import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, Check, CheckCircle, ChevronRight, Ship, Upload } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { getCleanupStatusColor, formatDateTime } from '../lib/utils';
import type { CleanupStatus } from '../types';

const MISSION_DATA: Record<string, any> = {
  'CM-204': {
    id: 'CM-204', title: 'Zone 4 Critical Debris Cluster', status: 'IN_PROGRESS',
    priority: 'CRITICAL', zoneName: 'Zone 4', locationLabel: 'Zone 4 N · 35.1°N, 158.3°W',
    detectionCount: 146, estimatedMassKg: 82, assignedTeam: 'Coastal Team A',
    scheduledAt: new Date(Date.now() - 3 * 3600000).toISOString(),
    startedAt: new Date(Date.now() - 1.5 * 3600000).toISOString(),
    createdAt: new Date(Date.now() - 5 * 3600000).toISOString(),
    createdBy: 'Cmdr. Elena Vance', progress: 45,
    description: 'Large fishing net and plastic cluster identified by Espada Track #1042. 146 debris items in 2.4km radius. High risk due to proximity to shipping routes and marine sanctuary.',
    evidence: [
      { id: 'EV-01', type: 'BEFORE', description: 'Aerial photo before cleanup', uploadedAt: new Date(Date.now() - 90 * 60000).toISOString(), uploadedBy: 'Marcus Brody' },
      { id: 'EV-02', type: 'DURING', description: 'Recovery in progress', uploadedAt: new Date(Date.now() - 30 * 60000).toISOString(), uploadedBy: 'Capt. Javier Silva' },
    ],
    timeline: [
      { label: 'Mission Created', time: new Date(Date.now() - 5 * 3600000).toISOString(), by: 'Cmdr. Elena Vance', color: 'bg-cyan-400' },
      { label: 'Team Assigned',   time: new Date(Date.now() - 4 * 3600000).toISOString(), by: 'Cmdr. Elena Vance', color: 'bg-purple-400' },
      { label: 'Departed Port',   time: new Date(Date.now() - 3 * 3600000).toISOString(), by: 'Capt. Javier Silva', color: 'bg-amber-400' },
      { label: 'On Site',         time: new Date(Date.now() - 1.5 * 3600000).toISOString(), by: 'Capt. Javier Silva', color: 'bg-green-400' },
    ],
  },
};

const STATUS_FLOW: CleanupStatus[] = ['DRAFT','SCHEDULED','ASSIGNED','IN_PROGRESS','PAUSED','COMPLETED','CANCELLED'];

