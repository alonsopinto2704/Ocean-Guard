import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import { createHmac, timingSafeEqual } from 'crypto';
import { storage, StoredUser } from './src/server/storage.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const AI_SERVICE_URL = (process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const ESPADA_SERVICE_TOKEN = process.env.ESPADA_SERVICE_TOKEN || '';
const SESSION_SECRET = process.env.OCEANGUARD_SESSION_SECRET || '';
const PUBLIC_AI_UNAVAILABLE = 'Espada is temporarily unavailable. Image analysis is paused. Please try again shortly.';

function positiveTimeout(name: string, fallback: number) {
  const configured = Number(process.env[name]);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

const AI_REQUEST_TIMEOUT_MS = positiveTimeout('AI_SERVICE_REQUEST_TIMEOUT_MS', 6000);
const AI_DETECT_TIMEOUT_MS = positiveTimeout('AI_SERVICE_DETECT_TIMEOUT_MS', 60000);

function createSignedSession(user: StoredUser) {
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: expiresAt })).toString('base64url');
  const signature = createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return { token: `${payload}.${signature}`, expiresAt };
}

function findSessionUser(token: string) {
  if (!SESSION_SECRET) {
    const session = storage.findSession(token);
    return session ? storage.findUserById(session.userId) : undefined;
  }

  try {
    const [payload, suppliedSignature] = token.split('.');
    if (!payload || !suppliedSignature) return undefined;
    const expectedSignature = createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return undefined;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: string; exp?: string };
    if (!claims.sub || !claims.exp || Date.parse(claims.exp) <= Date.now()) return undefined;
    return storage.findUserById(claims.sub);
  } catch {
    return undefined;
  }
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

// Helper to strip sensitive security fields
/** Strip password hash + salt before any user object leaves the server. */
function sanitizeUser(u: StoredUser) {
  const { passwordHash, salt, ...safe } = u;
  return safe;
}

// ============================================================
// SSE CLIENTS
// ============================================================
const sseClients: Response[] = [];

function broadcastEvent(type: string, payload: any) {
  const msg = `data: ${JSON.stringify({ type, payload, timestamp: new Date().toISOString() })}\n\n`;
  sseClients.forEach((c: any) => {
    try {
      c.write(msg);
    } catch { /* client disconnected */ }
  });
}

// ============================================================
// AUTHENTICATION & RBAC MIDDLEWARE
// ============================================================
/** Bearer-token auth gate. Without allowedRoles any ACTIVE authenticated user
 *  passes; with a role set, non-members get 403. Attaches the user to res.locals. */
function requireApiUser(allowedRoles?: Set<string>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authorization = req.headers.authorization || '';
    const token = authorization.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      res.status(401).json({ message: 'Authentication is required.' });
      return;
    }

    const user = findSessionUser(token);

    if (!user) {
      res.status(401).json({ message: 'Session is invalid or has expired. Please sign in again.' });
      return;
    }

    if (user.status !== 'ACTIVE') {
      res.status(403).json({ message: 'This operator account has been deactivated or suspended.' });
      return;
    }

    if (allowedRoles && !allowedRoles.has(user.role)) {
      res.status(403).json({ message: `Access denied. Operator role ${user.role} does not have permission to perform this action.` });
      return;
    }

    res.locals.authenticatedUser = user;
    next();
  };
}

// Role sets for each protected route group (RBAC matrix).
const ALL_ROLES = new Set(['ADMIN', 'FIELD_OPERATOR', 'ENVIRONMENTAL_OFFICER', 'CLEANUP_TEAM']);
const ESPADA_REVIEW_ROLES = new Set(['ADMIN', 'FIELD_OPERATOR', 'ENVIRONMENTAL_OFFICER']);
const CLEANUP_MANAGE_ROLES = new Set(['ADMIN', 'FIELD_OPERATOR', 'CLEANUP_TEAM']);
const REPORT_GENERATE_ROLES = new Set(['ADMIN', 'ENVIRONMENTAL_OFFICER', 'FIELD_OPERATOR']);
const ADMIN_ROLES = new Set(['ADMIN']);

// ============================================================
// API ROUTES
// ============================================================

// Health
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ONLINE',
    version: '1.4.0',
    service: 'OceanGuard AI Backend',
    timestamp: new Date().toISOString(),
  });
});

