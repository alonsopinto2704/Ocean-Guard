import express, { Request, Response } from 'express';
import path from 'path';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const AI_SERVICE_URL = (process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

// ============================================================
// MOCK DATABASE
// ============================================================
const mockDb = {
  users: [
    { id: 'USR-01', name: 'Cmdr. Elena Vance',   email: 'admin@oceanguard.ai',    role: 'ADMIN',                roleTitle: 'Chief Operations Administrator', organizationName: 'OceanGuard Central Command', status: 'ACTIVE' },
    { id: 'USR-02', name: 'Marcus Brody',         email: 'operator@oceanguard.ai', role: 'FIELD_OPERATOR',       roleTitle: 'Senior Marine Radar & Drone Pilot', organizationName: 'OceanGuard Coastal Watch', status: 'ACTIVE' },
    { id: 'USR-03', name: 'Dr. Asha Rao',         email: 'officer@oceanguard.ai',  role: 'ENVIRONMENTAL_OFFICER', roleTitle: 'Lead Oceanographer', organizationName: 'Coastal Environmental Unit', status: 'ACTIVE' },
    { id: 'USR-04', name: 'Captain Javier Silva', email: 'cleanup@oceanguard.ai',  role: 'CLEANUP_TEAM',         roleTitle: 'Coastal Team A Lead', organizationName: 'Rapid Marine Cleanup Fleet', status: 'ACTIVE' },
  ],
  detectionsCount: 1284,
  highRiskCount:   21,
  hotspotsCount:   18,
  activeAlertsCount: 7,
  onlineCameras: '14/15',
};

const DETECTIONS = [
  { id: 'DET-1042', trackId: 'TRK-1042', className: 'Fishing Net',    category: 'Fishing Gear', confidence: 89, status: 'TRACKING',   riskScore: 89, riskLevel: 'CRITICAL', estimatedSize: '3.6 m²', estimatedDistance: '420m', estimatedMassKg: 16.2, lat: 35.1,  lng: -158.3, locationLabel: 'Zone 4 N · Pacific',    cameraId: 'CAM-04', cameraName: 'Alpha 4', zoneId: 'Z4', zoneName: 'Zone 4', detectedAt: new Date(Date.now() - 5  * 60000).toISOString(), source: 'CAMERA', riskFactors: [{label:'Large size',score:24},{label:'High density',score:20},{label:'Shipping route',score:18},{label:'Moving',score:14},{label:'Sensitive zone',score:13}] },
  { id: 'DET-1105', trackId: 'TRK-1105', className: 'Rope',           category: 'Fishing Gear', confidence: 77, status: 'NEW',        riskScore: 38, riskLevel: 'MEDIUM',   estimatedSize: '1.2 m²', estimatedDistance: '280m', estimatedMassKg: 2.1,  lat: 20.4,  lng: 145.6,  locationLabel: 'Zone 2 · W Pacific',    cameraId: 'CAM-08', cameraName: 'Gamma 8', zoneId: 'Z2', zoneName: 'Zone 2', detectedAt: new Date(Date.now() - 28 * 60000).toISOString(), source: 'CAMERA', riskFactors: [] },
  { id: 'DET-1210', trackId: 'TRK-1210', className: 'Mixed Waste',    category: 'Unknown',      confidence: 68, status: 'VALIDATING', riskScore: 72, riskLevel: 'HIGH',     estimatedSize: '5.1 m²', estimatedDistance: '620m', estimatedMassKg: 28.4, lat: 35.1,  lng: -148.4, locationLabel: 'Zone 4 S · Pacific',   cameraId: 'CAM-04', cameraName: 'Alpha 4', zoneId: 'Z4', zoneName: 'Zone 4', detectedAt: new Date(Date.now() - 42 * 60000).toISOString(), source: 'UPLOAD',  riskFactors: [] },
  { id: 'DET-0902', trackId: 'TRK-902',  className: 'Plastic Bottle', category: 'Plastic',      confidence: 94, status: 'CONFIRMED',  riskScore: 42, riskLevel: 'MEDIUM',   estimatedSize: '0.5 m²', estimatedDistance: '140m', estimatedMassKg: 0.9,  lat: 28.5,  lng: -140.2, locationLabel: 'Pacific Gyre · Sector A', cameraId: 'CAM-02', cameraName: 'Beta 2', zoneId: 'Z1', zoneName: 'Zone 1', detectedAt: new Date(Date.now() - 12 * 60000).toISOString(), source: 'DRONE', riskFactors: [] },
  { id: 'DET-0988', trackId: 'TRK-988',  className: 'Plastic Bag',    category: 'Plastic',      confidence: 91, status: 'CONFIRMED',  riskScore: 55, riskLevel: 'MEDIUM',   estimatedSize: '0.9 m²', estimatedDistance: '190m', estimatedMassKg: 0.6,  lat: 14.2,  lng: -155.8, locationLabel: 'Zone 1 · N Pacific',    cameraId: 'CAM-01', cameraName: 'Alpha 1', zoneId: 'Z1', zoneName: 'Zone 1', detectedAt: new Date(Date.now() - 18 * 60000).toISOString(), source: 'CAMERA', riskFactors: [] },
];

const ALERTS = [
  { id: 'ALT-001', type: 'RISK_THRESHOLD', title: 'Large Debris Cluster Detected',      priority: 'CRITICAL', status: 'TRIGGERED',     triggeredAt: new Date(Date.now() -  8*60000).toISOString(), lat: 35.1, lng: -158.3, locationLabel: 'Zone 4 N · Pacific', description: '47-item cluster identified near Zone 4', detectionId: 'DET-1042' },
  { id: 'ALT-002', type: 'DETECTION',      title: 'Fishing Net — Track #1042',          priority: 'HIGH',     status: 'ACKNOWLEDGED',  triggeredAt: new Date(Date.now() - 22*60000).toISOString(), lat: 28.5, lng: -140.2, locationLabel: 'Pacific Gyre', description: '3.6m² net moving at 0.4 m/s', detectionId: 'DET-1042' },
  { id: 'ALT-003', type: 'DEVICE',         title: 'Camera CAM-15 Offline',              priority: 'MEDIUM',   status: 'INVESTIGATING', triggeredAt: new Date(Date.now() - 47*60000).toISOString(), lat: 24.0, lng: -138.0, locationLabel: 'Sector B', description: 'No heartbeat for 12 minutes' },
  { id: 'ALT-004', type: 'RISK_THRESHOLD', title: 'High Density — Sector A',            priority: 'HIGH',     status: 'ACTION_REQUIRED', triggeredAt: new Date(Date.now() - 95*60000).toISOString(), lat: 14.2, lng: -155.8, locationLabel: 'Sector A', description: '42 detections in 2km radius' },
  { id: 'ALT-005', type: 'DETECTION',      title: 'Plastic Debris — Track #988',        priority: 'HIGH',     status: 'ASSIGNED',      triggeredAt: new Date(Date.now()-140*60000).toISOString(), lat: 32.1, lng: -148.4, locationLabel: 'Zone 2 Coastal', description: 'Mixed plastic cluster 82 kg', detectionId: 'DET-0988' },
  { id: 'ALT-006', type: 'ZONE_BREACH',    title: 'Debris in Marine Sanctuary Zone',   priority: 'CRITICAL', status: 'TRIGGERED',     triggeredAt: new Date(Date.now() -  3*60000).toISOString(), lat: 20.4, lng: 145.6,  locationLabel: 'Marine Sanctuary Z2', description: 'Debris detected within protected boundary' },
  { id: 'ALT-007', type: 'DETECTION',      title: 'Mixed Waste — High Confidence',     priority: 'MEDIUM',   status: 'TRIGGERED',     triggeredAt: new Date(Date.now() -  1*60000).toISOString(), lat: 5.8,  lng: -110.2, locationLabel: 'Central Pacific', description: '28 kg mixed waste cluster', detectionId: 'DET-1210' },
];

const CAMERAS = [
  { id: 'CAM-01', name: 'Alpha 1 — Zone 4 N', status: 'STREAMING', fps: 29.8, resolution: '1080p', lat: 35.1, lng: -158.3, zoneId: 'Z4', location: 'Zone 4 North', uptimePercent: 99.8, lastHeartbeat: new Date().toISOString() },
  { id: 'CAM-02', name: 'Beta 2 — Pacific Gyre', status: 'STREAMING', fps: 30.0, resolution: '4K', lat: 28.5, lng: -140.2, zoneId: 'Z1', location: 'Pacific Gyre', uptimePercent: 100, lastHeartbeat: new Date().toISOString() },
  { id: 'CAM-04', name: 'Alpha 4 — Zone 4 S', status: 'STREAMING', fps: 28.3, resolution: '1080p', lat: 35.1, lng: -148.4, zoneId: 'Z4', location: 'Zone 4 South', uptimePercent: 99.1, lastHeartbeat: new Date().toISOString() },
  { id: 'CAM-08', name: 'Gamma 8 — Coastal', status: 'LOW_FPS',   fps: 12.1, resolution: '1080p', lat: 20.4, lng: 145.6, zoneId: 'Z2', location: 'Coastal Zone', uptimePercent: 92.4, lastHeartbeat: new Date(Date.now() - 25000).toISOString() },
  { id: 'CAM-15', name: 'Delta 15 — Sector B', status: 'DISCONNECTED', fps: 0, resolution: '720p', lat: 24.0, lng: -138.0, zoneId: 'Z3', location: 'Sector B', uptimePercent: 88.2, lastHeartbeat: new Date(Date.now() - 720000).toISOString() },
];

const HOTSPOTS = [
  { id: 'HS-01', name: 'Pacific Gyre Core',    lat: 28.5,  lng: -140.2, risk: 'CRITICAL', detectionCount: 312, estimatedMassKg: 1840, status: 'ACTIVE',    radius: 42000, trend: 'INCREASING', zoneId: 'Z1', dominantClass: 'Mixed Waste',   firstDetected: '2026-06-01T00:00:00Z', lastUpdated: new Date().toISOString() },
  { id: 'HS-02', name: 'Zone 4 Cluster',       lat: 35.1,  lng: -158.3, risk: 'CRITICAL', detectionCount: 204, estimatedMassKg: 982,  status: 'ACTIVE',    radius: 28000, trend: 'STABLE',     zoneId: 'Z4', dominantClass: 'Fishing Net',   firstDetected: '2026-07-15T00:00:00Z', lastUpdated: new Date().toISOString() },
  { id: 'HS-03', name: 'North Pacific Band',   lat: 14.2,  lng: -155.8, risk: 'HIGH',     detectionCount: 148, estimatedMassKg: 624,  status: 'ACTIVE',    radius: 22000, trend: 'INCREASING', zoneId: 'Z1', dominantClass: 'Plastic Bag',   firstDetected: '2026-07-20T00:00:00Z', lastUpdated: new Date().toISOString() },
  { id: 'HS-04', name: 'Oregon Shelf Zone',    lat: 42.1,  lng: -130.5, risk: 'HIGH',     detectionCount: 98,  estimatedMassKg: 410,  status: 'MONITORED', radius: 15000, trend: 'STABLE',     zoneId: 'Z3', dominantClass: 'Metal',         firstDetected: '2026-08-01T00:00:00Z', lastUpdated: new Date().toISOString() },
  { id: 'HS-05', name: 'Western Pacific',      lat: 20.4,  lng: 145.6,  risk: 'MEDIUM',   detectionCount: 74,  estimatedMassKg: 290,  status: 'ACTIVE',    radius: 18000, trend: 'DECREASING', zoneId: 'Z2', dominantClass: 'Rope',          firstDetected: '2026-08-10T00:00:00Z', lastUpdated: new Date().toISOString() },
];

const CLEANUP_MISSIONS = [
  { id: 'CM-204', title: 'Zone 4 Critical Debris Cluster', status: 'IN_PROGRESS', priority: 'CRITICAL', zoneId: 'Z4', zoneName: 'Zone 4', lat: 35.1, lng: -158.3, locationLabel: 'Zone 4 N · 35.1°N 158.3°W', detectionCount: 146, estimatedMassKg: 82, assignedTeam: 'Coastal Team A', scheduledAt: new Date(Date.now()-3*3600000).toISOString(), startedAt: new Date(Date.now()-1.5*3600000).toISOString(), createdAt: new Date(Date.now()-5*3600000).toISOString(), createdBy: 'admin', evidence: [] },
  { id: 'CM-202', title: 'Pacific Gyre Fishing Net Recovery', status: 'ASSIGNED', priority: 'HIGH', zoneId: 'Z1', zoneName: 'Zone 1', lat: 28.5, lng: -140.2, locationLabel: 'Pacific Gyre', detectionCount: 48, estimatedMassKg: 28, assignedTeam: 'Marine Ops Beta', scheduledAt: new Date(Date.now()+2*3600000).toISOString(), createdAt: new Date(Date.now()-8*3600000).toISOString(), createdBy: 'operator', evidence: [] },
  { id: 'CM-201', title: 'Zone 2 Coastal Plastic Sweep', status: 'COMPLETED', priority: 'MEDIUM', zoneId: 'Z2', zoneName: 'Zone 2', lat: 19.8, lng: -157.4, locationLabel: 'Zone 2 Inshore', detectionCount: 62, estimatedMassKg: 24, assignedTeam: 'Coastal Team B', completedAt: new Date(Date.now()-86400000*0.8).toISOString(), createdAt: new Date(Date.now()-3*86400000).toISOString(), createdBy: 'officer', evidence: [] },
];

// ============================================================
// SSE CLIENTS
// ============================================================
const sseClients: Response[] = [];

function broadcastEvent(type: string, payload: any) {
  const msg = `data: ${JSON.stringify({ type, payload, timestamp: new Date().toISOString() })}\n\n`;
  sseClients.forEach((c: any) => c.write(msg));
}

// ============================================================
// API ROUTES
// ============================================================

// Health
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ONLINE', version: '1.4.0', service: 'OceanGuard AI Backend', timestamp: new Date().toISOString() });
});

