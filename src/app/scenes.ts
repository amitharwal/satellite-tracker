import type { Overlay } from '../gl/renderer.ts';
import type { Marker } from '../gl/markers.ts';
import type { Polyline, PolylineStyle } from '../gl/trails.ts';
import {
  moonPositionEci,
  planetOrbit,
  planetPosition,
  PLANETS,
  type Vec3,
} from '../orbit/planets.ts';
import { eciToEcef } from '../orbit/sun.ts';
import { gmst, julianDateFromUnixMs } from '../orbit/time.ts';

type Lines = { polyline: Polyline; style: PolylineStyle }[];

const DAY_MS = 86_400_000;
/** Sidereal month. */
const MOON_PERIOD_MS = 27.321661 * DAY_MS;
const MOON_STEP_MS = 6 * 3_600_000;
const MOON_STYLE: PolylineStyle = { color: [0.85, 0.85, 0.82, 0.35], pastAlpha: 0.5, widthPx: 1 };

/** The Moon and its orbit for the Earth view (Earth radii, ECEF). */
export function moonOverlay(): Required<Overlay> {
  const samples = new Map<number, Vec3>();
  const half = Math.ceil(MOON_PERIOD_MS / MOON_STEP_MS / 2);
  const vertices = new Float32Array((2 * half + 1) * 4);

  const sample = (k: number): Vec3 => {
    let v = samples.get(k);
    if (!v) {
      v = moonPositionEci(julianDateFromUnixMs(k * MOON_STEP_MS));
      samples.set(k, v);
    }
    return v;
  };

  return {
    markers: (simMs) => {
      const date = julianDateFromUnixMs(simMs);
      const position = eciToEcef(moonPositionEci(date), gmst(date));
      return [{ position, color: [0.86, 0.86, 0.82], sizePx: 9, label: 'Moon' }];
    },
    polylines: (simMs): Lines => {
      const k0 = Math.round(simMs / MOON_STEP_MS);
      for (const k of samples.keys()) if (Math.abs(k - k0) > half + 1) samples.delete(k);
      // Inertial orbit rotated to now's Earth-fixed frame (as for satellites).
      const theta = gmst(julianDateFromUnixMs(simMs));
      let count = 0;
      for (let k = k0 - half; k <= k0 + half; k++) {
        const [x, y, z] = eciToEcef(sample(k), theta);
        vertices.set([x, y, z, (k * MOON_STEP_MS - simMs) / (MOON_PERIOD_MS / 2)], count * 4);
        count++;
      }
      return [{ polyline: { vertices, count }, style: MOON_STYLE }];
    },
  };
}

const PLANET_COLORS: Record<string, readonly [number, number, number]> = {
  Mercury: [0.7, 0.68, 0.65],
  Venus: [0.95, 0.85, 0.6],
  Earth: [0.35, 0.6, 1],
  Mars: [0.95, 0.45, 0.3],
  Jupiter: [0.85, 0.72, 0.55],
  Saturn: [0.93, 0.82, 0.55],
  Uranus: [0.55, 0.85, 0.9],
  Neptune: [0.4, 0.55, 1],
};
const SUN: Marker = { position: [0, 0, 0], color: [1, 0.86, 0.45], sizePx: 18, label: 'Sun' };

/** Sun, planets and their orbits for the solar view (au, J2000 ecliptic). */
export function solarOverlay(): Required<Overlay> {
  let orbitsDay = Number.NaN;
  let orbits: Lines = [];
  return {
    markers: (simMs) => {
      const date = julianDateFromUnixMs(simMs);
      return [
        SUN,
        ...PLANETS.map((p): Marker => ({
          position: planetPosition(p, date),
          color: PLANET_COLORS[p.name] ?? [1, 1, 1],
          sizePx: p.name === 'Jupiter' || p.name === 'Saturn' ? 9 : 7,
          label: p.name,
        })),
      ];
    },
    polylines: (simMs) => {
      const day = Math.floor(simMs / DAY_MS);
      if (day !== orbitsDay) {
        orbitsDay = day;
        const date = julianDateFromUnixMs(day * DAY_MS);
        orbits = PLANETS.map((p) => {
          const points = planetOrbit(p, date, 256);
          const vertices = new Float32Array(points.length * 4);
          points.forEach((pt, i) => {
            vertices.set([...pt, 1], i * 4);
          });
          const [r, g, b] = PLANET_COLORS[p.name] ?? [1, 1, 1];
          return {
            polyline: { vertices, count: points.length },
            style: { color: [r, g, b, 0.35], pastAlpha: 1, widthPx: 1 },
          };
        });
      }
      return orbits;
    },
  };
}
