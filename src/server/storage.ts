import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

export interface StoredUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string; // SHA-256 with salt
  salt: string;
  role: 'ADMIN' | 'FIELD_OPERATOR' | 'ENVIRONMENTAL_OFFICER' | 'CLEANUP_TEAM';
  roleTitle: string;
  organizationName: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  createdAt: string;
  lastLogin?: string;
}

export interface StoredSession {
  token: string;
  userId: string;
  role: string;
  createdAt: string;
  expiresAt: string;
}

export interface StoredDetection {
  id: string;
  trackId: string;
  className: string;
  category: string;
  confidence: number;
  status: 'NEW' | 'VALIDATING' | 'CONFIRMED' | 'TRACKING' | 'LOST' | 'FALSE_POSITIVE' | 'EXPIRED';
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  estimatedSize: string;
  estimatedDistance: string;
  estimatedMassKg: number;
  lat: number;
  lng: number;
  locationLabel: string;
  cameraId: string;
  cameraName: string;
  zoneId: string;
  zoneName: string;
  detectedAt: string;
  source: 'CAMERA' | 'DRONE' | 'UPLOAD' | 'SATELLITE';
  riskFactors: Array<{ label: string; score: number; description?: string }>;
  boundingBox?: { x: number; y: number; width: number; height: number };
  trackPoints?: Array<{ lat: number; lng: number; timestamp: string; confidence?: number }>;
  notes?: string;
}

export interface StoredAlert {
  id: string;
  type: 'RISK_THRESHOLD' | 'DETECTION' | 'DEVICE' | 'ZONE_BREACH';
  title: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'TRIGGERED' | 'ACKNOWLEDGED' | 'INVESTIGATING' | 'ACTION_REQUIRED' | 'ASSIGNED' | 'RESOLVED';
  triggeredAt: string;
  lat: number;
  lng: number;
  locationLabel: string;
  description: string;
  detectionId?: string;
  assignedTo?: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
}

export interface StoredCamera {
  id: string;
  name: string;
  status: 'CONNECTING' | 'ONLINE' | 'STREAMING' | 'NO_SIGNAL' | 'LOW_FPS' | 'DISCONNECTED' | 'ERROR';
  fps: number;
  resolution: string;
  lat: number;
  lng: number;
  zoneId: string;
  location: string;
  uptimePercent: number;
  lastHeartbeat: string;
}

export interface StoredDevice {
  id: string;
  name: string;
  type: 'CAMERA' | 'DRONE' | 'GPS' | 'AIS' | 'RADAR' | 'SENSOR';
  status: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE' | 'ERROR' | 'STANDBY';
  location: string;
  lat: number;
  lng: number;
  lastHeartbeat: string;
  uptimePercent: number;
  batteryLevel?: number;
  signalStrength?: number;
  firmware?: string;
  ip?: string;
}

export interface StoredHotspot {
  id: string;
  name: string;
  lat: number;
  lng: number;
  risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  detectionCount: number;
  estimatedMassKg: number;
  status: 'ACTIVE' | 'MONITORED' | 'CLEANING' | 'RESOLVED';
  radius: number;
  trend: 'INCREASING' | 'STABLE' | 'DECREASING';
  zoneId: string;
  dominantClass: string;
  firstDetected: string;
  lastUpdated: string;
}

export interface StoredCleanupEvidence {
  id: string;
  type: 'BEFORE' | 'DURING' | 'AFTER';
  description: string;
  recoveredKg?: number;
  photoUrl?: string;
  uploadedAt: string;
  uploadedBy: string;
}

export interface StoredCleanupMission {
  id: string;
  title: string;
  status: 'DRAFT' | 'SCHEDULED' | 'ASSIGNED' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  zoneId: string;
  zoneName: string;
  lat: number;
  lng: number;
  locationLabel: string;
  detectionCount: number;
  estimatedMassKg: number;
  assignedTeam?: string;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  createdBy: string;
  progress: number;
  description?: string;
  sourceDetectionId?: string;
  sourceHotspotId?: string;
  evidence: StoredCleanupEvidence[];
  timeline: Array<{ label: string; time: string; by: string; color: string }>;
}

export interface StoredReport {
  id: string;
  type: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'INCIDENT' | 'CLEANUP';
  zoneId: string;
  startDate?: string;
  endDate?: string;
  generatedAt: string;
  generatedBy: string;
  metrics: {
    totalDetectionsPeriod: number;
    criticalIncidents: number;
    clearedDebrisKg: number;
    meanResponseTimeHours: number;
    predominantClass: string;
  };
  summaryText: string;
  status: 'FINAL';
}

