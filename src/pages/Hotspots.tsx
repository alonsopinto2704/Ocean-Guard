import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowRight, ChevronDown, Layers, Minus, RefreshCw, TrendingDown, TrendingUp, X } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { hotspotsApi } from '../lib/api';
import type { RiskLevel } from '../types';

export interface HotspotItem {
  id: string;
  name: string;
  lat: number;
  lng: number;
  risk: RiskLevel;
  detections: number;
  mass: number;
  status: string;
  radius: number;
  trend: 'INCREASING' | 'STABLE' | 'DECREASING';
  dominantClass?: string;
  zoneId?: string;
}

const FALLBACK_HOTSPOTS: HotspotItem[] = [
  { id: 'HS-01', name: 'Gulf of Kachchh',     lat: 22.45, lng: 69.15, risk: 'CRITICAL', detections: 312, mass: 1840, status: 'ACTIVE',    radius: 38000, trend: 'INCREASING', dominantClass: 'Fishing Net', zoneId: 'Z-GUJ' },
  { id: 'HS-02', name: 'Mumbai Coast',        lat: 18.95, lng: 72.80, risk: 'HIGH',     detections: 204, mass: 982,  status: 'ACTIVE',    radius: 30000, trend: 'INCREASING', dominantClass: 'Mixed Waste', zoneId: 'Z-MUM' },
  { id: 'HS-03', name: 'Konkan Coast',        lat: 16.70, lng: 73.25, risk: 'HIGH',     detections: 176, mass: 760,  status: 'ACTIVE',    radius: 26000, trend: 'STABLE',     dominantClass: 'Plastic Bottle', zoneId: 'Z-KON' },
  { id: 'HS-04', name: 'Goa Coast',           lat: 15.35, lng: 73.75, risk: 'MEDIUM',   detections: 98,  mass: 410,  status: 'MONITORED', radius: 20000, trend: 'STABLE',     dominantClass: 'Plastic Bag', zoneId: 'Z-GOA' },
  { id: 'HS-05', name: 'Mangaluru Coast',     lat: 12.85, lng: 74.80, risk: 'HIGH',     detections: 120, mass: 510,  status: 'ACTIVE',    radius: 22000, trend: 'INCREASING', dominantClass: 'Rope', zoneId: 'Z-MNG' },
  { id: 'HS-06', name: 'Gulf of Mannar',      lat: 8.80,  lng: 78.75, risk: 'HIGH',     detections: 188, mass: 860,  status: 'ACTIVE',    radius: 28000, trend: 'STABLE',     dominantClass: 'Fishing Net', zoneId: 'Z-MAN' },
  { id: 'HS-07', name: 'Chennai Coast',       lat: 13.08, lng: 80.35, risk: 'MEDIUM',   detections: 74,  mass: 290,  status: 'MONITORED', radius: 18000, trend: 'DECREASING', dominantClass: 'Plastic Bottle', zoneId: 'Z-CHE' },
  { id: 'HS-08', name: 'Odisha Coast',        lat: 19.95, lng: 86.40, risk: 'CRITICAL', detections: 162, mass: 740,  status: 'ACTIVE',    radius: 32000, trend: 'INCREASING', dominantClass: 'Mixed Waste', zoneId: 'Z-ODI' },
  { id: 'HS-09', name: 'Sundarbans',          lat: 21.80, lng: 88.90, risk: 'MEDIUM',   detections: 148, mass: 624,  status: 'CLEANING',  radius: 24000, trend: 'STABLE',     dominantClass: 'Plastic Bag', zoneId: 'Z-SUN' },
  { id: 'HS-10', name: 'Lakshadweep Region',  lat: 10.55, lng: 72.60, risk: 'LOW',      detections: 42,  mass: 134,  status: 'MONITORED', radius: 16000, trend: 'DECREASING', dominantClass: 'Plastic Bottle', zoneId: 'Z-LAK' },
];

/** Map marker/circle color for each risk tier (used in HTML + SVG contexts). */
function riskColor(risk: RiskLevel) {
  if (risk === 'CRITICAL') return '#ff4455';
  if (risk === 'HIGH')     return '#ff8800';
  if (risk === 'MEDIUM')   return '#eab308';
  return '#10b981';
}