// SSE
app.get('/api/events', (req: Request, res: Response) => {
  if (process.env.VERCEL) {
    res.status(204).end();
    return;
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  (res as any).flushHeaders();
  sseClients.push(res as any);
  (res as any).write(`data: ${JSON.stringify({ type: 'CONNECTED', message: 'OceanGuard Telemetry Stream Active' })}\n\n`);
  req.on('close', () => {
    const i = sseClients.indexOf(res as any);
    if (i !== -1) sseClients.splice(i, 1);
  });
});

// ── Auth ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ message: 'Email and password are required.' });
    return;
  }

  const user = storage.findUserByEmail(email);
  if (!user) {
    res.status(401).json({ message: 'Invalid email or password.' });
    return;
  }

  if (user.status !== 'ACTIVE') {
    res.status(403).json({ message: 'This operator account has been deactivated.' });
    return;
  }

  const valid = storage.verifyPassword(user, password);
  if (!valid) {
    res.status(401).json({ message: 'Invalid email or password.' });
    return;
  }

  const session = SESSION_SECRET ? createSignedSession(user) : storage.createSession(user);
  res.json({
    token: session.token,
    expiresAt: session.expiresAt,
    user: sanitizeUser(user),
  });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  const authorization = req.headers.authorization || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (token && !SESSION_SECRET) {
    storage.removeSession(token);
  }
  res.json({ success: true });
});

app.get('/api/auth/me', (req: Request, res: Response) => {
  const authorization = req.headers.authorization || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    res.status(401).json({ message: 'No authentication token provided.' });
    return;
  }

  const user = findSessionUser(token);

  if (!user || user.status !== 'ACTIVE') {
    res.status(401).json({ message: 'Invalid or expired session' });
    return;
  }
  res.json({ user: sanitizeUser(user) });
});

// Account recovery & password reset
app.post('/api/auth/recover', (_req: Request, res: Response) => {
  // Recovery needs a verified delivery channel; never return reset tokens publicly.
  res.status(503).json({ message: 'Self-service recovery is not configured. Contact your administrator to restore access.' });
});

app.post('/api/auth/reset-password', (req: Request, res: Response) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword || newPassword.length < 6) {
    res.status(400).json({ message: 'Valid token and minimum 6-character password are required.' });
    return;
  }
  const ok = storage.resetPasswordWithToken(token, newPassword);
  if (!ok) {
    res.status(400).json({ message: 'Invalid or expired recovery token.' });
    return;
  }
  res.json({ success: true, message: 'Password updated successfully. You may now sign in.' });
});

// ── Public Portal Access Requests ───────────────────────────────────────────
app.post('/api/access-requests', (req: Request, res: Response) => {
  const { organization, email } = req.body;
  if (!organization || !organization.trim() || !email || !email.trim()) {
    res.status(400).json({ message: 'Organization name and institutional email are required.' });
    return;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    res.status(400).json({ message: 'Please provide a valid institutional email address.' });
    return;
  }

  const accessReq = storage.createAccessRequest(organization, email);
  res.status(201).json({
    success: true,
    message: `Sentinel access request ${accessReq.id} recorded for ${accessReq.organization}.`,
    request: accessReq,
  });
});

app.get('/api/admin/access-requests', requireApiUser(ADMIN_ROLES), (_req: Request, res: Response) => {
  res.json({ requests: storage.getAccessRequests() });
});

// ── Dashboard ────────────────────────────────────────────────────────────────
app.get('/api/dashboard/summary', async (_req: Request, res: Response) => {
  let aiStatus = 'MODEL_ERROR';
  try {
    const espada = await fetchAiJson('/v1/model');
    aiStatus = espada.ready ? 'RUNNING' : espada.state === 'ERROR' ? 'MODEL_ERROR' : 'STOPPED';
  } catch { /* The dashboard remains available while Espada is offline. */ }

  const detections = storage.getDetections();
  const criticalCount = detections.filter(d => d.riskLevel === 'CRITICAL' || d.riskLevel === 'HIGH').length;
  const hotspots = storage.getHotspots();
  const activeAlerts = storage.getAlerts().filter(a => ['TRIGGERED', 'ACKNOWLEDGED', 'ACTION_REQUIRED', 'ASSIGNED'].includes(a.status));
  const activeMissions = storage.getCleanupMissions().filter(m => ['IN_PROGRESS', 'ASSIGNED', 'SCHEDULED'].includes(m.status));
  const cameras = storage.getCameras();
  const onlineCameras = cameras.filter(c => c.status === 'STREAMING' || c.status === 'ONLINE').length;

  res.json({
    debrisDetected: detections.length,
    highRiskIncidents: criticalCount,
    activeHotspots: hotspots.filter(h => h.status === 'ACTIVE').length,
    activeAlerts: activeAlerts.length,
    cleanupMissions: activeMissions.length,
    camerasOnline: `${onlineCameras}/${cameras.length}`,
    systemStatus: 'ONLINE',
    aiStatus,
  });
});

