import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Navbar } from './Navbar';
import { SkipLink } from '../ui/SkipLink';

// Page title/subtitle shown in the Navbar, keyed by route (prefix-matched below).
const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  '/portal':     { title: 'Public 3D Portal',     subtitle: 'Interactive 3D marine debris visualization' },
  '/command':    { title: 'Command Center',        subtitle: 'Real-time operations overview' },
  '/monitoring': { title: '3D Monitoring',       subtitle: 'Interactive sample coastal mission' },
  '/detections': { title: 'Debris Detections',    subtitle: 'All detected marine debris events' },
  '/hotspots':   { title: 'Pollution Hotspots',   subtitle: 'Pollution concentration analysis' },
  '/ai':         { title: 'Environmental AI',     subtitle: 'AI analytics & environmental intelligence' },
  '/cleanup':    { title: 'Cleanup Missions',     subtitle: 'Response planning & field dispatch' },
  '/data':       { title: 'Espada AI & Data',    subtitle: 'Model status, image analysis & reviewed learning' },
  '/sensors':    { title: 'Sensors & Fleet',      subtitle: 'Device status & sensor network' },
  '/reports':    { title: 'Reports & Export',     subtitle: 'Generate and download mission reports' },
  '/admin':      { title: 'Admin Governance',     subtitle: 'Users, roles & system configuration' },
  '/settings':   { title: 'System Settings',      subtitle: 'Platform configuration & preferences' },
};

/** Authenticated app shell: sidebar + navbar + scrollable <main> outlet.
 *  Closes the mobile drawer, scrolls to top, and moves focus to <main> on
 *  every route change (accessibility), with Escape closing the mobile nav. */
export function AppLayout() {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  // Exact route match first, then prefix match for child routes (e.g. /detections/:id).
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
          sampleMission={location.pathname === '/monitoring'}
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
