import { useState, useEffect } from 'react';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useAuth } from '../context/AuthContext';
import { useSystem } from '../context/SystemContext';
import { authApi } from '../lib/api';
import { Check, RotateCcw, CheckCircle, AlertTriangle, Shield, Sliders, Bell, Info } from 'lucide-react';

interface DisplaySettings {
  theme: string;
  mapStyle: string;
  defaultView: string;
  alertSound: string;
}

interface NotificationSettings {
  criticalRisk: boolean;
  highRisk: boolean;
  cameraStatus: boolean;
  cleanupUpdates: boolean;
  aiModelStatus: boolean;
  dailyReportReady: boolean;
}

const DEFAULT_DISPLAY: DisplaySettings = {
  theme: 'Dark Ocean',
  mapStyle: 'OpenStreetMap',
  defaultView: 'Command Center',
  alertSound: 'Enabled',
};

const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  criticalRisk: true,
  highRisk: true,
  cameraStatus: true,
  cleanupUpdates: false,
  aiModelStatus: false,
  dailyReportReady: true,
};

// Settings page: operator profile, display/notification preferences persisted to
// localStorage, and an honest system-architecture status panel.
export default function Settings() {
  const { user } = useAuth();
  const { health, isOnline, summary } = useSystem();

  const [display, setDisplay] = useState<DisplaySettings>(() => {
    try {
      const saved = localStorage.getItem('oceanguard_display_settings');
      return saved ? { ...DEFAULT_DISPLAY, ...JSON.parse(saved) } : DEFAULT_DISPLAY;
    } catch {
      return DEFAULT_DISPLAY;
    }
  });

  const [notifications, setNotifications] = useState<NotificationSettings>(() => {
    try {
      const saved = localStorage.getItem('oceanguard_notification_settings');
      return saved ? { ...DEFAULT_NOTIFICATIONS, ...JSON.parse(saved) } : DEFAULT_NOTIFICATIONS;
    } catch {
      return DEFAULT_NOTIFICATIONS;
    }
  });

  const [fullName, setFullName] = useState(user?.name || '');
  const [organization, setOrganization] = useState(user?.organizationName || '');
  const [saved, setSaved] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.name) setFullName(user.name);
    if (user?.organizationName) setOrganization(user.organizationName);
  }, [user]);

  // Persist preferences to localStorage AND the profile to the server so a
  // reload (or another browser) retains saved values. Failures stay visible.
  const handleSave = async () => {
    setProfileError(null);
    const trimmedName = fullName.trim();
    const trimmedOrg = organization.trim();
    if (trimmedName.length < 2 || trimmedOrg.length < 2) {
      setProfileError('Name and organization must each be at least 2 characters.');
      return;
    }
    setSavingProfile(true);
    try {
      await authApi.updateProfile({ name: trimmedName, organizationName: trimmedOrg });
      try {
        localStorage.setItem('oceanguard_display_settings', JSON.stringify(display));
        localStorage.setItem('oceanguard_notification_settings', JSON.stringify(notifications));
      } catch {
        setProfileError('Profile saved on the server, but local preference storage is unavailable.');
        return;
      }
      setSaved(true);
      setNotice('Settings saved. Your profile is updated server-side and preferences on this device.');
      setTimeout(() => {
        setSaved(false);
        setNotice(null);
      }, 3000);
    } catch (err: any) {
      setProfileError(err?.message || 'Could not save your profile. Please try again.');
    } finally {
      setSavingProfile(false);
    }
  };

  // Restore factory defaults in state AND remove the persisted overrides.
  const handleResetDefaults = () => {
    setDisplay(DEFAULT_DISPLAY);
    setNotifications(DEFAULT_NOTIFICATIONS);
    try {
      localStorage.removeItem('oceanguard_display_settings');
      localStorage.removeItem('oceanguard_notification_settings');
      setNotice('Settings reset to system factory defaults.');
      setTimeout(() => setNotice(null), 3000);
    } catch { /* ignore */ }
  };

  return (
    <div className="p-3 space-y-6 max-w-4xl mx-auto sm:p-6">
      {notice && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 text-xs font-mono">
          <CheckCircle className="w-4 h-4 text-cyan-400 flex-shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {profileError && (
        <div role="alert" className="flex items-center gap-2 p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-xs font-mono">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span>{profileError}</span>
        </div>
      )}

      {/* Profile */}
      <Card>
        <CardHeader
          title="Operator Profile"
          subtitle="Your authenticated credentials and organizational affiliation"
          icon={<Shield className="w-4 h-4 text-cyan-400" />}
        />
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-cyan-900/50 border-2 border-cyan-700/40 flex items-center justify-center flex-shrink-0">
            <span className="text-xl font-bold text-cyan-300">
              {fullName ? fullName.split(' ').map(n => n[0]).slice(0, 2).join('') : 'OG'}
            </span>
          </div>
          <div>
            <p className="text-base font-bold text-[var(--ocean-text)]">{fullName || 'Operator'}</p>
            <p className="text-sm text-[var(--ocean-text-dim)]">{user?.roleTitle || 'Maritime Operations'}</p>
            <p className="text-xs text-[var(--ocean-text-muted)] mt-0.5">{organization || 'OceanGuard Sentinel'}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-[var(--ocean-text-dim)] mb-1.5 uppercase tracking-wider">Full Name</label>
            <input
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-bg)] text-[var(--ocean-text)] focus:border-cyan-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--ocean-text-dim)] mb-1.5 uppercase tracking-wider">Institutional Email</label>
            <input
              value={user?.email ?? ''}
              readOnly
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text-dim)] font-mono outline-none cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--ocean-text-dim)] mb-1.5 uppercase tracking-wider">Assigned Role</label>
            <input
              value={user?.role ? user.role.replace('_', ' ') : 'OPERATOR'}
              readOnly
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-cyan-400 font-mono outline-none cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--ocean-text-dim)] mb-1.5 uppercase tracking-wider">Organization</label>
            <input
              value={organization}
              onChange={e => setOrganization(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-bg)] text-[var(--ocean-text)] focus:border-cyan-500 outline-none"
            />
          </div>
        </div>
      </Card>

      {/* Display preferences */}
      <Card>
        <CardHeader
          title="Display & Interface Preferences"
          subtitle="Saved on this device. Alert tone and map style apply where supported; theme and startup view are not yet consumed by the app."
          icon={<Sliders className="w-4 h-4 text-cyan-400" />}
        />
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <p className="text-sm text-[var(--ocean-text)] font-medium">Tactical Theme</p>
              <p className="text-xs text-[var(--ocean-text-dim)]">Visual palette for dashboard and charts</p>
            </div>
            <select
              value={display.theme}
              onChange={e => setDisplay(d => ({ ...d, theme: e.target.value }))}
              className="px-3 py-1.5 text-xs rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-bg)] text-[var(--ocean-text)] focus:border-cyan-500 outline-none w-48"
            >
              <option value="Dark Ocean">Dark Ocean (Standard)</option>
              <option value="Dark Navy">Dark Navy (High Contrast)</option>
              <option value="Dark Carbon">Dark Carbon (OLED Night)</option>
            </select>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <p className="text-sm text-[var(--ocean-text)] font-medium">Cartographic Map Style</p>
              <p className="text-xs text-[var(--ocean-text-dim)]">Basemap tiles for Hotspots and Command Center</p>
            </div>
            <select
              value={display.mapStyle}
              onChange={e => setDisplay(d => ({ ...d, mapStyle: e.target.value }))}
              className="px-3 py-1.5 text-xs rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-bg)] text-[var(--ocean-text)] focus:border-cyan-500 outline-none w-48"
            >
              <option value="OpenStreetMap">OpenStreetMap Standard</option>
              <option value="CartoDB Dark">CartoDB Dark Matter</option>
              <option value="Satellite">Satellite Imagery</option>
            </select>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <p className="text-sm text-[var(--ocean-text)] font-medium">Default Startup View</p>
              <p className="text-xs text-[var(--ocean-text-dim)]">Initial page loaded upon authentication</p>
            </div>
            <select
              value={display.defaultView}
              onChange={e => setDisplay(d => ({ ...d, defaultView: e.target.value }))}
              className="px-3 py-1.5 text-xs rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-bg)] text-[var(--ocean-text)] focus:border-cyan-500 outline-none w-48"
            >
              <option value="Command Center">Command Center</option>
              <option value="Live Monitoring">3D Marine Monitoring</option>
              <option value="Detections">Inference Detections</option>
              <option value="Hotspots">Debris Hotspots</option>
            </select>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <p className="text-sm text-[var(--ocean-text)] font-medium">Alert Audio Tone</p>
              <p className="text-xs text-[var(--ocean-text-dim)]">Chime when CRITICAL or HIGH incidents arrive</p>
            </div>
            <select
              value={display.alertSound}
              onChange={e => setDisplay(d => ({ ...d, alertSound: e.target.value }))}
              className="px-3 py-1.5 text-xs rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-bg)] text-[var(--ocean-text)] focus:border-cyan-500 outline-none w-48"
            >
              <option value="Enabled">Enabled (Sonar Ping)</option>
              <option value="Disabled">Muted</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Notification settings */}
      <Card>
        <CardHeader
          title="Alert & Event Subscriptions"
          subtitle="Select which anomalies trigger desktop notifications and auditory cues"
          icon={<Bell className="w-4 h-4 text-cyan-400" />}
        />
        <div className="space-y-4">
          {[
            { key: 'criticalRisk', l: 'Critical Risk Incident Alerts', desc: 'Score >= 80 or high-priority maritime collision' },
            { key: 'highRisk', l: 'High Risk Detections', desc: 'Ghost nets, chemical drums, or clusters >= 60' },
            { key: 'cameraStatus', l: 'Camera Status Changes', desc: 'Sensor array dropout or frame disruption' },
            { key: 'cleanupUpdates', l: 'Cleanup Mission Dispatch & Timeline Updates', desc: 'Team progress, recovered mass logs' },
            { key: 'aiModelStatus', l: 'Espada Model Status Changes', desc: 'Retraining completion or checkpoint promotions' },
            { key: 'dailyReportReady', l: 'Daily Environmental Summary Ready', desc: 'Compiled 24h operational report notifications' },
          ].map(({ key, l, desc }) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-[var(--ocean-text-dim)] font-medium">{l}</p>
                <p className="text-[10px] text-[var(--ocean-text-muted)]">{desc}</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                <input
                  type="checkbox"
                  checked={(notifications as any)[key]}
                  onChange={e => setNotifications(n => ({ ...n, [key]: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 rounded-full bg-[var(--ocean-border)] peer-checked:bg-cyan-500/70 after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-4" />
              </label>
            </div>
          ))}
        </div>
      </Card>

      {/* Honest System Info */}
      <Card>
        <CardHeader
          title="System Architecture & Telemetry"
          subtitle="Honest status of backend services, sensor mesh, and inference workers"
          icon={<Info className="w-4 h-4 text-cyan-400" />}
        />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { l: 'Platform Version', v: 'OceanGuard AI v1.4.0' },
            { l: 'AI Inference Engine', v: 'Espada v1 · ONNX' },
            { l: 'Backend Service', v: isOnline ? 'ONLINE' : 'OFFLINE' },
            { l: 'Espada Status', v: health?.ai ?? 'STANDBY' },
            {
              l: 'Inference Latency',
              v: health?.aiLatencyMs && health.aiLatencyMs > 0 ? `${health.aiLatencyMs.toFixed(1)} ms` : '— (Standby)',
            },
            {
              l: 'Operational Fleet',
              v: summary?.camerasOnline ? `${summary.camerasOnline} Online` : `${health?.activeCameras ?? 0}/${health?.totalCameras ?? 15} Online`,
            },
            { l: 'Monitored Sectors', v: '7 Coastal India Zones' },
            { l: 'Event Stream (SSE)', v: isOnline ? 'CONNECTED' : 'DISCONNECTED' },
          ].map(({ l, v }) => (
            <div key={l} className="p-3 rounded-lg bg-[var(--ocean-surface)] border border-[var(--ocean-border)]">
              <p className="text-[10px] text-[var(--ocean-text-muted)] uppercase tracking-wider">{l}</p>
              <p className="text-xs font-mono text-[var(--ocean-text)] mt-0.5 font-semibold">{v}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex items-center gap-3 pt-2">
        <Button
          variant="primary"
          onClick={() => void handleSave()}
          loading={savingProfile}
          icon={saved ? <Check className="h-4 w-4" /> : undefined}
        >
          {saved ? 'Settings Saved' : 'Save Preferences'}
        </Button>
        <Button
          variant="outline"
          onClick={handleResetDefaults}
          icon={<RotateCcw className="h-3.5 w-3.5" />}
        >
          Reset to Defaults
        </Button>
      </div>
    </div>
  );
}
