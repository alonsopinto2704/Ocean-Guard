import React, { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Navbar } from './Navbar';
import { SkipLink } from '../ui/SkipLink';

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  '/portal':     { title: 'Public 3D Portal',     subtitle: 'Interactive 3D marine debris visualization' },
  '/command':    { title: 'Command Center',        subtitle: 'Real-time operations overview' },
  '/monitoring': { title: 'Live Monitoring',       subtitle: 'Active camera feeds & AI detection' },
  '/detections': { title: 'Debris Detections',    subtitle: 'All detected marine debris events' },
  '/hotspots':   { title: 'Pollution Hotspots',   subtitle: 'Pollution concentration analysis' },
  '/ai':         { title: 'Environmental AI',     subtitle: 'AI analytics & environmental intelligence' },
  '/cleanup':    { title: 'Cleanup Missions',     subtitle: 'Response planning & field dispatch' },
  '/data':       { title: 'Data & UAV Ingestion', subtitle: 'Upload footage and trigger AI processing' },
  '/sensors':    { title: 'Sensors & Fleet',      subtitle: 'Device status & sensor network' },
  '/ai-models':  { title: 'AI Model Registry',    subtitle: 'Model versions, metrics & deployment' },
  '/reports':    { title: 'Reports & Export',     subtitle: 'Generate and download mission reports' },
  '/admin':      { title: 'Admin Governance',     subtitle: 'Users, roles & system configuration' },
  '/settings':   { title: 'System Settings',      subtitle: 'Platform configuration & preferences' },
};

export function AppLayout() {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const meta = PAGE_META[location.pathname] ?? PAGE_META[
    Object.keys(PAGE_META).find(k => location.pathname.startsWith(k)) ?? '/command'
  ] ?? { title: 'OceanGuard AI', subtitle: '' };

  useEffect(() => {
    setMobileNavOpen(false);
    mainRef.current?.scrollTo({ top: 0, left: 0 });
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [mobileNavOpen]);

  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--ocean-bg)]">
      <SkipLink />
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <Sidebar mobileOpen={mobileNavOpen} onNavigate={() => setMobileNavOpen(false)} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Navbar
          title={meta.title}
          subtitle={meta.subtitle}
          navigationOpen={mobileNavOpen}
          onOpenNavigation={() => setMobileNavOpen(true)}
        />
        <main
          ref={mainRef}
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth outline-none"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
