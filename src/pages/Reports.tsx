import { useState, useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CalendarRange,
  CheckCircle,
  Download,
  FileText,
  Recycle,
  Filter,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge, DataProvenanceBadge } from '../components/ui/Badge';
import { ErrorState, LoadingState } from '../components/ui/StateComponents';
import { reportsApi } from '../lib/api';
import { formatDate } from '../lib/utils';
import type { ReportType } from '../types';

interface ReportTypeOption {
  type: ReportType;
  label: string;
  desc: string;
  icon: LucideIcon;
}

const REPORT_TYPES: ReportTypeOption[] = [
  { type: 'DAILY',   label: 'Daily Report',   desc: 'Last 24-hour operations summary', icon: CalendarDays },
  { type: 'WEEKLY',  label: 'Weekly Report',  desc: 'Last 7-day pollution & cleanup overview', icon: CalendarRange },
  { type: 'MONTHLY', label: 'Monthly Report', desc: 'Full month environmental impact analysis', icon: Activity },
  { type: 'INCIDENT',label: 'Incident Report',desc: 'Specific high-risk event documentation', icon: AlertTriangle },
  { type: 'CLEANUP', label: 'Cleanup Report', desc: 'Mission completion and debris cleared', icon: Recycle },
];

const MONITORED_ZONES = [
  { id: 'ALL', label: 'All Operational Zones (Coastal India)' },
  { id: 'Z1',  label: 'Zone 1 — Gulf of Kachchh Marine Park' },
  { id: 'Z2',  label: 'Zone 2 — Mumbai Offshore & Harbour' },
  { id: 'Z3',  label: 'Zone 3 — Goa Shelf & Estuary' },
  { id: 'Z4',  label: 'Zone 4 — Konkan Coastal Corridor' },
  { id: 'Z5',  label: 'Zone 5 — Odisha Offshore Shelf' },
  { id: 'Z6',  label: 'Zone 6 — Chennai Marine Corridor' },
  { id: 'Z7',  label: 'Zone 7 — Gulf of Mannar Biosphere' },
];

