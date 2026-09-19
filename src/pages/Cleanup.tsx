import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowUpDown, CalendarDays, CheckCircle2, ChevronRight, Clock3,
  Link2, Play, Plus, RefreshCw, Scale, Target, Users
} from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { LoadingState } from '../components/ui/StateComponents';
import { cleanupApi } from '../lib/api';
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
  sourceHotspotId?: string;
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

interface SourceHotspot {
  id: string;
  name: string;
  lat: number;
  lng: number;
  risk: CleanupPriority;
  detections: number;
  mass: number;
  dominantClass?: string;
  zoneId?: string;
}

interface CleanupLocationState {
  sourceDetection?: SourceDetection;
  sourceHotspot?: SourceHotspot;
}

const PRIORITY_ORDER: Record<CleanupPriority, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

function MissionStatusIcon({ status }: { status: CleanupStatus }) {
  const className = 'h-4 w-4';
  if (status === 'COMPLETED') return <CheckCircle2 className={`${className} text-green-400`} />;
  if (status === 'IN_PROGRESS') return <Play className={`${className} text-cyan-400`} />;
  if (status === 'ASSIGNED') return <Users className={`${className} text-purple-400`} />;
  return <CalendarDays className={`${className} text-blue-400`} />;
}

// Cleanup missions queue: filterable/sortable mission list plus a create-mission
// modal that can be pre-filled from a linked detection or hotspot.
export default function Cleanup() {
  const navigate = useNavigate();
  const location = useLocation();
  const locState = location.state as CleanupLocationState | null;
  const initialSourceDetection = locState?.sourceDetection ?? null;
  const initialSourceHotspot = locState?.sourceHotspot ?? null;

  const [missions, setMissions] = useState<MissionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(Boolean(initialSourceDetection || initialSourceHotspot));
  const [sourceDet, setSourceDet] = useState<SourceDetection | null>(initialSourceDetection);
  const [sourceHs, setSourceHs] = useState<SourceHotspot | null>(initialSourceHotspot);

  const initialTitle = initialSourceDetection
    ? `${initialSourceDetection.zoneName} ${initialSourceDetection.className} Recovery`
    : initialSourceHotspot
      ? `${initialSourceHotspot.name} Debris Hotspot Clean`
      : '';

  const initialPriority: CleanupPriority = initialSourceDetection?.riskLevel
    ?? initialSourceHotspot?.risk
    ?? 'HIGH';

  const [newTitle, setNewTitle] = useState(initialTitle);
  const [priority, setPriority] = useState<CleanupPriority>(initialPriority);
  const [team, setTeam] = useState('Coastal Team A');
  const [description, setDescription] = useState(
    initialSourceDetection
      ? `Recover and document debris linked to ${initialSourceDetection.id}.`
      : initialSourceHotspot
        ? `Clean up verified cluster ${initialSourceHotspot.id} (${initialSourceHotspot.name}) totaling ~${initialSourceHotspot.mass} kg.`
        : ''
  );
  const [scheduledAt, setScheduledAt] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'COMPLETED' | 'PAUSED'>('ACTIVE');
  const [urgentFirst, setUrgentFirst] = useState(true);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');

  // Load missions and derive a progress value for any that lack one.
  const fetchMissions = async () => {
    setLoading(true);
    try {
      const res = await cleanupApi.list();
      if (res && Array.isArray(res.missions)) {
        setMissions(res.missions.map((m: any) => ({
          ...m,
          progress: typeof m.progress === 'number' ? m.progress : m.status === 'COMPLETED' ? 100 : m.status === 'IN_PROGRESS' ? 45 : 0,
        })));
      }
    } catch (err: any) {
      console.error('Failed to load missions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMissions();
  }, []);

  const stats = [
    { label: 'Total Missions', value: missions.length, color: '#00d4ff' },
    { label: 'In Progress', value: missions.filter(m => m.status === 'IN_PROGRESS').length, color: '#00ff88' },
    { label: 'Assigned', value: missions.filter(m => m.status === 'ASSIGNED').length, color: '#aa55ff' },
    { label: 'Completed', value: missions.filter(m => m.status === 'COMPLETED').length, color: '#ffaa00' },
  ];

  // Apply the status filter, then optionally sort urgent priorities to the top.
  const visibleMissions = useMemo(() => {
    const filtered = missions.filter(m => {
      if (statusFilter === 'ALL') return true;
      if (statusFilter === 'COMPLETED') return m.status === 'COMPLETED';
      if (statusFilter === 'PAUSED') return m.status === 'PAUSED';
      return !['COMPLETED', 'CANCELLED'].includes(m.status);
    });
    return urgentFirst
      ? [...filtered].sort((a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority])
      : filtered;
  }, [missions, statusFilter, urgentFirst]);

  // Close the modal; if a detection/hotspot prefill was active, clear the
  // router state so reloading the page doesn't reopen the form.
  const closeMissionForm = () => {
    setShowNew(false);
    setFormError('');
    if (sourceDet || sourceHs) {
      setSourceDet(null);
      setSourceHs(null);
      navigate('/cleanup', { replace: true });
    }
  };

  // Reset the form to a blank mission (no linked source) and open the modal.
  const openBlankMission = () => {
    setSourceDet(null);
    setSourceHs(null);
    setNewTitle('');
    setPriority('HIGH');
    setTeam('Coastal Team A');
    setDescription('');
    setScheduledAt('');
    setFormError('');
    setShowNew(true);
  };

  // Validate the title, POST the mission (carrying any linked source IDs),
  // and prepend the created record to the local list.
  const createMission = async () => {
    if (!newTitle.trim()) {
      setFormError('Add a clear mission title before creating the mission.');
      return;
    }

    setCreating(true);
    setFormError('');

    try {
      const payload: Partial<MissionListItem> = {
        title: newTitle.trim(),
        description: description.trim(),
        status: team ? 'ASSIGNED' : 'DRAFT',
        priority,
        zoneName: sourceDet?.zoneName ?? sourceHs?.name ?? 'Coastal Zone Sector',
        locationLabel: sourceDet?.locationLabel ?? (sourceHs ? `${sourceHs.name} (${sourceHs.lat}°N, ${sourceHs.lng}°E)` : 'Marine Surveillance Area'),
        detectionCount: sourceDet?.detectionCount ?? sourceHs?.detections ?? 0,
        estimatedMassKg: sourceDet?.estimatedMassKg ?? sourceHs?.mass ?? 0,
        assignedTeam: team || undefined,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        sourceDetectionId: sourceDet?.id,
        sourceHotspotId: sourceHs?.id,
      };

      const created = await cleanupApi.create(payload);
      const missionWithProgress: MissionListItem = {
        ...(created as any),
        progress: (created as any).progress ?? 0,
      };
      setMissions(curr => [missionWithProgress, ...curr]);
      setNotice(`${created.id} created and dispatched to ${created.assignedTeam ?? 'the operations queue'}.`);
      setShowNew(false);
      setSourceDet(null);
      setSourceHs(null);
      navigate('/cleanup', { replace: true });
    } catch (err: any) {
      setFormError(err.message || 'Failed to create cleanup mission.');
    } finally {
      setCreating(false);
    }
  };

  if (loading && missions.length === 0) {
    return <LoadingState message="Loading cleanup missions..." size="lg" className="h-full p-8" />;
  }

  return (
    <div className="p-3 sm:p-6 space-y-5 sm:space-y-6">
      {/* Metrics Row */}
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
          <h2 className="text-sm font-semibold text-[var(--ocean-text)]">Mission Queue</h2>
          <p className="mt-0.5 text-xs text-[var(--ocean-text-muted)]">Permanent operational records with real field verification & tracking.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" icon={<RefreshCw className="w-4 h-4" />} onClick={fetchMissions}>
            Refresh
          </Button>
          <Button variant="primary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={openBlankMission}>
            New Mission
          </Button>
        </div>
      </div>

      {/* Filter and sorting controls */}
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <label htmlFor="mission-status-filter" className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--ocean-text-muted)]">
            Filter Status
          </label>
          <select
            id="mission-status-filter"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
          >
            <option value="ACTIVE">Active Operations</option>
            <option value="ALL">All Recorded Missions</option>
            <option value="COMPLETED">Completed Missions</option>
            <option value="PAUSED">Paused Missions</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => setUrgentFirst(v => !v)}
          className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-[var(--ocean-border)] hover:border-cyan-500/40 text-[var(--ocean-text)] transition-colors"
        >
          <ArrowUpDown className="w-3.5 h-3.5 text-cyan-400" />
          <span>{urgentFirst ? 'Urgent Priority First' : 'Default Order'}</span>
        </button>
      </Card>

      {/* Missions List */}
      <div className="space-y-3">
        {visibleMissions.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm font-semibold text-[var(--ocean-text)]">No missions matching this filter</p>
            <p className="text-xs text-[var(--ocean-text-muted)] mt-1">Try switching to &apos;All Recorded Missions&apos; or create a new cleanup mission.</p>
          </Card>
        ) : (
          visibleMissions.map(m => (
            <div
              key={m.id}
              onClick={() => navigate(`/cleanup/${m.id}`)}
              className="p-4 rounded-xl border border-[var(--ocean-border)] bg-[var(--ocean-card)] hover:bg-[var(--ocean-card-hover)] hover:border-cyan-500/40 transition-all cursor-pointer space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-[var(--ocean-surface)] border border-[var(--ocean-border)]">
                    <MissionStatusIcon status={m.status} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-cyan-400 font-bold">{m.id}</span>
                      <h3 className="text-sm font-bold text-[var(--ocean-text)]">{m.title}</h3>
                    </div>
                    <p className="text-xs text-[var(--ocean-text-dim)] mt-0.5">{m.locationLabel}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <Badge variant={m.priority === 'CRITICAL' ? 'red' : m.priority === 'HIGH' ? 'amber' : 'outline'} size="xs">
                    {m.priority}
                  </Badge>
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${getCleanupStatusColor(m.status)}`}>
                    {m.status.replace('_', ' ')}
                  </span>
                  <ChevronRight className="w-4 h-4 text-[var(--ocean-text-muted)]" />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[var(--ocean-border)]/50 text-xs text-[var(--ocean-text-dim)]">
                <div className="flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{m.detectionCount} contacts</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Scale className="w-3.5 h-3.5 text-cyan-400" />
                  <span>~{m.estimatedMassKg} kg est.</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{m.assignedTeam || 'Unassigned'}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock3 className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{m.progress}% progress</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* New Mission Modal */}
      <Modal
        isOpen={showNew}
        onClose={closeMissionForm}
        title={sourceDet ? `Dispatch Cleanup: ${sourceDet.id}` : sourceHs ? `Dispatch Cleanup: ${sourceHs.name}` : 'Create Cleanup Mission'}
        size="lg"
      >
        <div className="space-y-4">
          {(sourceDet || sourceHs) && (
            <div className="p-3 rounded-lg border border-cyan-500/30 bg-cyan-950/20 text-xs text-cyan-300 flex items-start gap-2">
              <Link2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <strong>Linked Operational Source:</strong>
                {sourceDet && <p className="mt-0.5 font-mono">{sourceDet.id} · {sourceDet.className} ({sourceDet.estimatedMassKg} kg) in {sourceDet.locationLabel}</p>}
                {sourceHs && <p className="mt-0.5 font-mono">{sourceHs.id} · {sourceHs.name} ({sourceHs.mass} kg, {sourceHs.detections} debris contacts)</p>}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-[var(--ocean-text-dim)] mb-1 uppercase tracking-wider">
              Mission Title
            </label>
            <input
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="e.g. Gulf of Kachchh Ghost Net Recovery"
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[var(--ocean-text-dim)] mb-1 uppercase tracking-wider">
                Priority Level
              </label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value as CleanupPriority)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
              >
                <option value="CRITICAL">Critical Priority</option>
                <option value="HIGH">High Priority</option>
                <option value="MEDIUM">Medium Priority</option>
                <option value="LOW">Low Priority</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--ocean-text-dim)] mb-1 uppercase tracking-wider">
                Assigned Team
              </label>
              <select
                value={team}
                onChange={e => setTeam(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
              >
                <option value="Coastal Team A">Coastal Team A (Rapid Recovery)</option>
                <option value="Marine Ops Beta">Marine Ops Beta (Offshore Vessel)</option>
                <option value="Coastal Team B">Coastal Team B (Inshore Sweep)</option>
                <option value="Ops Team Gamma">Ops Team Gamma (Port Intercept)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--ocean-text-dim)] mb-1 uppercase tracking-wider">
              Schedule Execution
            </label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--ocean-text-dim)] mb-1 uppercase tracking-wider">
              Operational Instructions
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Detail vessel dispatch requirements, recovery nets, containment bins, or environmental cautions..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] outline-none focus:border-cyan-500 resize-none"
            />
          </div>

          {formError && (
            <div className="p-2.5 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-400">
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--ocean-border)]">
            <Button variant="ghost" size="sm" onClick={closeMissionForm}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={creating} onClick={createMission}>
              Dispatch Mission
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
