import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowUpDown, CalendarDays, CheckCircle2, ChevronRight, Clock3,
  Link2, MapPin, Play, Plus, Scale, Target, Users
} from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { getCleanupStatusColor } from '../lib/utils';
import type { CleanupStatus, CleanupPriority } from '../types';

interface MissionListItem {
  id: string;
  title: string;
  status: CleanupStatus;
  priority: CleanupPriority;
  zoneName: string;
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
  relatedAlertId?: string;
  sourceDetectionId?: string;
  description?: string;
}

interface SourceDetection {
  id: string;
  className: string;
  riskLevel: CleanupPriority;
  zoneName: string;
  locationLabel: string;
  estimatedMassKg: number;
  detectionCount: number;
}

interface CleanupLocationState {
  sourceDetection?: SourceDetection;
}

const INITIAL_MISSIONS: MissionListItem[] = [
  {
    id: 'CM-204', title: 'Zone 4 Critical Debris Cluster', status: 'IN_PROGRESS', priority: 'CRITICAL',
    zoneName: 'Zone 4', locationLabel: 'Zone 4 N · 35.1°N 158.3°W', detectionCount: 146, estimatedMassKg: 82,
    assignedTeam: 'Coastal Team A', scheduledAt: new Date(Date.now() - 3 * 3600000).toISOString(),
    startedAt: new Date(Date.now() - 1.5 * 3600000).toISOString(), createdAt: new Date(Date.now() - 5 * 3600000).toISOString(), createdBy: 'admin',
    progress: 45, relatedAlertId: 'ALT-001', sourceDetectionId: 'DET-1042',
  },
  {
    id: 'CM-202', title: 'Pacific Gyre Fishing Net Recovery', status: 'ASSIGNED', priority: 'HIGH',
    zoneName: 'Zone 1', locationLabel: 'Pacific Gyre · 28.5°N 140.2°W', detectionCount: 48, estimatedMassKg: 28,
    assignedTeam: 'Marine Ops Beta', scheduledAt: new Date(Date.now() + 2 * 3600000).toISOString(),
    createdAt: new Date(Date.now() - 8 * 3600000).toISOString(), createdBy: 'operator', progress: 0,
  },
  {
    id: 'CM-201', title: 'Zone 2 Coastal Plastic Sweep', status: 'COMPLETED', priority: 'MEDIUM',
    zoneName: 'Zone 2', locationLabel: 'Zone 2 Inshore · 19.8°N 157.4°W', detectionCount: 62, estimatedMassKg: 24,
    assignedTeam: 'Coastal Team B', scheduledAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    startedAt: new Date(Date.now() - 1.5 * 86400000).toISOString(), completedAt: new Date(Date.now() - 86400000 * 0.8).toISOString(),
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(), createdBy: 'officer', progress: 100,
  },
  {
    id: 'CM-199', title: 'Oregon Shelf Metal Debris', status: 'SCHEDULED', priority: 'LOW',
    zoneName: 'Zone 3', locationLabel: 'Oregon Shelf · 42.1°N 130.5°W', detectionCount: 18, estimatedMassKg: 8,
    assignedTeam: 'Ops Team Gamma', scheduledAt: new Date(Date.now() + 24 * 3600000).toISOString(),
    createdAt: new Date(Date.now() - 24 * 3600000).toISOString(), createdBy: 'admin', progress: 0,
  },
];

const PRIORITY_ORDER: Record<CleanupPriority, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

function MissionStatusIcon({ status }: { status: CleanupStatus }) {
  const className = 'h-4 w-4';
  if (status === 'COMPLETED') return <CheckCircle2 className={`${className} text-green-400`} />;
  if (status === 'IN_PROGRESS') return <Play className={`${className} text-cyan-400`} />;
  if (status === 'ASSIGNED') return <Users className={`${className} text-purple-400`} />;
  return <CalendarDays className={`${className} text-blue-400`} />;
}

