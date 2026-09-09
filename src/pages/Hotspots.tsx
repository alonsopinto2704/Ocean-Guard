import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowRight, Minus, TrendingDown, TrendingUp, X } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { getRiskBg } from '../lib/utils';
import type { RiskLevel } from '../types';

const HOTSPOTS = [
  { id: 'HS-01', name: 'Pacific Gyre Core',    lat: 28.5,  lng: -140.2, risk: 'CRITICAL' as RiskLevel, detections: 312, mass: 1840, status: 'ACTIVE',    radius: 42000, trend: 'INCREASING' },
  { id: 'HS-02', name: 'Zone 4 Cluster',       lat: 35.1,  lng: -158.3, risk: 'CRITICAL' as RiskLevel, detections: 204, mass: 982,  status: 'ACTIVE',    radius: 28000, trend: 'STABLE' },
  { id: 'HS-03', name: 'North Pacific Band',   lat: 14.2,  lng: -155.8, risk: 'HIGH'     as RiskLevel, detections: 148, mass: 624,  status: 'ACTIVE',    radius: 22000, trend: 'INCREASING' },
  { id: 'HS-04', name: 'Oregon Shelf Zone',    lat: 42.1,  lng: -130.5, risk: 'HIGH'     as RiskLevel, detections: 98,  mass: 410,  status: 'MONITORED', radius: 15000, trend: 'STABLE' },
  { id: 'HS-05', name: 'Western Pacific',      lat: 20.4,  lng: 145.6,  risk: 'MEDIUM'   as RiskLevel, detections: 74,  mass: 290,  status: 'ACTIVE',    radius: 18000, trend: 'DECREASING' },
  { id: 'HS-06', name: 'Eastern Pacific',      lat: -10.2, lng: -85.4,  risk: 'MEDIUM'   as RiskLevel, detections: 61,  mass: 218,  status: 'MONITORED', radius: 12000, trend: 'STABLE' },
  { id: 'HS-07', name: 'Central Pacific',      lat: 5.8,   lng: -110.2, risk: 'LOW'      as RiskLevel, detections: 42,  mass: 134,  status: 'MONITORED', radius: 10000, trend: 'DECREASING' },
  { id: 'HS-08', name: 'Zone 2 Inshore',       lat: 19.8,  lng: -157.4, risk: 'MEDIUM'   as RiskLevel, detections: 55,  mass: 188,  status: 'CLEANING',  radius: 8000,  trend: 'DECREASING' },
];

function riskColor(risk: RiskLevel) {
  if (risk === 'CRITICAL') return '#ff4455';
  if (risk === 'HIGH')     return '#ff8800';
  if (risk === 'MEDIUM')   return '#ffaa00';
  return '#00ff88';
}

