import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Camera, Check, CheckCircle, ChevronRight,
  Pause, Play, Plus, Ship, Upload, XCircle
} from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { LoadingState } from '../components/ui/StateComponents';
import { cleanupApi } from '../lib/api';
import { getCleanupStatusColor, formatDateTime } from '../lib/utils';
import type { CleanupStatus } from '../types';

const STATUS_FLOW: CleanupStatus[] = ['DRAFT', 'SCHEDULED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'];

// Cleanup mission detail: status progression, evidence logging, deployment info,
// and the mission timeline.
export default function CleanupDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [mission, setMission] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Evidence modal state
  const [showEvidenceModal, setShowEvidenceModal] = useState(false);
  const [evidenceType, setEvidenceType] = useState<'BEFORE' | 'DURING' | 'AFTER'>('DURING');
  const [evidenceDesc, setEvidenceDesc] = useState('');
  const [recoveredKg, setRecoveredKg] = useState<string>('');
  const [uploadingEvidence, setUploadingEvidence] = useState(false);

  // Load the mission; a missing/invalid ID surfaces the not-found state.
  const fetchMission = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await cleanupApi.get(id);
      setMission(data);
    } catch (err: any) {
      setError(err.message || `Cleanup mission ${id} could not be found.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMission();
  }, [id]);

  // Advance the mission lifecycle; COMPLETED forces progress to 100 and a fresh
  // IN_PROGRESS mission starts at 25%.
  const handleUpdateStatus = async (nextStatus: CleanupStatus, nextProgress?: number) => {
    if (!mission) return;
    setActionLoading(true);
    try {
      const updates: any = { status: nextStatus };
      if (nextProgress !== undefined) updates.progress = nextProgress;
      else if (nextStatus === 'COMPLETED') updates.progress = 100;
      else if (nextStatus === 'IN_PROGRESS' && mission.progress === 0) updates.progress = 25;

      const updated = await cleanupApi.update(mission.id, updates);
      setMission(updated);
      setActionNotice(null);
    } catch (err: any) {
      setActionNotice(`Could not update status: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Submit an evidence entry and optimistically append it to the local mission state.
  const handleAddEvidence = async (e: FormEvent) => {
    e.preventDefault();
    if (!mission || !evidenceDesc.trim()) return;

    setUploadingEvidence(true);
    try {
      const kg = recoveredKg ? parseFloat(recoveredKg) : undefined;
      const res = await cleanupApi.addEvidence(mission.id, {
        type: evidenceType,
        description: evidenceDesc.trim(),
        // BUGFIX: send the field the server actually persists (recoveredKg).
        // collectedMassKg was silently ignored, so logged mass never appeared.
        recoveredKg: kg,
      });

      // Update mission state with new evidence
      setMission((curr: any) => ({
        ...curr,
        evidence: [...(curr.evidence || []), res],
        timeline: [
          ...(curr.timeline || []),
          {
            label: `Evidence recorded: ${evidenceType} (${kg ? `${kg} kg` : 'Visual log'})`,
            time: new Date().toISOString(),
            by: 'Operator',
            color: 'bg-emerald-400',
          },
        ],
      }));

      setShowEvidenceModal(false);
      setEvidenceDesc('');
      setRecoveredKg('');
      setActionNotice(null);
    } catch (err: any) {
      setActionNotice(`Failed to add evidence: ${err.message}`);
    } finally {
      setUploadingEvidence(false);
    }
  };

  if (loading) {
    return <LoadingState message="Loading cleanup operation details..." size="lg" className="h-full p-12" />;
  }

  if (error || !mission) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4 text-center">
        <div className="p-8 rounded-xl border border-red-500/30 bg-red-500/10">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Record Not Found</h2>
          <p className="text-xs text-[var(--ocean-text-dim)] mb-6">
            {error || `No cleanup mission registered under ID ${id}.`}
          </p>
          <Button variant="primary" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => navigate('/cleanup')}>
            Return to Mission Queue
          </Button>
        </div>
      </div>
    );
  }

  const status: CleanupStatus = mission.status;
  const progress: number = mission.progress ?? 0;

  return (
    <div className="p-3 space-y-6 max-w-5xl mx-auto sm:p-6">
      {/* Action Notice */}
      {actionNotice && (
        <div role="alert" className="flex items-center justify-between rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          <span>{actionNotice}</span>
          <button onClick={() => setActionNotice(null)} className="font-semibold text-red-400 hover:text-red-200 cursor-pointer">Dismiss</button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
        <div className="flex min-w-0 items-start gap-3">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => navigate('/cleanup')}>
            Back
          </Button>
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-mono text-cyan-400 font-bold">{mission.id}</span>
              <Badge variant={mission.priority === 'CRITICAL' ? 'red' : mission.priority === 'HIGH' ? 'amber' : 'outline'} size="xs">
                {mission.priority}
              </Badge>
            </div>
            <h2 className="text-lg font-bold text-[var(--ocean-text)]">{mission.title}</h2>
          </div>
        </div>

        {/* Action buttons based on real status */}
        <div className="flex flex-wrap items-center gap-2">
          {status === 'ASSIGNED' && (
            <Button
              variant="primary"
              size="sm"
              icon={<Play className="w-4 h-4" />}
              loading={actionLoading}
              onClick={() => handleUpdateStatus('IN_PROGRESS', 25)}
            >
              Start Mission
            </Button>
          )}

          {status === 'IN_PROGRESS' && (
            <>
              <Button
                variant="outline"
                size="sm"
                icon={<Pause className="w-4 h-4" />}
                loading={actionLoading}
                onClick={() => handleUpdateStatus('PAUSED')}
              >
                Pause
              </Button>
              <Button
                variant="success"
                size="sm"
                icon={<CheckCircle className="w-4 h-4" />}
                loading={actionLoading}
                onClick={() => handleUpdateStatus('COMPLETED', 100)}
              >
                Mark Complete
              </Button>
            </>
          )}

          {status === 'PAUSED' && (
            <Button
              variant="primary"
              size="sm"
              icon={<Play className="w-4 h-4" />}
              loading={actionLoading}
              onClick={() => handleUpdateStatus('IN_PROGRESS')}
            >
              Resume Operation
            </Button>
          )}

          {status !== 'COMPLETED' && status !== 'CANCELLED' && (
            <Button
              variant="danger"
              size="sm"
              loading={actionLoading}
              onClick={() => {
                if (window.confirm('Cancel this cleanup operation? This decision is permanently logged.')) {
                  handleUpdateStatus('CANCELLED');
                }
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="xl:col-span-2 space-y-4">
          {/* Status Card */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <span className={`text-sm font-mono px-3 py-1.5 rounded border font-bold ${getCleanupStatusColor(status)}`}>
                {status.replace('_', ' ')}
              </span>
              <span className="text-sm font-bold text-[var(--ocean-text)]">{progress}% Verified Progress</span>
            </div>

            <div className="h-3 rounded-full bg-[var(--ocean-border)] overflow-hidden mb-4">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${progress}%`,
                  background: status === 'COMPLETED' ? '#00ff88' : 'linear-gradient(90deg,#00d4ff,#00ff88)',
                }}
              />
            </div>

            {/* Status Flow Progression */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {STATUS_FLOW.map((s, i, arr) => (
                <Fragment key={s}>
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono whitespace-nowrap ${
                    s === status
                      ? 'bg-cyan-500/20 border border-cyan-500/60 text-cyan-400 font-bold'
                      : STATUS_FLOW.indexOf(s) < STATUS_FLOW.indexOf(status)
                        ? 'text-green-400 border border-green-500/30 bg-green-500/10'
                        : 'text-[var(--ocean-text-muted)] border border-[var(--ocean-border)]'
                  }`}>
                    {STATUS_FLOW.indexOf(s) < STATUS_FLOW.indexOf(status) && <Check className="h-3 w-3" aria-hidden="true" />}
                    {s.replace('_', ' ')}
                  </div>
                  {i < arr.length - 1 && <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-[var(--ocean-text-muted)]" aria-hidden="true" />}
                </Fragment>
              ))}
            </div>
          </Card>

          {/* Mission Brief */}
          <Card>
            <CardHeader title="Operational Brief" />
            <p className="text-sm text-[var(--ocean-text-dim)] leading-relaxed">
              {mission.description || 'No detailed instructions provided for this operation.'}
            </p>
            <div className="grid grid-cols-1 gap-3 mt-4 sm:grid-cols-3">
              {[
                { l: 'Target Contacts', v: mission.detectionCount },
                { l: 'Est. Debris Mass', v: `${mission.estimatedMassKg} kg` },
                { l: 'Assigned Zone', v: mission.zoneName },
              ].map(({ l, v }) => (
                <div key={l} className="text-center p-2 rounded-lg bg-[var(--ocean-surface)] border border-[var(--ocean-border)]">
                  <p className="text-sm font-bold text-[var(--ocean-text)]">{v}</p>
                  <p className="text-[10px] text-[var(--ocean-text-muted)]">{l}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* Evidence Collection */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <CardHeader title="Evidence & Recovery Manifest" className="mb-0" />
              <Button
                variant="outline"
                size="xs"
                icon={<Upload className="w-3.5 h-3.5" />}
                onClick={() => setShowEvidenceModal(true)}
              >
                Log Evidence
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {mission.evidence && mission.evidence.map((ev: any) => (
                <div key={ev.id} className="p-3 rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)]">
                  <div className="aspect-video bg-[var(--ocean-bg)] rounded-lg mb-2 flex flex-col items-center justify-center border border-[var(--ocean-border)]">
                    {ev.type === 'BEFORE' ? (
                      <Camera className="h-7 w-7 text-[#4cd6fb]" aria-hidden="true" />
                    ) : (
                      <Ship className="h-7 w-7 text-[#00f5d4]" aria-hidden="true" />
                    )}
                    <span className="text-[10px] font-mono text-[var(--ocean-text-muted)] mt-1">{ev.id}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <Badge variant={ev.type === 'BEFORE' ? 'amber' : ev.type === 'AFTER' ? 'green' : 'cyan'} size="xs">
                      {ev.type}
                    </Badge>
                    {ev.recoveredKg && (
                      <span className="text-xs font-mono font-bold text-green-400">+{ev.recoveredKg} kg recovered</span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--ocean-text-dim)] mt-2">{ev.description}</p>
                  <p className="text-[10px] text-[var(--ocean-text-muted)] mt-1">Logged by {ev.uploadedBy}</p>
                </div>
              ))}

              <button
                type="button"
                onClick={() => setShowEvidenceModal(true)}
                className="p-4 rounded-lg border border-dashed border-[var(--ocean-border)] flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-cyan-500/40 hover:bg-white/5 transition-all aspect-video"
              >
                <Plus className="w-6 h-6 text-cyan-400" />
                <p className="text-xs text-cyan-300 font-medium">Add field recovery evidence</p>
              </button>
            </div>
          </Card>
        </div>

        {/* Right Column: Mission Info + Operational Timeline */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Deployment Details" />
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between py-1.5 border-b border-[var(--ocean-border)]">
                <span className="text-[var(--ocean-text-muted)]">Assigned Team</span>
                <span className="font-semibold text-[var(--ocean-text)]">{mission.assignedTeam || 'Unassigned'}</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-[var(--ocean-border)]">
                <span className="text-[var(--ocean-text-muted)]">Coordinates</span>
                <span className="font-mono text-[var(--ocean-text)]">{mission.lat?.toFixed(2)}°N, {mission.lng?.toFixed(2)}°E</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-[var(--ocean-border)]">
                <span className="text-[var(--ocean-text-muted)]">Location Label</span>
                <span className="text-[var(--ocean-text)] text-right">{mission.locationLabel}</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-[var(--ocean-border)]">
                <span className="text-[var(--ocean-text-muted)]">Created By</span>
                <span className="text-[var(--ocean-text)]">{mission.createdBy}</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-[var(--ocean-border)]">
                <span className="text-[var(--ocean-text-muted)]">Created At</span>
                <span className="font-mono text-[var(--ocean-text)]">{formatDateTime(mission.createdAt)}</span>
              </div>
              {mission.sourceDetectionId && (
                <div className="flex items-center justify-between py-1.5 border-b border-[var(--ocean-border)]">
                  <span className="text-[var(--ocean-text-muted)]">Linked Detection</span>
                  <button
                    onClick={() => navigate(`/detections/${mission.sourceDetectionId}`)}
                    className="font-mono text-cyan-400 hover:underline"
                  >
                    {mission.sourceDetectionId} →
                  </button>
                </div>
              )}
            </div>
          </Card>

          {/* Timeline */}
          <Card>
            <CardHeader title="Mission Log & Timeline" />
            <div className="space-y-3">
              {mission.timeline && mission.timeline.map((item: any, i: number) => (
                <div key={i} className="flex items-start gap-3 relative">
                  {i < mission.timeline.length - 1 && (
                    <div className="absolute left-2 top-4 bottom-0 w-px bg-[var(--ocean-border)]" />
                  )}
                  <div className={`w-4 h-4 rounded-full flex-shrink-0 mt-0.5 ${item.color || 'bg-cyan-400'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-[var(--ocean-text)]">{item.label}</p>
                    <p className="text-[10px] text-[var(--ocean-text-muted)] font-mono">
                      {formatDateTime(item.time)} {item.by ? `· by ${item.by}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Evidence Log Modal */}
      <Modal
        isOpen={showEvidenceModal}
        onClose={() => setShowEvidenceModal(false)}
        title="Record Cleanup Evidence"
        size="md"
      >
        <form onSubmit={handleAddEvidence} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--ocean-text-dim)] mb-1 uppercase tracking-wider">
              Evidence Stage
            </label>
            <select
              value={evidenceType}
              onChange={e => setEvidenceType(e.target.value as any)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
            >
              <option value="BEFORE">Before Operation (Initial Debris Observation)</option>
              <option value="DURING">During Operation (Retrieval in Progress)</option>
              <option value="AFTER">After Operation (Remediated Water / Weigh-in)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--ocean-text-dim)] mb-1 uppercase tracking-wider">
              Recovered Mass (kg)
            </label>
            <input
              type="number"
              step="0.1"
              value={recoveredKg}
              onChange={e => setRecoveredKg(e.target.value)}
              placeholder="e.g. 35.5"
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--ocean-text-dim)] mb-1 uppercase tracking-wider">
              Field Description & Log
            </label>
            <textarea
              rows={3}
              value={evidenceDesc}
              onChange={e => setEvidenceDesc(e.target.value)}
              placeholder="Describe recovered objects, net conditions, crane haul readings..."
              required
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] outline-none focus:border-cyan-500 resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--ocean-border)]">
            <Button variant="ghost" size="sm" type="button" onClick={() => setShowEvidenceModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" loading={uploadingEvidence}>
              Record Evidence
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
