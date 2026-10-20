import { useEffect, useState } from 'react';
import { clock } from '@/state';

/** Source note for the solar view, with a warning outside the elements' validity range. */
export function SolarNote() {
  const [year, setYear] = useState(() => new Date(clock.now()).getUTCFullYear());
  useEffect(() => {
    const id = window.setInterval(() => {
      setYear(new Date(clock.now()).getUTCFullYear());
    }, 500);
    return () => {
      window.clearInterval(id);
    };
  }, []);
  const outOfRange = year < 1800 || year > 2050;
  return (
    <footer className="pointer-events-none absolute bottom-4 left-4 hidden max-w-xs space-y-1 text-xs text-neutral-400 sm:block">
      {outOfRange && (
        <p className="text-amber-300">
          {year} is outside 1800–2050, where these planetary elements are valid; positions will
          drift.
        </p>
      )}
      <p>
        Planet positions: JPL approximate Keplerian elements (Standish &amp; Williams). Orbits and
        sizes not to scale with distance.
      </p>
    </footer>
  );
}
