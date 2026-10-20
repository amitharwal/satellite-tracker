import { Pause, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { clock } from '@/state';
import { useStore } from '@/ui/useStore';

const RATES = [-600, -60, 1, 10, 60, 600, 3600];

function formatRate(rate: number): string {
  return `${rate < 0 ? '−' : ''}${Math.abs(rate).toLocaleString()}×`;
}

function formatUtc(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/** Samples simulated and wall time 4× per second for display only; never drives rendering. */
function useSimTime(): { sim: number; wall: number } {
  const [now, setNow] = useState(() => ({ sim: clock.now(), wall: Date.now() }));
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow({ sim: clock.now(), wall: Date.now() });
    }, 250);
    return () => {
      window.clearInterval(id);
    };
  }, []);
  return now;
}

export function TimeControls() {
  const state = useStore(clock.store);
  const now = useSimTime();
  const offsetS = Math.round((now.sim - now.wall) / 1000);

  return (
    <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 rounded-lg bg-black/70 px-3 py-2 text-neutral-100 backdrop-blur">
      <div className="font-mono text-sm tabular-nums" aria-live="off">
        {formatUtc(now.sim)}
        {Math.abs(offsetS) >= 2 && (
          <span className="ml-2 text-xs text-neutral-400">
            ({offsetS > 0 ? '+' : '−'}
            {formatDuration(Math.abs(offsetS))} from now)
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          size="icon"
          variant="secondary"
          aria-label={state.paused ? 'Play' : 'Pause'}
          onClick={() => {
            if (state.paused) clock.resume();
            else clock.pause();
          }}
        >
          {state.paused ? <Play /> : <Pause />}
        </Button>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={String(state.rate)}
          onValueChange={(value) => {
            if (value) clock.setRate(Number(value));
          }}
          aria-label="Time rate"
        >
          {RATES.map((rate) => (
            <ToggleGroupItem key={rate} value={String(rate)} className="px-2 tabular-nums">
              {formatRate(rate)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            clock.jumpToNow();
          }}
        >
          Now
        </Button>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 120) return `${seconds} s`;
  if (seconds < 7200) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172800) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86400).toFixed(1)} d`;
}
