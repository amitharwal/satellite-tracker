import { Eye, LocateFixed, MapPin } from 'lucide-react';
import { useEffect, useState } from 'react';
import { satelliteAt } from '@/app/interaction';
import { observer, type ObserverLocation } from '@/app/observer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { findPasses, type Pass } from '@/orbit/passes';
import { clock } from '@/state';
import { useStore } from '@/ui/useStore';

const DEG = Math.PI / 180;
const WINDOW_MS = 48 * 3_600_000;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const compass = (azimuth: number) => COMPASS[Math.round(azimuth / DEG / 45) % 8] ?? 'N';

const timeFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const zoneName =
  new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')?.value ?? 'local';

function formatLocation(o: ObserverLocation): string {
  const lat = `${Math.abs(o.latitude).toFixed(2)}°${o.latitude >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(o.longitude).toFixed(2)}°${o.longitude >= 0 ? 'E' : 'W'}`;
  return `${lat} ${lon}`;
}

/**
 * Passes for one satellite over the observer, recomputed when the selection or
 * location changes, or when simulated time leaves the computed window.
 */
function usePasses(index: number, location: ObserverLocation | null): Pass[] | null {
  const [result, setResult] = useState<{ start: number; passes: Pass[] } | null>(null);

  useEffect(() => {
    if (!location) return;
    const satellite = satelliteAt(index);
    if (satellite?.initError !== 0) return;
    const compute = () => {
      const start = clock.now();
      const passes = findPasses(
        satellite,
        { latitude: location.latitude * DEG, longitude: location.longitude * DEG, height: 0 },
        { startMs: start, durationMs: WINDOW_MS, maxPasses: 8 },
      );
      setResult({ start, passes });
      return { start, passes };
    };
    let current = compute();
    const id = window.setInterval(() => {
      const now = clock.now();
      const first = current.passes[0];
      const firstEnded = first?.set ? now > first.set.t : false;
      const outside = now < current.start - 60_000 || now > current.start + WINDOW_MS / 4;
      if (firstEnded || outside) current = compute();
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [index, location]);

  return location ? (result?.passes ?? null) : null;
}

function LocationForm({ onDone }: { onDone: () => void }) {
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const useDevice = () => {
    if (!('geolocation' in navigator)) {
      setError('Location is not available in this browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        observer.set({
          // ~1 km precision is plenty for pass times and avoids storing more than needed.
          latitude: Math.round(pos.coords.latitude * 100) / 100,
          longitude: Math.round(pos.coords.longitude * 100) / 100,
          source: 'device',
        });
        onDone();
      },
      (err) => {
        setLocating(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was denied.'
            : 'Could not get your location.',
        );
      },
      { maximumAge: 600_000, timeout: 15_000 },
    );
  };

  const save = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const latitude = Number(lat);
    const longitude = Number(lon);
    if (
      lat.trim() === '' ||
      lon.trim() === '' ||
      !(Math.abs(latitude) <= 90) ||
      !(Math.abs(longitude) <= 180)
    ) {
      setError('Latitude must be −90…90 and longitude −180…180.');
      return;
    }
    observer.set({ latitude, longitude, source: 'manual' });
    onDone();
  };

  return (
    <div className="space-y-2">
      <Button size="sm" variant="secondary" onClick={useDevice} disabled={locating}>
        <LocateFixed /> {locating ? 'Locating…' : 'Use my location'}
      </Button>
      <form className="flex items-end gap-2" onSubmit={save}>
        <label className="flex-1 text-xs text-neutral-400">
          Latitude
          <Input
            inputMode="decimal"
            placeholder="52.52"
            value={lat}
            onChange={(e) => {
              setLat(e.target.value);
            }}
          />
        </label>
        <label className="flex-1 text-xs text-neutral-400">
          Longitude
          <Input
            inputMode="decimal"
            placeholder="13.40"
            value={lon}
            onChange={(e) => {
              setLon(e.target.value);
            }}
          />
        </label>
        <Button size="sm" type="submit" variant="outline">
          Set
        </Button>
      </form>
      {error && <p className="text-xs text-amber-300">{error}</p>}
      <p className="text-xs text-neutral-500">Your location is stored only in this browser.</p>
    </div>
  );
}

export function PassesSection({ index }: { index: number }) {
  const location = useStore(observer);
  const [editing, setEditing] = useState(false);
  const passes = usePasses(index, location);

  if (!location || editing) {
    return (
      <section aria-label="Pass predictions" className="space-y-2">
        <h3 className="text-xs font-medium tracking-wide text-neutral-400 uppercase">Passes</h3>
        {!location && (
          <p className="text-neutral-400">
            Set a location to see when this satellite passes overhead.
          </p>
        )}
        <LocationForm
          onDone={() => {
            setEditing(false);
          }}
        />
      </section>
    );
  }

  return (
    <section aria-label="Pass predictions" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium tracking-wide text-neutral-400 uppercase">
          Passes · next 48 h
        </h3>
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-neutral-400 underline hover:text-neutral-200"
          onClick={() => {
            setEditing(true);
          }}
        >
          <MapPin className="size-3" /> {formatLocation(location)}
        </button>
      </div>
      {passes === null ? (
        <p className="text-neutral-400">Computing…</p>
      ) : passes.length === 0 ? (
        <p className="text-neutral-400">No passes above the horizon in the next 48 hours.</p>
      ) : (
        <ul className="space-y-0.5">
          {passes.map((p) => {
            const start = p.rise?.t ?? p.peak.t;
            const durationMin = p.rise && p.set ? Math.round((p.set.t - p.rise.t) / 60_000) : null;
            return (
              <li key={p.peak.t}>
                <button
                  type="button"
                  className="grid w-full grid-cols-[1fr_auto_auto_1rem] items-center gap-2 rounded px-1.5 py-1 text-left font-mono text-xs tabular-nums hover:bg-white/10"
                  title="Jump to this pass"
                  onClick={() => {
                    clock.setTime(start - 60_000);
                  }}
                >
                  <span>{timeFormat.format(start)}</span>
                  <span className="text-neutral-400">
                    {p.rise ? compass(p.rise.azimuth) : '…'}→{p.set ? compass(p.set.azimuth) : '…'}
                    {durationMin !== null && ` ${durationMin}m`}
                  </span>
                  <span>{Math.round(p.peak.elevation / DEG)}°</span>
                  {p.visible ? (
                    <Eye
                      className="size-3.5 text-amber-300"
                      aria-label="Visible to the naked eye"
                    />
                  ) : (
                    <span />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-neutral-500">
        Times in {zoneName}. Max elevation shown; <Eye className="inline size-3 text-amber-300" /> =
        sunlit while your sky is dark. Click to jump there.
      </p>
    </section>
  );
}