// SSE
app.get('/api/events', (req: Request, res: Response) => {
  // Vercel functions cannot hold a durable SSE connection. A 204 tells
  // EventSource clients not to reconnect; container deployments keep SSE.
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
  const { email } = req.body;
  const user = mockDb.users.find(u => u.email.toLowerCase() === (email || '').toLowerCase()) ?? mockDb.users[1];
  res.json({ token: `jwt-token-${user.id}-${Date.now()}`, user });
});

app.post('/api/auth/logout', (_req: Request, res: Response) => {
  res.json({ success: true });
});

app.get('/api/auth/me', (req: Request, res: Response) => {
  const auth = req.headers.authorization ?? '';
  const userId = auth.match(/^Bearer jwt-token-(USR-\d+)-\d+$/)?.[1];
  const user = mockDb.users.find(u => u.id === userId);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }
  res.json({ user });
});

// ── Dashboard ────────────────────────────────────────────────────────────────
app.get('/api/dashboard/summary', async (_req: Request, res: Response) => {
  let aiStatus = 'MODEL_ERROR';
  try {
    const espada = await fetchAiJson('/v1/model');
    aiStatus = espada.ready ? 'RUNNING' : espada.state === 'ERROR' ? 'MODEL_ERROR' : 'STOPPED';
  } catch { /* The dashboard remains available while Espada is offline. */ }
  res.json({
    debrisDetected: mockDb.detectionsCount,
    highRiskIncidents: mockDb.highRiskCount,
    activeHotspots: mockDb.hotspotsCount,
    activeAlerts: mockDb.activeAlertsCount,
    cleanupMissions: CLEANUP_MISSIONS.filter(m => ['IN_PROGRESS','ASSIGNED'].includes(m.status)).length,
    camerasOnline: mockDb.onlineCameras,
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
  res.json({ system: 'ONLINE', camera: 'STREAMING', ai, gps: 'VALID', internet: 'ONLINE', activeCameras: 14, totalCameras: 15, aiLatencyMs, fps: 29.8, uptime: '99.7%' });
});

app.get('/api/dashboard/recent-detections', (_req: Request, res: Response) => {
  res.json({ detections: DETECTIONS.slice(0, 5) });
});

app.get('/api/dashboard/alerts', (_req: Request, res: Response) => {
  res.json({ alerts: ALERTS.filter(a => ['TRIGGERED','ACKNOWLEDGED','ACTION_REQUIRED'].includes(a.status)).slice(0, 5) });
});

// ── Monitoring ───────────────────────────────────────────────────────────────
app.get('/api/monitoring/cameras', (_req: Request, res: Response) => {
  res.json({ cameras: CAMERAS });
});

app.get('/api/monitoring/cameras/:id', (req: Request, res: Response) => {
  const cam = CAMERAS.find(c => c.id === req.params.id) ?? CAMERAS[0];
  res.json(cam);
});

// ── Detections ───────────────────────────────────────────────────────────────
app.get('/api/detections', (_req: Request, res: Response) => {
  res.json({ detections: DETECTIONS, total: DETECTIONS.length });
});

app.get('/api/detections/:id', (req: Request, res: Response) => {
  const d = DETECTIONS.find(det => det.id === req.params.id) ?? DETECTIONS[0];
  res.json(d);
});

app.get('/api/detections/:id/track', (req: Request, res: Response) => {
  const d = DETECTIONS.find(det => det.id === req.params.id) ?? DETECTIONS[0];
  res.json({
    id: d.trackId, detectionId: d.id, className: d.className, status: 'ACTIVE',
    firstSeen: new Date(Date.now() - 35 * 60000).toISOString(), lastSeen: new Date().toISOString(),
    currentLat: d.lat, currentLng: d.lng, velocity: 0.4, heading: 320, confidence: d.confidence,
    points: [
      { lat: d.lat - 0.02, lng: d.lng + 0.02, timestamp: new Date(Date.now() - 35 * 60000).toISOString(), confidence: 87 },
      { lat: d.lat - 0.01, lng: d.lng + 0.01, timestamp: new Date(Date.now() - 20 * 60000).toISOString(), confidence: 88 },
      { lat: d.lat,        lng: d.lng,         timestamp: new Date().toISOString(), confidence: d.confidence },
    ],
  });
});

app.patch('/api/detections/:id/status', (req: Request, res: Response) => {
  const d = DETECTIONS.find(det => det.id === req.params.id) ?? DETECTIONS[0];
  res.json({ ...d, status: req.body.status });
});

// ── Alerts ───────────────────────────────────────────────────────────────────
app.get('/api/alerts', (_req: Request, res: Response) => {
  res.json({ alerts: ALERTS });
});

app.get('/api/alerts/:id', (req: Request, res: Response) => {
  const a = ALERTS.find(al => al.id === req.params.id) ?? ALERTS[0];
  res.json(a);
});

app.patch('/api/alerts/:id/status', (req: Request, res: Response) => {
  const a = ALERTS.find(al => al.id === req.params.id) ?? ALERTS[0];
  const updated = { ...a, status: req.body.status };
  broadcastEvent('ALERT_UPDATE', updated);
  res.json(updated);
});

app.post('/api/alerts/:id/assign', (req: Request, res: Response) => {
  const a = ALERTS.find(al => al.id === req.params.id) ?? ALERTS[0];
  res.json({ ...a, status: 'ASSIGNED', assignedTo: req.body.assignedTo });
});

// ── Hotspots ─────────────────────────────────────────────────────────────────
app.get('/api/hotspots', (_req: Request, res: Response) => {
  res.json({ hotspots: HOTSPOTS });
});

app.get('/api/hotspots/:id', (req: Request, res: Response) => {
  const h = HOTSPOTS.find(hs => hs.id === req.params.id) ?? HOTSPOTS[0];
  res.json(h);
});

app.get('/api/hotspots/heatmap', (_req: Request, res: Response) => {
  res.json({ points: HOTSPOTS.map(h => [h.lat, h.lng, h.detectionCount / 100]) });
});

// ── Cleanup ──────────────────────────────────────────────────────────────────
app.get('/api/cleanup/missions', (_req: Request, res: Response) => {
  res.json({ missions: CLEANUP_MISSIONS });
});

app.get('/api/cleanup/missions/:id', (req: Request, res: Response) => {
  const m = CLEANUP_MISSIONS.find(m => m.id === req.params.id) ?? CLEANUP_MISSIONS[0];
  res.json(m);
});

app.post('/api/cleanup/missions', (req: Request, res: Response) => {
  const newMission = { id: `CM-${Date.now().toString().slice(-3)}`, ...req.body, createdAt: new Date().toISOString(), status: 'DRAFT', evidence: [] };
  CLEANUP_MISSIONS.push(newMission as any);
  broadcastEvent('CLEANUP_UPDATE', newMission);
  res.status(201).json(newMission);
});

app.patch('/api/cleanup/missions/:id', (req: Request, res: Response) => {
  const m = CLEANUP_MISSIONS.find(m => m.id === req.params.id) ?? CLEANUP_MISSIONS[0];
  const updated = { ...m, ...req.body };
  broadcastEvent('CLEANUP_UPDATE', updated);
  res.json(updated);
});

app.post('/api/cleanup/missions/:id/evidence', (req: Request, res: Response) => {
  const m = CLEANUP_MISSIONS.find(m => m.id === req.params.id) ?? CLEANUP_MISSIONS[0];
  const evidence = { id: `EV-${Date.now()}`, missionId: m.id, uploadedAt: new Date().toISOString(), ...req.body };
  res.json(evidence);
});

// ── Devices ──────────────────────────────────────────────────────────────────
app.get('/api/devices', (_req: Request, res: Response) => {
  res.json({ devices: CAMERAS.map(c => ({ ...c, type: 'CAMERA', batteryLevel: undefined, firmware: '2.4.1' })) });
});

app.get('/api/devices/:id', (req: Request, res: Response) => {
  const d = CAMERAS.find(c => c.id === req.params.id) ?? CAMERAS[0];
  res.json({ ...d, type: 'CAMERA' });
});

// ── AI Models ────────────────────────────────────────────────────────────────
async function fetchAiJson(pathname: string, init?: RequestInit) {
  const response = await fetch(`${AI_SERVICE_URL}${pathname}`, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.detail === 'string'
      ? payload.detail
      : `Espada service returned HTTP ${response.status}`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
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
    architecture: 'Faster R-CNN MobileNetV3 FPN',
    classes: [],
    inputSize: 640,
    confidenceThreshold: 0.35,
    confidenceCalibration: 'unavailable',
    metrics: null,
    learning: null,
    error: error instanceof Error ? error.message : 'Espada service is offline.',
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
      classes: status.classes,
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
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '20mb' }),
  async (req: Request, res: Response) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ message: 'Upload a JPG, PNG, or WebP image.' });
      return;
    }

    let filename = String(req.headers['x-file-name'] || 'espada-frame.jpg');
    try { filename = decodeURIComponent(filename); } catch { /* Keep safe raw value. */ }
    const contentType = String(req.headers['content-type'] || 'image/jpeg');
    const form = new FormData();
    form.append('file', new Blob([req.body], { type: contentType }), filename);

    try {
      res.json(await fetchAiJson('/v1/detect', { method: 'POST', body: form }));
    } catch (error) {
      const status = (error as Error & { status?: number }).status || 502;
      res.status(status).json({ message: error instanceof Error ? error.message : 'Espada inference failed.' });
    }
  },
);