app.get('/api/dashboard/trends', (_req: Request, res: Response) => {
  res.json({
    history: [
      { date: 'Aug 24', plastic: 142, fishingGear: 48, metalGlass: 28, other: 14 },
      { date: 'Aug 25', plastic: 168, fishingGear: 52, metalGlass: 31, other: 19 },
      { date: 'Aug 26', plastic: 155, fishingGear: 60, metalGlass: 29, other: 16 },
      { date: 'Aug 27', plastic: 184, fishingGear: 74, metalGlass: 34, other: 22 },
      { date: 'Aug 28', plastic: 190, fishingGear: 82, metalGlass: 38, other: 25 },
      { date: 'Aug 29', plastic: 215, fishingGear: 94, metalGlass: 42, other: 28 },
      { date: 'Aug 30', plastic: 232, fishingGear: 104, metalGlass: 46, other: 30 },
    ],
  });
});

app.get('/api/dashboard/system-health', async (_req: Request, res: Response) => {
  let ai = 'MODEL_ERROR';
  let aiLatencyMs = 0;
  try {
    const espada = await fetchAiJson('/v1/model');
    ai = espada.ready ? 'RUNNING' : espada.state === 'ERROR' ? 'MODEL_ERROR' : 'STOPPED';
    aiLatencyMs = espada.metrics?.inferenceMs ?? 0;
  } catch { /* Report a model error without taking down the main application. */ }

  const cameras = storage.getCameras();
  const activeCameras = cameras.filter(c => c.status === 'STREAMING' || c.status === 'ONLINE').length;

  res.json({
    system: 'ONLINE',
    camera: activeCameras > 0 ? 'STREAMING' : 'NO_SIGNAL',
    ai,
    gps: 'VALID',
    internet: 'ONLINE',
    activeCameras,
    totalCameras: cameras.length,
    aiLatencyMs,
    fps: 29.8,
    uptime: '99.7%',
  });
});

app.get('/api/dashboard/recent-detections', (_req: Request, res: Response) => {
  res.json({ detections: storage.getDetections().slice(0, 5) });
});

app.get('/api/dashboard/alerts', (_req: Request, res: Response) => {
  res.json({
    alerts: storage.getAlerts().filter(a => ['TRIGGERED', 'ACKNOWLEDGED', 'ACTION_REQUIRED'].includes(a.status)).slice(0, 5),
  });
});

// ── Monitoring ───────────────────────────────────────────────────────────────
app.get('/api/monitoring/cameras', (_req: Request, res: Response) => {
  res.json({ cameras: storage.getCameras() });
});

app.get('/api/monitoring/cameras/:id', (req: Request, res: Response) => {
  const cam = storage.getCameraById(req.params.id);
  if (!cam) {
    res.status(404).json({ message: `Camera ${req.params.id} not found.` });
    return;
  }
  res.json(cam);
});

app.patch('/api/monitoring/cameras/:id', requireApiUser(ALL_ROLES), (req: Request, res: Response) => {
  const user = res.locals.authenticatedUser as StoredUser;
  const updated = storage.updateCamera(req.params.id, req.body, { id: user.id, email: user.email });
  if (!updated) {
    res.status(404).json({ message: `Camera ${req.params.id} not found.` });
    return;
  }
  broadcastEvent('CAMERA_UPDATE', updated);
  res.json(updated);
});

// ── Devices & Fleet ─────────────────────────────────────────────────────────
app.get('/api/devices', (_req: Request, res: Response) => {
  res.json({ devices: storage.getDevices() });
});

app.get('/api/devices/:id', (req: Request, res: Response) => {
  const d = storage.getDeviceById(req.params.id);
  if (!d) {
    res.status(404).json({ message: `Device ${req.params.id} not found.` });
    return;
  }
  res.json(d);
});

app.patch('/api/devices/:id', requireApiUser(ALL_ROLES), (req: Request, res: Response) => {
  const user = res.locals.authenticatedUser as StoredUser;
  const updated = storage.updateDevice(req.params.id, req.body, { id: user.id, email: user.email });
  if (!updated) {
    res.status(404).json({ message: `Device ${req.params.id} not found.` });
    return;
  }
  broadcastEvent('DEVICE_UPDATE', updated);
  res.json(updated);
});

// ── Detections ───────────────────────────────────────────────────────────────
app.get('/api/detections', (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const riskLevel = typeof req.query.riskLevel === 'string' ? req.query.riskLevel : undefined;
  const query = typeof req.query.q === 'string' ? req.query.q : undefined;

  const detections = storage.getDetections({ status, riskLevel, query });
  res.json({ detections, total: detections.length });
});

app.get('/api/detections/:id', (req: Request, res: Response) => {
  const d = storage.getDetectionById(req.params.id);
  if (!d) {
    res.status(404).json({ message: `Detection ${req.params.id} not found.` });
    return;
  }
  res.json(d);
});

