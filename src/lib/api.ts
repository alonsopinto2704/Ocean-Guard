import type {
  DashboardSummary, SystemHealth, Camera, Device, Detection, Alert,
  CleanupMission, CleanupEvidence, Hotspot, AIModel,
  ReportType, Track, User, AIInferenceResult,
  AIServiceStatus, AILearningStatus, AIFeedbackPayload, AIFrameReviewPayload,
  AIFrameReviewResponse
} from '../types';
import { getToken } from './auth';

const BASE = '/api';

/** Core fetch wrapper: attaches the bearer token + JSON headers, applies a 15s
 *  timeout, and unwraps HTTP errors into thrown Error messages for the UI. */
async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem('og_token');
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(`${BASE}${path}`, { ...options, headers, signal: options.signal || AbortSignal.timeout(15000) });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Auth ────────────────────────────────────────────────────────────────────
// login/logout/me + password recovery & reset endpoints.
export const authApi = {
  login: (email: string, password: string) =>
    request<{ token: string; expiresAt?: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ success: boolean }>('/auth/logout', { method: 'POST' }),
  me: () => request<{ user: User }>('/auth/me'),
  recover: (email: string) =>
    request<{ success: boolean; message: string; resetToken?: string }>('/auth/recover', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, newPassword: string) =>
    request<{ success: boolean; message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),
};

// ─── Access Requests (Public Portal) ─────────────────────────────────────────
export const accessRequestsApi = {
  create: (organization: string, email: string) =>
    request<{ success: boolean; message: string; request: any }>('/access-requests', {
      method: 'POST',
      body: JSON.stringify({ organization, email }),
    }),
  list: () => request<{ requests: any[] }>('/admin/access-requests'),
};

// ─── Dashboard ───────────────────────────────────────────────────────────────
export const dashboardApi = {
  summary: () => request<DashboardSummary>('/dashboard/summary'),
  trends: () => request<{ history: any[] }>('/dashboard/trends'),
  systemHealth: () => request<SystemHealth>('/dashboard/system-health'),
  recentDetections: () => request<{ detections: Detection[] }>('/dashboard/recent-detections'),
  alerts: () => request<{ alerts: Alert[] }>('/dashboard/alerts'),
};

