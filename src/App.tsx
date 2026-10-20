import { rendererStatus } from '@/state';
import { Globe } from '@/ui/Globe';
import { useStore } from '@/ui/useStore';

export default function App() {
  const status = useStore(rendererStatus);

  return (
    <main className="relative h-full overflow-hidden bg-black text-foreground">
      <Globe />
      <header className="pointer-events-none absolute top-4 left-4">
        <h1 className="text-lg font-semibold tracking-tight">Satellite Tracker</h1>
      </header>
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
