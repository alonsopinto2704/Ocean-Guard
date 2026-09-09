import type {
  DashboardSummary, SystemHealth, Camera, Device, Detection, Alert,
  CleanupMission, CleanupEvidence, Hotspot, AIModel, MediaFile,
  ProcessingJob, Report, ReportType, Track, User, AIInferenceResult,
  AIServiceStatus, AILearningStatus, AIFeedbackPayload
} from '../types';

const BASE = '/api';

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

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Auth ────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ success: boolean }>('/auth/logout', { method: 'POST' }),
  me: () => request<{ user: User }>('/auth/me'),
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
export const aiApi = {
  models: () => request<{ models: AIModel[] }>('/ai/models'),
  status: () => request<AIServiceStatus>('/ai/status'),
  learning: () => request<AILearningStatus>('/ai/learning'),
  inferImage: async (image: Blob, filename = 'espada-frame.jpg') => {
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
};

// ─── Analytics ───────────────────────────────────────────────────────────────
export const analyticsApi = {
  overview: () => request<any>('/analytics/overview'),
  trends: (period: string) => request<any>(`/analytics/trends?period=${period}`),
  categories: () => request<any>('/analytics/categories'),
  hotspots: () => request<any>('/analytics/hotspots'),
  cleanup: () => request<any>('/analytics/cleanup'),
};

// ─── Media ───────────────────────────────────────────────────────────────────
export const mediaApi = {
  list: () => request<{ files: MediaFile[] }>('/media'),
  get: (id: string) => request<MediaFile>(`/media/${id}`),
  process: (id: string) => request<ProcessingJob>(`/media/${id}/process`, { method: 'POST' }),
};

// ─── Reports ─────────────────────────────────────────────────────────────────
export const reportsApi = {
  generate: (type: ReportType, zoneId?: string) =>
    request<any>('/reports/generate', {
      method: 'POST',
      body: JSON.stringify({ type, zoneId: zoneId || 'ALL' }),
    }),
};

// ─── Admin ───────────────────────────────────────────────────────────────────
export const adminApi = {
  users: () => request<{ users: User[] }>('/admin/users'),
  updateUser: (id: string, data: Partial<User>) =>
    request<User>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
};
