import { lazy, Suspense } from 'react';
const RunEventConsole = lazy(() => import('../components/replay/RunEventConsole'));
export default function MissionReplay() {
  return <main className="p-3 sm:p-4">
    <Suspense fallback={<p role="status">Loading mission archive…</p>}><RunEventConsole /></Suspense>
  </main>;
}