app.get('/api/detections/:id/track', (req: Request, res: Response) => {
  const d = storage.getDetectionById(req.params.id);
  if (!d) {
    res.status(404).json({ message: `Detection ${req.params.id} not found.` });
    return;
  }
  const points = d.trackPoints && d.trackPoints.length > 0
    ? d.trackPoints
    : [
        { lat: d.lat - 0.02, lng: d.lng + 0.02, timestamp: new Date(Date.now() - 35 * 60000).toISOString(), confidence: 87 },
        { lat: d.lat - 0.01, lng: d.lng + 0.01, timestamp: new Date(Date.now() - 20 * 60000).toISOString(), confidence: 88 },
        { lat: d.lat, lng: d.lng, timestamp: d.detectedAt, confidence: d.confidence },
      ];

  res.json({
    id: d.trackId,
    detectionId: d.id,
    className: d.className,
    status: 'ACTIVE',
    firstSeen: points[0].timestamp,
    lastSeen: points[points.length - 1].timestamp,
    currentLat: d.lat,
    currentLng: d.lng,
    velocity: 0.4,
    heading: 320,
    confidence: d.confidence,
    points,
  });
});

app.patch('/api/detections/:id/status', requireApiUser(ESPADA_REVIEW_ROLES), (req: Request, res: Response) => {
  const status = req.body.status;
  if (!status) {
    res.status(400).json({ message: 'Status is required.' });
    return;
  }
  const user = res.locals.authenticatedUser as StoredUser;
  const updated = storage.updateDetectionStatus(req.params.id, status, { id: user.id, email: user.email });
  if (!updated) {
    res.status(404).json({ message: `Detection ${req.params.id} not found.` });
    return;
  }
  broadcastEvent('DETECTION_UPDATE', updated);
  res.json(updated);
});

// ── Alerts ───────────────────────────────────────────────────────────────────
app.get('/api/alerts', (_req: Request, res: Response) => {
  res.json({ alerts: storage.getAlerts() });
});

app.get('/api/alerts/:id', (req: Request, res: Response) => {
  const a = storage.getAlertById(req.params.id);
  if (!a) {
    res.status(404).json({ message: `Alert ${req.params.id} not found.` });
    return;
  }
  res.json(a);
});

app.patch('/api/alerts/:id/status', requireApiUser(ALL_ROLES), (req: Request, res: Response) => {
  const user = res.locals.authenticatedUser as StoredUser;
  const updated = storage.updateAlertStatus(req.params.id, req.body.status, undefined, { id: user.id, email: user.email });
  if (!updated) {
    res.status(404).json({ message: `Alert ${req.params.id} not found.` });
    return;
  }
  broadcastEvent('ALERT_UPDATE', updated);
  res.json(updated);
});

app.post('/api/alerts/:id/assign', requireApiUser(ALL_ROLES), (req: Request, res: Response) => {
  const user = res.locals.authenticatedUser as StoredUser;
  const updated = storage.updateAlertStatus(req.params.id, 'ASSIGNED', req.body.assignedTo, { id: user.id, email: user.email });
  if (!updated) {
    res.status(404).json({ message: `Alert ${req.params.id} not found.` });
    return;
  }
  broadcastEvent('ALERT_UPDATE', updated);
  res.json(updated);
});

// ── Hotspots ─────────────────────────────────────────────────────────────────
// IMPORTANT: /api/hotspots/heatmap MUST be registered BEFORE /api/hotspots/:id
app.get('/api/hotspots/heatmap', (_req: Request, res: Response) => {
  const points = storage.getHotspots().map(h => [h.lat, h.lng, h.detectionCount / 100]);
  res.json({ points });
});

app.get('/api/hotspots', (_req: Request, res: Response) => {
  res.json({ hotspots: storage.getHotspots() });
});

app.get('/api/hotspots/:id', (req: Request, res: Response) => {
  const h = storage.getHotspotById(req.params.id);
  if (!h) {
    res.status(404).json({ message: `Hotspot ${req.params.id} not found.` });
    return;
  }
  res.json(h);
});

// ── Cleanup ──────────────────────────────────────────────────────────────────
app.get('/api/cleanup/missions', (_req: Request, res: Response) => {
  res.json({ missions: storage.getCleanupMissions() });
});

app.get('/api/cleanup/missions/:id', (req: Request, res: Response) => {
  const m = storage.getCleanupMissionById(req.params.id);
  if (!m) {
    res.status(404).json({ message: `Cleanup mission ${req.params.id} not found.` });
    return;
  }
  res.json(m);
});

app.post('/api/cleanup/missions', requireApiUser(CLEANUP_MANAGE_ROLES), (req: Request, res: Response) => {
  const user = res.locals.authenticatedUser as StoredUser;
  const newMission = storage.createCleanupMission(req.body, { id: user.id, email: user.email, name: user.name });
  broadcastEvent('CLEANUP_UPDATE', newMission);
  res.status(201).json(newMission);
});

app.patch('/api/cleanup/missions/:id', requireApiUser(CLEANUP_MANAGE_ROLES), (req: Request, res: Response) => {
  const user = res.locals.authenticatedUser as StoredUser;
  const updated = storage.updateCleanupMission(req.params.id, req.body, { id: user.id, email: user.email, name: user.name });
  if (!updated) {
    res.status(404).json({ message: `Cleanup mission ${req.params.id} not found.` });
    return;
  }
  broadcastEvent('CLEANUP_UPDATE', updated);
  res.json(updated);
});

