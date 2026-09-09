import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { useAuth } from '../../context/AuthContext';
import { useSystem } from '../../context/SystemContext';
import { LiveBadge, AdminBadge, CountBadge, ThreeDBadge } from '../ui/Badge';
import { PanelLeftClose, PanelLeftOpen, Waves, X } from 'lucide-react';

/* ─── Mini 3D globe for sector 00 ────────────────────────────────────────── */
function MiniGlobe() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const angleRef = useRef(0);
  const animRef  = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 36, H = 36, cx = W / 2, cy = H / 2, R = 14;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      // Outer glow ring
      const grad = ctx.createRadialGradient(cx, cy, R - 4, cx, cy, R + 4);
      grad.addColorStop(0, 'rgba(0,212,255,0.3)');
      grad.addColorStop(1, 'rgba(0,212,255,0)');
      ctx.beginPath();
      ctx.arc(cx, cy, R + 2, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // Base globe
      const globe = ctx.createRadialGradient(cx - 4, cy - 4, 2, cx, cy, R);
      globe.addColorStop(0, '#0d3a5a');
      globe.addColorStop(1, '#060e1c');
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = globe;
      ctx.fill();

      // Globe border
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,212,255,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Latitude lines
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = 'rgba(0,212,255,0.15)';
      ctx.lineWidth = 0.5;
      for (let lat = -60; lat <= 60; lat += 30) {
        const y = cy + (R * Math.sin((lat * Math.PI) / 180));
        const rx = R * Math.cos((lat * Math.PI) / 180);
        ctx.beginPath();
        ctx.ellipse(cx, y, rx, rx * 0.25, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Longitude lines (rotating)
      const a = angleRef.current;
      for (let lon = 0; lon < 180; lon += 45) {
        const offset = ((lon + a) % 180) / 90 - 1; // -1 to 1
        const rx = R * Math.abs(offset);
        ctx.beginPath();
        ctx.ellipse(cx + R * offset * 0.0, cy, rx * 0.15, R, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // Debris dot
      const dx = cx + R * 0.4 * Math.cos(a * Math.PI / 180 * 2);
      const dy = cy + R * 0.2 * Math.sin(a * Math.PI / 180 * 1.5);
      ctx.beginPath();
      ctx.arc(dx, dy, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#ff4455';
      ctx.fill();

      angleRef.current = (a + 0.5) % 360;
      if (!reduceMotion) animRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return <canvas ref={canvasRef} width={36} height={36} aria-hidden="true" className="rounded-full" />;
}

/* ─── Nav Item Definition ────────────────────────────────────────────────── */
interface NavItem {
  num: string;
  label: string;
  path: string;
  badge?: 'live' | 'admin' | 'count' | 'fraction' | '3d';
  badgeCount?: number | string;
  adminOnly?: boolean;
  special?: '3d-globe';
}

interface SidebarProps {
  mobileOpen?: boolean;
  onNavigate?: () => void;
}

/* ─── Sidebar ─────────────────────────────────────────────────────────────── */
export function Sidebar({ mobileOpen = false, onNavigate }: SidebarProps) {
  const { user } = useAuth();
  const { summary } = useSystem();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const updateViewport = () => setIsMobile(query.matches);
    updateViewport();
    query.addEventListener('change', updateViewport);
    return () => query.removeEventListener('change', updateViewport);
  }, []);

  const NAV: NavItem[] = [
    { num: '00', label: 'Public 3D Portal',     path: '/portal',   badge: '3d',       special: '3d-globe' },
    { num: '01', label: 'Command Center',        path: '/command' },
    { num: '02', label: 'Live Monitoring 3D',    path: '/monitoring', badge: '3d' },
    { num: '03', label: 'Debris Detections',    path: '/detections', badge: 'count', badgeCount: summary?.debrisDetected ?? 1284 },
    { num: '04', label: 'Pollution Hotspots',   path: '/hotspots',   badge: 'count', badgeCount: summary?.activeHotspots ?? 14 },
    { num: '05', label: 'Environmental AI',     path: '/ai' },
    { num: '06', label: 'Cleanup Missions',     path: '/cleanup',    badge: 'count', badgeCount: summary?.cleanupMissions ?? 2 },
    { num: '07', label: 'Data & UAV Ingestion', path: '/data' },
    { num: '08', label: 'Sensors & Fleet',      path: '/sensors',    badge: 'fraction', badgeCount: summary?.camerasOnline ?? '14/15' },
    { num: '09', label: 'AI Model Registry',    path: '/ai-models' },
    { num: '10', label: 'Reports & Export',     path: '/reports' },
    { num: '11', label: 'Admin Governance',     path: '/admin',     badge: 'admin', adminOnly: true },
    { num: '12', label: 'System Settings',      path: '/settings' },
  ];

  const visibleNav = NAV.filter(item => !item.adminOnly || user?.role === 'ADMIN');

  return (
    <aside
      id="primary-navigation"
      aria-label="Primary navigation"
      aria-hidden={isMobile && !mobileOpen}
      inert={isMobile && !mobileOpen ? true : undefined}
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex h-dvh w-[min(86vw,300px)] flex-col flex-shrink-0 transition-transform duration-300 md:static md:z-auto md:h-full md:translate-x-0 md:transition-[width]',
        'border-r border-[var(--ocean-border)]',
        'bg-[var(--ocean-surface)]',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
        collapsed ? 'md:w-16' : 'md:w-[260px]'
      )}
      style={{ background: 'linear-gradient(180deg, #080e1a 0%, #0e131f 100%)' }}
    >
      {/* ── Logo / Header ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-[#3a4a46]/30">
        <div className="relative flex-shrink-0">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-[#00f5d4]/20 to-[#4cd6fb]/20 border border-[#00f5d4]/40 flex items-center justify-center shadow-[0_0_12px_rgba(0,245,212,0.25)]">
            <Waves className="h-[18px] w-[18px] text-[#00f5d4]" aria-hidden="true" />
          </div>
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#00f5d4] shadow-[0_0_6px_#00f5d4] pulse-dot" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="font-headline-sm text-xs font-bold text-[#d7fff3] leading-none tracking-wider uppercase">
              OceanGuard
            </div>
            <div className="text-[9px] text-[#00f5d4] font-mono mt-1 tracking-widest uppercase">
              SYS_VER 4.8.2
            </div>
          </div>
        )}
        <button
          type="button"
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          onClick={() => setCollapsed(c => !c)}
          className={cn(
            'ml-auto hidden h-9 w-9 items-center justify-center rounded text-[#83948f] hover:bg-white/5 hover:text-[#00f5d4] transition-colors cursor-pointer md:inline-flex',
            collapsed && 'mx-auto'
          )}
        >
          {collapsed
            ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            : <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          }
        </button>
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onNavigate}
          className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded text-[#b9cac4] transition-colors hover:bg-white/5 hover:text-[#00f5d4] md:hidden"
        >
          <X className="h-[18px] w-[18px]" aria-hidden="true" />
        </button>
      </div>

      {/* ── Navigation Matrix Label ──────────────────────────────────────── */}
      {!collapsed && (
        <div className="px-4 pt-4 pb-2">
          <div className="font-telemetry-tag text-[10px] text-[#00f5d4] tracking-[0.2em] uppercase font-bold">
            Navigation Matrix
          </div>
          <div className="text-[10px] font-mono text-[#83948f] tracking-wider mt-0.5 uppercase">
            {visibleNav.length} Active Sectors
          </div>
        </div>
      )}

      {/* ── Nav Items ────────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 scrollbar-thin">
        {visibleNav.map((item) => {
          const isActive = location.pathname === item.path ||
            (item.path !== '/' && location.pathname.startsWith(item.path));

          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              className={({ isActive: na }) => cn(
                'flex min-h-11 items-center gap-3 px-4 py-2.5 transition-all duration-150 relative group',
                'border-l-2',
                (isActive || na)
                  ? 'sidebar-active-item border-cyan-500 text-[var(--ocean-text)]'
                  : 'border-transparent text-[var(--ocean-text-dim)] hover:text-[var(--ocean-text)] hover:bg-white/3',
              )}
            >
              {/* Number */}
              {!collapsed && (
                <span className={cn(
                  'text-[11px] font-mono w-5 flex-shrink-0 text-right',
                  isActive ? 'text-cyan-500' : 'text-[var(--ocean-text-muted)]'
                )}>
                  {item.num}
                </span>
              )}

              {/* Special: mini globe for item 00 */}
              {item.special === '3d-globe' && !collapsed && (
                <span className="flex-shrink-0 opacity-90">
                  <MiniGlobe />
                </span>
              )}

              {/* Label */}
              {!collapsed && (
                <span className="flex-1 text-sm font-medium min-w-0 truncate">
                  {item.label}
                </span>
              )}

              {collapsed && (
                <span className="text-[10px] font-mono text-[var(--ocean-text-muted)] mx-auto">
                  {item.num}
                </span>
              )}

              {/* Badge */}
              {!collapsed && item.badge && (
                <span className="flex-shrink-0">
                  {item.badge === 'live'     && <LiveBadge />}
                  {item.badge === 'admin'    && <AdminBadge />}
                  {item.badge === '3d'       && <ThreeDBadge />}
                  {item.badge === 'count'    && item.badgeCount !== undefined && (
                    <CountBadge count={item.badgeCount} />
                  )}
                  {item.badge === 'fraction' && item.badgeCount !== undefined && (
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-slate-600/40 text-slate-300 bg-slate-800/60">
                      {item.badgeCount}
                    </span>
                  )}
                </span>
              )}

              {/* Active indicator line */}
              {isActive && (
                <span className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-cyan-500 rounded-l" />
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* ── User ────────────────────────────────────────────────────────── */}
      {!collapsed && user && (
        <div className="border-t border-[var(--ocean-border)] p-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-cyan-900/50 border border-cyan-700/40 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-cyan-300">
                {user.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-[var(--ocean-text)] truncate">
                {user.name}
              </div>
              <div className="text-[10px] text-[var(--ocean-text-dim)] truncate">
                {user.roleTitle}
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
