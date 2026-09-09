import React, {
  createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode
} from 'react';
import { dashboardApi } from '../lib/api';
import type { DashboardSummary, SystemHealth, SSEEvent } from '../types';

interface SystemContextValue {
  summary: DashboardSummary | null;
  health: SystemHealth | null;
  isOnline: boolean;
  lastEvent: SSEEvent | null;
  lastEventTime: string | null;
  refreshSummary: () => void;
  refreshHealth: () => void;
}

const SystemContext = createContext<SystemContextValue | null>(null);

const DEFAULT_SUMMARY: DashboardSummary = {
  debrisDetected: 1284,
  highRiskIncidents: 21,
  activeHotspots: 18,
  activeAlerts: 7,
  cleanupMissions: 3,
  camerasOnline: '14/15',
  systemStatus: 'ONLINE',
  aiStatus: 'MODEL_ERROR',
};

const DEFAULT_HEALTH: SystemHealth = {
  system: 'ONLINE',
  camera: 'STREAMING',
  ai: 'MODEL_ERROR',
  gps: 'VALID',
  internet: 'ONLINE',
  activeCameras: 14,
  totalCameras: 15,
  aiLatencyMs: 0,
  fps: 29.8,
  uptime: '99.7%',
};

export function SystemProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState<DashboardSummary | null>(DEFAULT_SUMMARY);
  const [health, setHealth]   = useState<SystemHealth | null>(DEFAULT_HEALTH);
  const [isOnline, setIsOnline] = useState(true);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const [lastEventTime, setLastEventTime] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const refreshSummary = useCallback(async () => {
    try {
      const data = await dashboardApi.summary();
      setSummary(data);
      setIsOnline(true);
    } catch { /* keep last value */ }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const data = await dashboardApi.systemHealth();
      setHealth(data);
    } catch { /* keep last value */ }
  }, []);

  // SSE connection
  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const es = new EventSource('/api/events');
      esRef.current = es;

      es.onmessage = (e) => {
        try {
          const event: SSEEvent = JSON.parse(e.data);
          setLastEvent(event);
          setLastEventTime(new Date().toISOString());
          setIsOnline(true);
        } catch { /* ignore malformed */ }
      };

      es.onerror = () => {
        setIsOnline(false);
        es.close();
        // Reconnect after 5s
        reconnectTimer = setTimeout(connect, 5000);
      };
    };

    connect();
    return () => {
      disposed = true;
      esRef.current?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  // Poll summary + health every 30s
  useEffect(() => {
    refreshSummary();
    refreshHealth();
    const id = setInterval(() => {
      refreshSummary();
      refreshHealth();
    }, 30000);
    return () => clearInterval(id);
  }, [refreshSummary, refreshHealth]);

  return (
    <SystemContext.Provider value={{ summary, health, isOnline, lastEvent, lastEventTime, refreshSummary, refreshHealth }}>
      {children}
    </SystemContext.Provider>
  );
}

export function useSystem(): SystemContextValue {
  const ctx = useContext(SystemContext);
  if (!ctx) throw new Error('useSystem must be used within SystemProvider');
  return ctx;
}