app.post('/api/cleanup/missions/:id/evidence', requireApiUser(CLEANUP_MANAGE_ROLES), (req: Request, res: Response) => {
  const user = res.locals.authenticatedUser as StoredUser;
  const evidence = storage.addCleanupEvidence(req.params.id, req.body, { id: user.id, email: user.email, name: user.name });
  if (!evidence) {
    res.status(404).json({ message: `Cleanup mission ${req.params.id} not found.` });
    return;
  }
  const updatedMission = storage.getCleanupMissionById(req.params.id);
  broadcastEvent('CLEANUP_UPDATE', updatedMission);
  res.status(201).json(evidence);
});

// REDUNDANCY FIX: the /api/devices routes were previously registered twice.
// Express matches routes in registration order, so this second (stricter)
// block never executed — dead code that also silently differed from the
// live PATCH handler by skipping the DEVICE_UPDATE SSE broadcast.
// It has been removed; the authoritative handlers live in the earlier block.

// ── AI Models ────────────────────────────────────────────────────────────────
/** Proxy a request to the Espada inference service with per-route timeouts,
 *  normalizing FastAPI validation errors into readable messages. */
async function fetchAiJson(pathname: string, init?: RequestInit) {
  let response: globalThis.Response;
  const timeoutMs = pathname === '/v1/detect' ? AI_DETECT_TIMEOUT_MS : AI_REQUEST_TIMEOUT_MS;
  try {
    response = await fetch(`${AI_SERVICE_URL}${pathname}`, {
      ...init,
      headers: {
        ...(ESPADA_SERVICE_TOKEN ? { 'X-Espada-Service-Token': ESPADA_SERVICE_TOKEN } : {}),
        ...init?.headers,
      },
      signal: init?.signal || AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    const timedOut = cause instanceof Error && (
      cause.name === 'TimeoutError'
      || cause.name === 'AbortError'
    );
    console.error(`[ESPADA] ${timedOut ? 'Request timed out' : 'Service unavailable'} for ${pathname}:`, cause);
    const error = new Error(PUBLIC_AI_UNAVAILABLE) as Error & { status?: number };
    error.status = 503;
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const validationDetails = Array.isArray(payload.detail)
      ? payload.detail
        .map((item: any) => {
          if (!item || typeof item.msg !== 'string') return null;
          const cleanMsg = item.msg.replace(/^Value error,\s*/i, '');
          const location = Array.isArray(item.loc) ? item.loc.slice(1).join('.') : '';
          return location ? `${location}: ${cleanMsg}` : cleanMsg;
        })
        .filter(Boolean)
        .join('; ')
      : '';
    const upstreamMessage = typeof payload.detail === 'string'
      ? payload.detail
      : validationDetails || `Espada service returned HTTP ${response.status}`;
    console.error(`[ESPADA] Upstream ${response.status} for ${pathname}:`, upstreamMessage);
    const message = response.status >= 500 ? PUBLIC_AI_UNAVAILABLE : upstreamMessage;
    const error = new Error(message) as Error & { status?: number; details?: any };
    error.status = response.status;
    error.details = payload.detail;
    throw error;
  }
  return payload;
}

function offlineModelStatus(error: unknown) {
  return {
    state: 'OFFLINE',
    ready: false,
    service: 'Espada Intelligence',
    engine: 'ONNX Runtime',
    modelName: 'Espada',
    version: '1',
    architecture: 'SSDLite320 MobileNetV3',
    classes: ['Mixed Waste'],
    inputSize: 320,
    confidenceThreshold: 0.25,
    confidenceCalibration: 'unavailable',
    metrics: null,
    learning: null,
    error: PUBLIC_AI_UNAVAILABLE,
  };
}

app.get('/api/ai/status', async (_req: Request, res: Response) => {
  try {
    res.json(await fetchAiJson('/v1/model'));
  } catch (error) {
    res.json(offlineModelStatus(error));
  }
});

app.get('/api/ai/models', async (_req: Request, res: Response) => {
  let status: any;
  try {
    status = await fetchAiJson('/v1/model');
  } catch (error) {
    status = offlineModelStatus(error);
  }
  const metrics = status.metrics || {};
  const asPercent = (value: unknown) => typeof value === 'number'
    ? (value <= 1 ? value * 100 : value)
    : null;
  res.json({
    models: [{
      id: 'ESPADA-1',
      name: 'Espada',
      version: '1',
      type: 'DETECTION',
      status: status.ready ? 'ACTIVE' : status.state === 'ERROR' ? 'ERROR' : 'INACTIVE',
      mAP: metrics.map50 ?? null,
      precision: asPercent(metrics.iou50Precision),
      recall: asPercent(metrics.iou50Recall),
      f1Score: asPercent(metrics.iou50F1),
      inferenceMs: metrics.inferenceMs ?? null,
      classes: status.classes || ['Mixed Waste'],
      trainedAt: status.trainedAt ?? null,
      deployedAt: status.deployedAt ?? null,
      framework: `${status.architecture} → ${status.engine}`,
      size: status.modelSize ?? null,
      description: 'OceanGuard real-time marine-debris detector with reviewed-feedback continual learning.',
    }],
  });
});

app.post(
  '/api/ai/infer-image',
  requireApiUser(),
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '4mb' }),
  async (req: Request, res: Response) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ message: 'Upload a JPG, PNG, or WebP image.' });
      return;
    }

    let filename = String(req.headers['x-file-name'] || 'espada-frame.jpg');
    try { filename = decodeURIComponent(filename); } catch { /* Keep safe raw value. */ }
    const contentType = String(req.headers['content-type'] || 'image/jpeg');
    const form = new FormData();
    form.append('file', new Blob([req.body as any], { type: contentType }), filename);

    try {
      res.json(await fetchAiJson('/v1/detect', { method: 'POST', body: form }));
    } catch (error) {
      const status = (error as Error & { status?: number }).status || 502;
      res.status(status).json({ message: error instanceof Error ? error.message : 'Espada inference failed.' });
    }
  },
);

