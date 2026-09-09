import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CalendarRange,
  CheckCircle,
  Download,
  FileText,
  Recycle,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { reportsApi } from '../lib/api';
import { formatDate } from '../lib/utils';
import type { ReportType } from '../types';

const REPORT_TYPES: { type: ReportType; label: string; desc: string; icon: LucideIcon }[] = [
  { type: 'DAILY',   label: 'Daily Report',   desc: 'Last 24-hour operations summary', icon: CalendarDays },
  { type: 'WEEKLY',  label: 'Weekly Report',  desc: 'Last 7-day pollution & cleanup overview', icon: CalendarRange },
  { type: 'MONTHLY', label: 'Monthly Report', desc: 'Full month environmental impact analysis', icon: Activity },
  { type: 'INCIDENT',label: 'Incident Report',desc: 'Specific high-risk event documentation', icon: AlertTriangle },
  { type: 'CLEANUP', label: 'Cleanup Report', desc: 'Mission completion and debris cleared', icon: Recycle },
];

const HISTORY = [
  { id: 'RPT-204812', type: 'DAILY',   generatedAt: new Date(Date.now() - 3600000).toISOString(), detections: 412, critical: 6, clearedKg: 242, responseH: 1.8 },
  { id: 'RPT-204720', type: 'WEEKLY',  generatedAt: new Date(Date.now() - 2 * 86400000).toISOString(), detections: 2841, critical: 21, clearedKg: 1284, responseH: 2.1 },
  { id: 'RPT-204618', type: 'INCIDENT',generatedAt: new Date(Date.now() - 5 * 86400000).toISOString(), detections: 146, critical: 3, clearedKg: 82, responseH: 1.2 },
  { id: 'RPT-204510', type: 'CLEANUP', generatedAt: new Date(Date.now() - 8 * 86400000).toISOString(), detections: 62, critical: 0, clearedKg: 24, responseH: 0.8 },
];

export default function Reports() {
  const [selectedType, setSelectedType] = useState<ReportType>('DAILY');
  const [generating, setGenerating]     = useState(false);
  const [generated, setGenerated]       = useState<any | null>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerated(null);
    try {
      const result = await reportsApi.generate(selectedType);
      setGenerated(result);
    } catch {
      // Fallback demo
      setGenerated({
        reportId: `RPT-${Date.now().toString().slice(-6)}`,
        generatedAt: new Date().toISOString(),
        type: selectedType,
        metrics: {
          totalDetectionsPeriod: 412,
          criticalIncidents: 6,
          clearedDebrisKg: 242,
          meanResponseTimeHours: 1.8,
          predominantClass: 'Plastic Polymer (64%)',
        },
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="p-3 space-y-6 sm:p-6">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Generator */}
        <div className="xl:col-span-1 space-y-4">
          <Card>
            <CardHeader title="Generate Report" subtitle="Select type and generate" icon={<FileText className="w-4 h-4" />} />
            <div className="space-y-2 mb-4">
              {REPORT_TYPES.map(rt => {
                const ReportIcon = rt.icon;
                return (
                <button
                  key={rt.type}
                  onClick={() => { setSelectedType(rt.type); setGenerated(null); }}
                  aria-pressed={selectedType === rt.type}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    selectedType === rt.type
                      ? 'border-cyan-500/60 bg-cyan-500/10'
                      : 'border-[var(--ocean-border)] hover:border-cyan-500/30 bg-[var(--ocean-surface)]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <ReportIcon className="h-4 w-4 flex-shrink-0 text-[#4cd6fb]" aria-hidden="true" />
                    <div>
                      <p className="text-xs font-semibold text-[var(--ocean-text)]">{rt.label}</p>
                      <p className="text-[10px] text-[var(--ocean-text-dim)]">{rt.desc}</p>
                    </div>
                  </div>
                </button>
                );
              })}
            </div>
            <Button variant="primary" fullWidth size="md" loading={generating} onClick={handleGenerate}
              icon={!generating ? <FileText className="w-4 h-4" /> : undefined}>
              Generate Report
            </Button>
          </Card>

          {/* Generated result */}
          {generated && (
            <Card className="border-green-500/30 bg-green-500/5">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle className="w-4 h-4 text-green-400" />
                <span className="text-xs font-semibold text-green-400">Report Generated</span>
              </div>
              <p className="text-[10px] font-mono text-[var(--ocean-text-muted)] mb-2">{generated.reportId}</p>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {[
                  { l: 'Detections', v: generated.metrics.totalDetectionsPeriod },
                  { l: 'Critical',   v: generated.metrics.criticalIncidents },
                  { l: 'Cleared',    v: `${generated.metrics.clearedDebrisKg} kg` },
                  { l: 'Avg Resp.',  v: `${generated.metrics.meanResponseTimeHours}h` },
                ].map(({ l, v }) => (
                  <div key={l} className="text-center p-2 rounded-lg bg-[var(--ocean-bg)] border border-[var(--ocean-border)]">
                    <p className="text-xs font-bold text-[var(--ocean-text)]">{v}</p>
                    <p className="text-[10px] text-[var(--ocean-text-muted)]">{l}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="success" size="xs" fullWidth icon={<Download className="w-3 h-3" />}>PDF</Button>
                <Button variant="outline" size="xs" fullWidth icon={<Download className="w-3 h-3" />}>CSV</Button>
                <Button variant="outline" size="xs" fullWidth icon={<Download className="w-3 h-3" />}>JSON</Button>
              </div>
            </Card>
          )}
        </div>

        {/* History */}
        <div className="xl:col-span-2">
          <Card noPad>
            <CardHeader title="Report History" subtitle="Previously generated reports" className="px-4 pt-4" />
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--ocean-border)]">
                    {['Report ID', 'Type', 'Detections', 'Critical', 'Cleared', 'Response', 'Generated', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold text-[var(--ocean-text-muted)] uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {HISTORY.map(r => (
                    <tr key={r.id} className="border-b border-[var(--ocean-border)]/50 hover:bg-[var(--ocean-card-hover)] transition-colors">
                      <td className="px-4 py-3 text-xs font-mono text-cyan-400">{r.id}</td>
                      <td className="px-4 py-3"><Badge variant="outline" size="xs">{r.type}</Badge></td>
                      <td className="px-4 py-3 text-xs font-mono text-[var(--ocean-text)]">{r.detections}</td>
                      <td className="px-4 py-3 text-xs font-mono text-red-400">{r.critical}</td>
                      <td className="px-4 py-3 text-xs font-mono text-green-400">{r.clearedKg} kg</td>
                      <td className="px-4 py-3 text-xs font-mono text-[var(--ocean-text-dim)]">{r.responseH}h</td>
                      <td className="px-4 py-3 text-xs text-[var(--ocean-text-dim)]">{formatDate(r.generatedAt)}</td>
                      <td className="px-4 py-3">
                        <Button
                          variant="ghost"
                          size="xs"
                          icon={<Download className="w-3 h-3" />}
                          aria-label={`Download ${r.id}`}
                          title={`Download ${r.id}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
