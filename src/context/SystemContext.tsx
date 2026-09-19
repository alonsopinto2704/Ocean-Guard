import {
  createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode
} from 'react';
import { dashboardApi } from '../lib/api';
import type { DashboardSummary, SystemHealth, SSEEvent } from '../types';
import { useAuth } from './AuthContext';

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

/** Global telemetry provider: polls dashboard summary + system health every 30s
 *  and maintains one SSE connection for live events. */
export function SystemProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [health, setHealth]   = useState<SystemHealth | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const [lastEventTime, setLastEventTime] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const refreshSummary = useCallback(async () => {
    try {
      const data = await dashboardApi.summary();
      setSummary(data);
      setIsOnline(true);
    } catch {
      setIsOnline(false);
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const data = await dashboardApi.systemHealth();
      setHealth(data);
    } catch {
      setIsOnline(false);
    }
  }, []);

  // SSE connection
  useEffect(() => {
    if (authLoading || !isAuthenticated) return;

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
        // EventSource retries transient failures natively. A 204 response (used
        // by Vercel where SSE is unsupported) transitions to CLOSED; leave it
        // closed and let polling continue to own the online status.
        if (es.readyState === EventSource.CLOSED) esRef.current = null;
      };
    };

    connect();
    return () => {
      disposed = true;
      esRef.current?.close();
    };
  }, [authLoading, isAuthenticated]);

  // Poll summary + health every 30s
  useEffect(() => {
    if (authLoading || !isAuthenticated) return;

    refreshSummary();
    refreshHealth();
    const id = setInterval(() => {
      refreshSummary();
      refreshHealth();
    }, 30000);
    return () => clearInterval(id);
  }, [authLoading, isAuthenticated, refreshSummary, refreshHealth]);

  return (
    <SystemContext.Provider value={{ summary, health, isOnline, lastEvent, lastEventTime, refreshSummary, refreshHealth }}>
      {children}
    </SystemContext.Provider>
  );
}

/** Access system telemetry; throws if used outside <SystemProvider>. */
export function useSystem(): SystemContextValue {
  const ctx = useContext(SystemContext);
  if (!ctx) throw new Error('useSystem must be used within SystemProvider');
  return ctx;
}