app.post('/api/ai/feedback', requireApiUser(ESPADA_REVIEW_ROLES), (_req: Request, res: Response) => {
  res.status(410).json({
    message: 'The per-box feedback endpoint was retired. Use whole-frame review at PUT /api/ai/analyses/:analysisId/review.',
  });
});

app.put('/api/ai/analyses/:analysisId/review', requireApiUser(ESPADA_REVIEW_ROLES), async (req: Request, res: Response) => {
  const reviewer = (res.locals.authenticatedUser as StoredUser).email;
  try {
    res.json(await fetchAiJson(`/v1/analyses/${encodeURIComponent(req.params.analysisId)}/review`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...req.body, reviewer }),
    }));
  } catch (error) {
    const status = (error as Error & { status?: number }).status || 502;
    res.status(status).json({ message: error instanceof Error ? error.message : 'Frame review could not be saved.' });
  }
});

app.get('/api/ai/learning', async (_req: Request, res: Response) => {
  try {
    res.json(await fetchAiJson('/v1/learning'));
  } catch (error) {
    res.status(502).json({ message: error instanceof Error ? error.message : 'Learning service is offline.' });
  }
});

app.post('/api/ai/infer', (_req: Request, res: Response) => {
  res.status(410).json({
    message: 'The simulated inference route was removed. Upload image bytes to /api/ai/infer-image.',
  });
});

// ── Analytics ────────────────────────────────────────────────────────────────
app.get('/api/analytics/overview', (_req: Request, res: Response) => {
  const detections = storage.getDetections();
  const missions = storage.getCleanupMissions();
  const clearedKg = missions.reduce((acc, m) => {
    const fromEvidence = m.evidence.reduce((eAcc, e) => eAcc + (e.recoveredKg || 0), 0);
    return acc + (fromEvidence > 0 ? fromEvidence : m.status === 'COMPLETED' ? m.estimatedMassKg : 0);
  }, 0);

  res.json({
    totalDetections: detections.length,
    criticalAlerts: storage.getAlerts().filter(a => a.priority === 'CRITICAL').length,
    activeMissions: missions.filter(m => m.status === 'IN_PROGRESS' || m.status === 'ASSIGNED').length,
    clearedKg: clearedKg || 2840,
    responseTimeH: 1.8,
    aiAccuracy: null,
  });
});

app.get('/api/analytics/trends', (req: Request, res: Response) => {
  const period = String(req.query.period ?? '7d').toLowerCase();
  let data = [142, 168, 155, 184, 190, 215, 232];
  if (period === 'today' || period === '1d') {
    data = [12, 19, 15, 24, 32, 28, 35, 42];
  } else if (period === '30d' || period === '30 days') {
    data = [110, 125, 142, 138, 155, 162, 178, 184, 195, 210, 205, 220, 232];
  }
  res.json({ period, data });
});

app.get('/api/analytics/categories', (_req: Request, res: Response) => {
  res.json([
    { name: 'Plastic', value: 638 },
    { name: 'Fishing Gear', value: 312 },
    { name: 'Metal/Glass', value: 198 },
    { name: 'Organic', value: 89 },
    { name: 'Unknown', value: 47 },
  ]);
});

// ── Media ────────────────────────────────────────────────────────────────────
app.get('/api/media', (_req: Request, res: Response) => {
  res.json({ files: [] });
});

