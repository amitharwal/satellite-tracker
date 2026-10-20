import { satelliteStatus } from '@/state';
import { useStore } from '@/ui/useStore';

const REGIMES = [
  { label: 'LEO', color: 'rgb(102 232 250)' },
  { label: 'MEO', color: 'rgb(252 212 77)' },
  { label: 'GEO', color: 'rgb(245 115 181)' },
  { label: 'HEO', color: 'rgb(166 140 250)' },
  { label: 'Other', color: 'rgb(212 212 217)' },
];

export function SatelliteStatusBar() {
  const status = useStore(satelliteStatus);
  return (
    // Hidden on phones, where the time controls need the bottom edge.
    <footer className="pointer-events-none absolute bottom-4 left-4 hidden space-y-1 text-xs text-neutral-300 sm:block">
      <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Orbit regime colours">
        {REGIMES.map((r) => (
          <li key={r.label} className="flex items-center gap-1.5">
            <span className="inline-block size-2 rounded-full" style={{ background: r.color }} />
            {r.label}
          </li>
        ))}
      </ul>
      <p role="status">
        {status.kind === 'loading' && 'Loading satellites…'}
        {status.kind === 'ready' &&
          `${status.count.toLocaleString()} satellites · data ${new Date(status.generatedAt).toUTCString()}`}
        {status.kind === 'error' && (
          <span className="text-destructive">Satellites unavailable: {status.message}</span>
        )}
      </p>
    </footer>
  );
}