export default function Hotspots() {
  const navigate = useNavigate();
  const mapRef    = useRef<L.Map | null>(null);
  const mapEl     = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<typeof HOTSPOTS[0] | null>(null);
  const [filter, setFilter] = useState<RiskLevel | 'ALL'>('ALL');

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;

    const map = L.map(mapEl.current, {
      center: [20, -155],
      zoom: 4,
      zoomControl: true,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    // Add hotspot circles + markers
    HOTSPOTS.forEach(hs => {
      const color = riskColor(hs.risk);

      // Glow circle
      L.circle([hs.lat, hs.lng], {
        radius: hs.radius,
        color, fillColor: color,
        fillOpacity: 0.08, weight: 1.5, opacity: 0.4,
      }).addTo(map);

      // Center marker
      const icon = L.divIcon({
        html: `<div style="
          width:14px;height:14px;border-radius:50%;
          background:${color};border:2px solid white;
          box-shadow:0 0 12px ${color}88;
        "></div>`,
        className: '',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      L.marker([hs.lat, hs.lng], { icon })
        .addTo(map)
        .on('click', () => setSelected(hs));
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  const filtered = filter === 'ALL' ? HOTSPOTS : HOTSPOTS.filter(h => h.risk === filter);
  const SelectedTrendIcon = selected?.trend === 'INCREASING'
    ? TrendingUp
    : selected?.trend === 'DECREASING'
      ? TrendingDown
      : Minus;

  return (
    <div className="flex min-h-[calc(100dvh-64px)] flex-col overflow-visible md:h-[calc(100dvh-64px)] md:min-h-0 md:flex-row md:overflow-hidden">
      {/* Map */}
      <div className="relative h-[70vh] min-h-[480px] flex-none md:h-auto md:min-h-0 md:flex-1">
        <div ref={mapEl} className="w-full h-full" />

        {/* Map legend */}
        <div className="absolute top-4 left-4 z-[1000] p-3 rounded-xl border border-[var(--ocean-border)] bg-[var(--ocean-card)]/95 backdrop-blur-sm">
          <p className="text-[10px] font-mono text-[var(--ocean-text-muted)] mb-2 uppercase tracking-widest">Risk Legend</p>
          {([['CRITICAL','#ff4455'],['HIGH','#ff8800'],['MEDIUM','#ffaa00'],['LOW','#00ff88']] as const).map(([r, c]) => (
            <div key={r} className="flex items-center gap-2 py-0.5">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: c }} />
              <span className="text-xs text-[var(--ocean-text-dim)]">{r}</span>
            </div>
          ))}
          <div className="mt-2 pt-2 border-t border-[var(--ocean-border)]">
            <p className="text-[10px] text-[var(--ocean-text-muted)]">{HOTSPOTS.length} hotspots tracked</p>
          </div>
        </div>

        {/* Selected hotspot panel */}
        {selected && (
          <div className="absolute bottom-4 left-4 right-4 md:right-auto md:w-80 z-[1000] p-4 rounded-xl border border-[var(--ocean-border)] bg-[var(--ocean-card)]/98 backdrop-blur-sm">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-sm font-bold text-[var(--ocean-text)]">{selected.name}</h3>
                <p className="text-xs text-[var(--ocean-text-dim)]">{selected.id}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={selected.risk === 'CRITICAL' ? 'red' : selected.risk === 'HIGH' ? 'amber' : 'cyan'} size="xs">
                  {selected.risk}
                </Badge>
                <button
                  type="button"
                  aria-label="Close hotspot details"
                  onClick={() => setSelected(null)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded text-[var(--ocean-text-muted)] hover:bg-white/5 hover:text-[var(--ocean-text)] md:h-9 md:w-9"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { l: 'Detections', v: selected.detections },
                { l: 'Est. Mass',  v: `${selected.mass} kg` },
                { l: 'Radius',     v: `${(selected.radius / 1000).toFixed(0)} km` },
              ].map(({ l, v }) => (
                <div key={l} className="text-center p-2 rounded-lg bg-[var(--ocean-surface)] border border-[var(--ocean-border)]">
                  <p className="text-xs font-bold text-[var(--ocean-text)]">{v}</p>
                  <p className="text-[10px] text-[var(--ocean-text-muted)]">{l}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--ocean-text-dim)]">
                Trend: <span className={selected.trend === 'INCREASING' ? 'text-red-400' : selected.trend === 'DECREASING' ? 'text-green-400' : 'text-amber-400'}>
                  <span className="inline-flex items-center gap-1">
                    <SelectedTrendIcon className="h-3.5 w-3.5" aria-hidden="true" /> {selected.trend}
                  </span>
                </span>
              </span>
              <Badge variant={selected.status === 'CLEANING' ? 'green' : 'outline'} size="xs">{selected.status}</Badge>
            </div>
            <Button
              variant="primary"
              size="sm"
              fullWidth
              className="mt-3"
              iconRight={<ArrowRight className="h-3.5 w-3.5" />}
              onClick={() => navigate('/cleanup')}
            >
              Create Cleanup Mission
            </Button>
          </div>
        )}
      </div>

      {/* Sidebar list */}
      <div className="flex h-[55vh] w-full flex-shrink-0 flex-col overflow-hidden border-t border-[var(--ocean-border)] bg-[var(--ocean-surface)] md:h-auto md:w-72 md:border-l md:border-t-0">
        <div className="p-4 border-b border-[var(--ocean-border)]">
          <p className="text-xs font-semibold text-[var(--ocean-text)] mb-3">Active Hotspots</p>
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as any)}
            className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-card)] text-[var(--ocean-text)] focus:border-cyan-500 outline-none"
          >
            <option value="ALL">All Risk Levels</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {filtered.map(hs => (
            <button
              key={hs.id}
              aria-pressed={selected?.id === hs.id}
              onClick={() => {
                setSelected(hs);
                mapRef.current?.flyTo([hs.lat, hs.lng], 6, { duration: 1.2 });
              }}
              className={`w-full text-left p-3 rounded-lg border transition-all ${
                selected?.id === hs.id
                  ? 'border-cyan-500/60 bg-cyan-500/10'
                  : 'border-[var(--ocean-border)] hover:border-cyan-500/30 bg-[var(--ocean-card)]'
              }`}
            >
              <div className="flex items-start justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: riskColor(hs.risk) }} />
                  <span className="text-xs font-semibold text-[var(--ocean-text)] leading-tight">{hs.name}</span>
                </div>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-[var(--ocean-text-muted)]">{hs.detections} detections · {hs.mass} kg</span>
                <Badge variant={hs.risk === 'CRITICAL' ? 'red' : hs.risk === 'HIGH' ? 'amber' : 'cyan'} size="xs">
                  {hs.risk}
                </Badge>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
