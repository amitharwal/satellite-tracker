import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS_KM } from './frames.ts';
import { moonPositionEci, planetOrbit, planetPosition, PLANETS, type Vec3 } from './planets.ts';
import { julianDateFromUnixMs } from './time.ts';

/*
 * Reference vectors from JPL Horizons (DE441), queried 2026-10-20 via
 * https://ssd.jpl.nasa.gov/api/horizons.api for 2026-10-20 00:00 UT:
 * planets heliocentric (CENTER 500@10), ecliptic of J2000, au;
 * Moon geocentric (500@399), ICRF equatorial, km.
 */
const DATE = julianDateFromUnixMs(Date.UTC(2026, 9, 20));
const HORIZONS: Record<string, Vec3> = {
  Mercury: [3.32699750128161e-1, -2.159939565637634e-1, -4.816591914725681e-2],
  Venus: [6.627129139427786e-1, 2.915258708520372e-1, -3.423164430902011e-2],
  Earth: [8.932616517417117e-1, 4.404188995552351e-1, -3.231838641625756e-5], // EM barycentre
  Mars: [-1.28263342358581e-1, 1.575327763047221, 3.615811786031726e-2],
  Jupiter: [-3.598944746138536, 3.907978841906129, 6.428785478746525e-2],
  Saturn: [9.232820191447166, 1.870441101044111, -4.000967360130855e-1],
  Uranus: [8.863624669979849, 17.29921335902506, -5.067912822677258e-2],
  Neptune: [29.83425744089081, 1.440037692909671, -7.171769959042927e-1],
};
const MOON_KM: Vec3 = [2.605937244163282e5, -2.726808737129234e5, -1.294535492107278e5];

function angleDeg(a: Vec3, b: Vec3): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return (Math.acos(Math.min(1, dot / (Math.hypot(...a) * Math.hypot(...b)))) * 180) / Math.PI;
}

describe('planetPosition (JPL Table 1) vs Horizons DE441', () => {
  it.each(PLANETS.map((p) => [p.name, p] as const))(
    '%s within 0.25° and 0.5 % of distance',
    (name, planet) => {
      const ours = planetPosition(planet, DATE);
      const ref = HORIZONS[name];
      if (!ref) throw new Error(`no reference for ${name}`);
      expect(angleDeg(ours, ref)).toBeLessThan(0.25);
      expect(Math.abs(Math.hypot(...ours) / Math.hypot(...ref) - 1)).toBeLessThan(0.005);
    },
  );
});

describe('planetOrbit', () => {
  it('is a closed loop that contains the current position', () => {
    const earth = PLANETS[2];
    if (!earth) throw new Error('missing Earth');
    const orbit = planetOrbit(earth, DATE, 360);
    expect(orbit).toHaveLength(361);
    const [first, last] = [orbit[0], orbit[360]];
    expect(first?.[0]).toBeCloseTo(last?.[0] ?? NaN, 12);
    const now = planetPosition(earth, DATE);
    const nearest = Math.min(
      ...orbit.map((p) => Math.hypot(p[0] - now[0], p[1] - now[1], p[2] - now[2])),
    );
    expect(nearest).toBeLessThan(0.01); // within one sampling step (~0.0175 au)
  });
});

describe('moonPositionEci vs Horizons', () => {
  it('is within 0.6° (incl. ~0.37° precession J2000→date) and 1 % in distance', () => {
    const ours = moonPositionEci(DATE).map((v) => v * EARTH_RADIUS_KM) as Vec3;
    expect(angleDeg(ours, MOON_KM)).toBeLessThan(0.6);
    expect(Math.abs(Math.hypot(...ours) / Math.hypot(...MOON_KM) - 1)).toBeLessThan(0.01);
  });
});