// ─── Monitoring ──────────────────────────────────────────────────────────────
export const monitoringApi = {
  cameras: () => request<{ cameras: Camera[] }>('/monitoring/cameras'),
  camera: (id: string) => request<Camera>(`/monitoring/cameras/${id}`),
  updateCamera: (id: string, updates: Partial<Camera>) =>
    request<Camera>(`/monitoring/cameras/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),
};


// ─── Detections ──────────────────────────────────────────────────────────────
export const detectionsApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<{ detections: Detection[]; total: number }>(`/detections${qs}`);
  },
  get: (id: string) => request<Detection>(`/detections/${id}`),
  track: (id: string) => request<Track>(`/detections/${id}/track`),
  updateStatus: (id: string, status: string) =>
    request<Detection>(`/detections/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
};

// ─── Alerts ──────────────────────────────────────────────────────────────────
export const alertsApi = {
  list: () => request<{ alerts: Alert[] }>('/alerts'),
  get: (id: string) => request<Alert>(`/alerts/${id}`),
  updateStatus: (id: string, status: string) =>
    request<Alert>(`/alerts/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  assign: (id: string, assignedTo: string) =>
    request<Alert>(`/alerts/${id}/assign`, {
      method: 'POST',
      body: JSON.stringify({ assignedTo }),
    }),
};

// ─── Hotspots ────────────────────────────────────────────────────────────────
export const hotspotsApi = {
  list: () => request<{ hotspots: Hotspot[] }>('/hotspots'),
  get: (id: string) => request<Hotspot>(`/hotspots/${id}`),
  heatmap: () => request<{ points: Array<[number, number, number]> }>('/hotspots/heatmap'),
};

// ─── Cleanup ─────────────────────────────────────────────────────────────────
export const cleanupApi = {
  list: () => request<{ missions: CleanupMission[] }>('/cleanup/missions'),
  get: (id: string) => request<CleanupMission>(`/cleanup/missions/${id}`),
  create: (data: Partial<CleanupMission>) =>
    request<CleanupMission>('/cleanup/missions', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<CleanupMission>) =>
    request<CleanupMission>(`/cleanup/missions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  addEvidence: (id: string, evidence: Partial<CleanupEvidence>) =>
    request<CleanupMission>(`/cleanup/missions/${id}/evidence`, {
      method: 'POST',
      body: JSON.stringify(evidence),
    }),
};

// ─── Devices ─────────────────────────────────────────────────────────────────
export const devicesApi = {
  list: () => request<{ devices: Device[] }>('/devices'),
  get: (id: string) => request<Device>(`/devices/${id}`),
  update: (id: string, data: Partial<Device>) =>
    request<Device>(`/devices/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
};

// ─── AI Models ───────────────────────────────────────────────────────────────
// Espada detector: status/learning queries, image inference (multipart-free raw
// body upload with a 65s timeout), operator feedback, and whole-frame review.
export const aiApi = {
  models: () => request<{ models: AIModel[] }>('/ai/models'),
  status: () => request<AIServiceStatus>('/ai/status'),
  learning: () => request<AILearningStatus>('/ai/learning'),
  inferImage: async (image: Blob, filename = 'espada-frame.jpg', signal?: AbortSignal) => {
    const token = localStorage.getItem('og_token');
    const safeFilename = image instanceof File ? image.name : filename;
    const response = await fetch(`${BASE}/ai/infer-image`, {
      method: 'POST',
      headers: {
        'Content-Type': image.type || 'image/jpeg',
        'X-File-Name': encodeURIComponent(safeFilename),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: image,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(65000)]) : AbortSignal.timeout(65000),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }
    return response.json() as Promise<AIInferenceResult>;
  },
  feedback: (payload: AIFeedbackPayload) => request<{
    analysisId: string;
    detectionId: string;
    verdict: string;
    queuedForLearning: boolean;
    updatedAt: string;
  }>('/ai/feedback', { method: 'POST', body: JSON.stringify(payload) }),
  submitFrameReview: (analysisId: string, payload: AIFrameReviewPayload) =>
    request<AIFrameReviewResponse>(`/ai/analyses/${encodeURIComponent(analysisId)}/review`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
};



// ─── Reports ─────────────────────────────────────────────────────────────────
export const reportsApi = {
  list: () => request<{ reports: any[] }>('/reports'),
  get: (id: string) => request<any>(`/reports/${id}`),
  generate: (params: { type: ReportType; zoneId?: string; startDate?: string; endDate?: string }) =>
    request<any>('/reports/generate', {
      method: 'POST',
      body: JSON.stringify(params),
    }),
  downloadUrl: (id: string, format: 'csv' | 'json' | 'pdf' = 'json') =>
    `${BASE}/reports/${encodeURIComponent(id)}/download?format=${format}`,
  download: async (id: string, format: 'csv' | 'json' | 'pdf' = 'json') => {
    const token = getToken();
    const response = await fetch(reportsApi.downloadUrl(id, format), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }
    return response;
  },
};

// ─── Admin ───────────────────────────────────────────────────────────────────
// ADMIN-only: user CRUD, server-persisted alert thresholds, and audit log.
export const adminApi = {
  users: () => request<{ users: User[] }>('/admin/users'),
  createUser: (data: { name: string; email: string; password?: string; role: string; roleTitle: string; organizationName: string }) =>
    request<User>('/admin/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id: string, data: Partial<User>) =>
    request<User>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  thresholds: () => request<{ thresholds: Array<{ label: string; value: string; unit: string; desc: string }> }>('/admin/thresholds'),
  updateThresholds: (thresholds: Array<{ label: string; value: string; unit: string; desc: string }>) =>
    request<{ thresholds: Array<{ label: string; value: string; unit: string; desc: string }> }>('/admin/thresholds', {
      method: 'PUT',
      body: JSON.stringify({ thresholds }),
    }),
  auditLog: () => request<{ auditLog: any[] }>('/admin/audit-log'),
};