// Reports page: generates operational reports (live from the server, or a
// labeled sample preview) and lists the saved report repository with downloads.
export default function Reports() {
  const [selectedType, setSelectedType] = useState<ReportType>('DAILY');
  const [selectedZone, setSelectedZone] = useState<string>('ALL');
  const [startDate, setStartDate]       = useState<string>('');
  const [endDate, setEndDate]           = useState<string>('');
  const [generating, setGenerating]     = useState(false);
  const [generated, setGenerated]       = useState<any | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const [isSample, setIsSample]         = useState(false);

  // Saved reports history
  const [history, setHistory]           = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);

  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await reportsApi.list();
      if (res && Array.isArray(res.reports)) {
        setHistory(res.reports);
      }
    } catch (err: any) {
      console.error('Failed to load reports history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  // Ask the server to compile a report from real telemetry, then refresh history.
  const handleGenerate = async () => {
    setGenerating(true);
    setGenerated(null);
    setError(null);
    setIsSample(false);
    try {
      const result = await reportsApi.generate({
        type: selectedType,
        zoneId: selectedZone !== 'ALL' ? selectedZone : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setGenerated(result);
      await fetchHistory();
    } catch (err: any) {
      setError(err?.message || 'Report generation failed. Real telemetry is unavailable or offline.');
    } finally {
      setGenerating(false);
    }
  };

  // Build a clearly-labeled SAMPLE report locally so the UI can be evaluated
  // when live telemetry is unavailable (badge shows SAMPLE, not LIVE).
  const handlePreviewSample = () => {
    setError(null);
    setIsSample(true);
    setGenerated({
      id: `SAMPLE-${selectedType.slice(0, 3)}-${Date.now().toString().slice(-4)}`,
      reportId: `SAMPLE-${selectedType.slice(0, 3)}-${Date.now().toString().slice(-4)}`,
      generatedAt: new Date().toISOString(),
      type: selectedType,
      zoneId: selectedZone !== 'ALL' ? selectedZone : undefined,
      metrics: {
        totalDetectionsPeriod: 412,
        criticalIncidents: 6,
        clearedDebrisKg: 242,
        meanResponseTimeHours: 1.8,
        predominantClass: 'Mixed Waste (64%)',
      },
    });
  };

  // Fetch the protected export with the bearer token. PDF is an HTML print view.
  const downloadReport = async (id: string, format: 'pdf' | 'csv' | 'json') => {
    const key = `${id}:${format}`;
    const printWindow = format === 'pdf' ? window.open('', '_blank') : null;
    if (format === 'pdf' && !printWindow) {
      setError('The print window was blocked. Allow pop-ups for this site and try again.');
      return;
    }

    setError(null);
    setDownloading(key);
    try {
      const response = await reportsApi.download(id, format);
      if (format === 'pdf') {
        const html = await response.text();
        printWindow!.document.open();
        printWindow!.document.write(html);
        printWindow!.document.close();
        printWindow!.focus();
        printWindow!.print();
      } else {
        const url = URL.createObjectURL(await response.blob());
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${id}.${format}`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    } catch (err: any) {
      printWindow?.close();
      setError(err?.message || 'Report download failed.');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="p-3 space-y-6 sm:p-6 max-w-7xl mx-auto">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Generator */}
        <div className="xl:col-span-1 space-y-4">
          <Card>
            <CardHeader
              title="Generate Operational Report"
              subtitle="Select report category, scope, and parameters"
              icon={<FileText className="w-4 h-4 text-cyan-400" />}
            />

            {/* Report Type Selector */}
            <div className="space-y-2 mb-4">
              <label className="text-[11px] font-semibold text-[var(--ocean-text-dim)] uppercase tracking-wider block">
                Report Type
              </label>
              {REPORT_TYPES.map(rt => {
                const ReportIcon = rt.icon;
                return (
                  <button
                    key={rt.type}
                    onClick={() => { setSelectedType(rt.type); setGenerated(null); }}
                    aria-pressed={selectedType === rt.type}
                    className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                      selectedType === rt.type
                        ? 'border-cyan-500/60 bg-cyan-500/10'
                        : 'border-[var(--ocean-border)] hover:border-cyan-500/30 bg-[var(--ocean-surface)]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <ReportIcon className="h-4 w-4 flex-shrink-0 text-cyan-400" aria-hidden="true" />
                      <div>
                        <p className="text-xs font-semibold text-[var(--ocean-text)]">{rt.label}</p>
                        <p className="text-[10px] text-[var(--ocean-text-dim)]">{rt.desc}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Scope / Filters */}
            <div className="space-y-3 mb-4 p-3 rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)]">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--ocean-text-dim)] uppercase tracking-wider">
                <Filter className="w-3.5 h-3.5 text-cyan-400" />
                <span>Scope & Date Filter</span>
              </div>

              <div>
                <label className="block text-[10px] text-[var(--ocean-text-muted)] mb-1">Target Sector</label>
                <select
                  value={selectedZone}
                  onChange={e => setSelectedZone(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded border border-[var(--ocean-border)] bg-[var(--ocean-bg)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
                >
                  {MONITORED_ZONES.map(z => (
                    <option key={z.id} value={z.id}>{z.label}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-[var(--ocean-text-muted)] mb-1">Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="w-full px-2 py-1 text-xs rounded border border-[var(--ocean-border)] bg-[var(--ocean-bg)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--ocean-text-muted)] mb-1">End Date</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    className="w-full px-2 py-1 text-xs rounded border border-[var(--ocean-border)] bg-[var(--ocean-bg)] text-[var(--ocean-text)] outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Button
                variant="primary"
                fullWidth
                size="md"
                loading={generating}
                onClick={handleGenerate}
                icon={!generating ? <FileText className="w-4 h-4" /> : undefined}
              >
                Compile Live Report
              </Button>
              <Button
                variant="outline"
                fullWidth
                size="sm"
                disabled={generating}
                onClick={handlePreviewSample}
              >
                Preview Sample Report
              </Button>
            </div>
          </Card>

          {/* Error display */}
          {error && (
            <Card className="border-red-500/30 bg-red-500/5">
              <ErrorState message={error} onRetry={handleGenerate} />
            </Card>
          )}

          {/* Generated result */}
          {generated && (
            <Card className={isSample ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5'}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <CheckCircle className={`w-4 h-4 ${isSample ? 'text-amber-400' : 'text-emerald-400'}`} />
                  <span className={`text-xs font-semibold ${isSample ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {isSample ? 'Sample Report Preview' : 'Report Generated & Saved'}
                  </span>
                </div>
                <DataProvenanceBadge status={isSample ? 'SAMPLE' : 'LIVE'} />
              </div>
              <p className="text-[10px] font-mono text-[var(--ocean-text-muted)] mb-2">
                ID: {generated.id || generated.reportId}
              </p>

              {generated.metrics && (
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {[
                    { l: 'Detections', v: generated.metrics.totalDetectionsPeriod ?? 0 },
                    { l: 'Critical',   v: generated.metrics.criticalIncidents ?? 0 },
                    { l: 'Cleared',    v: `${generated.metrics.clearedDebrisKg ?? 0} kg` },
                    { l: 'Avg Resp.',  v: `${generated.metrics.meanResponseTimeHours ?? 0}h` },
                  ].map(({ l, v }) => (
                    <div key={l} className="text-center p-2 rounded-lg bg-[var(--ocean-bg)] border border-[var(--ocean-border)]">
                      <p className="text-xs font-bold text-[var(--ocean-text)]">{v}</p>
                      <p className="text-[10px] text-[var(--ocean-text-muted)]">{l}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-[var(--ocean-text-dim)]">Export Options:</p>
                <div className="flex gap-2">
                  <Button
                    variant="success"
                    size="xs"
                    fullWidth
                    icon={<Download className="w-3 h-3" />}
                    onClick={() => void downloadReport(generated.id || generated.reportId, 'pdf')}
                    loading={downloading === `${generated.id || generated.reportId}:pdf`}
                  >
                    PDF / Print
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    fullWidth
                    icon={<Download className="w-3 h-3" />}
                    onClick={() => void downloadReport(generated.id || generated.reportId, 'csv')}
                    loading={downloading === `${generated.id || generated.reportId}:csv`}
                  >
                    CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    fullWidth
                    icon={<Download className="w-3 h-3" />}
                    onClick={() => void downloadReport(generated.id || generated.reportId, 'json')}
                    loading={downloading === `${generated.id || generated.reportId}:json`}
                  >
                    JSON
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* Saved Report History */}
        <div className="xl:col-span-2">
          <Card noPad>
            <div className="p-4 border-b border-[var(--ocean-border)] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--ocean-text)]">Permanent Report Repository</h3>
                <p className="text-xs text-[var(--ocean-text-dim)]">Archived operations summaries and environmental audits</p>
              </div>
              <Button
                variant="ghost"
                size="xs"
                icon={<RefreshCw className={`w-3 h-3 ${loadingHistory ? 'animate-spin' : ''}`} />}
                onClick={fetchHistory}
              >
                Refresh
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--ocean-border)]">
                    {['Report ID', 'Type', 'Target Sector', 'Detections', 'Critical', 'Cleared', 'Generated', 'Download'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold text-[var(--ocean-text-muted)] uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loadingHistory && history.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-xs text-[var(--ocean-text-muted)]">
                        <LoadingState message="Loading saved reports..." size="sm" />
                      </td>
                    </tr>
                  ) : history.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-xs text-[var(--ocean-text-muted)]">
                        No saved reports in repository. Generate your first operational report above.
                      </td>
                    </tr>
                  ) : (
                    history.map(r => (
                      <tr key={r.id} className="border-b border-[var(--ocean-border)]/50 hover:bg-[var(--ocean-card-hover)] transition-colors">
                        <td className="px-4 py-3 text-xs font-mono text-cyan-400">{r.id}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" size="xs">{r.type}</Badge>
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-[var(--ocean-text-dim)]">
                          {r.zoneId ? r.zoneId : 'All Sectors'}
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-[var(--ocean-text)]">
                          {r.metrics?.totalDetectionsPeriod ?? r.detections ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-red-400">
                          {r.metrics?.criticalIncidents ?? r.critical ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-emerald-400">
                          {r.metrics?.clearedDebrisKg ?? r.clearedKg ?? 0} kg
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--ocean-text-dim)]">
                          {formatDate(r.generatedAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => void downloadReport(r.id, 'pdf')}
                              disabled={downloading === `${r.id}:pdf`}
                              className="px-2 py-1 text-[10px] font-mono rounded bg-cyan-950/40 border border-cyan-800/40 text-cyan-300 hover:bg-cyan-900/60"
                              title="Download PDF"
                            >
                              PDF
                            </button>
                            <button
                              onClick={() => void downloadReport(r.id, 'csv')}
                              disabled={downloading === `${r.id}:csv`}
                              className="px-2 py-1 text-[10px] font-mono rounded bg-[var(--ocean-surface)] border border-[var(--ocean-border)] text-[var(--ocean-text-dim)] hover:text-[var(--ocean-text)]"
                              title="Download CSV"
                            >
                              CSV
                            </button>
                            <button
                              onClick={() => void downloadReport(r.id, 'json')}
                              disabled={downloading === `${r.id}:json`}
                              className="px-2 py-1 text-[10px] font-mono rounded bg-[var(--ocean-surface)] border border-[var(--ocean-border)] text-[var(--ocean-text-dim)] hover:text-[var(--ocean-text)]"
                              title="Download JSON"
                            >
                              JSON
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