export default function Cleanup() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialSource = (location.state as CleanupLocationState | null)?.sourceDetection ?? null;

  const [missions, setMissions] = useState(INITIAL_MISSIONS);
  const [showNew, setShowNew] = useState(Boolean(initialSource));
  const [source, setSource] = useState<SourceDetection | null>(initialSource);
  const [newTitle, setNewTitle] = useState(initialSource ? `${initialSource.zoneName} ${initialSource.className} Recovery` : '');
  const [priority, setPriority] = useState<CleanupPriority>(initialSource?.riskLevel ?? 'HIGH');
  const [team, setTeam] = useState('Coastal Team A');
  const [description, setDescription] = useState(initialSource ? `Recover and document debris linked to ${initialSource.id}.` : '');
  const [scheduledAt, setScheduledAt] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'COMPLETED'>('ACTIVE');
  const [urgentFirst, setUrgentFirst] = useState(true);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');

  const stats = [
    { label: 'Total Missions', value: missions.length, color: '#00d4ff' },
    { label: 'In Progress', value: missions.filter(m => m.status === 'IN_PROGRESS').length, color: '#00ff88' },
    { label: 'Assigned', value: missions.filter(m => m.status === 'ASSIGNED').length, color: '#aa55ff' },
    { label: 'Completed', value: missions.filter(m => m.status === 'COMPLETED').length, color: '#ffaa00' },
  ];

  const visibleMissions = useMemo(() => {
    const filtered = missions.filter(m => {
      if (statusFilter === 'ALL') return true;
      if (statusFilter === 'COMPLETED') return m.status === 'COMPLETED';
      return !['COMPLETED', 'CANCELLED'].includes(m.status);
    });
    return urgentFirst
      ? [...filtered].sort((a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority])
      : filtered;
  }, [missions, statusFilter, urgentFirst]);

  const closeMissionForm = () => {
    setShowNew(false);
    setFormError('');
    if (source) {
      setSource(null);
      navigate('/cleanup', { replace: true });
    }
  };

  const openBlankMission = () => {
    setSource(null);
    setNewTitle('');
    setPriority('HIGH');
    setTeam('Coastal Team A');
    setDescription('');
    setScheduledAt('');
    setFormError('');
    setShowNew(true);
  };

  const createMission = () => {
    if (!newTitle.trim()) {
      setFormError('Add a clear mission title before creating the mission.');
      return;
    }

    const newMission: MissionListItem = {
      id: `CM-${Date.now().toString().slice(-3)}`,
      title: newTitle.trim(), description: description.trim(),
      status: team ? 'ASSIGNED' : 'DRAFT', priority,
      zoneName: source?.zoneName ?? 'Unassigned zone',
      locationLabel: source?.locationLabel ?? 'Location pending',
      detectionCount: source?.detectionCount ?? 0,
      estimatedMassKg: source?.estimatedMassKg ?? 0,
      assignedTeam: team || undefined,
      scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      createdAt: new Date().toISOString(), createdBy: 'current-user', progress: 0,
      sourceDetectionId: source?.id,
    };

    setMissions(current => [newMission, ...current]);
    setNotice(`${newMission.id} created and assigned to ${newMission.assignedTeam ?? 'the operations queue'}.`);
    setShowNew(false);
    setSource(null);
    setFormError('');
    navigate('/cleanup', { replace: true });
  };

  return (
    <div className="p-3 sm:p-6 space-y-5 sm:space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map(s => (
          <Card key={s.label} className="py-3 px-4">
            <p className="text-xs text-[var(--ocean-text-dim)] mb-1">{s.label}</p>
            <p className="text-2xl font-bold font-mono" style={{ color: s.color }}>{s.value}</p>
          </Card>
        ))}
      </div>

      {notice && (
        <div role="status" aria-live="polite" className="flex items-start gap-2 rounded border border-[#00f5d4]/30 bg-[#00f5d4]/10 p-3 text-sm text-[#d7fff3]">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#00f5d4]" />
          <span>{notice}</span>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ocean-text)]">Mission queue</h2>
          <p className="mt-0.5 text-xs text-[var(--ocean-text-muted)]">Review urgent work first, then track field progress.</p>
        </div>
        <Button variant="primary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={openBlankMission}>New Mission</Button>
      </div>

      <Card className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <label htmlFor="mission-status-filter" className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--ocean-text-muted)]">Show missions</label>
          <select id="mission-status-filter" value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)} className="w-full rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-bg)] px-3 py-2 text-sm text-[var(--ocean-text)] outline-none focus:border-cyan-500">
            <option value="ACTIVE">Active missions</option><option value="ALL">All missions</option><option value="COMPLETED">Completed missions</option>
          </select>
        </div>
        <Button variant={urgentFirst ? 'success' : 'outline'} size="sm" icon={<ArrowUpDown className="h-4 w-4" />} aria-pressed={urgentFirst} onClick={() => setUrgentFirst(value => !value)}>Urgent first</Button>
      </Card>

      <div className="space-y-3">
        {visibleMissions.map(m => (
          <button key={m.id} type="button" onClick={() => navigate(`/cleanup/${m.id}`)} className="w-full rounded border border-[#3a4a46]/45 bg-[#1a202c]/85 p-4 text-left shadow-md transition-all duration-200 hover:-translate-y-px hover:border-[#00f5d4]/50 hover:shadow-[0_0_20px_rgba(0,245,212,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4cd6fb] sm:p-5" aria-label={`Open mission ${m.id}, ${m.title}, ${m.status.replace('_', ' ')}`}>
            <div className="flex items-start gap-3 sm:gap-4">
              <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border border-[#3a4a46]/60 bg-[#080e1a]"><MissionStatusIcon status={m.status} /></div>
              <div className="min-w-0 flex-1">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono text-[var(--ocean-text-muted)]">{m.id}</span>
                      <Badge variant={m.priority === 'CRITICAL' ? 'red' : m.priority === 'HIGH' ? 'amber' : 'cyan'} size="xs">{m.priority}</Badge>
                      {m.sourceDetectionId && <span className="inline-flex items-center gap-1 text-[10px] font-mono text-[#4cd6fb]"><Link2 className="h-3 w-3" /> {m.sourceDetectionId}</span>}
                    </div>
                    <h3 className="text-sm font-semibold text-[var(--ocean-text)] sm:text-base">{m.title}</h3>
                  </div>
                  <span className={`self-start whitespace-nowrap rounded border px-2 py-0.5 text-[10px] font-mono sm:text-xs ${getCleanupStatusColor(m.status)}`}>{m.status.replace('_', ' ')}</span>
                </div>
                <div className="grid grid-cols-1 gap-2 text-xs text-[var(--ocean-text-dim)] sm:grid-cols-2 xl:grid-cols-4">
                  <span className="flex items-start gap-1.5"><MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-cyan-400" /> {m.locationLabel}</span>
                  <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-cyan-400" /> {m.assignedTeam ?? 'Unassigned'}</span>
                  <span className="flex items-center gap-1.5"><Target className="h-3.5 w-3.5 text-cyan-400" /> {m.detectionCount} detections</span>
                  <span className="flex items-center gap-1.5"><Scale className="h-3.5 w-3.5 text-cyan-400" /> ~{m.estimatedMassKg} kg estimated</span>
                </div>
                {m.status !== 'SCHEDULED' && m.status !== 'DRAFT' && (
                  <div className="mt-4">
                    <div className="mb-1 flex items-center justify-between text-[10px] text-[var(--ocean-text-muted)]"><span>Progress</span><span>{m.progress}%</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ocean-border)]" role="progressbar" aria-label={`${m.title} progress`} aria-valuenow={m.progress} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full rounded-full transition-[width]" style={{ width: `${m.progress}%`, background: m.status === 'COMPLETED' ? '#00ff88' : 'linear-gradient(90deg, #00d4ff, #00ff88)' }} />
                    </div>
                  </div>
                )}
              </div>
              <ChevronRight className="mt-2 h-4 w-4 flex-shrink-0 text-[var(--ocean-text-muted)]" />
            </div>
          </button>
        ))}
      </div>

      <Modal isOpen={showNew} onClose={closeMissionForm} title={source ? 'Review Cleanup Mission' : 'Create Cleanup Mission'} subtitle={source ? 'Confirm assignment and timing before dispatch.' : 'Define a new cleanup response mission.'} size="lg" footer={<><Button variant="ghost" size="sm" onClick={closeMissionForm}>Cancel</Button><Button variant="primary" size="sm" onClick={createMission}>Create Mission</Button></>}>
        <div className="space-y-4">
          {source && (
            <div className="rounded-lg border border-[#4cd6fb]/30 bg-[#4cd6fb]/10 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#b3ebff]"><Link2 className="h-4 w-4" /> Source detection {source.id}</div>
              <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-[var(--ocean-text-dim)] sm:grid-cols-3"><span>{source.className}</span><span>{source.riskLevel} risk</span><span>~{source.estimatedMassKg} kg</span></div>
            </div>
          )}
          {formError && <div role="alert" className="rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{formError}</div>}
          <div>
            <label htmlFor="mission-title" className="block text-xs text-[var(--ocean-text-dim)] mb-1.5">Mission Title</label>
            <input id="mission-title" value={newTitle} onChange={event => setNewTitle(event.target.value)} className="w-full rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-bg)] px-3 py-2 text-sm text-[var(--ocean-text)] outline-none focus:border-cyan-500" placeholder="e.g. Zone 4 Emergency Cleanup" autoFocus />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label htmlFor="mission-priority" className="block text-xs text-[var(--ocean-text-dim)] mb-1.5">Priority</label><select id="mission-priority" value={priority} onChange={event => setPriority(event.target.value as CleanupPriority)} className="w-full rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-bg)] px-3 py-2 text-sm text-[var(--ocean-text)] outline-none focus:border-cyan-500"><option>CRITICAL</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select></div>
            <div><label htmlFor="mission-team" className="block text-xs text-[var(--ocean-text-dim)] mb-1.5">Assign Team</label><select id="mission-team" value={team} onChange={event => setTeam(event.target.value)} className="w-full rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-bg)] px-3 py-2 text-sm text-[var(--ocean-text)] outline-none focus:border-cyan-500"><option>Coastal Team A</option><option>Coastal Team B</option><option>Marine Ops Beta</option><option>Ops Team Gamma</option></select></div>
          </div>
          <div>
            <label htmlFor="mission-schedule" className="block text-xs text-[var(--ocean-text-dim)] mb-1.5">Target departure</label>
            <div className="relative"><Clock3 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ocean-text-muted)]" /><input id="mission-schedule" type="datetime-local" value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} className="w-full rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-bg)] py-2 pl-9 pr-3 text-sm text-[var(--ocean-text)] outline-none focus:border-cyan-500" /></div>
          </div>
          <div><label htmlFor="mission-description" className="block text-xs text-[var(--ocean-text-dim)] mb-1.5">Mission brief</label><textarea id="mission-description" rows={3} value={description} onChange={event => setDescription(event.target.value)} className="w-full resize-none rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-bg)] px-3 py-2 text-sm text-[var(--ocean-text)] outline-none focus:border-cyan-500" placeholder="Describe the mission scope and objectives..." /></div>
        </div>
      </Modal>
    </div>
  );
}
