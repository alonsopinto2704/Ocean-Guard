import { useNavigate } from 'react-router-dom';
import { LogOut, Bell, Menu, Radio } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSystem } from '../../context/SystemContext';
import { Button } from '../ui/Button';

interface NavbarProps {
  title?: string;
  subtitle?: string;
  sampleMission?: boolean;
  navigationOpen?: boolean;
  onOpenNavigation?: () => void;
}

export function Navbar({ title, subtitle, sampleMission = false, navigationOpen = false, onOpenNavigation }: NavbarProps) {
  const { user, logout } = useAuth();
  const { health, isOnline, summary } = useSystem();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="h-16 flex items-center justify-between px-3 sm:px-4 lg:px-6 gap-2 sm:gap-4 flex-shrink-0 bg-[#080e1a]/90 backdrop-blur-2xl border-b border-[#00f5d4]/20 shadow-[0_4px_25px_rgba(0,245,212,0.04)] z-30">
      {/* Page Title & Sector breadcrumb */}
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
        <button
          type="button"
          aria-label="Open navigation"
          aria-controls="primary-navigation"
          aria-expanded={navigationOpen}
          onClick={onOpenNavigation}
          className="md:hidden inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded border border-[#3a4a46]/60 bg-[#161c28] text-[#d7fff3] transition-colors hover:border-[#00f5d4]/50 hover:text-[#00f5d4]"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2">
            <h1 className="font-headline-sm truncate text-xs font-bold uppercase tracking-wide text-[#d7fff3] sm:text-sm md:text-base">
              {title || 'OceanGuard Command'}
            </h1>
            <span className="hidden h-1.5 w-1.5 rounded-full bg-[#00f5d4] shadow-[0_0_8px_#00f5d4] animate-pulse sm:block" />
          </div>
          {subtitle && (
            <p className="font-telemetry-tag text-[10px] text-[#b9cac4]/80 uppercase tracking-widest truncate">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Center Tactical Telemetry (hidden on smaller screens) */}
      {!sampleMission && <div className="hidden 2xl:flex items-center gap-4 px-3 py-1.5 rounded bg-[#161c28]/80 border border-[#3a4a46]/40">
        <div className="flex flex-col text-left">
          <span className="font-telemetry-tag text-[9px] uppercase tracking-wider text-[#b9cac4]">
            Neural Confidence
          </span>
          <span className="font-data-mono-sm text-[11px] font-bold text-[#00f5d4]">
            ESPADA V1 · {health?.ai === 'RUNNING' ? 'ONLINE' : 'UNAVAILABLE'}
          </span>
        </div>
        <div className="h-6 w-px bg-[#3a4a46]/50" />
        <div className="flex flex-col text-left">
          <span className="font-telemetry-tag text-[9px] uppercase tracking-wider text-[#b9cac4]">
            Surveillance Fleet
          </span>
          <span className="font-data-mono-sm text-[11px] font-bold text-[#4cd6fb]">
            {summary?.camerasOnline ? `${summary.camerasOnline} CAMERAS ONLINE` : '7 COASTAL SECTORS'}
          </span>
        </div>
        <div className="h-6 w-px bg-[#3a4a46]/50" />
        <div className="flex flex-col text-left">
          <span className="font-telemetry-tag text-[9px] uppercase tracking-wider text-[#b9cac4]">
            Inference Engine
          </span>
          <span className="font-data-mono-sm text-[11px] font-bold text-[#dde2f3]">
            {health?.aiLatencyMs ? `${health.aiLatencyMs.toFixed(0)}MS` : health?.ai === 'RUNNING' ? 'ACTIVE' : 'STANDBY'} · {summary?.systemStatus ?? 'CHECKING'}
          </span>
        </div>
      </div>}

      {/* Right Action Bar */}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        {/* Connection status badge */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#161c28] border border-[#3a4a46]/60 font-mono text-[11px]">
          {sampleMission ? <span className="text-[#d9d9b5]">SAMPLE SCENE</span> : isOnline ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-[#00f5d4] shadow-[0_0_6px_#00f5d4]" />
              <span className="text-[#00f5d4] font-semibold">ONLINE</span>
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff5964]" />
              <span className="text-[#ff5964] font-semibold">OFFLINE</span>
            </>
          )}
        </div>

        {/* Tactical Quick Links */}
        <button
          onClick={() => navigate('/monitoring')}
          className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-data-mono-sm text-[11px] font-bold uppercase bg-gradient-to-r from-[#00f5d4] to-[#4cd6fb] text-[#00201a] hover:shadow-[0_0_20px_rgba(0,245,212,0.4)] transition-all cursor-pointer"
        >
          <Radio className="w-3.5 h-3.5 animate-pulse" />
          <span>3D view</span>
        </button>

        {/* Alerts Bell */}
        <button
          onClick={() => navigate('/command')}
          aria-label={`${summary?.activeAlerts ?? 0} active alerts`}
          className="relative inline-flex h-11 w-11 items-center justify-center rounded bg-[#161c28] border border-[#3a4a46]/60 text-[#b9cac4] hover:text-[#00f5d4] hover:border-[#00f5d4]/40 transition-colors cursor-pointer md:h-9 md:w-9"
          title="Active Alerts"
        >
          <Bell className="w-4 h-4" />
          {(summary?.activeAlerts ?? 0) > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff5964] text-white font-mono text-[10px] font-bold flex items-center justify-center shadow-[0_0_8px_rgba(255,89,100,0.6)]">
              {summary?.activeAlerts}
            </span>
          )}
        </button>

        {/* User Pill */}
        <div className="flex items-center gap-2.5 border-l border-[#3a4a46]/50 pl-1.5 sm:pl-2">
          <div className="hidden h-8 w-8 items-center justify-center rounded-full border border-[#00f5d4]/40 bg-gradient-to-tr from-[#00f5d4]/20 to-[#4cd6fb]/30 font-mono text-xs font-bold text-[#00f5d4] shadow-[0_0_10px_rgba(0,245,212,0.15)] sm:flex">
            {user?.name ? user.name.split(' ').map(n => n[0]).slice(0, 2).join('') : 'OG'}
          </div>
          <div className="hidden lg:flex flex-col text-left">
            <span className="text-xs font-semibold text-[#dde2f3] leading-none">
              {user?.name || 'Operator'}
            </span>
            <span className="font-telemetry-tag text-[9px] text-[#00f5d4] tracking-wider mt-0.5">
              {user?.role ? user.role.replace('_', ' ') : 'STATION LEAD'}
            </span>
          </div>
          <Button
            variant="ghost"
            size="xs"
            icon={<LogOut className="w-3.5 h-3.5" />}
            onClick={handleLogout}
            title="Sign Out"
            aria-label="Sign out"
            className="text-[#b9cac4] hover:text-[#ff5964]"
          />
        </div>
      </div>
    </header>
  );
}