app.post('/api/media/:id/process', (req: Request, res: Response) => {
  res.json({ id: `JOB-${Date.now()}`, mediaId: req.params.id, status: 'QUEUED', progress: 0, stages: [] });
});

// ── Reports ──────────────────────────────────────────────────────────────────
app.get('/api/reports', requireApiUser(REPORT_GENERATE_ROLES), (_req: Request, res: Response) => {
  res.json({ reports: storage.getReports() });
});

app.get('/api/reports/:id', requireApiUser(REPORT_GENERATE_ROLES), (req: Request, res: Response) => {
  const r = storage.getReportById(req.params.id);
  if (!r) {
    res.status(404).json({ message: `Report ${req.params.id} not found.` });
    return;
  }
  res.json(r);
});

app.post('/api/reports/generate', requireApiUser(REPORT_GENERATE_ROLES), (req: Request, res: Response) => {
  const { type = 'DAILY', zoneId = 'ALL', startDate, endDate } = req.body;
  const user = res.locals.authenticatedUser as StoredUser;
  const report = storage.createReport(
    { type, zoneId, startDate, endDate },
    { id: user.id, email: user.email, name: user.name },
  );
  res.status(201).json(report);
});

app.get('/api/reports/:id/download', requireApiUser(ALL_ROLES), (req: Request, res: Response) => {
  const r = storage.getReportById(req.params.id);
  if (!r) {
    res.status(404).json({ message: `Report ${req.params.id} not found.` });
    return;
  }
  const format = String(req.query.format || 'json').toLowerCase();

  if (format === 'csv') {
    const csvContent = [
      'Report ID,Type,Zone,Generated At,Generated By,Total Detections,Critical Incidents,Cleared Debris (kg),Mean Response (h),Predominant Class',
      `"${r.id}","${r.type}","${r.zoneId}","${r.generatedAt}","${r.generatedBy}",${r.metrics.totalDetectionsPeriod},${r.metrics.criticalIncidents},${r.metrics.clearedDebrisKg},${r.metrics.meanResponseTimeHours},"${r.metrics.predominantClass}"`,
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${r.id}.csv"`);
    res.send(csvContent);
    return;
  }

  if (format === 'pdf' || format === 'html') {
    const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>OceanGuard Report — ${escapeHtml(r.id)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #0f172a; max-width: 800px; margin: 0 auto; }
    h1 { color: #0891b2; margin-bottom: 4px; }
    .header { border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 24px; }
    .meta { font-size: 13px; color: #64748b; margin-top: 4px; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 24px; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
    .card-label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: bold; }
    .card-val { font-size: 24px; font-weight: bold; color: #0891b2; margin-top: 4px; }
    .summary { line-height: 1.6; color: #334155; margin-bottom: 24px; }
    .footer { font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>OceanGuard Environmental Intelligence Report</h1>
    <div class="meta">Report ID: <strong>${escapeHtml(r.id)}</strong> | Type: <strong>${escapeHtml(r.type)}</strong> | Zone: <strong>${escapeHtml(r.zoneId)}</strong></div>
    <div class="meta">Generated on ${new Date(r.generatedAt).toLocaleString()} by ${escapeHtml(r.generatedBy)}</div>
  </div>
  <div class="grid">
    <div class="card"><div class="card-label">Total Detections</div><div class="card-val">${escapeHtml(r.metrics.totalDetectionsPeriod)}</div></div>
    <div class="card"><div class="card-label">Critical Incidents</div><div class="card-val">${escapeHtml(r.metrics.criticalIncidents)}</div></div>
    <div class="card"><div class="card-label">Cleared Debris</div><div class="card-val">${escapeHtml(r.metrics.clearedDebrisKg)} kg</div></div>
    <div class="card"><div class="card-label">Mean Response Time</div><div class="card-val">${escapeHtml(r.metrics.meanResponseTimeHours)} hrs</div></div>
  </div>
  <h3>Operational Summary</h3>
  <p class="summary">${escapeHtml(r.summaryText)}</p>
  <p class="summary"><strong>Predominant Pollutant Class:</strong> ${escapeHtml(r.metrics.predominantClass)}</p>
  <div class="footer">OceanGuard AI Platform — Self-Hosted Ecological Telemetry — UN SDG 14 Compliant</div>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${r.id}.html"`);
    res.send(html);
    return;
  }

  // Default JSON download
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${r.id}.json"`);
  res.send(JSON.stringify(r, null, 2));
});

// ── Admin ────────────────────────────────────────────────────────────────────
app.get('/api/admin/users', requireApiUser(ADMIN_ROLES), (_req: Request, res: Response) => {
  res.json({ users: storage.getAllUsers().map(sanitizeUser) });
});

app.post('/api/admin/users', requireApiUser(ADMIN_ROLES), (req: Request, res: Response) => {
  const { name, email, password, role, roleTitle, organizationName } = req.body;
  if (!name || !email || !role || !roleTitle || !organizationName) {
    res.status(400).json({ message: 'All user profile fields are required.' });
    return;
  }

  const existing = storage.findUserByEmail(email);
  if (existing) {
    res.status(400).json({ message: `A user with email ${email} already exists.` });
    return;
  }

  const currentUser = res.locals.authenticatedUser as StoredUser;
  const created = storage.createUser(
    { name, email, password, role, roleTitle, organizationName },
    { id: currentUser.id, email: currentUser.email },
  );
  res.status(201).json(sanitizeUser(created));
});

app.patch('/api/admin/users/:id', requireApiUser(ADMIN_ROLES), (req: Request, res: Response) => {
  const allowed = new Set(['name', 'email', 'role', 'roleTitle', 'organizationName', 'status']);
  if (Object.entries(req.body).some(([key, value]) => !allowed.has(key) || typeof value !== 'string' || !value.trim()) ||
      (req.body.role && !ALL_ROLES.has(req.body.role)) ||
      (req.body.status && !['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(req.body.status))) {
    res.status(400).json({ message: 'Only valid user profile fields may be updated.' });
    return;
  }
  const duplicate = req.body.email && storage.findUserByEmail(req.body.email);
  if (duplicate && duplicate.id !== req.params.id) {
    res.status(409).json({ message: 'That email address is already in use.' });
    return;
  }
  const currentUser = res.locals.authenticatedUser as StoredUser;
  const updated = storage.updateUser(req.params.id, req.body, { id: currentUser.id, email: currentUser.email });
  if (!updated) {
    res.status(404).json({ message: `User ${req.params.id} not found.` });
    return;
  }
  res.json(sanitizeUser(updated));
});

app.get('/api/admin/thresholds', (_req: Request, res: Response) => {
  res.json({ thresholds: storage.getThresholds() });
});

app.put('/api/admin/thresholds', requireApiUser(ADMIN_ROLES), (req: Request, res: Response) => {
  const { thresholds } = req.body;
  if (!Array.isArray(thresholds)) {
    res.status(400).json({ message: 'Thresholds must be an array.' });
    return;
  }
  const currentUser = res.locals.authenticatedUser as StoredUser;
  const updated = storage.updateThresholds(thresholds, { id: currentUser.id, email: currentUser.email });
  res.json({ thresholds: updated });
});

app.get('/api/admin/audit-log', requireApiUser(ADMIN_ROLES), (_req: Request, res: Response) => {
  res.json({ auditLog: storage.getAuditLog() });
});

// ============================================================
// SSE BROADCAST — live telemetry feed based on real records
// ============================================================
// Every 10s, push a random real detection to all connected SSE clients so the
// Command Center feed stays live without a websocket layer. (Skipped on Vercel,
// where long-lived intervals/SSE are not supported.)
if (!process.env.VERCEL) {
  setInterval(() => {
    const detections = storage.getDetections();
    if (detections.length > 0) {
      const sample = detections[Math.floor(Math.random() * detections.length)];
      broadcastEvent('DETECTION_TELEMETRY', {
        id: sample.id,
        className: sample.className,
        confidence: sample.confidence,
        riskScore: sample.riskScore,
        lat: sample.lat,
        lng: sample.lng,
        timestamp: new Date().toISOString(),
      });
    }
  }, 10000);
}

// 404 handler for unknown API routes — prevents unmatched API requests from falling through to Vite or SPA HTML
app.all('/api/*', (_req: Request, res: Response) => {
  res.status(404).json({ message: 'API route not found' });
});

// Global error handling middleware
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[API ERROR]', err);
  if (!res.headersSent) {
    const status = Number.isInteger(err.status) ? err.status : 500;
    const message = status >= 500
      ? 'The request could not be completed. Please try again.'
      : err.message || 'The request could not be completed. Please try again.';
    res.status(status).json({ message });
  }
});

// ============================================================
// VITE DEV SERVER OR STATIC
// ============================================================
/** Boot the full-stack server: Vite dev middleware in development, or the built
 *  static SPA bundle with an index.html fallback in production. */
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`\n🌊 OceanGuard AI — Full-stack Server`);
    console.log(`   → http://localhost:${PORT}`);
    console.log(`   → API: http://localhost:${PORT}/api/health`);
    console.log(`\n📋 Demo Accounts:`);
    console.log(`   admin@oceanguard.ai    — Admin`);
    console.log(`   operator@oceanguard.ai — Field Operator`);
    console.log(`   officer@oceanguard.ai  — Environmental Officer`);
    console.log(`   cleanup@oceanguard.ai  — Cleanup Team`);
    console.log(`   Password: demo1234\n`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ Error: Port ${PORT} is already in use by another application.`);
      console.error(`   Free up port ${PORT} or specify a different port with: PORT=${PORT + 1} npm run dev\n`);
    } else {
      console.error('\n❌ Server error:', err);
    }
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
