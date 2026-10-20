import { Crosshair, LocateFixed, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { flyTo, satelliteAt, select } from '@/app/interaction';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Toggle } from '@/components/ui/toggle';
import { GROUPS } from '@/data/groups';
import type { SatelliteState } from '@/orbit/details';
import { catalogIndex, clock, selection } from '@/state';
import { displayName, orPlaceholder } from '@/ui/format';
import { useStore } from '@/ui/useStore';

const REGIME_LABELS = ['LEO', 'MEO', 'GEO', 'HEO', 'Other'];
const DEG = 180 / Math.PI;

/** Live state of the selected satellite, sampled 4× per second for display. */
function useLiveState(index: number | null): { state: SatelliteState | null; now: number } {
  const [live, setLive] = useState<{ state: SatelliteState | null; now: number }>({
    state: null,
    now: 0,
  });
  useEffect(() => {
    if (index === null) return;
    const update = () => {
      const now = clock.now();
      setLive({ state: satelliteAt(index)?.at(now) ?? null, now });
    };
    update();
    const id = window.setInterval(update, 250);
    return () => {
      window.clearInterval(id);
    };
  }, [index]);
  return live;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-neutral-400">{label}</dt>
      <dd className="text-right font-mono tabular-nums">{children}</dd>
    </div>
  );
}

const fmt = (n: number, digits = 1) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

function latLon(lat: number, lon: number): string {
  return `${Math.abs(lat * DEG).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon * DEG).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
}

export function InfoPanel() {
  const index = useStore(selection, (s) => s.selected);
  const follow = useStore(selection, (s) => s.follow);
  const data = useStore(catalogIndex);
  const { state, now } = useLiveState(index);

  if (index === null || !data) return null;
  const c = data.catalog.columns;
  const satellite = satelliteAt(index);
  const summary = satellite?.summary;
  const group = GROUPS[data.groups[index] ?? -1];
  const ageDays = summary ? (now - summary.epochMs) / 86_400_000 : NaN;

  return (
    <Card
      className="pointer-events-auto w-80 gap-3 bg-black/75 p-4 text-sm text-neutral-100 backdrop-blur"
      aria-label="Selected satellite"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{displayName(c.objectName[index])}</h2>
          <p className="font-mono text-xs text-neutral-400">
            NORAD {c.noradId[index]} · {orPlaceholder(c.objectId[index], '—')}
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Deselect"
          onClick={() => {
            select(null);
          }}
        >
          <X />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary">{REGIME_LABELS[data.regimes[index] ?? 4]}</Badge>
        {group && <Badge variant="outline">{group.label}</Badge>}
      </div>

      <Separator />
      {state ? (
        <dl className="space-y-1">
          <Row label="Position">{latLon(state.latitude, state.longitude)}</Row>
          <Row label="Altitude">{fmt(state.height)} km</Row>
          <Row label="Speed">{fmt(state.speed, 3)} km/s</Row>
        </dl>
      ) : (
        <p className="text-amber-300">
          Position unavailable: SGP4 reports this element set as decayed or invalid at this time.
        </p>
      )}

      {summary && (
        <>
          <Separator />
          <dl className="space-y-1">
            <Row label="Period">{fmt(summary.period)} min</Row>
            <Row label="Perigee / apogee">
              {fmt(summary.perigee, 0)} / {fmt(summary.apogee, 0)} km
            </Row>
            <Row label="Inclination">{fmt(summary.inclination, 2)}°</Row>
            <Row label="Eccentricity">{summary.eccentricity.toFixed(5)}</Row>
            <Row label="Elements epoch">
              {new Date(summary.epochMs).toISOString().slice(0, 16).replace('T', ' ')}
            </Row>
            <Row label="Element age">{fmt(ageDays)} d</Row>
          </dl>
        </>
      )}

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            flyTo(index);
          }}
        >
          <Crosshair /> Fly to
        </Button>
        <Toggle
          size="sm"
          variant="outline"
          pressed={follow}
          onPressedChange={(pressed) => {
            selection.set((s) => ({ ...s, follow: pressed }));
            if (pressed) flyTo(index);
          }}
          aria-label="Follow satellite"
        >
          <LocateFixed /> Follow
        </Toggle>
      </div>
    </Card>
  );
}