export interface StoredAccessRequest {
  id: string;
  organization: string;
  email: string;
  requestedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface StoredAuditLog {
  id: string;
  timestamp: string;
  actorId: string;
  actorEmail: string;
  action: string;
  details: Record<string, any>;
}

export interface DatabaseSchema {
  users: StoredUser[];
  sessions: StoredSession[];
  passwordResetTokens: Array<{ token: string; email: string; expiresAt: string }>;
  detections: StoredDetection[];
  alerts: StoredAlert[];
  cameras: StoredCamera[];
  devices: StoredDevice[];
  hotspots: StoredHotspot[];
  cleanupMissions: StoredCleanupMission[];
  reports: StoredReport[];
  accessRequests: StoredAccessRequest[];
  thresholds: Array<{ label: string; value: string; unit: string; desc: string }>;
  auditLog: StoredAuditLog[];
}

function hashPassword(password: string, salt: string): string {
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

const DEFAULT_SALT = 'oceanguard_demo_salt_2026';
const DEFAULT_HASH = hashPassword('demo1234', DEFAULT_SALT);

function getInitialDatabase(): DatabaseSchema {
  const now = Date.now();
  return {
    users: [
      {
        id: 'USR-01',
        name: 'Cmdr. Elena Vance',
        email: 'admin@oceanguard.ai',
        passwordHash: DEFAULT_HASH,
        salt: DEFAULT_SALT,
        role: 'ADMIN',
        roleTitle: 'Chief Operations Administrator',
        organizationName: 'OceanGuard Central Command',
        status: 'ACTIVE',
        createdAt: new Date(now - 90 * 86400000).toISOString(),
      },
      {
        id: 'USR-02',
        name: 'Marcus Brody',
        email: 'operator@oceanguard.ai',
        passwordHash: DEFAULT_HASH,
        salt: DEFAULT_SALT,
        role: 'FIELD_OPERATOR',
        roleTitle: 'Senior Marine Radar & Drone Pilot',
        organizationName: 'OceanGuard Coastal Watch',
        status: 'ACTIVE',
        createdAt: new Date(now - 60 * 86400000).toISOString(),
      },
      {
        id: 'USR-03',
        name: 'Dr. Asha Rao',
        email: 'officer@oceanguard.ai',
        passwordHash: DEFAULT_HASH,
        salt: DEFAULT_SALT,
        role: 'ENVIRONMENTAL_OFFICER',
        roleTitle: 'Lead Oceanographer',
        organizationName: 'Coastal Environmental Unit',
        status: 'ACTIVE',
        createdAt: new Date(now - 45 * 86400000).toISOString(),
      },
      {
        id: 'USR-04',
        name: 'Captain Javier Silva',
        email: 'cleanup@oceanguard.ai',
        passwordHash: DEFAULT_HASH,
        salt: DEFAULT_SALT,
        role: 'CLEANUP_TEAM',
        roleTitle: 'Coastal Team A Lead',
        organizationName: 'Rapid Marine Cleanup Fleet',
        status: 'ACTIVE',
        createdAt: new Date(now - 30 * 86400000).toISOString(),
      },
    ],
    sessions: [],
    passwordResetTokens: [],
    detections: [
      {
        id: 'DET-1042',
        trackId: 'TRK-1042',
        className: 'Fishing Net',
        category: 'Fishing Gear',
        confidence: 89,
        status: 'TRACKING',
        riskScore: 89,
        riskLevel: 'CRITICAL',
        estimatedSize: '3.6 m²',
        estimatedDistance: '420m',
        estimatedMassKg: 16.2,
        lat: 22.45,
        lng: 69.15,
        locationLabel: 'Gulf of Kachchh · Gujarat (22.45°N, 69.15°E)',
        cameraId: 'CAM-04',
        cameraName: 'Alpha 4 — Gulf of Kachchh',
        zoneId: 'Z-GUJ',
        zoneName: 'Gujarat Marine Sanctuary',
        detectedAt: new Date(now - 5 * 60000).toISOString(),
        source: 'CAMERA',
        boundingBox: { x: 0.54, y: 0.44, width: 0.28, height: 0.24 },
        riskFactors: [
          { label: 'Large size', score: 24, description: 'Object exceeds 3.5m² area' },
          { label: 'High density cluster', score: 20, description: '312 debris contacts within 38km' },
          { label: 'Near shipping route', score: 18, description: '1.4km from Gulf tanker passage' },
          { label: 'Moving debris', score: 14, description: 'Velocity 0.4 m/s heading NW' },
          { label: 'Sensitive zone', score: 13, description: 'Inside Marine Protected Area' },
        ],
        trackPoints: [
          { lat: 22.43, lng: 69.17, timestamp: new Date(now - 35 * 60000).toISOString(), confidence: 87 },
          { lat: 22.44, lng: 69.16, timestamp: new Date(now - 20 * 60000).toISOString(), confidence: 88 },
          { lat: 22.45, lng: 69.15, timestamp: new Date(now - 5 * 60000).toISOString(), confidence: 89 },
        ],
      },
      {
        id: 'DET-1105',
        trackId: 'TRK-1105',
        className: 'Rope',
        category: 'Fishing Gear',
        confidence: 77,
        status: 'NEW',
        riskScore: 38,
        riskLevel: 'MEDIUM',
        estimatedSize: '1.2 m²',
        estimatedDistance: '280m',
        estimatedMassKg: 2.1,
        lat: 15.35,
        lng: 73.75,
        locationLabel: 'Goa Coast · Arabian Sea (15.35°N, 73.75°E)',
        cameraId: 'CAM-08',
        cameraName: 'Gamma 8 — Goa Inshore',
        zoneId: 'Z-GOA',
        zoneName: 'Goa Coastal Waters',
        detectedAt: new Date(now - 28 * 60000).toISOString(),
        source: 'CAMERA',
        boundingBox: { x: 0.4, y: 0.5, width: 0.2, height: 0.1 },
        riskFactors: [
          { label: 'Floating line hazard', score: 20, description: 'Possible vessel prop entanglement' },
          { label: 'Near inshore fisheries', score: 18, description: 'Active artisanal fishing zone' },
        ],
        trackPoints: [
          { lat: 15.34, lng: 73.74, timestamp: new Date(now - 28 * 60000).toISOString(), confidence: 77 },
        ],
      },
      {
        id: 'DET-1210',
        trackId: 'TRK-1210',
        className: 'Mixed Waste',
        category: 'Unknown',
        confidence: 68,
        status: 'VALIDATING',
        riskScore: 72,
        riskLevel: 'HIGH',
        estimatedSize: '5.1 m²',
        estimatedDistance: '620m',
        estimatedMassKg: 28.4,
        lat: 18.95,
        lng: 72.80,
        locationLabel: 'Mumbai Coast · Maharashtra (18.95°N, 72.80°E)',
        cameraId: 'CAM-02',
        cameraName: 'Beta 2 — Mumbai Offshore',
        zoneId: 'Z-MUM',
        zoneName: 'Mumbai Harbor Sector',
        detectedAt: new Date(now - 42 * 60000).toISOString(),
        source: 'UPLOAD',
        boundingBox: { x: 0.2, y: 0.3, width: 0.35, height: 0.3 },
        riskFactors: [
          { label: 'Dense industrial waste', score: 32, description: 'Mixed polymer and metal scrap' },
          { label: 'Port navigation channel', score: 25, description: 'Approaching JNPT vessel channel' },
          { label: 'High buoyancy risk', score: 15, description: 'Partially submerged mass' },
        ],
        trackPoints: [
          { lat: 18.93, lng: 72.78, timestamp: new Date(now - 42 * 60000).toISOString(), confidence: 68 },
        ],
      },
      {
        id: 'DET-0902',
        trackId: 'TRK-902',
        className: 'Plastic Bottle',
        category: 'Plastic',
        confidence: 94,
        status: 'CONFIRMED',
        riskScore: 42,
        riskLevel: 'MEDIUM',
        estimatedSize: '0.5 m²',
        estimatedDistance: '140m',
        estimatedMassKg: 0.9,
        lat: 19.95,
        lng: 86.40,
        locationLabel: 'Odisha Shelf · Bay of Bengal (19.95°N, 86.40°E)',
        cameraId: 'CAM-15',
        cameraName: 'Delta 15 — Odisha Watch',
        zoneId: 'Z-ODI',
        zoneName: 'Odisha Shelf',
        detectedAt: new Date(now - 12 * 60000).toISOString(),
        source: 'DRONE',
        boundingBox: { x: 0.18, y: 0.38, width: 0.14, height: 0.16 },
        riskFactors: [
          { label: 'Turtle nesting coast', score: 28, description: 'Near Olive Ridley migratory area' },
          { label: 'Degradation hazard', score: 14, description: 'Microplastic shedding risk' },
        ],
        trackPoints: [
          { lat: 19.95, lng: 86.40, timestamp: new Date(now - 12 * 60000).toISOString(), confidence: 94 },
        ],
      },
      {
        id: 'DET-0988',
        trackId: 'TRK-988',
        className: 'Plastic Bag',
        category: 'Plastic',
        confidence: 91,
        status: 'CONFIRMED',
        riskScore: 55,
        riskLevel: 'MEDIUM',
        estimatedSize: '0.9 m²',
        estimatedDistance: '190m',
        estimatedMassKg: 0.6,
        lat: 13.08,
        lng: 80.35,
        locationLabel: 'Chennai Coast · Coromandel (13.08°N, 80.35°E)',
        cameraId: 'CAM-01',
        cameraName: 'Alpha 1 — Chennai Harbor',
        zoneId: 'Z-CHE',
        zoneName: 'Chennai Port',
        detectedAt: new Date(now - 18 * 60000).toISOString(),
        source: 'CAMERA',
        boundingBox: { x: 0.32, y: 0.68, width: 0.18, height: 0.15 },
        riskFactors: [
          { label: 'Marine ingestion risk', score: 35, description: 'High probability of turtle/fish ingestion' },
          { label: 'Shallow tidal zone', score: 20, description: 'Drifting into tidal mudflats' },
        ],
        trackPoints: [
          { lat: 13.08, lng: 80.35, timestamp: new Date(now - 18 * 60000).toISOString(), confidence: 91 },
        ],
      },
    ],
    alerts: [
      {
        id: 'ALT-001',
        type: 'RISK_THRESHOLD',
        title: 'Large Debris Cluster Detected',
        priority: 'CRITICAL',
        status: 'TRIGGERED',
        triggeredAt: new Date(now - 8 * 60000).toISOString(),
        lat: 22.45,
        lng: 69.15,
        locationLabel: 'Gulf of Kachchh · Gujarat',
        description: '312-item cluster identified near Gulf of Kachchh marine reserve',
        detectionId: 'DET-1042',
      },
      {
        id: 'ALT-002',
        type: 'DETECTION',
        title: 'Fishing Net — Track #1042',
        priority: 'HIGH',
        status: 'ACKNOWLEDGED',
        triggeredAt: new Date(now - 22 * 60000).toISOString(),
        lat: 22.45,
        lng: 69.15,
        locationLabel: 'Gulf of Kachchh · Gujarat',
        description: '3.6m² net moving at 0.4 m/s in Gujarat Marine Sanctuary',
        detectionId: 'DET-1042',
        assignedTo: 'Capt. Javier Silva',
      },
      {
        id: 'ALT-003',
        type: 'DEVICE',
        title: 'Camera CAM-15 Offline',
        priority: 'MEDIUM',
        status: 'INVESTIGATING',
        triggeredAt: new Date(now - 47 * 60000).toISOString(),
        lat: 19.95,
        lng: 86.40,
        locationLabel: 'Odisha Shelf Watch',
        description: 'No heartbeat received for 12 minutes from Delta 15 node',
      },
      {
        id: 'ALT-004',
        type: 'RISK_THRESHOLD',
        title: 'High Density — Odisha Shelf',
        priority: 'HIGH',
        status: 'ACTION_REQUIRED',
        triggeredAt: new Date(now - 95 * 60000).toISOString(),
        lat: 19.95,
        lng: 86.40,
        locationLabel: 'Odisha Coast · Bay of Bengal',
        description: '162 debris detections accumulated in coastal marine zone',
        detectionId: 'DET-0902',
      },
      {
        id: 'ALT-005',
        type: 'DETECTION',
        title: 'Plastic Debris — Track #988',
        priority: 'MEDIUM',
        status: 'ASSIGNED',
        triggeredAt: new Date(now - 140 * 60000).toISOString(),
        lat: 13.08,
        lng: 80.35,
        locationLabel: 'Chennai Coast · Coromandel',
        description: 'Film plastic cluster near harbor navigational entrance',
        detectionId: 'DET-0988',
        assignedTo: 'Coastal Team B',
      },
      {
        id: 'ALT-006',
        type: 'ZONE_BREACH',
        title: 'Debris in Marine Sanctuary Zone',
        priority: 'CRITICAL',
        status: 'TRIGGERED',
        triggeredAt: new Date(now - 3 * 60000).toISOString(),
        lat: 8.80,
        lng: 78.75,
        locationLabel: 'Gulf of Mannar Biosphere',
        description: 'Floating net fragments detected inside protected coral sanctuary',
      },
      {
        id: 'ALT-007',
        type: 'DETECTION',
        title: 'Mixed Waste — High Density',
        priority: 'HIGH',
        status: 'TRIGGERED',
        triggeredAt: new Date(now - 1 * 60000).toISOString(),
        lat: 18.95,
        lng: 72.80,
        locationLabel: 'Mumbai Coast · Arabian Sea',
        description: '28.4 kg mixed waste cluster drifting toward port channel',
        detectionId: 'DET-1210',
      },
    ],
    cameras: [
      { id: 'CAM-01', name: 'Alpha 1 — Chennai Harbor', status: 'STREAMING', fps: 29.8, resolution: '1080p', lat: 13.08, lng: 80.35, zoneId: 'Z-CHE', location: 'Chennai Port', uptimePercent: 99.8, lastHeartbeat: new Date(now - 2000).toISOString() },
      { id: 'CAM-02', name: 'Beta 2 — Mumbai Offshore', status: 'STREAMING', fps: 30.0, resolution: '4K', lat: 18.95, lng: 72.80, zoneId: 'Z-MUM', location: 'Mumbai Coast', uptimePercent: 100, lastHeartbeat: new Date(now - 1000).toISOString() },
      { id: 'CAM-04', name: 'Alpha 4 — Gulf of Kachchh', status: 'STREAMING', fps: 28.3, resolution: '1080p', lat: 22.45, lng: 69.15, zoneId: 'Z-GUJ', location: 'Kachchh Marine', uptimePercent: 99.1, lastHeartbeat: new Date(now - 3000).toISOString() },
      { id: 'CAM-08', name: 'Gamma 8 — Goa Inshore', status: 'LOW_FPS', fps: 12.1, resolution: '1080p', lat: 15.35, lng: 73.75, zoneId: 'Z-GOA', location: 'Goa Coastal', uptimePercent: 92.4, lastHeartbeat: new Date(now - 25000).toISOString() },
      { id: 'CAM-15', name: 'Delta 15 — Odisha Watch', status: 'DISCONNECTED', fps: 0, resolution: '720p', lat: 19.95, lng: 86.40, zoneId: 'Z-ODI', location: 'Odisha Shelf', uptimePercent: 88.2, lastHeartbeat: new Date(now - 720000).toISOString() },
    ],
    devices: [
      { id: 'CAM-01', name: 'Alpha 1 — Chennai Harbor', type: 'CAMERA', status: 'ONLINE', location: 'Chennai Port', lat: 13.08, lng: 80.35, uptimePercent: 99.8, lastHeartbeat: new Date(now - 2000).toISOString(), firmware: '2.4.1', batteryLevel: undefined, signalStrength: 96 },
      { id: 'CAM-02', name: 'Beta 2 — Mumbai Offshore', type: 'CAMERA', status: 'ONLINE', location: 'Mumbai Coast', lat: 18.95, lng: 72.80, uptimePercent: 100, lastHeartbeat: new Date(now - 1000).toISOString(), firmware: '2.4.1', batteryLevel: undefined, signalStrength: 99 },
      { id: 'CAM-04', name: 'Alpha 4 — Gulf of Kachchh', type: 'CAMERA', status: 'ONLINE', location: 'Kachchh Marine', lat: 22.45, lng: 69.15, uptimePercent: 99.1, lastHeartbeat: new Date(now - 3000).toISOString(), firmware: '2.4.1', batteryLevel: undefined, signalStrength: 91 },
      { id: 'CAM-08', name: 'Gamma 8 — Goa Inshore', type: 'CAMERA', status: 'ONLINE', location: 'Goa Coastal', lat: 15.35, lng: 73.75, uptimePercent: 92.4, lastHeartbeat: new Date(now - 25000).toISOString(), firmware: '2.3.9', batteryLevel: undefined, signalStrength: 74 },
      { id: 'CAM-15', name: 'Delta 15 — Odisha Watch', type: 'CAMERA', status: 'OFFLINE', location: 'Odisha Shelf', lat: 19.95, lng: 86.40, uptimePercent: 88.2, lastHeartbeat: new Date(now - 720000).toISOString(), firmware: '2.4.0', batteryLevel: undefined, signalStrength: 0 },
      { id: 'DRN-01', name: 'UAV Sentinel Alpha', type: 'DRONE', status: 'ONLINE', location: 'Gulf of Kachchh', lat: 22.48, lng: 69.18, uptimePercent: 98.6, lastHeartbeat: new Date(now - 4000).toISOString(), firmware: '3.1.0', batteryLevel: 84, signalStrength: 92 },
      { id: 'GPS-01', name: 'Marine DGPS Base', type: 'GPS', status: 'ONLINE', location: 'Mumbai Command', lat: 18.96, lng: 72.82, uptimePercent: 100, lastHeartbeat: new Date(now - 1000).toISOString(), firmware: '1.8.2', batteryLevel: undefined, signalStrength: 100 },
      { id: 'AIS-01', name: 'Coastal AIS Receiver', type: 'AIS', status: 'ONLINE', location: 'Goa Station', lat: 15.36, lng: 73.77, uptimePercent: 99.7, lastHeartbeat: new Date(now - 5000).toISOString(), firmware: '2.0.4', batteryLevel: undefined, signalStrength: 88 },
      { id: 'RAD-01', name: 'Surface Radar Node 1', type: 'RADAR', status: 'MAINTENANCE', location: 'Odisha Shore', lat: 19.94, lng: 86.38, uptimePercent: 74.5, lastHeartbeat: new Date(now - 3600000).toISOString(), firmware: '1.4.1', batteryLevel: undefined, signalStrength: 0 },
      { id: 'SEN-01', name: 'Buoy Telemetry Sensor 1', type: 'SENSOR', status: 'ONLINE', location: 'Gulf of Mannar', lat: 8.81, lng: 78.76, uptimePercent: 98.4, lastHeartbeat: new Date(now - 15000).toISOString(), firmware: '1.2.0', batteryLevel: 68, signalStrength: 85 },
    ],
    hotspots: [
      { id: 'HS-01', name: 'Gulf of Kachchh', lat: 22.45, lng: 69.15, risk: 'CRITICAL', detectionCount: 312, estimatedMassKg: 1840, status: 'ACTIVE', radius: 38000, trend: 'INCREASING', zoneId: 'Z-GUJ', dominantClass: 'Fishing Net', firstDetected: '2026-06-01T00:00:00Z', lastUpdated: new Date().toISOString() },
      { id: 'HS-02', name: 'Mumbai Coast', lat: 18.95, lng: 72.80, risk: 'HIGH', detectionCount: 204, estimatedMassKg: 982, status: 'ACTIVE', radius: 30000, trend: 'INCREASING', zoneId: 'Z-MUM', dominantClass: 'Mixed Waste', firstDetected: '2026-07-15T00:00:00Z', lastUpdated: new Date().toISOString() },
      { id: 'HS-03', name: 'Konkan Coast', lat: 16.70, lng: 73.25, risk: 'HIGH', detectionCount: 176, estimatedMassKg: 760, status: 'ACTIVE', radius: 26000, trend: 'STABLE', zoneId: 'Z-KON', dominantClass: 'Plastic Bottle', firstDetected: '2026-07-20T00:00:00Z', lastUpdated: new Date().toISOString() },
      { id: 'HS-04', name: 'Goa Coast', lat: 15.35, lng: 73.75, risk: 'MEDIUM', detectionCount: 98, estimatedMassKg: 410, status: 'MONITORED', radius: 20000, trend: 'STABLE', zoneId: 'Z-GOA', dominantClass: 'Plastic Bag', firstDetected: '2026-08-01T00:00:00Z', lastUpdated: new Date().toISOString() },
      { id: 'HS-05', name: 'Mangaluru Coast', lat: 12.85, lng: 74.80, risk: 'HIGH', detectionCount: 120, estimatedMassKg: 510, status: 'ACTIVE', radius: 22000, trend: 'INCREASING', zoneId: 'Z-MNG', dominantClass: 'Rope', firstDetected: '2026-08-10T00:00:00Z', lastUpdated: new Date().toISOString() },
      { id: 'HS-06', name: 'Gulf of Mannar', lat: 8.80, lng: 78.75, risk: 'HIGH', detectionCount: 188, estimatedMassKg: 860, status: 'ACTIVE', radius: 28000, trend: 'STABLE', zoneId: 'Z-MAN', dominantClass: 'Fishing Net', firstDetected: '2026-08-15T00:00:00Z', lastUpdated: new Date().toISOString() },
      { id: 'HS-07', name: 'Chennai Coast', lat: 13.08, lng: 80.35, risk: 'MEDIUM', detectionCount: 74, estimatedMassKg: 290, status: 'MONITORED', radius: 18000, trend: 'DECREASING', zoneId: 'Z-CHE', dominantClass: 'Plastic Bottle', firstDetected: '2026-08-20T00:00:00Z', lastUpdated: new Date().toISOString() },
      { id: 'HS-08', name: 'Odisha Coast', lat: 19.95, lng: 86.40, risk: 'CRITICAL', detectionCount: 162, estimatedMassKg: 740, status: 'ACTIVE', radius: 32000, trend: 'INCREASING', zoneId: 'Z-ODI', dominantClass: 'Mixed Waste', firstDetected: '2026-08-25T00:00:00Z', lastUpdated: new Date().toISOString() },
      { id: 'HS-09', name: 'Sundarbans', lat: 21.80, lng: 88.90, risk: 'MEDIUM', detectionCount: 148, estimatedMassKg: 624, status: 'CLEANING', radius: 24000, trend: 'STABLE', zoneId: 'Z-SUN', dominantClass: 'Plastic Bag', firstDetected: '2026-08-30T00:00:00Z', lastUpdated: new Date().toISOString() },
      { id: 'HS-10', name: 'Lakshadweep Region', lat: 10.55, lng: 72.60, risk: 'LOW', detectionCount: 42, estimatedMassKg: 134, status: 'MONITORED', radius: 16000, trend: 'DECREASING', zoneId: 'Z-LAK', dominantClass: 'Plastic Bottle', firstDetected: '2026-09-01T00:00:00Z', lastUpdated: new Date().toISOString() },
    ],
    cleanupMissions: [
      {
        id: 'CM-204',
        title: 'Gulf of Kachchh Critical Ghost Net Recovery',
        status: 'IN_PROGRESS',
        priority: 'CRITICAL',
        zoneId: 'Z-GUJ',
        zoneName: 'Gujarat Marine Sanctuary',
        lat: 22.45,
        lng: 69.15,
        locationLabel: 'Gulf of Kachchh · Gujarat (22.45°N, 69.15°E)',
        detectionCount: 146,
        estimatedMassKg: 82,
        assignedTeam: 'Coastal Team A',
        scheduledAt: new Date(now - 3 * 3600000).toISOString(),
        startedAt: new Date(now - 1.5 * 3600000).toISOString(),
        createdAt: new Date(now - 5 * 3600000).toISOString(),
        createdBy: 'Cmdr. Elena Vance',
        progress: 45,
        description: 'Ghost net and marine debris cluster verified by DET-1042 in marine sanctuary. High entanglement threat to coastal cetaceans and marine turtles.',
        sourceDetectionId: 'DET-1042',
        sourceHotspotId: 'HS-01',
        evidence: [
          { id: 'EV-01', type: 'BEFORE', description: 'Drone survey photo showing 3.6m² net submerged at 1.8m', uploadedAt: new Date(now - 90 * 60000).toISOString(), uploadedBy: 'Marcus Brody' },
          { id: 'EV-02', type: 'DURING', description: 'Vessel crane deployment and winch retrieval underway', recoveredKg: 35, uploadedAt: new Date(now - 30 * 60000).toISOString(), uploadedBy: 'Capt. Javier Silva' },
        ],
        timeline: [
          { label: 'Mission Created', time: new Date(now - 5 * 3600000).toISOString(), by: 'Cmdr. Elena Vance', color: 'bg-cyan-400' },
          { label: 'Team Assigned', time: new Date(now - 4 * 3600000).toISOString(), by: 'Cmdr. Elena Vance', color: 'bg-purple-400' },
          { label: 'Departed Port Okha', time: new Date(now - 3 * 3600000).toISOString(), by: 'Capt. Javier Silva', color: 'bg-amber-400' },
          { label: 'On Site Kachchh Reef', time: new Date(now - 1.5 * 3600000).toISOString(), by: 'Capt. Javier Silva', color: 'bg-green-400' },
        ],
      },
      {
        id: 'CM-202',
        title: 'Mumbai Offshore Mixed Debris Intercept',
        status: 'ASSIGNED',
        priority: 'HIGH',
        zoneId: 'Z-MUM',
        zoneName: 'Mumbai Harbor Sector',
        lat: 18.95,
        lng: 72.80,
        locationLabel: 'Mumbai Coast · Maharashtra (18.95°N, 72.80°E)',
        detectionCount: 48,
        estimatedMassKg: 28,
        assignedTeam: 'Marine Ops Beta',
        scheduledAt: new Date(now + 2 * 3600000).toISOString(),
        createdAt: new Date(now - 8 * 3600000).toISOString(),
        createdBy: 'Marcus Brody',
        progress: 0,
        description: 'Preemptive intercept of industrial packaging and plastic accumulation drifting into harbor entrance.',
        sourceDetectionId: 'DET-1210',
        sourceHotspotId: 'HS-02',
        evidence: [],
        timeline: [
          { label: 'Mission Created', time: new Date(now - 8 * 3600000).toISOString(), by: 'Marcus Brody', color: 'bg-cyan-400' },
          { label: 'Assigned to Marine Ops Beta', time: new Date(now - 6 * 3600000).toISOString(), by: 'Cmdr. Elena Vance', color: 'bg-purple-400' },
        ],
      },
      {
        id: 'CM-201',
        title: 'Goa Coastal Waters Line Sweep',
        status: 'COMPLETED',
        priority: 'MEDIUM',
        zoneId: 'Z-GOA',
        zoneName: 'Goa Coastal Waters',
        lat: 15.35,
        lng: 73.75,
        locationLabel: 'Goa Coast · Arabian Sea (15.35°N, 73.75°E)',
        detectionCount: 62,
        estimatedMassKg: 24,
        assignedTeam: 'Coastal Team B',
        scheduledAt: new Date(now - 2 * 86400000).toISOString(),
        startedAt: new Date(now - 1.5 * 86400000).toISOString(),
        completedAt: new Date(now - 86400000 * 0.8).toISOString(),
        createdAt: new Date(now - 3 * 86400000).toISOString(),
        createdBy: 'Dr. Asha Rao',
        progress: 100,
        description: 'Completed sweep of discarded monofilament rope and tourist plastic waste along Aguada and Candolim shelves.',
        sourceDetectionId: 'DET-1105',
        sourceHotspotId: 'HS-04',
        evidence: [
          { id: 'EV-03', type: 'AFTER', description: 'Clear seabed inspection and shore container transfer receipt', recoveredKg: 24, uploadedAt: new Date(now - 86400000 * 0.8).toISOString(), uploadedBy: 'Coastal Team B' },
        ],
        timeline: [
          { label: 'Mission Created', time: new Date(now - 3 * 86400000).toISOString(), by: 'Dr. Asha Rao', color: 'bg-cyan-400' },
          { label: 'Team Deployed', time: new Date(now - 1.5 * 86400000).toISOString(), by: 'Capt. Javier Silva', color: 'bg-amber-400' },
          { label: 'Recovery Complete (24kg)', time: new Date(now - 86400000 * 0.8).toISOString(), by: 'Coastal Team B', color: 'bg-green-400' },
        ],
      },
    ],
    reports: [
      {
        id: 'RPT-204812',
        type: 'DAILY',
        zoneId: 'ALL',
        startDate: new Date(now - 86400000).toISOString().slice(0, 10),
        endDate: new Date(now).toISOString().slice(0, 10),
        generatedAt: new Date(now - 3600000).toISOString(),
        generatedBy: 'Cmdr. Elena Vance',
        metrics: {
          totalDetectionsPeriod: 412,
          criticalIncidents: 6,
          clearedDebrisKg: 242,
          meanResponseTimeHours: 1.8,
          predominantClass: 'Plastic Bottle (42%)',
        },
        summaryText: 'Daily 24-hour operations summary across all coastal monitoring sectors. 412 total debris detections logged, 6 critical alerts triggered in Gujarat and Odisha sectors.',
        status: 'FINAL',
      },
      {
        id: 'RPT-204720',
        type: 'WEEKLY',
        zoneId: 'Z-GUJ',
        startDate: new Date(now - 7 * 86400000).toISOString().slice(0, 10),
        endDate: new Date(now).toISOString().slice(0, 10),
        generatedAt: new Date(now - 2 * 86400000).toISOString(),
        generatedBy: 'Dr. Asha Rao',
        metrics: {
          totalDetectionsPeriod: 2841,
          criticalIncidents: 21,
          clearedDebrisKg: 1284,
          meanResponseTimeHours: 2.1,
          predominantClass: 'Fishing Net (58%)',
        },
        summaryText: 'Weekly environmental impact analysis for Gulf of Kachchh Marine Sanctuary. High ghost gear concentration noted along shipping transition zones.',
        status: 'FINAL',
      },
    ],
    accessRequests: [
      {
        id: 'REQ-2026-0104',
        organization: 'National Institute of Oceanography (NIO)',
        email: 'research@nio.res.in',
        requestedAt: new Date(now - 3 * 86400000).toISOString(),
        status: 'APPROVED',
        reviewedAt: new Date(now - 2 * 86400000).toISOString(),
        reviewedBy: 'admin@oceanguard.ai',
      },
      {
        id: 'REQ-2026-0108',
        organization: 'Indian Coast Guard Western Region',
        email: 'ops@indiancoastguard.gov.in',
        requestedAt: new Date(now - 12 * 3600000).toISOString(),
        status: 'PENDING',
      },
    ],
    thresholds: [
      { label: 'Critical Risk Score Threshold', value: '80', unit: '/ 100', desc: 'Triggers CRITICAL alert when exceeded' },
      { label: 'High Risk Score Threshold', value: '60', unit: '/ 100', desc: 'Triggers HIGH alert when exceeded' },
      { label: 'Min Detection Confidence', value: '50', unit: '%', desc: 'Detections below this are discarded' },
      { label: 'Camera Offline Timeout', value: '300', unit: 'sec', desc: 'Seconds before camera marked offline' },
      { label: 'Max Track Loss Duration', value: '120', unit: 'sec', desc: 'Track expires after losing object' },
    ],
    auditLog: [
      {
        id: 'AUD-001',
        timestamp: new Date(now - 24 * 3600000).toISOString(),
        actorId: 'USR-01',
        actorEmail: 'admin@oceanguard.ai',
        action: 'UPDATE_THRESHOLDS',
        details: { field: 'Min Detection Confidence', oldValue: '45', newValue: '50' },
      },
      {
        id: 'AUD-002',
        timestamp: new Date(now - 12 * 3600000).toISOString(),
        actorId: 'USR-01',
        actorEmail: 'admin@oceanguard.ai',
        action: 'APPROVE_ACCESS_REQUEST',
        details: { requestId: 'REQ-2026-0104', org: 'National Institute of Oceanography' },
      },
    ],
  };
}

// JSON-file persistence engine. The whole database lives in memory and is
// flushed to data/oceanguard-db.json (debounced + atomic rename) after mutations.
class StorageEngine {
  private dbPath: string;
  private db: DatabaseSchema;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor() {
    const dataDir = process.env.OCEANGUARD_WEB_DATA_DIR || path.join(process.env.VERCEL ? os.tmpdir() : process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.dbPath = path.join(dataDir, 'oceanguard-db.json');
    this.db = this.loadDatabase();
  }

  private loadDatabase(): DatabaseSchema {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.detections)) {
          return parsed;
        }
      }
    } catch (e) {
      console.error('[STORAGE] Error loading database from disk, re-initializing:', e);
    }
    const initial = getInitialDatabase();
    this.saveImmediate(initial);
    return initial;
  }

  /** Atomic write: dump to a temp file then rename over the live DB to avoid corruption on crash. */
  private saveImmediate(dbToSave: DatabaseSchema = this.db) {
    try {
      const tempPath = `${this.dbPath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(dbToSave, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.dbPath);
    } catch (e) {
      console.error('[STORAGE] Failed to persist database:', e);
    }
  }

  /** Debounced disk write: coalesces rapid mutations into one save 100ms later. */
  public save() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveImmediate();
      this.saveTimeout = null;
    }, 100);
  }

  // --- Auth & Users ---
  public findUserByEmail(email: string): StoredUser | undefined {
    return this.db.users.find(u => u.email.toLowerCase() === (email || '').toLowerCase().trim());
  }

  public findUserById(id: string): StoredUser | undefined {
    return this.db.users.find(u => u.id === id);
  }

  public getAllUsers(): StoredUser[] {
    return this.db.users;
  }

  public verifyPassword(user: StoredUser, passwordAttempt: string): boolean {
    if (!passwordAttempt) return false;
    const computedHash = hashPassword(passwordAttempt, user.salt);
    return computedHash === user.passwordHash;
  }

  public createUser(userData: {
    name: string;
    email: string;
    password?: string;
    role: StoredUser['role'];
    roleTitle: string;
    organizationName: string;
  }, actor?: { id: string; email: string }): StoredUser {
    const salt = generateSalt();
    const passwordHash = hashPassword(userData.password || 'demo1234', salt);
    const newUser: StoredUser = {
      id: `USR-${String(this.db.users.length + 1).padStart(2, '0')}`,
      name: userData.name.trim(),
      email: userData.email.toLowerCase().trim(),
      passwordHash,
      salt,
      role: userData.role,
      roleTitle: userData.roleTitle.trim(),
      organizationName: userData.organizationName.trim(),
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };
    this.db.users.push(newUser);
    this.logAudit(actor?.id || 'SYSTEM', actor?.email || 'system', 'CREATE_USER', { userId: newUser.id, email: newUser.email, role: newUser.role });
    this.save();
    return newUser;
  }

  public updateUser(id: string, updates: Partial<StoredUser>, actor?: { id: string; email: string }): StoredUser | null {
    const idx = this.db.users.findIndex(u => u.id === id);
    if (idx === -1) return null;
    const current = this.db.users[idx];
    const updated: StoredUser = {
      ...current,
      ...updates,
      id: current.id, // Immutable
      salt: current.salt, // Salt never changes on profile updates (only on password resets).
    };
    this.db.users[idx] = updated;
    this.logAudit(actor?.id || 'SYSTEM', actor?.email || 'system', 'UPDATE_USER', { userId: id, updates });
    this.save();
    return updated;
  }

  public createSession(user: StoredUser): StoredSession {
    const token = `og_sess_${crypto.randomBytes(24).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString(); // 24 hours
    const session: StoredSession = {
      token,
      userId: user.id,
      role: user.role,
      createdAt: new Date().toISOString(),
      expiresAt,
    };
    // Keep max 100 active sessions
    this.db.sessions = [session, ...this.db.sessions.slice(0, 99)];
    // Update user lastLogin
    user.lastLogin = session.createdAt;
    this.save();
    return session;
  }

  public findSession(token: string): StoredSession | undefined {
    if (!token) return undefined;
    const sess = this.db.sessions.find(s => s.token === token);
    if (!sess) return undefined;
    if (new Date(sess.expiresAt).getTime() < Date.now()) {
      // Expired
      this.removeSession(token);
      return undefined;
    }
    return sess;
  }

  public removeSession(token: string) {
    this.db.sessions = this.db.sessions.filter(s => s.token !== token);
    this.save();
  }

  public createPasswordResetToken(email: string): string {
    const token = crypto.randomBytes(20).toString('hex');
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString(); // 1 hour
    this.db.passwordResetTokens.push({ token, email: email.toLowerCase(), expiresAt });
    this.save();
    return token;
  }

  public resetPasswordWithToken(token: string, newPassword: string): boolean {
    const item = this.db.passwordResetTokens.find(p => p.token === token && new Date(p.expiresAt).getTime() > Date.now());
    if (!item) return false;
    const user = this.findUserByEmail(item.email);
    if (!user) return false;
    user.salt = generateSalt();
    user.passwordHash = hashPassword(newPassword, user.salt);
    this.db.passwordResetTokens = this.db.passwordResetTokens.filter(p => p.email !== user.email.toLowerCase());
    this.db.sessions = this.db.sessions.filter(session => session.userId !== user.id);
    this.logAudit(user.id, user.email, 'PASSWORD_RESET', { method: 'RECOVERY_TOKEN' });
    this.save();
    return true;
  }

  // --- Detections ---
  public getDetections(filter?: { status?: string; riskLevel?: string; query?: string }): StoredDetection[] {
    let list = this.db.detections;
    if (filter?.status && filter.status !== 'ALL') {
      list = list.filter(d => d.status === filter.status);
    }
    if (filter?.riskLevel && filter.riskLevel !== 'ALL') {
      list = list.filter(d => d.riskLevel === filter.riskLevel);
    }
    if (filter?.query) {
      const q = filter.query.toLowerCase();
      list = list.filter(d =>
        d.id.toLowerCase().includes(q) ||
        d.className.toLowerCase().includes(q) ||
        d.locationLabel.toLowerCase().includes(q) ||
        d.trackId.toLowerCase().includes(q)
      );
    }
    return list;
  }

  public getDetectionById(id: string): StoredDetection | undefined {
    return this.db.detections.find(d => d.id === id);
  }

  public updateDetectionStatus(id: string, status: StoredDetection['status'], actor?: { id: string; email: string }): StoredDetection | null {
    const d = this.db.detections.find(det => det.id === id);
    if (!d) return null;
    d.status = status;
    this.logAudit(actor?.id || 'SYSTEM', actor?.email || 'system', 'UPDATE_DETECTION_STATUS', { detectionId: id, status });
    this.save();
    return d;
  }

  public addDetection(detection: StoredDetection): StoredDetection {
    this.db.detections.unshift(detection);
    this.save();
    return detection;
  }

  // --- Alerts ---
  public getAlerts(): StoredAlert[] {
    return this.db.alerts;
  }

  public getAlertById(id: string): StoredAlert | undefined {
    return this.db.alerts.find(a => a.id === id);
  }

  public updateAlertStatus(id: string, status: StoredAlert['status'], assignedTo?: string, actor?: { id: string; email: string }): StoredAlert | null {
    const alert = this.db.alerts.find(a => a.id === id);
    if (!alert) return null;
    alert.status = status;
    if (assignedTo !== undefined) alert.assignedTo = assignedTo;
    if (status === 'ACKNOWLEDGED' && !alert.acknowledgedAt) alert.acknowledgedAt = new Date().toISOString();
    if (status === 'RESOLVED' && !alert.resolvedAt) alert.resolvedAt = new Date().toISOString();
    this.logAudit(actor?.id || 'SYSTEM', actor?.email || 'system', 'UPDATE_ALERT', { alertId: id, status, assignedTo });
    this.save();
    return alert;
  }

  // --- Hotspots ---
  public getHotspots(): StoredHotspot[] {
    return this.db.hotspots;
  }

  public getHotspotById(id: string): StoredHotspot | undefined {
    return this.db.hotspots.find(h => h.id === id);
  }

  // --- Cameras & Devices ---
  public getCameras(): StoredCamera[] {
    return this.db.cameras;
  }

  public getCameraById(id: string): StoredCamera | undefined {
    return this.db.cameras.find(c => c.id === id);
  }

  public updateCamera(id: string, updates: Partial<StoredCamera>, actor?: { id: string; email: string }): StoredCamera | null {
    const cam = this.db.cameras.find(c => c.id === id);
    if (!cam) return null;
    Object.assign(cam, updates);
    this.logAudit(actor?.id || 'SYSTEM', actor?.email || 'system', 'UPDATE_CAMERA', { cameraId: id, updates });
    this.save();
    return cam;
  }

  public getDevices(): StoredDevice[] {
    return this.db.devices;
  }

  public getDeviceById(id: string): StoredDevice | undefined {
    return this.db.devices.find(d => d.id === id);
  }

  public updateDevice(id: string, updates: Partial<StoredDevice>, actor?: { id: string; email: string }): StoredDevice | null {
    const d = this.db.devices.find(dev => dev.id === id);
    if (!d) return null;
    Object.assign(d, updates);
    this.logAudit(actor?.id || 'SYSTEM', actor?.email || 'system', 'UPDATE_DEVICE', { deviceId: id, updates });
    this.save();
    return d;
  }

  // --- Cleanup Missions ---
  public getCleanupMissions(): StoredCleanupMission[] {
    return this.db.cleanupMissions;
  }

  public getCleanupMissionById(id: string): StoredCleanupMission | undefined {
    return this.db.cleanupMissions.find(m => m.id === id);
  }

  public createCleanupMission(data: Partial<StoredCleanupMission>, actor?: { id: string; email: string; name?: string }): StoredCleanupMission {
    const newMission: StoredCleanupMission = {
      id: `CM-${Date.now().toString().slice(-4)}`,
      title: data.title?.trim() || 'Coastal Cleanup Operation',
      status: data.status || (data.assignedTeam ? 'ASSIGNED' : 'DRAFT'),
      priority: data.priority || 'HIGH',
      zoneId: data.zoneId || 'Z-GUJ',
      zoneName: data.zoneName || 'Gujarat Marine Sanctuary',
      lat: data.lat ?? 22.45,
      lng: data.lng ?? 69.15,
      locationLabel: data.locationLabel || 'Coastal Marine Zone',
      detectionCount: data.detectionCount ?? 0,
      estimatedMassKg: data.estimatedMassKg ?? 0,
      assignedTeam: data.assignedTeam,
      scheduledAt: data.scheduledAt,
      startedAt: data.startedAt,
      completedAt: data.completedAt,
      createdAt: new Date().toISOString(),
      createdBy: actor?.name || actor?.email || 'Operator',
      progress: data.progress ?? 0,
      description: data.description?.trim(),
      sourceDetectionId: data.sourceDetectionId,
      sourceHotspotId: data.sourceHotspotId,
      evidence: data.evidence || [],
      timeline: [
        {
          label: 'Mission Created',
          time: new Date().toISOString(),
          by: actor?.name || 'Operator',
          color: 'bg-cyan-400',
        },
      ],
    };
    this.db.cleanupMissions.unshift(newMission);
    this.logAudit(actor?.id || 'SYSTEM', actor?.email || 'system', 'CREATE_MISSION', { missionId: newMission.id, title: newMission.title });
    this.save();
    return newMission;
  }

  public updateCleanupMission(id: string, updates: Partial<StoredCleanupMission>, actor?: { id: string; email: string; name?: string }): StoredCleanupMission | null {
    const mission = this.db.cleanupMissions.find(m => m.id === id);
    if (!mission) return null;
    const oldStatus = mission.status;
    Object.assign(mission, updates);
    if (updates.status && updates.status !== oldStatus) {
      if (updates.status === 'IN_PROGRESS' && !mission.startedAt) mission.startedAt = new Date().toISOString();
      if (updates.status === 'COMPLETED' && !mission.completedAt) {
        mission.completedAt = new Date().toISOString();
        mission.progress = 100;
      }
      mission.timeline.push({
        label: `Status changed to ${updates.status.replace('_', ' ')}`,
        time: new Date().toISOString(),
        by: actor?.name || actor?.email || 'Operator',
        color: updates.status === 'COMPLETED' ? 'bg-green-400' : 'bg-cyan-400',
      });
    }
    this.logAudit(actor?.id || 'SYSTEM', actor?.email || 'system', 'UPDATE_MISSION', { missionId: id, updates });
    this.save();
    return mission;
  }

  public addCleanupEvidence(missionId: string, evidence: Partial<StoredCleanupEvidence>, actor?: { id: string; email: string; name?: string }): StoredCleanupEvidence | null {
    const mission = this.db.cleanupMissions.find(m => m.id === missionId);
    if (!mission) return null;
    const newEv: StoredCleanupEvidence = {
      id: `EV-${Date.now().toString().slice(-4)}`,
      type: evidence.type || 'DURING',
      description: evidence.description?.trim() || 'Field evidence log',
      recoveredKg: evidence.recoveredKg,
      photoUrl: evidence.photoUrl,
      uploadedAt: new Date().toISOString(),
      uploadedBy: actor?.name || actor?.email || 'Cleanup Crew',
    };
    mission.evidence.push(newEv);
    mission.timeline.push({
      label: `Evidence added: ${newEv.type} ${newEv.recoveredKg ? `(${newEv.recoveredKg} kg)` : ''}`,
      time: newEv.uploadedAt,
      by: newEv.uploadedBy,
      color: 'bg-emerald-400',
    });
    this.logAudit(actor?.id || 'SYSTEM', actor?.email || 'system', 'ADD_MISSION_EVIDENCE', { missionId, evidenceId: newEv.id });
    this.save();
    return newEv;
  }

  // --- Reports ---
  public getReports(): StoredReport[] {
    return this.db.reports;
  }

  public getReportById(id: string): StoredReport | undefined {
    return this.db.reports.find(r => r.id === id);
  }

  public createReport(data: {
    type: StoredReport['type'];
    zoneId: string;
    startDate?: string;
    endDate?: string;
  }, actor?: { id: string; email: string; name?: string }): StoredReport {
    const report: StoredReport = {
      id: `RPT-${Date.now().toString().slice(-6)}`,
      type: data.type,
      zoneId: data.zoneId || 'ALL',
      startDate: data.startDate || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
      endDate: data.endDate || new Date().toISOString().slice(0, 10),
      generatedAt: new Date().toISOString(),
      generatedBy: actor?.name || actor?.email || 'Cmdr. Elena Vance',
      metrics: {
        totalDetectionsPeriod: 412,
        criticalIncidents: 6,
        clearedDebrisKg: 242,
        meanResponseTimeHours: 1.8,
        predominantClass: 'Plastic Bottle (42%)',
      },
      summaryText: `${data.type} report generated for Zone ${data.zoneId || 'ALL'}. Operational telemetry confirmed across 5 monitored coastal sectors.`,
      status: 'FINAL',
    };
    this.db.reports.unshift(report);
    this.logAudit(actor?.id || 'SYSTEM', actor?.email || 'system', 'GENERATE_REPORT', { reportId: report.id, type: report.type });
    this.save();
    return report;
  }

  // --- Access Requests (Public Portal) ---
  public getAccessRequests(): StoredAccessRequest[] {
    return this.db.accessRequests;
  }

  public createAccessRequest(organization: string, email: string): StoredAccessRequest {
    const req: StoredAccessRequest = {
      id: `REQ-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      organization: organization.trim(),
      email: email.toLowerCase().trim(),
      requestedAt: new Date().toISOString(),
      status: 'PENDING',
    };
    this.db.accessRequests.unshift(req);
    this.save();
    return req;
  }

  // --- Admin Thresholds & Audit Log ---
  public getThresholds() {
    return this.db.thresholds;
  }

  public updateThresholds(newThresholds: Array<{ label: string; value: string; unit: string; desc: string }>, actor?: { id: string; email: string }) {
    this.db.thresholds = newThresholds;
    this.logAudit(actor?.id || 'SYSTEM', actor?.email || 'system', 'UPDATE_THRESHOLDS', { count: newThresholds.length });
    this.save();
    return this.db.thresholds;
  }

  public getAuditLog(limit = 50): StoredAuditLog[] {
    return this.db.auditLog.slice(0, limit);
  }

  public logAudit(actorId: string, actorEmail: string, action: string, details: Record<string, any>) {
    const entry: StoredAuditLog = {
      id: `AUD-${Date.now().toString().slice(-6)}`,
      timestamp: new Date().toISOString(),
      actorId,
      actorEmail,
      action,
      details,
    };
    this.db.auditLog.unshift(entry);
    if (this.db.auditLog.length > 500) this.db.auditLog.pop();
  }
}

export const storage = new StorageEngine();