type BasemapStyle = 'english' | 'street' | 'ocean' | 'satellite';

/** Leaflet map of pollution hotspots with pulsing risk-colored markers,
 *  a switchable basemap, a risk filter, and a detail panel that can hand off
 *  to cleanup planning. Falls back to a static dataset if the API fails. */
export default function Hotspots() {
  const navigate = useNavigate();
  const mapRef       = useRef<L.Map | null>(null);
  const mapEl        = useRef<HTMLDivElement>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const refLayerRef  = useRef<L.TileLayer | null>(null);
  const markersGroup = useRef<L.LayerGroup | null>(null);

  const [hotspots, setHotspots] = useState<HotspotItem[]>(FALLBACK_HOTSPOTS);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState<HotspotItem | null>(null);
  const [filter, setFilter]     = useState<RiskLevel | 'ALL'>('ALL');
  const [basemap, setBasemap]   = useState<BasemapStyle>('english');
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [tileError, setTileError] = useState(false);

  // Fetch hotspots from the API; on success map server fields (riskLevel/
  // detectionCount/estimatedMassKg) onto the local HotspotItem shape.
  const loadHotspots = async () => {
    setLoading(true);
    try {
      const res = await hotspotsApi.list();
      if (res && Array.isArray(res.hotspots) && res.hotspots.length > 0) {
        const mapped: HotspotItem[] = res.hotspots.map((h: any) => ({
          id: h.id,
          name: h.name,
          lat: h.lat,
          lng: h.lng,
          risk: (h.risk || h.riskLevel || 'MEDIUM') as RiskLevel,
          detections: h.detectionCount ?? h.detections ?? 0,
          mass: h.estimatedMassKg ?? h.mass ?? 0,
          status: h.status || 'ACTIVE',
          radius: h.radius || 25000,
          trend: h.trend || 'STABLE',
          dominantClass: h.dominantClass,
          zoneId: h.zoneId,
        }));
        setHotspots(mapped);
      }
    } catch {
      // Keep fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHotspots();
  }, []);

  // Initialize Map
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;

    const map = L.map(mapEl.current, {
      center: [18.8, 79.5],
      zoom: 5,
      zoomControl: false,
      attributionControl: false,
      minZoom: 4,
      maxZoom: 14,
    });

    const tileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
      attribution: '© Esri, HERE, Garmin, USGS',
    });

    tileLayer.on('tileerror', () => {
      setTileError(true);
    });

    tileLayer.addTo(map);
    tileLayerRef.current = tileLayer;

    // Create layer group for dynamic markers
    markersGroup.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersGroup.current = null;
    };
  }, []);

  // Redraw markers + translucent radar circles whenever data or filter changes.
  useEffect(() => {
    if (!mapRef.current || !markersGroup.current) return;
    const group = markersGroup.current;
    group.clearLayers();

    const itemsToDisplay = filter === 'ALL' ? hotspots : hotspots.filter(h => h.risk === filter);

    itemsToDisplay.forEach(hs => {
      const color = riskColor(hs.risk);

      // Translucent radar/glow circle on the water
      L.circle([hs.lat, hs.lng], {
        radius: hs.radius,
        color,
        fillColor: color,
        fillOpacity: 0.14,
        weight: 1.5,
        opacity: 0.5,
      }).addTo(group);

      // DivIcon with title badge and glowing pulsing pin
      const markerHtml = `
        <div style="display: flex; flex-direction: column; align-items: center; cursor: pointer; pointer-events: auto;">
          <div style="
            background: #0f172a;
            color: #f8fafc;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: -0.01em;
            padding: 2.5px 8px;
            border-radius: 6px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            white-space: nowrap;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.45);
            margin-bottom: 4px;
            transition: transform 0.15s ease, background 0.15s ease;
          " onmouseover="this.style.transform='scale(1.05)'; this.style.background='#1e293b';" onmouseout="this.style.transform='scale(1)'; this.style.background='#0f172a';">
            ${hs.name}
          </div>
          <div style="position: relative; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;">
            <div class="hotspot-pulse-ring" style="
              position: absolute;
              inset: 0;
              border-radius: 50%;
              background: ${color}35;
              border: 1.5px solid ${color}80;
            "></div>
            <div style="
              position: relative;
              z-index: 2;
              width: 14px;
              height: 14px;
              border-radius: 50%;
              background: ${color};
              border: 2.5px solid #ffffff;
              box-shadow: 0 0 12px ${color}, 0 2px 5px rgba(0,0,0,0.4);
            "></div>
          </div>
        </div>
      `;

      const icon = L.divIcon({
        html: markerHtml,
        className: '!bg-transparent !border-0',
        iconSize: [120, 56],
        iconAnchor: [60, 42],
      });

      L.marker([hs.lat, hs.lng], { icon })
        .addTo(group)
        .on('click', () => {
          setSelected(hs);
          mapRef.current?.flyTo([hs.lat, hs.lng], 6.5, { duration: 1 });
        });
    });
  }, [hotspots, filter]);

  // Swap the Esri tile layer (ocean style also adds a reference overlay) and
  // reset the tile-error banner.
  const changeBasemap = (style: BasemapStyle) => {
    if (!mapRef.current) return;
    setBasemap(style);
    setShowLayerMenu(false);
    setTileError(false);

    if (tileLayerRef.current) {
      mapRef.current.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }
    if (refLayerRef.current) {
      mapRef.current.removeLayer(refLayerRef.current);
      refLayerRef.current = null;
    }

    let url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';
    let maxZoom = 18;

    if (style === 'street') {
      url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
    } else if (style === 'ocean') {
      url = 'https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}';
      maxZoom = 13;
      refLayerRef.current = L.tileLayer('https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 13,
      }).addTo(mapRef.current);
    } else if (style === 'satellite') {
      url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    }

    tileLayerRef.current = L.tileLayer(url, { maxZoom }).addTo(mapRef.current);
    tileLayerRef.current.on('tileerror', () => {
      setTileError(true);
    });
  };

  const filtered = filter === 'ALL' ? hotspots : hotspots.filter(h => h.risk === filter);
  const SelectedTrendIcon = selected?.trend === 'INCREASING'
    ? TrendingUp
    : selected?.trend === 'DECREASING'
      ? TrendingDown
      : Minus;

  // Hand the selected hotspot to /cleanup via router state for mission prefill.
  const handleCreateCleanupMission = () => {
    if (!selected) return;
    // Pass selected hotspot into cleanup planning with state
    navigate('/cleanup', {
      state: {
        sourceHotspot: {
          id: selected.id,
          name: selected.name,
          lat: selected.lat,
          lng: selected.lng,
          risk: selected.risk,
          detections: selected.detections,
          mass: selected.mass,
          dominantClass: selected.dominantClass,
          zoneId: selected.zoneId,
        },
      },
    });
  };

  return (
    <div className="relative flex min-h-[calc(100dvh-64px)] flex-col overflow-visible md:h-[calc(100dvh-64px)] md:min-h-0 md:flex-row md:overflow-hidden bg-[#0a101d]">
      <style>{`
        @keyframes hotspot-pulse {
          0% { transform: scale(0.85); opacity: 0.85; }
          50% { transform: scale(1.65); opacity: 0.25; }
          100% { transform: scale(2.4); opacity: 0; }
        }
        .hotspot-pulse-ring {
          animation: hotspot-pulse 2.2s cubic-bezier(0.15, 0.7, 0.4, 1) infinite;
        }
        .leaflet-container {
          background-color: #d6e8ef !important;
        }
      `}</style>

      {/* Map Area */}
      <div className="relative h-[70vh] min-h-[480px] flex-none md:h-auto md:min-h-0 md:flex-1">
        <div ref={mapEl} className="w-full h-full" />

        {/* Tile warning banner if remote basemap failed */}
        {tileError && (
          <div className="absolute top-16 left-4 z-[1000] p-2.5 rounded-lg border border-amber-500/30 bg-[#0c1322]/95 backdrop-blur-md text-xs text-amber-300 flex items-center gap-2">
            <span>External map tile server is rate-limited. Vectors and clustering remain active.</span>
            <button
              onClick={() => changeBasemap('english')}
              className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200"
            >
              Retry
            </button>
          </div>
        )}

        {/* Top-Left Risk Legend Overlay */}
        <div className="absolute top-4 left-4 z-[1000] p-3.5 rounded-xl border border-white/10 bg-[#0c1322]/92 backdrop-blur-md shadow-2xl min-w-[135px]">
          <p className="text-[10px] font-mono font-bold text-[#708096] mb-2.5 uppercase tracking-widest">
            RISK LEGEND
          </p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ff4455] shadow-[0_0_8px_#ff4455]" />
              <span className="text-[11px] font-semibold tracking-wide text-[#cbd5e1]">CRITICAL</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ff8800] shadow-[0_0_8px_#ff8800]" />
              <span className="text-[11px] font-semibold tracking-wide text-[#cbd5e1]">HIGH</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#eab308] shadow-[0_0_8px_#eab308]" />
              <span className="text-[11px] font-semibold tracking-wide text-[#cbd5e1]">MEDIUM</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#10b981] shadow-[0_0_8px_#10b981]" />
              <span className="text-[11px] font-semibold tracking-wide text-[#cbd5e1]">LOW</span>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between">
            <p className="text-[10px] text-[#94a3b8] font-medium">
              {filtered.length} of {hotspots.length} shown
            </p>
            <button
              onClick={loadHotspots}
              title="Refresh Hotspot Telemetry"
              className="text-[#94a3b8] hover:text-cyan-400 transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Top-Right Clean Basemap Selector Toggle */}
        <div className="absolute top-4 right-4 z-[1000]">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowLayerMenu(!showLayerMenu)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-white/15 bg-[#0c1322]/90 text-white backdrop-blur-md hover:bg-[#162035] hover:border-cyan-500/50 shadow-lg transition-all"
            >
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>Map Layer</span>
            </button>

            {showLayerMenu && (
              <div className="absolute right-0 mt-1.5 w-44 rounded-xl border border-white/15 bg-[#0c1322]/95 backdrop-blur-md shadow-2xl p-1.5 space-y-1">
                {[
                  { id: 'english', label: 'English Topo Map' },
                  { id: 'street', label: 'English Street Map' },
                  { id: 'ocean', label: 'Ocean Bathymetric' },
                  { id: 'satellite', label: 'Satellite Imagery' },
                ].map(layer => (
                  <button
                    key={layer.id}
                    type="button"
                    onClick={() => changeBasemap(layer.id as BasemapStyle)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      basemap === layer.id
                        ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                        : 'text-[#cbd5e1] hover:bg-white/5'
                    }`}
                  >
                    {layer.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Bottom-Left Compass & Scale Ruler */}
        <div className="absolute bottom-5 left-5 z-[1000] flex items-end gap-5 pointer-events-none select-none">
          {/* North Compass */}
          <div className="flex flex-col items-center">
            <span className="text-[12px] font-bold text-[#334155] tracking-wider font-mono">N</span>
            <svg className="w-5 h-6 text-[#334155]" viewBox="0 0 24 32" fill="currentColor">
              <path d="M12 2 L20 28 L12 22 L4 28 Z" />
            </svg>
          </div>
          {/* Scale Ruler */}
          <div className="flex flex-col text-[10px] font-mono text-[#475569]">
            <div className="flex justify-between w-48 px-0.5 mb-1 text-[9px] font-semibold">
              <span>0</span>
              <span>250</span>
              <span>500</span>
              <span>750</span>
              <span>1,000 km</span>
            </div>
            <div className="w-48 h-1.5 border border-[#475569] flex">
              <div className="w-1/4 h-full bg-[#475569]" />
              <div className="w-1/4 h-full bg-transparent" />
              <div className="w-1/4 h-full bg-[#475569]" />
              <div className="w-1/4 h-full bg-transparent" />
            </div>
          </div>
        </div>

        {/* Selected Hotspot Detail Panel */}
        {selected && (
          <div className="absolute bottom-4 right-4 md:right-auto md:left-4 md:bottom-20 z-[1000] w-80 p-4 rounded-xl border border-white/15 bg-[#0b1322]/98 backdrop-blur-md shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-sm font-bold text-white">{selected.name}</h3>
                <p className="text-xs text-[#94a3b8] font-mono">{selected.id} · Coastal Waters, India</p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="px-2 py-0.5 text-[10px] font-bold uppercase rounded border"
                  style={{
                    color: riskColor(selected.risk),
                    borderColor: `${riskColor(selected.risk)}88`,
                    backgroundColor: `${riskColor(selected.risk)}15`,
                  }}
                >
                  {selected.risk}
                </span>
                <button
                  type="button"
                  aria-label="Close hotspot details"
                  onClick={() => setSelected(null)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#94a3b8] hover:bg-white/10 hover:text-white transition-colors"
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
                <div key={l} className="text-center p-2 rounded-lg bg-[#111c30] border border-white/10">
                  <p className="text-xs font-bold text-white">{v}</p>
                  <p className="text-[10px] text-[#94a3b8]">{l}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between text-xs mb-3">
              <span className="text-[#94a3b8]">
                Trend:{' '}
                <span className={selected.trend === 'INCREASING' ? 'text-red-400 font-semibold' : selected.trend === 'DECREASING' ? 'text-green-400 font-semibold' : 'text-amber-400 font-semibold'}>
                  <span className="inline-flex items-center gap-1">
                    <SelectedTrendIcon className="h-3.5 w-3.5" aria-hidden="true" /> {selected.trend}
                  </span>
                </span>
              </span>
              <Badge variant={selected.status === 'CLEANING' ? 'green' : 'outline'} size="xs">
                {selected.status}
              </Badge>
            </div>

            {selected.dominantClass && (
              <div className="mb-3 p-2 rounded bg-[#111c30] border border-white/10 text-xs">
                <span className="text-[10px] text-[#94a3b8] uppercase block">Dominant Debris Class</span>
                <span className="text-cyan-300 font-medium">{selected.dominantClass}</span>
              </div>
            )}

            <Button
              variant="primary"
              size="sm"
              fullWidth
              iconRight={<ArrowRight className="h-3.5 w-3.5" />}
              onClick={handleCreateCleanupMission}
            >
              Plan Cleanup Mission
            </Button>
          </div>
        )}
      </div>

      {/* Right Sidebar List */}
      <div className="flex h-[50vh] w-full flex-shrink-0 flex-col overflow-hidden border-t border-[#1e293b] bg-[#0c1322] md:h-auto md:w-80 md:border-l md:border-t-0">
        <div className="p-4 border-b border-[#1e293b]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-white tracking-wide">Active Hotspots</p>
            <Badge variant="outline" size="xs">{filtered.length} visible</Badge>
          </div>
          <div className="relative">
            <select
              value={filter}
              onChange={e => setFilter(e.target.value as any)}
              className="w-full appearance-none px-3.5 py-2 text-xs font-medium rounded-lg border border-[#26354a] bg-[#111a2e] text-[#f1f5f9] focus:border-cyan-400 outline-none pr-8 cursor-pointer shadow-sm transition-colors"
            >
              <option value="ALL">All Risk Levels</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94a3b8] pointer-events-none" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {filtered.map(hs => (
            <button
              key={hs.id}
              type="button"
              aria-pressed={selected?.id === hs.id}
              onClick={() => {
                setSelected(hs);
                mapRef.current?.flyTo([hs.lat, hs.lng], 6.5, { duration: 1.2 });
              }}
              className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer ${
                selected?.id === hs.id
                  ? 'border-cyan-400 bg-cyan-950/40 shadow-[0_0_15px_rgba(6,182,212,0.15)] ring-1 ring-cyan-400/50'
                  : 'border-[#1b2638] hover:border-cyan-500/40 bg-[#0f172a]/90 hover:bg-[#131d33]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0 pr-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{
                      background: riskColor(hs.risk),
                      boxShadow: `0 0 8px ${riskColor(hs.risk)}`,
                    }}
                  />
                  <div className="min-w-0">
                    <span className="block text-[13px] font-bold text-white leading-tight truncate">
                      {hs.name}
                    </span>
                    <span className="block text-[11px] text-[#8696a7] mt-0.5">
                      {hs.detections} detections · {hs.mass} kg
                    </span>
                  </div>
                </div>

                <span
                  className="flex-shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md border"
                  style={{
                    borderColor: `${riskColor(hs.risk)}88`,
                    color: riskColor(hs.risk),
                    backgroundColor: `${riskColor(hs.risk)}15`,
                  }}
                >
                  {hs.risk}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