export default function CleanupDetail() {
  const { id }   = useParams<{ id: string }>();
  const navigate = useNavigate();
  const mission  = MISSION_DATA[id!] ?? MISSION_DATA['CM-204'];
  const [status, setStatus]     = useState<CleanupStatus>(mission.status);
  const [progress, setProgress] = useState(mission.progress);
  const [completing, setCompleting] = useState(false);

  const handleComplete = async () => {
    setCompleting(true);
    setTimeout(() => { setStatus('COMPLETED'); setProgress(100); setCompleting(false); }, 1500);
  };

  return (
    <div className="p-3 space-y-6 max-w-5xl mx-auto sm:p-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
        <div className="flex min-w-0 items-start gap-3">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => navigate('/cleanup')}>Back</Button>
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-mono text-[var(--ocean-text-muted)]">{mission.id}</span>
              <Badge variant={mission.priority === 'CRITICAL' ? 'red' : 'amber'} size="xs">{mission.priority}</Badge>
            </div>
            <h2 className="text-lg font-bold text-[var(--ocean-text)]">{mission.title}</h2>
          </div>
        </div>
        <div className="flex gap-2">
          {status === 'IN_PROGRESS' && (
            <Button variant="success" size="sm" icon={<CheckCircle className="w-4 h-4" />} loading={completing} onClick={handleComplete}>
              Mark Complete
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left */}
        <div className="xl:col-span-2 space-y-4">
          {/* Status card */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <span className={`text-sm font-mono px-3 py-1.5 rounded border font-bold ${getCleanupStatusColor(status)}`}>
                {status.replace('_', ' ')}
              </span>
              <span className="text-sm font-bold text-[var(--ocean-text)]">{progress}% Complete</span>
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
            {/* Status flow */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {STATUS_FLOW.filter(s => !['CANCELLED','PAUSED'].includes(s)).map((s, i, arr) => (
                <React.Fragment key={s}>
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono whitespace-nowrap ${
                    s === status
                      ? 'bg-cyan-500/20 border border-cyan-500/60 text-cyan-400'
                      : STATUS_FLOW.indexOf(s) < STATUS_FLOW.indexOf(status)
                        ? 'text-green-400 border border-green-500/30 bg-green-500/10'
                        : 'text-[var(--ocean-text-muted)] border border-[var(--ocean-border)]'
                  }`}>
                    {STATUS_FLOW.indexOf(s) < STATUS_FLOW.indexOf(status) && <Check className="h-3 w-3" aria-hidden="true" />}
                    {s.replace('_', ' ')}
                  </div>
                  {i < arr.length - 1 && <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-[var(--ocean-text-muted)]" aria-hidden="true" />}
                </React.Fragment>
              ))}
            </div>
          </Card>

          {/* Description */}
          <Card>
            <CardHeader title="Mission Brief" />
            <p className="text-sm text-[var(--ocean-text-dim)] leading-relaxed">{mission.description}</p>
            <div className="grid grid-cols-1 gap-3 mt-4 sm:grid-cols-3">
              {[
                { l: 'Detections', v: mission.detectionCount },
                { l: 'Est. Mass', v: `${mission.estimatedMassKg} kg` },
                { l: 'Zone', v: mission.zoneName },
              ].map(({ l, v }) => (
                <div key={l} className="text-center p-2 rounded-lg bg-[var(--ocean-surface)] border border-[var(--ocean-border)]">
                  <p className="text-sm font-bold text-[var(--ocean-text)]">{v}</p>
                  <p className="text-[10px] text-[var(--ocean-text-muted)]">{l}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* Evidence */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <CardHeader title="Evidence & Photos" className="mb-0" />
              <Button variant="outline" size="xs" icon={<Upload className="w-3 h-3" />}>Upload</Button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {mission.evidence.map((ev: any) => (
                <div key={ev.id} className="p-3 rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)]">
                  <div className="aspect-video bg-[var(--ocean-bg)] rounded-lg mb-2 flex items-center justify-center border border-[var(--ocean-border)]">
                    {ev.type === 'BEFORE'
                      ? <Camera className="h-7 w-7 text-[#4cd6fb]" aria-hidden="true" />
                      : <Ship className="h-7 w-7 text-[#00f5d4]" aria-hidden="true" />
                    }
                  </div>
                  <Badge variant={ev.type === 'BEFORE' ? 'amber' : ev.type === 'AFTER' ? 'green' : 'cyan'} size="xs">{ev.type}</Badge>
                  <p className="text-xs text-[var(--ocean-text-dim)] mt-1">{ev.description}</p>
                  <p className="text-[10px] text-[var(--ocean-text-muted)] mt-0.5">by {ev.uploadedBy}</p>
                </div>
              ))}
              <button type="button" className="p-3 rounded-lg border border-dashed border-[var(--ocean-border)] flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-cyan-500/40 transition-colors aspect-video">
                <Upload className="w-5 h-5 text-[var(--ocean-text-muted)]" />
                <p className="text-xs text-[var(--ocean-text-muted)]">Add evidence</p>
              </button>
            </div>
          </Card>
        </div>

        {/* Right: info + timeline */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Mission Info" />
            <div className="space-y-3">
              {[
                { l: 'Assigned Team', v: mission.assignedTeam },
                { l: 'Location', v: mission.locationLabel },
                { l: 'Created By', v: mission.createdBy },
                { l: 'Created', v: formatDateTime(mission.createdAt) },
                { l: 'Started', v: mission.startedAt ? formatDateTime(mission.startedAt) : '—' },
              ].map(({ l, v }) => (
                <div key={l}>
                  <p className="text-[10px] text-[var(--ocean-text-muted)] uppercase tracking-wider">{l}</p>
                  <p className="text-xs text-[var(--ocean-text)] mt-0.5">{v}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Timeline" />
            <div className="space-y-4">
              {mission.timeline.map((ev: any, i: number) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${ev.color}`} />
                    {i < mission.timeline.length - 1 && <div className="w-px flex-1 bg-[var(--ocean-border)] mt-1" />}
                  </div>
                  <div className="pb-4">
                    <p className="text-xs font-semibold text-[var(--ocean-text)]">{ev.label}</p>
                    <p className="text-[10px] text-[var(--ocean-text-muted)]">{formatDateTime(ev.time)}</p>
                    <p className="text-[10px] text-[var(--ocean-text-dim)]">by {ev.by}</p>
                  </div>
                </div>
              ))}
              {status === 'COMPLETED' && (
                <div className="flex gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-green-400 flex-shrink-0" />
                  <div>
                    <p className="flex items-center gap-1 text-xs font-semibold text-green-400">
                      Mission Completed <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    </p>
                    <p className="text-[10px] text-[var(--ocean-text-muted)]">Just now</p>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
