import { useState, useEffect } from 'react';
import {
  Users, Shield, Settings as SettingsIcon, Plus,
  CheckCircle, AlertTriangle, Edit2, UserCheck, UserX,
  FileText, User as UserIcon, X, Search, Activity
} from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { getRoleBadgeColor, getRoleLabel } from '../lib/auth';
import { adminApi, accessRequestsApi, monitoringApi } from '../lib/api';
import type { User, UserRole, Camera } from '../types';

interface ThresholdItem {
  label: string;
  value: string;
  unit: string;
  desc: string;
}

interface AuditLogEntry {
  id: string;
  action: string;
  actor: { id: string; email: string };
  details: any;
  timestamp: string;
}

interface AccessRequest {
  id: string;
  organization: string;
  email: string;
  requestedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

const MONITORED_ZONES = [
  { id: 'Z1', name: 'Zone 1 — Gulf of Kachchh Marine Park', coordinates: '22.45°N, 69.15°E', radius: '45 km', cameras: ['CAM-01', 'CAM-02', 'CAM-14'], active: true, color: '#00d4ff' },
  { id: 'Z2', name: 'Zone 2 — Mumbai Offshore & Harbour', coordinates: '18.95°N, 72.80°E', radius: '35 km', cameras: ['CAM-03', 'CAM-04', 'CAM-12'], active: true, color: '#00ff88' },
  { id: 'Z3', name: 'Zone 3 — Goa Shelf & Estuary', coordinates: '15.35°N, 73.75°E', radius: '30 km', cameras: ['CAM-05', 'CAM-06'], active: true, color: '#ffaa00' },
  { id: 'Z4', name: 'Zone 4 — Konkan Coastal Corridor', coordinates: '16.98°N, 73.28°E', radius: '40 km', cameras: ['CAM-07', 'CAM-13'], active: true, color: '#aa55ff' },
  { id: 'Z5', name: 'Zone 5 — Odisha Offshore Shelf', coordinates: '19.95°N, 86.40°E', radius: '50 km', cameras: ['CAM-08', 'CAM-09'], active: true, color: '#ff4455' },
  { id: 'Z6', name: 'Zone 6 — Chennai Marine Corridor', coordinates: '13.08°N, 80.35°E', radius: '30 km', cameras: ['CAM-10', 'CAM-15'], active: true, color: '#00e5ff' },
  { id: 'Z7', name: 'Zone 7 — Gulf of Mannar Biosphere', coordinates: '9.12°N, 79.15°E', radius: '45 km', cameras: ['CAM-11'], active: false, color: '#6a9ab8' },
];

// Admin governance page: user management (create/edit/toggle), monitoring zones,
// server-persisted alert thresholds, public access requests, and the audit trail.
export default function Admin() {
  const [activeTab, setActiveTab] = useState<'users' | 'zones' | 'thresholds' | 'requests' | 'audit'>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [thresholds, setThresholds] = useState<ThresholdItem[]>([]);
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Modals state
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [isSavingThresholds, setIsSavingThresholds] = useState(false);

  // New user form state
  const [newUserForm, setNewUserForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'FIELD_OPERATOR' as UserRole,
    roleTitle: '',
    organizationName: '',
  });

