// ─── Users & Auth ──────────────────────────────────────────────────────────
export type UserRole = 'ADMIN' | 'FIELD_OPERATOR' | 'ENVIRONMENTAL_OFFICER' | 'CLEANUP_TEAM';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  roleTitle: string;
  organizationName: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  avatarUrl?: string;
  lastSeen?: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

// ─── System ─────────────────────────────────────────────────────────────────
export type SystemStatus = 'INITIALIZING' | 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'MAINTENANCE' | 'ERROR';
export type AIStatus = 'LOADING' | 'READY' | 'RUNNING' | 'DEGRADED' | 'MODEL_ERROR' | 'STOPPED';

export interface SystemHealth {
  system: SystemStatus;
  camera: string;
  ai: AIStatus;
  /** No GPS receiver is connected in this prototype: expect 'UNAVAILABLE'. */
  gps: string;
  internet: string;
  activeCameras: number;
  totalCameras: number;
  aiLatencyMs: number;
  /** No fleet-wide FPS measurement exists; null means "not measured". */
  fps: number | null;
  /** No measured uptime source exists; null means "not measured". */
  uptime?: string | null;
}

// ─── Cameras & Devices ───────────────────────────────────────────────────────
export type CameraStatus = 'CONNECTING' | 'ONLINE' | 'STREAMING' | 'NO_SIGNAL' | 'LOW_FPS' | 'DISCONNECTED' | 'ERROR';
export type DeviceType = 'CAMERA' | 'DRONE' | 'GPS' | 'AIS' | 'RADAR' | 'SENSOR';
export type DeviceStatus = 'ONLINE' | 'OFFLINE' | 'MAINTENANCE' | 'ERROR' | 'STANDBY';

export interface Camera {
  id: string;
  name: string;
  location: string;
  lat: number;
  lng: number;
  status: CameraStatus;
  fps: number;
  resolution: string;
  lastHeartbeat: string;
  streamUrl?: string;
  zoneId: string;
  uptimePercent: number;
}

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  status: DeviceStatus;
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

// ─── Detection ───────────────────────────────────────────────────────────────
export type DetectionStatus = 'NEW' | 'VALIDATING' | 'CONFIRMED' | 'TRACKING' | 'LOST' | 'FALSE_POSITIVE' | 'EXPIRED';
export type DebrisClass =
  | 'Plastic Bottle' | 'Plastic Bag' | 'Fishing Net' | 'Rope'
  | 'Metal' | 'Glass' | 'Wood' | 'Mixed Waste' | 'Unknown';
export type DebrisCategory = 'Plastic' | 'Fishing Gear' | 'Metal/Glass' | 'Organic' | 'Unknown';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface BoundingBox {
  x: number; // 0-1 normalized
  y: number;
  width: number;
  height: number;
}

export interface Detection {
  id: string;
  trackId: string;
  className: DebrisClass;
  category: DebrisCategory;
  confidence: number; // 0-100
  status: DetectionStatus;
  riskScore: number; // 0-100
  riskLevel: RiskLevel;
  riskFactors: RiskFactor[];
  boundingBox: BoundingBox;
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
  confirmedAt?: string;
  frameUrl?: string;
  source: 'CAMERA' | 'DRONE' | 'UPLOAD' | 'MANUAL';
  originReview?: { label: 'NATURAL' | 'MAN_MADE' | 'UNCERTAIN'; reviewedAt: string; reviewedBy: string };
}

export interface RiskFactor {
  label: string;
  score: number;
  description: string;
}

// ─── Tracking ────────────────────────────────────────────────────────────────
export interface TrackPoint {
  lat: number;
  lng: number;
  timestamp: string;
  confidence: number;
  velocity?: number; // m/s
  heading?: number;  // degrees
}

