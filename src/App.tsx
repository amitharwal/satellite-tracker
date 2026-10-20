import { useEffect } from 'react';
import { select } from '@/app/interaction';
import { rendererStatus, showStats } from '@/state';
import { Globe } from '@/ui/Globe';
import { HoverTooltip } from '@/ui/HoverTooltip';
import { InfoPanel } from '@/ui/InfoPanel';
import { SatelliteStatusBar } from '@/ui/SatelliteStatusBar';
import { SearchPanel } from '@/ui/SearchPanel';
import { StatsHud } from '@/ui/StatsHud';
import { TimeControls } from '@/ui/TimeControls';
import { useStore } from '@/ui/useStore';

export default function App() {
  const status = useStore(rendererStatus);
  const stats = useStore(showStats);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === '`' && !e.repeat) showStats.set((v) => !v);
      if (e.key === 'Escape') select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <main className="relative h-full overflow-hidden bg-black text-foreground">
      <Globe />
      <HoverTooltip />
      <div className="pointer-events-none absolute top-4 left-4 flex flex-col items-start gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Satellite Tracker</h1>
        <SearchPanel />
      </div>
      <div className="pointer-events-none absolute top-4 right-4 flex flex-col items-end gap-3">
        {stats && <StatsHud />}
        <InfoPanel />
      </div>
      <SatelliteStatusBar />
      <TimeControls />
      {status.kind === 'error' && (
        <p role="alert" className="absolute inset-x-4 top-1/2 text-center text-destructive">
          {status.message}
        </p>
      )}
      {status.kind === 'context-lost' && (
        <p role="status" className="absolute inset-x-4 top-1/2 text-center text-muted-foreground">
          Graphics context lost. Waiting for the browser to restore it…
        </p>
      )}
    </main>
  );
}
