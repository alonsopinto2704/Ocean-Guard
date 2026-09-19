import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronRight, ChevronLeft, MapPin, RefreshCw } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { LoadingState, EmptyState } from '../components/ui/StateComponents';
import { detectionsApi } from '../lib/api';
import {
  getDetectionStatusColor, getRiskBg,
  formatRelativeTime
} from '../lib/utils';
import type { Detection, DetectionStatus, RiskLevel } from '../types';

const STATUS_FILTERS: DetectionStatus[] = ['NEW', 'VALIDATING', 'CONFIRMED', 'TRACKING', 'LOST', 'FALSE_POSITIVE', 'EXPIRED'];
const RISK_FILTERS: RiskLevel[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

/** Detections list: summary stat cards, search + status/risk filters + sorting,
 *  and client-side pagination over the fetched telemetry records. */
export default function Detections() {
  const navigate = useNavigate();
  const [detections, setDetections] = useState<Detection[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatus]   = useState<DetectionStatus | 'ALL'>('ALL');
  const [riskFilter, setRisk]       = useState<RiskLevel | 'ALL'>('ALL');
  const [sortBy, setSortBy]         = useState<'DATE_DESC' | 'DATE_ASC' | 'RISK_DESC' | 'CONF_DESC'>('DATE_DESC');
  const [page, setPage]             = useState(1);
  const pageSize = 8;

  const loadDetections = async () => {
    setLoading(true);
    try {
      const res = await detectionsApi.list();
      if (res && Array.isArray(res.detections)) {
        setDetections(res.detections);
      }
    } catch (err: any) {
      console.error('Failed to fetch detections:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetections();
  }, []);

  // Apply search/status/risk filters, then sort. Memoized to avoid re-sorting
  // on unrelated renders (e.g. pagination changes).
  const filtered = useMemo(() => {
    let list = detections.filter(d => {
      const matchSearch = !search ||
        d.className.toLowerCase().includes(search.toLowerCase()) ||
        d.id.toLowerCase().includes(search.toLowerCase()) ||
        d.trackId.toLowerCase().includes(search.toLowerCase()) ||
        d.locationLabel.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === 'ALL' || d.status === statusFilter;
      const matchRisk   = riskFilter === 'ALL' || d.riskLevel === riskFilter;
      return matchSearch && matchStatus && matchRisk;
    });

    list.sort((a, b) => {
      if (sortBy === 'DATE_DESC') return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
      if (sortBy === 'DATE_ASC') return new Date(a.detectedAt).getTime() - new Date(b.detectedAt).getTime();
      if (sortBy === 'RISK_DESC') return b.riskScore - a.riskScore;
      if (sortBy === 'CONF_DESC') return b.confidence - a.confidence;
      return 0;
    });

    return list;
  }, [detections, search, statusFilter, riskFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedDetections = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  // Adjust page if filter shrinks total pages
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [totalPages, page]);

  return (
    <div className="p-3 sm:p-6 space-y-4">
      {/* Dynamic Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Tracked', value: detections.length, color: '#00d4ff' },
          { label: 'Critical Risk', value: detections.filter(d => d.riskLevel === 'CRITICAL').length, color: '#ff4455' },
          { label: 'Active Tracking', value: detections.filter(d => d.status === 'TRACKING').length, color: '#00ff88' },
          { label: 'New Unconfirmed', value: detections.filter(d => d.status === 'NEW').length, color: '#aa55ff' },
        ].map(s => (
          <Card key={s.label} className="py-3 px-4">
            <p className="text-xs text-[var(--ocean-text-dim)] mb-1">{s.label}</p>
            <p className="text-2xl font-bold font-mono" style={{ color: s.color }}>{s.value}</p>
          </Card>
        ))}
      </div>

      {/* Filter and search bar */}
      <Card className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
        <div className="relative flex-1">
          <label htmlFor="detection-search" className="sr-only">Search detections</label>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ocean-text-muted)]" />
          <input
            id="detection-search"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by class, ID, track or coastal sector..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] placeholder-[var(--ocean-text-muted)] focus:border-cyan-500 outline-none"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label htmlFor="detection-status" className="sr-only">Filter by status</label>
            <select
              id="detection-status"
              value={statusFilter}
              onChange={e => { setStatus(e.target.value as any); setPage(1); }}
              className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] focus:border-cyan-500 outline-none"
            >
              <option value="ALL">All Statuses</option>
              {STATUS_FILTERS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="detection-risk" className="sr-only">Filter by risk level</label>
            <select
              id="detection-risk"
              value={riskFilter}
              onChange={e => { setRisk(e.target.value as any); setPage(1); }}
              className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] focus:border-cyan-500 outline-none"
            >
              <option value="ALL">All Risk Levels</option>
              {RISK_FILTERS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="detection-sort" className="sr-only">Sort records</label>
            <select
              id="detection-sort"
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text)] focus:border-cyan-500 outline-none"
            >
              <option value="DATE_DESC">Newest First</option>
              <option value="DATE_ASC">Oldest First</option>
              <option value="RISK_DESC">Highest Risk</option>
              <option value="CONF_DESC">Highest Confidence</option>
            </select>
          </div>
        </div>

        <Button variant="ghost" size="sm" icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />} onClick={loadDetections}>
          Refresh
        </Button>
      </Card>

      {/* Detections List */}
      {loading && detections.length === 0 ? (
        <LoadingState message="Loading telemetry records..." size="lg" className="h-64" />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No detections match your query"
          description="Try broadening the status or risk filter, or clearing the search terms."
          action={<Button variant="outline" size="sm" onClick={() => { setSearch(''); setStatus('ALL'); setRisk('ALL'); }}>Reset Filters</Button>}
        />
      ) : (
        <div className="space-y-2">
          {paginatedDetections.map(d => (
            <div
              key={d.id}
              onClick={() => navigate(`/detections/${d.id}`)}
              className="p-3.5 rounded-xl border border-[var(--ocean-border)] bg-[var(--ocean-card)] hover:bg-[var(--ocean-card-hover)] hover:border-cyan-500/40 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start sm:items-center gap-3 min-w-0">
                <div className={`p-2 rounded-lg border font-mono text-xs font-bold ${getRiskBg(d.riskLevel)}`}>
                  {d.riskScore}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-[var(--ocean-text)]">{d.className}</span>
                    <span className="font-mono text-xs text-cyan-400 font-semibold">{d.id}</span>
                    <span className="font-mono text-[11px] text-[var(--ocean-text-muted)]">{d.trackId}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--ocean-text-dim)] mt-0.5">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-cyan-400" />
                      {d.locationLabel}
                    </span>
                    <span>·</span>
                    <span>{d.cameraName}</span>
                    <span>·</span>
                    <span>{formatRelativeTime(d.detectedAt)}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 self-end sm:self-center">
                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${getDetectionStatusColor(d.status)}`}>
                  {d.status}
                </span>
                <Badge variant={d.confidence >= 85 ? 'green' : d.confidence >= 70 ? 'cyan' : 'amber'} size="xs">
                  {d.confidence}% CONF
                </Badge>
                <ChevronRight className="w-4 h-4 text-[var(--ocean-text-muted)]" />
              </div>
            </div>
          ))}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 px-1 text-xs text-[var(--ocean-text-dim)]">
              <span>Showing {(page - 1) * pageSize + 1} to {Math.min(filtered.length, page * pageSize)} of {filtered.length} detections</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  icon={<ChevronLeft className="w-3.5 h-3.5" />}
                >
                  Prev
                </Button>
                <span className="font-mono px-2 text-[var(--ocean-text)]">Page {page} / {totalPages}</span>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  iconRight={<ChevronRight className="w-3.5 h-3.5" />}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