app.post('/api/ai/feedback', async (req: Request, res: Response) => {
  try {
    res.json(await fetchAiJson('/v1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    }));
  } catch (error) {
    const status = (error as Error & { status?: number }).status || 502;
    res.status(status).json({ message: error instanceof Error ? error.message : 'Feedback could not be saved.' });
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
  res.json({ totalDetections: 1284, criticalAlerts: 21, activeMissions: 3, clearedKg: 2840, responseTimeH: 1.8, aiAccuracy: null });
});

app.get('/api/analytics/trends', (req: Request, res: Response) => {
  res.json({ period: req.query.period ?? '7d', data: [142, 168, 155, 184, 190, 215, 232] });
});

app.get('/api/analytics/categories', (_req: Request, res: Response) => {
  res.json([
    { name: 'Plastic',      value: 638 },
    { name: 'Fishing Gear', value: 312 },
    { name: 'Metal/Glass',  value: 198 },
    { name: 'Organic',      value: 89  },
    { name: 'Unknown',      value: 47  },
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
app.post('/api/reports/generate', (req: Request, res: Response) => {
  const { type = 'DAILY', zoneId = 'ALL' } = req.body;
  res.json({
    reportId: `RPT-${Date.now().toString().slice(-6)}`,
    generatedAt: new Date().toISOString(),
    type, zoneId,
    metrics: { totalDetectionsPeriod: 412, criticalIncidents: 6, clearedDebrisKg: 242, meanResponseTimeHours: 1.8, predominantClass: 'Plastic Polymer (64%)' },
    downloadUrl: '/api/reports/download/sample.pdf',
  });
});

// ── Admin ────────────────────────────────────────────────────────────────────
app.get('/api/admin/users', (_req: Request, res: Response) => {
  res.json({ users: mockDb.users });
});

// ============================================================
// SSE BROADCAST — simulate live detections every 8s
// ============================================================
if (!process.env.VERCEL) {
  setInterval(() => {
    const classes = ['Plastic Bottle', 'Fishing Net', 'Plastic Bag', 'Rope', 'Mixed Waste'];
    const cls = classes[Math.floor(Math.random() * classes.length)];
    broadcastEvent('DETECTION_NEW', {
      id: `DET-${Date.now().toString().slice(-4)}`,
      className: cls,
      confidence: Math.floor(Math.random() * 30 + 70),
      riskScore: Math.floor(Math.random() * 80 + 10),
      timestamp: new Date().toISOString(),
    });
  }, 8000);
}

// ============================================================
// VITE DEV SERVER OR STATIC
// ============================================================
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

  app.listen(PORT, '0.0.0.0', () => {
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
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
