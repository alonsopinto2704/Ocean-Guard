import React, { useState } from 'react';
import { Users, Shield, Settings as SettingsIcon, Plus } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { getRoleBadgeColor, getRoleLabel } from '../lib/auth';
import type { User, UserRole } from '../types';

const USERS: User[] = [
  { id: 'USR-01', name: 'Cmdr. Elena Vance',    email: 'admin@oceanguard.ai',    role: 'ADMIN',               roleTitle: 'Chief Operations Administrator', organizationName: 'OceanGuard Central Command', status: 'ACTIVE' },
  { id: 'USR-02', name: 'Marcus Brody',          email: 'operator@oceanguard.ai', role: 'FIELD_OPERATOR',      roleTitle: 'Senior Marine Radar & Drone Pilot', organizationName: 'OceanGuard Coastal Watch', status: 'ACTIVE' },
  { id: 'USR-03', name: 'Dr. Asha Rao',          email: 'officer@oceanguard.ai',  role: 'ENVIRONMENTAL_OFFICER',roleTitle: 'Lead Oceanographer', organizationName: 'Coastal Environmental Unit', status: 'ACTIVE' },
  { id: 'USR-04', name: 'Captain Javier Silva',  email: 'cleanup@oceanguard.ai',  role: 'CLEANUP_TEAM',        roleTitle: 'Coastal Team A Lead', organizationName: 'Rapid Marine Cleanup Fleet', status: 'ACTIVE' },
];

const THRESHOLDS = [
  { label: 'Critical Risk Score Threshold', value: '80', unit: '/ 100', desc: 'Triggers CRITICAL alert when exceeded' },
  { label: 'High Risk Score Threshold',     value: '60', unit: '/ 100', desc: 'Triggers HIGH alert when exceeded' },
  { label: 'Min Detection Confidence',      value: '50', unit: '%', desc: 'Detections below this are discarded' },
  { label: 'Camera Offline Timeout',        value: '300', unit: 'sec', desc: 'Seconds before camera marked offline' },
  { label: 'Max Track Loss Duration',       value: '120', unit: 'sec', desc: 'Track expires after losing object' },
];

export default function Admin() {
  const [activeTab, setActiveTab] = useState<'users' | 'zones' | 'thresholds'>('users');

  return (
    <div className="p-6 space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { l: 'Total Users', v: USERS.length, c: '#00d4ff' },
          { l: 'Active',      v: USERS.filter(u => u.status === 'ACTIVE').length, c: '#00ff88' },
          { l: 'Roles',       v: 4, c: '#aa55ff' },
          { l: 'Cameras',     v: 15, c: '#ffaa00' },
        ].map(s => (
          <Card key={s.l} className="py-3 px-4">
            <p className="text-xs text-[var(--ocean-text-dim)] mb-1">{s.l}</p>
            <p className="text-2xl font-bold font-mono" style={{ color: s.c }}>{s.v}</p>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-[var(--ocean-border)]">
        {(['users','zones','thresholds'] as const).map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-all capitalize ${
              activeTab === t
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-[var(--ocean-text-dim)] hover:text-[var(--ocean-text)]'
            }`}
          >
            {t === 'users' ? 'User Management' : t === 'zones' ? 'Monitoring Zones' : 'Alert Thresholds'}
          </button>
        ))}
      </div>

      {/* Users tab */}
      {activeTab === 'users' && (
        <Card noPad>
          <div className="flex items-center justify-between px-4 pt-4 mb-4">
            <CardHeader title="Operator Accounts" subtitle="All system users" icon={<Users className="w-4 h-4" />} className="mb-0" />
            <Button variant="primary" size="sm" icon={<Plus className="w-4 h-4" />}>Add User</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--ocean-border)]">
                  {['User', 'Role', 'Organization', 'Email', 'Status', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold text-[var(--ocean-text-muted)] uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {USERS.map(u => (
                  <tr key={u.id} className="border-b border-[var(--ocean-border)]/50 hover:bg-[var(--ocean-card-hover)] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-cyan-900/50 border border-cyan-700/40 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-cyan-300">
                            {u.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
                          </span>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-[var(--ocean-text)]">{u.name}</p>
                          <p className="text-[10px] text-[var(--ocean-text-muted)]">{u.roleTitle}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${getRoleBadgeColor(u.role)}`}>
                        {getRoleLabel(u.role)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--ocean-text-dim)]">{u.organizationName}</td>
                    <td className="px-4 py-3 text-xs font-mono text-[var(--ocean-text-dim)]">{u.email}</td>
                    <td className="px-4 py-3">
                      <Badge variant={u.status === 'ACTIVE' ? 'green' : 'red'} size="xs">{u.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" size="xs">Edit</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Zones tab */}
      {activeTab === 'zones' && (
        <Card>
          <CardHeader title="Monitoring Zones" subtitle="Configure surveillance areas" icon={<Shield className="w-4 h-4" />} />
          <div className="space-y-3">
            {[
              { id: 'Z1', name: 'Zone 1 — North Pacific', radius: '45 km', cameras: 4, active: true,  color: '#00d4ff' },
              { id: 'Z2', name: 'Zone 2 — Coastal Waters', radius: '30 km', cameras: 3, active: true,  color: '#00ff88' },
              { id: 'Z3', name: 'Zone 3 — Oregon Shelf',  radius: '25 km', cameras: 2, active: true,  color: '#ffaa00' },
              { id: 'Z4', name: 'Zone 4 — Pacific Core',  radius: '60 km', cameras: 4, active: true,  color: '#ff4455' },
              { id: 'Z5', name: 'Zone 5 — Eastern Pacific', radius: '20 km', cameras: 2, active: false, color: '#6a9ab8' },
            ].map(z => (
              <div key={z.id} className="flex items-center justify-between p-3 rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)]">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: z.color }} />
                  <div>
                    <p className="text-xs font-semibold text-[var(--ocean-text)]">{z.name}</p>
                    <p className="text-[10px] text-[var(--ocean-text-dim)]">{z.id} · Radius {z.radius} · {z.cameras} cameras</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={z.active ? 'green' : 'outline'} size="xs">{z.active ? 'ACTIVE' : 'INACTIVE'}</Badge>
                  <Button variant="ghost" size="xs">Edit</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Thresholds tab */}
      {activeTab === 'thresholds' && (
        <Card>
          <CardHeader title="Alert Thresholds" subtitle="Configure trigger values" icon={<SettingsIcon className="w-4 h-4" />} />
          <div className="space-y-4">
            {THRESHOLDS.map(t => (
              <div key={t.label} className="p-4 rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)]">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-semibold text-[var(--ocean-text)]">{t.label}</p>
                  <div className="flex items-center gap-2">
                    <input
                      defaultValue={t.value}
                      className="w-16 px-2 py-1 text-sm text-right rounded border border-[var(--ocean-border)] bg-[var(--ocean-bg)] text-cyan-400 font-mono focus:border-cyan-500 outline-none"
                    />
                    <span className="text-xs text-[var(--ocean-text-dim)]">{t.unit}</span>
                  </div>
                </div>
                <p className="text-xs text-[var(--ocean-text-muted)]">{t.desc}</p>
              </div>
            ))}
            <Button variant="primary" size="sm">Save Configuration</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