  // Load every admin dataset in parallel; each failure is isolated via allSettled
  // so one broken endpoint cannot blank the whole console.
  const loadData = async () => {
    try {
      setLoading(true);
      const [usersRes, thresholdsRes, camRes, requestsRes, auditRes] = await Promise.allSettled([
        adminApi.users(),
        adminApi.thresholds(),
        monitoringApi.cameras(),
        accessRequestsApi.list(),
        adminApi.auditLog(),
      ]);

      if (usersRes.status === 'fulfilled' && usersRes.value.users) {
        setUsers(usersRes.value.users);
      }
      if (thresholdsRes.status === 'fulfilled' && thresholdsRes.value.thresholds) {
        setThresholds(thresholdsRes.value.thresholds);
      }
      if (camRes.status === 'fulfilled' && camRes.value.cameras) {
        setCameras(camRes.value.cameras);
      }
      if (requestsRes.status === 'fulfilled' && requestsRes.value.requests) {
        setAccessRequests(requestsRes.value.requests);
      }
      if (auditRes.status === 'fulfilled' && auditRes.value.auditLog) {
        setAuditLog(auditRes.value.auditLog);
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to load administration data.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserForm.name || !newUserForm.email || !newUserForm.roleTitle || !newUserForm.organizationName) {
      setFeedback({ type: 'error', message: 'Please fill in all required fields.' });
      return;
    }

    try {
      setIsSavingUser(true);
      await adminApi.createUser(newUserForm);
      setFeedback({ type: 'success', message: `User ${newUserForm.name} created successfully.` });
      setIsAddUserOpen(false);
      setNewUserForm({
        name: '',
        email: '',
        password: '',
        role: 'FIELD_OPERATOR',
        roleTitle: '',
        organizationName: '',
      });
      await loadData();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Could not create user.' });
    } finally {
      setIsSavingUser(false);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    try {
      setIsSavingUser(true);
      await adminApi.updateUser(editingUser.id, {
        name: editingUser.name,
        role: editingUser.role,
        roleTitle: editingUser.roleTitle,
        organizationName: editingUser.organizationName,
        status: editingUser.status,
      });
      setFeedback({ type: 'success', message: `User ${editingUser.name} updated.` });
      setEditingUser(null);
      await loadData();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Could not update user.' });
    } finally {
      setIsSavingUser(false);
    }
  };

  const handleToggleStatus = async (user: User) => {
    const nextStatus = user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await adminApi.updateUser(user.id, { status: nextStatus });
      setFeedback({ type: 'success', message: `User ${user.name} marked ${nextStatus}.` });
      await loadData();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to update user status.' });
    }
  };

  const handleSaveThresholds = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSavingThresholds(true);
      const res = await adminApi.updateThresholds(thresholds);
      setThresholds(res.thresholds);
      setFeedback({ type: 'success', message: 'Alert thresholds successfully saved to persistent storage.' });
      const auditRes = await adminApi.auditLog();
      if (auditRes.auditLog) setAuditLog(auditRes.auditLog);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to update alert thresholds.' });
    } finally {
      setIsSavingThresholds(false);
    }
  };

  // Case-insensitive user search across name/email/org/role.
  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.organizationName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`flex items-center justify-between p-3 rounded-lg border text-xs font-mono ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-rose-400" />}
            <span>{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="opacity-60 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { l: 'Total Users', v: users.length, c: '#00d4ff', sub: 'Stored accounts' },
          { l: 'Active Operators', v: users.filter(u => u.status === 'ACTIVE').length, c: '#00ff88', sub: 'Authorized access' },
          { l: 'Surveillance Cameras', v: cameras.length || 15, c: '#ffaa00', sub: '7 Coastal Sectors' },
          { l: 'Access Requests', v: accessRequests.length, c: '#aa55ff', sub: 'Public Portal requests' },
        ].map(s => (
          <Card key={s.l} className="py-3 px-4">
            <p className="text-xs text-[var(--ocean-text-dim)] mb-1">{s.l}</p>
            <p className="text-2xl font-bold font-mono" style={{ color: s.c }}>{s.v}</p>
            <p className="text-[10px] text-[var(--ocean-text-muted)] mt-1">{s.sub}</p>
          </Card>
        ))}
      </div>

      {/* Navigation Tabs */}
      <div className="flex gap-2 border-b border-[var(--ocean-border)] overflow-x-auto pb-1">
        {[
          { id: 'users', label: 'User Management', icon: Users, count: users.length },
          { id: 'zones', label: 'Monitoring Zones', icon: Shield, count: MONITORED_ZONES.length },
          { id: 'thresholds', label: 'Alert Thresholds', icon: SettingsIcon },
          { id: 'requests', label: 'Sentinel Requests', icon: FileText, count: accessRequests.length },
          { id: 'audit', label: 'Audit Log', icon: Activity, count: auditLog.length },
        ].map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as any)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
                activeTab === t.id
                  ? 'border-cyan-500 text-cyan-400 bg-cyan-950/20'
                  : 'border-transparent text-[var(--ocean-text-dim)] hover:text-[var(--ocean-text)]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{t.label}</span>
              {t.count !== undefined && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--ocean-border)] font-mono text-[var(--ocean-text-dim)]">
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ─── TAB 1: USERS ─────────────────────────────────────────────────── */}
      {activeTab === 'users' && (
        <Card noPad>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 pt-4 mb-4">
            <CardHeader
              title="Operator Accounts & Roles"
              subtitle="Manage authenticated team members and permission levels"
              icon={<Users className="w-4 h-4 text-cyan-400" />}
              className="mb-0"
            />
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ocean-text-muted)]" />
                <input
                  type="text"
                  placeholder="Filter users..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
                />
              </div>
              <Button
                variant="primary"
                size="sm"
                icon={<Plus className="w-4 h-4" />}
                onClick={() => setIsAddUserOpen(true)}
              >
                Add User
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--ocean-border)]">
                  {['User', 'Role', 'Organization', 'Email', 'Status', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold text-[var(--ocean-text-muted)] uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-xs text-[var(--ocean-text-muted)]">
                      {loading ? 'Loading user database...' : 'No users match the search filter.'}
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map(u => (
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
                        <Badge variant={u.status === 'ACTIVE' ? 'green' : 'red'} size="xs">
                          {u.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="xs"
                            icon={<Edit2 className="w-3 h-3" />}
                            onClick={() => setEditingUser({ ...u })}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            className={u.status === 'ACTIVE' ? 'text-rose-400 hover:text-rose-300' : 'text-emerald-400 hover:text-emerald-300'}
                            onClick={() => handleToggleStatus(u)}
                            icon={u.status === 'ACTIVE' ? <UserX className="w-3 h-3" /> : <UserCheck className="w-3 h-3" />}
                          >
                            {u.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ─── TAB 2: ZONES ─────────────────────────────────────────────────── */}
      {activeTab === 'zones' && (
        <Card>
          <CardHeader
            title="Operational Surveillance Sectors"
            subtitle="Coastal India monitoring perimeters and surveillance cameras"
            icon={<Shield className="w-4 h-4 text-cyan-400" />}
          />
          <div className="space-y-3">
            {MONITORED_ZONES.map(z => (
              <div key={z.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: z.color }} />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-[var(--ocean-text)]">{z.name}</p>
                      <span className="text-[10px] font-mono text-[var(--ocean-text-muted)]">({z.coordinates})</span>
                    </div>
                    <p className="text-[10px] text-[var(--ocean-text-dim)] mt-0.5">
                      Sector {z.id} · Radar Horizon: {z.radius} · Sensor Array: {z.cameras.join(', ')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-center">
                  <Badge variant={z.active ? 'green' : 'outline'} size="xs">
                    {z.active ? 'PATROL ACTIVE' : 'STANDBY'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ─── TAB 3: THRESHOLDS ────────────────────────────────────────────── */}
      {activeTab === 'thresholds' && (
        <Card>
          <CardHeader
            title="Alert & Anomaly Engine Thresholds"
            subtitle="Configure server-persisted trigger rules, timeouts, and discard limits"
            icon={<SettingsIcon className="w-4 h-4 text-cyan-400" />}
          />
          <form onSubmit={handleSaveThresholds} className="space-y-4">
            {thresholds.map((t, idx) => (
              <div key={t.label} className="p-4 rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
                  <p className="text-sm font-semibold text-[var(--ocean-text)]">{t.label}</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={t.value}
                      onChange={e => {
                        const next = [...thresholds];
                        next[idx] = { ...next[idx], value: e.target.value };
                        setThresholds(next);
                      }}
                      className="w-20 px-2 py-1 text-sm text-right rounded border border-[var(--ocean-border)] bg-[var(--ocean-bg)] text-cyan-400 font-mono focus:border-cyan-500 outline-none"
                    />
                    <span className="text-xs text-[var(--ocean-text-dim)] w-12">{t.unit}</span>
                  </div>
                </div>
                <p className="text-xs text-[var(--ocean-text-muted)]">{t.desc}</p>
              </div>
            ))}
            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={isSavingThresholds}
              >
                Save Configuration to Server
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* ─── TAB 4: ACCESS REQUESTS ──────────────────────────────────────── */}
      {activeTab === 'requests' && (
        <Card noPad>
          <div className="p-4 border-b border-[var(--ocean-border)]">
            <CardHeader
              title="Public Portal Sentinel Requests"
              subtitle="Incoming requests from external institutions and conservation units"
              icon={<FileText className="w-4 h-4 text-purple-400" />}
              className="mb-0"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--ocean-border)]">
                  {['Request ID', 'Organization', 'Institutional Email', 'Date', 'Status'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold text-[var(--ocean-text-muted)] uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accessRequests.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-xs text-[var(--ocean-text-muted)]">
                      No public data stream requests received yet.
                    </td>
                  </tr>
                ) : (
                  accessRequests.map(r => (
                    <tr key={r.id} className="border-b border-[var(--ocean-border)]/50 hover:bg-[var(--ocean-card-hover)] transition-colors">
                      <td className="px-4 py-3 text-xs font-mono text-cyan-400">{r.id}</td>
                      <td className="px-4 py-3 text-xs font-medium text-[var(--ocean-text)]">{r.organization}</td>
                      <td className="px-4 py-3 text-xs font-mono text-[var(--ocean-text-dim)]">{r.email}</td>
                      <td className="px-4 py-3 text-xs text-[var(--ocean-text-muted)]">
                        {new Date(r.requestedAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={r.status === 'APPROVED' ? 'green' : r.status === 'REJECTED' ? 'red' : 'amber'} size="xs">
                          {r.status}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ─── TAB 5: AUDIT LOG ────────────────────────────────────────────── */}
      {activeTab === 'audit' && (
        <Card noPad>
          <div className="p-4 border-b border-[var(--ocean-border)]">
            <CardHeader
              title="System Audit Trail"
              subtitle="Permanent log of operator actions and security state changes"
              icon={<Activity className="w-4 h-4 text-emerald-400" />}
              className="mb-0"
            />
          </div>
          <div className="divide-y divide-[var(--ocean-border)] max-h-[550px] overflow-y-auto">
            {auditLog.length === 0 ? (
              <div className="p-8 text-center text-xs text-[var(--ocean-text-muted)]">
                No audit entries recorded.
              </div>
            ) : (
              auditLog.slice().reverse().map(entry => (
                <div key={entry.id} className="p-4 flex items-start justify-between gap-4 hover:bg-[var(--ocean-card-hover)] transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="cyan" size="xs">{entry.action}</Badge>
                      <span className="text-xs font-mono text-[var(--ocean-text-dim)]">by {entry.actor.email}</span>
                    </div>
                    <pre className="text-[11px] font-mono text-[var(--ocean-text-muted)] overflow-x-auto max-w-xl bg-[var(--ocean-bg)] p-2 rounded border border-[var(--ocean-border)]">
                      {JSON.stringify(entry.details, null, 2)}
                    </pre>
                  </div>
                  <span className="text-[10px] text-[var(--ocean-text-muted)] whitespace-nowrap font-mono">
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>
      )}

      {/* ─── MODAL: ADD USER ──────────────────────────────────────────────── */}
      {isAddUserOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--ocean-card)] border border-[var(--ocean-border)] rounded-xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-[var(--ocean-border)]">
              <h3 className="text-sm font-semibold text-[var(--ocean-text)] flex items-center gap-2">
                <UserIcon className="w-4 h-4 text-cyan-400" />
                Add New Operator Account
              </h3>
              <button onClick={() => setIsAddUserOpen(false)} className="text-[var(--ocean-text-muted)] hover:text-[var(--ocean-text)]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-4 space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-[var(--ocean-text-dim)] mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={newUserForm.name}
                  onChange={e => setNewUserForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Lt. Vikram Rathore"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[var(--ocean-text-dim)] mb-1">Institutional Email *</label>
                <input
                  type="email"
                  required
                  value={newUserForm.email}
                  onChange={e => setNewUserForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="v.rathore@oceanguard.ai"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[var(--ocean-text-dim)] mb-1">Initial Password</label>
                <input
                  type="password"
                  value={newUserForm.password}
                  onChange={e => setNewUserForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Defaults to demo1234 if blank"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--ocean-text-dim)] mb-1">System Role *</label>
                  <select
                    value={newUserForm.role}
                    onChange={e => setNewUserForm(f => ({ ...f, role: e.target.value as UserRole }))}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
                  >
                    {/* BUGFIX: 'ANALYST' was offered here but is not a valid UserRole —
                        such accounts broke role checks (menus, route guards, badges). */}
                    <option value="ADMIN">Administrator</option>
                    <option value="FIELD_OPERATOR">Field Operator</option>
                    <option value="ENVIRONMENTAL_OFFICER">Environmental Officer</option>
                    <option value="CLEANUP_TEAM">Cleanup Team</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[var(--ocean-text-dim)] mb-1">Role Title *</label>
                  <input
                    type="text"
                    required
                    value={newUserForm.roleTitle}
                    onChange={e => setNewUserForm(f => ({ ...f, roleTitle: e.target.value }))}
                    placeholder="e.g. Coastal Drone Pilot"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[var(--ocean-text-dim)] mb-1">Organization *</label>
                <input
                  type="text"
                  required
                  value={newUserForm.organizationName}
                  onChange={e => setNewUserForm(f => ({ ...f, organizationName: e.target.value }))}
                  placeholder="e.g. Gujarat Marine Police / Coast Guard"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--ocean-border)]">
                <Button type="button" variant="ghost" size="sm" onClick={() => setIsAddUserOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="sm" loading={isSavingUser}>
                  Create Account
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL: EDIT USER ─────────────────────────────────────────────── */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--ocean-card)] border border-[var(--ocean-border)] rounded-xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-[var(--ocean-border)]">
              <h3 className="text-sm font-semibold text-[var(--ocean-text)] flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-cyan-400" />
                Edit Operator: {editingUser.name}
              </h3>
              <button onClick={() => setEditingUser(null)} className="text-[var(--ocean-text-muted)] hover:text-[var(--ocean-text)]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateUser} className="p-4 space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-[var(--ocean-text-dim)] mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={editingUser.name}
                  onChange={e => setEditingUser(u => u ? { ...u, name: e.target.value } : null)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--ocean-text-dim)] mb-1">Role</label>
                  <select
                    value={editingUser.role}
                    onChange={e => setEditingUser(u => u ? { ...u, role: e.target.value as UserRole } : null)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
                  >
                    {/* Same fix as add-user modal: ANALYST is not a valid UserRole. */}
                    <option value="ADMIN">Administrator</option>
                    <option value="FIELD_OPERATOR">Field Operator</option>
                    <option value="ENVIRONMENTAL_OFFICER">Environmental Officer</option>
                    <option value="CLEANUP_TEAM">Cleanup Team</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[var(--ocean-text-dim)] mb-1">Status</label>
                  <select
                    value={editingUser.status}
                    onChange={e => setEditingUser(u => u ? { ...u, status: e.target.value as any } : null)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                    <option value="SUSPENDED">SUSPENDED</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[var(--ocean-text-dim)] mb-1">Role Title</label>
                <input
                  type="text"
                  required
                  value={editingUser.roleTitle}
                  onChange={e => setEditingUser(u => u ? { ...u, roleTitle: e.target.value } : null)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[var(--ocean-text-dim)] mb-1">Organization</label>
                <input
                  type="text"
                  required
                  value={editingUser.organizationName}
                  onChange={e => setEditingUser(u => u ? { ...u, organizationName: e.target.value } : null)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--ocean-border)]">
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditingUser(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="sm" loading={isSavingUser}>
                  Save Changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
