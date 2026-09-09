import React, { useState } from 'react';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { useAuth } from '../context/AuthContext';
import { useSystem } from '../context/SystemContext';
import { Check } from 'lucide-react';

export default function Settings() {
  const { user } = useAuth();
  const { health, isOnline } = useSystem();
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-3 space-y-6 max-w-3xl sm:p-6">
      {/* Profile */}
      <Card>
        <CardHeader title="Operator Profile" subtitle="Your account information" />
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-cyan-900/50 border-2 border-cyan-700/40 flex items-center justify-center">
            <span className="text-xl font-bold text-cyan-300">
              {user?.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
            </span>
          </div>
          <div>
            <p className="text-base font-bold text-[var(--ocean-text)]">{user?.name}</p>
            <p className="text-sm text-[var(--ocean-text-dim)]">{user?.roleTitle}</p>
            <p className="text-xs text-[var(--ocean-text-muted)] mt-0.5">{user?.organizationName}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {[
            { l: 'Full Name', v: user?.name ?? '' },
            { l: 'Email', v: user?.email ?? '' },
            { l: 'Role', v: user?.role ?? '' },
            { l: 'Organization', v: user?.organizationName ?? '' },
          ].map(({ l, v }) => (
            <div key={l}>
              <label className="block text-xs text-[var(--ocean-text-dim)] mb-1.5 uppercase tracking-wider">{l}</label>
              <input
                defaultValue={v}
                readOnly={l === 'Role'}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-bg)] text-[var(--ocean-text)] focus:border-cyan-500 outline-none"
              />
            </div>
          ))}
        </div>
      </Card>

      {/* Display preferences */}
      <Card>
        <CardHeader title="Display Preferences" />
        <div className="space-y-4">
          {[
            { l: 'Theme', options: ['Dark Ocean', 'Dark Navy', 'Dark Carbon'] },
            { l: 'Map Style', options: ['Satellite', 'OpenStreetMap', 'Dark'] },
            { l: 'Default View', options: ['Command Center', 'Live Monitoring', 'Detections'] },
            { l: 'Alert Sound', options: ['Enabled', 'Disabled'] },
          ].map(({ l, options }) => (
            <div key={l} className="flex items-center justify-between">
              <span className="text-sm text-[var(--ocean-text-dim)]">{l}</span>
              <select className="px-3 py-1.5 text-sm rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-bg)] text-[var(--ocean-text)] focus:border-cyan-500 outline-none">
                {options.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
          ))}
        </div>
      </Card>

      {/* Notification settings */}
      <Card>
        <CardHeader title="Notifications" />
        <div className="space-y-4">
          {[
            { l: 'Critical Risk Alerts', checked: true },
            { l: 'High Risk Detections', checked: true },
            { l: 'Camera Status Changes', checked: true },
            { l: 'Cleanup Mission Updates', checked: false },
            { l: 'AI Model Status', checked: false },
            { l: 'Daily Report Ready', checked: true },
          ].map(({ l, checked }) => (
            <div key={l} className="flex items-center justify-between">
              <span className="text-sm text-[var(--ocean-text-dim)]">{l}</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" defaultChecked={checked} className="sr-only peer" />
                <div className="w-9 h-5 rounded-full bg-[var(--ocean-border)] peer-checked:bg-cyan-500/70 after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-4" />
              </label>
            </div>
          ))}
        </div>
      </Card>

      {/* System info */}
      <Card>
        <CardHeader title="System Information" />
        <div className="grid grid-cols-2 gap-3">
          {[
            { l: 'Platform Version', v: 'OceanGuard AI v1.4.0' },
            { l: 'AI Engine',   v: 'Espada v1 · ONNX Runtime' },
            { l: 'System Status', v: health?.system ?? 'ONLINE' },
            { l: 'AI Status',   v: health?.ai ?? 'RUNNING' },
            { l: 'FPS',         v: `${health?.fps?.toFixed(1) ?? '29.8'} fps` },
            { l: 'AI Latency',  v: `${health?.aiLatencyMs?.toFixed(1) ?? '14.2'} ms` },
            { l: 'Cameras',     v: `${health?.activeCameras ?? 14}/${health?.totalCameras ?? 15}` },
            { l: 'Connection',  v: isOnline ? 'ONLINE' : 'OFFLINE' },
          ].map(({ l, v }) => (
            <div key={l} className="p-3 rounded-lg bg-[var(--ocean-surface)] border border-[var(--ocean-border)]">
              <p className="text-[10px] text-[var(--ocean-text-muted)] uppercase tracking-wider">{l}</p>
              <p className="text-xs font-mono text-[var(--ocean-text)] mt-0.5">{v}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex gap-3">
        <Button variant="primary" onClick={handleSave} icon={saved ? <Check className="h-4 w-4" /> : undefined}>
          {saved ? 'Saved' : 'Save Settings'}
        </Button>
        <Button variant="ghost">Reset to Defaults</Button>
      </div>
    </div>
  );
}