export interface Track {
  id: string;
  detectionId: string;
  className: DebrisClass;
  status: 'ACTIVE' | 'LOST' | 'RESOLVED';
  firstSeen: string;
  lastSeen: string;
  points: TrackPoint[];
  currentLat: number;
  currentLng: number;
  velocity: number;
  heading: number;
  confidence: number;
}

// ─── Alerts ──────────────────────────────────────────────────────────────────
export type AlertStatus =
  | 'TRIGGERED' | 'ACKNOWLEDGED' | 'INVESTIGATING'
  | 'ACTION_REQUIRED' | 'ASSIGNED' | 'RESOLVED' | 'DISMISSED';
export type AlertPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AlertType = 'DETECTION' | 'RISK_THRESHOLD' | 'SYSTEM' | 'DEVICE' | 'ZONE_BREACH';

export interface Alert {
  id: string;
  type: AlertType;
  title: string;
  description: string;
  priority: AlertPriority;
  status: AlertStatus;
  detectionId?: string;
  cameraId?: string;
  zoneId?: string;
  assignedTo?: string;
  triggeredAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  lat: number;
  lng: number;
  locationLabel: string;
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────
export type CleanupStatus =
  | 'DRAFT' | 'SCHEDULED' | 'ASSIGNED' | 'IN_PROGRESS'
  | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
export type CleanupPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface CleanupMission {
  id: string;
  title: string;
  description: string;
  status: CleanupStatus;
  priority: CleanupPriority;
  zoneId: string;
  zoneName: string;
  lat: number;
  lng: number;
  locationLabel: string;
  detectionCount: number;
  estimatedMassKg: number;
  assignedTeam?: string;
  assignedTeamId?: string;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  evidence: CleanupEvidence[];
  relatedAlertId?: string;
  createdBy: string;
  createdAt: string;
}

export interface CleanupEvidence {
  id: string;
  missionId: string;
  type: 'BEFORE' | 'AFTER' | 'DURING';
  imageUrl: string;
  description: string;
  uploadedAt: string;
  uploadedBy: string;
  /** Mass logged for this evidence entry. Kept in sync with the server's
   *  StoredCleanupEvidence.recoveredKg (previously mismatched as collectedMassKg). */
  recoveredKg?: number;
}

// ─── Hotspots ────────────────────────────────────────────────────────────────
export type HotspotStatus = 'ACTIVE' | 'MONITORED' | 'CLEANING' | 'CLEANED' | 'ARCHIVED';

export interface Hotspot {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius: number; // meters
  status: HotspotStatus;
  riskLevel: RiskLevel;
  detectionCount: number;
  dominantClass: DebrisClass;
  estimatedMassKg: number;
  firstDetected: string;
  lastUpdated: string;
  trend: 'INCREASING' | 'STABLE' | 'DECREASING';
  zoneId: string;
}

// ─── AI Models ───────────────────────────────────────────────────────────────
export type ModelStatus = 'ACTIVE' | 'INACTIVE' | 'TRAINING' | 'DEPRECATED' | 'ERROR';

export interface AIModel {
  id: string;
  name: string;
  version: string;
  type: 'DETECTION' | 'CLASSIFICATION' | 'TRACKING' | 'RISK';
  status: ModelStatus;
  mAP: number | null;
  precision: number | null;
  recall: number | null;
  f1Score: number | null;
  inferenceMs: number | null;
  classes: string[];
  trainedAt: string | null;
  deployedAt?: string;
  framework: string;
  size: string | null;
  description: string;
}

export interface AIBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AIInferenceDetection {
  id: string;
  className: string;
  parentCategory: string;
  confidence: number;
  rawConfidence: number;
  confidenceCalibrated: boolean;
  boundingBox: AIBoundingBox;
  riskScore: number;
  riskLevel: RiskLevel;
}

export interface AIInferenceResult {
  analysisId: string;
  model: { name: string; version: string; engine: string };
  source: { filename: string; width: number; height: number };
  latencyMs: number;
  detections: AIInferenceDetection[];
  summary: {
    totalDetections: number;
    meanConfidence: number;
    highRiskDetections: number;
    dominantCategory: string | null;
    categoryCounts: Record<string, number>;
  };
  analysis: { riskMethod: string; confidenceMethod: string };
}

export interface AILearningStatus {
  analysesStored: number;
  framesReviewed?: number;
  detectionsReviewed: number;
  approvedTrainingExamples: number;
  falsePositivesReviewed: number;
  learningMode: string;
  trainer?: { state: string; lastHeartbeat?: string; reviewThreshold?: number; lastError?: string; lastRun?: { promoted: boolean; candidateF1: number; baselineF1: number } };
}

export interface AIServiceStatus {
  state: 'READY' | 'BOOTSTRAP' | 'NEEDS_TRAINING' | 'ERROR' | 'OFFLINE';
  ready: boolean;
  service: string;
  engine: string;
  modelName: string;
  version: string;
  architecture: string;
  classes: string[];
  inputSize: number;
  confidenceThreshold: number;
  confidenceCalibration: string;
  metrics: {
    map50?: number;
    iou50Precision?: number;
    iou50Recall?: number;
    iou50F1?: number;
    inferenceMs?: number;
  } | null;
  learning: AILearningStatus | null;
  error: string | null;
  notice?: string | null;
  trainedAt?: string;
  trainingImages?: number;
  validationImages?: number;
  validationScope?: string;
}

export type AIFeedbackVerdict = 'CONFIRMED' | 'FALSE_POSITIVE' | 'CORRECTED' | 'MISSED';

export interface AIFeedbackPayload {
  analysisId: string;
  detectionId: string;
  verdict: AIFeedbackVerdict;
  correctedClass?: string;
  correctedBoundingBox?: AIBoundingBox;
  reviewer?: string;
}

export interface AIFrameReviewAnnotation {
  annotationId: string;
  sourceDetectionId: string | null;
  verdict: AIFeedbackVerdict;
  correctedClass?: string;
  correctedBoundingBox?: AIBoundingBox;
}

export interface AIFrameReviewPayload {
  expectedRevision: number;
  annotations: AIFrameReviewAnnotation[];
  reviewer?: string;
}

export interface AIFrameReviewResponse {
  analysisId: string;
  reviewId: number;
  revision: number;
  contentHash: string;
  annotationCount: number;
  queuedForLearning: boolean;
  idempotent: boolean;
  updatedAt: string;
}



// ─── Dashboard ───────────────────────────────────────────────────────────────
export interface DashboardSummary {
  debrisDetected: number;
  highRiskIncidents: number;
  activeHotspots: number;
  activeAlerts: number;
  cleanupMissions: number;
  camerasOnline: string;
  systemStatus: SystemStatus;
  aiStatus: AIStatus;
}

// ─── Reports ─────────────────────────────────────────────────────────────────
export type ReportType = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'INCIDENT' | 'CLEANUP';

export interface Report {
  reportId: string;
  type: ReportType;
  generatedAt: string;
  period: string;
  metrics: {
    totalDetectionsPeriod: number;
    criticalIncidents: number;
    clearedDebrisKg: number;
    meanResponseTimeHours: number;
    predominantClass: string;
  };
  downloadUrl?: string;
}

// ─── SSE Events ─────────────────────────────────────────────────────────────
export type SSEEventType =
  | 'CONNECTED' | 'DETECTION_NEW' | 'DETECTION_UPDATE' | 'ALERT_TRIGGERED'
  | 'ALERT_UPDATE' | 'CAMERA_STATUS' | 'SYSTEM_STATUS' | 'AI_STATUS'
  | 'CLEANUP_UPDATE' | 'TRACK_UPDATE' | 'HOTSPOT_UPDATE';

export interface SSEEvent {
  type: SSEEventType;
  payload: any;
  timestamp: string;
}
