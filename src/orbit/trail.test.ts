import { describe, expect, it } from 'vitest';
import { SingleSatellite } from './details.ts';
import { EARTH_RADIUS_KM } from './frames.ts';
import { ecefToGeodetic, geodeticToEcef } from './geodetic.ts';
import { OrbitTrail, SAMPLES_PER_PERIOD, TRAIL_STRIDE } from './trail.ts';

const ISS = {
  noradId: 25544,
  epoch: '2026-10-20T12:00:00.000000',
  meanMotion: 15.50103472,
  eccentricity: 0.0004781,
  inclination: 51.6393,
  raOfAscNode: 123.4567,
  argOfPericenter: 45.6789,
  meanAnomaly: 314.5678,
  bstar: 0.00018403,
  meanMotionDot: 0,
  meanMotionDdot: 0,
};
const NOW = Date.UTC(2026, 9, 20, 15, 0, 7);

function vertex(a: Float32Array, i: number): [number, number, number, number] {
  const o = i * TRAIL_STRIDE;
  return [a[o] ?? NaN, a[o + 1] ?? NaN, a[o + 2] ?? NaN, a[o + 3] ?? NaN];
}

describe('geodeticToEcef', () => {
  it('round-trips with ecefToGeodetic', () => {
    const out = [0, 0, 0];
    geodeticToEcef(0.7, -2.1, 420, out);
    const g = ecefToGeodetic(out[0] ?? 0, out[1] ?? 0, out[2] ?? 0);
    expect(g.latitude).toBeCloseTo(0.7, 10);
    expect(g.longitude).toBeCloseTo(-2.1, 10);
    expect(g.height).toBeCloseTo(420, 6);
  });
});

describe('OrbitTrail', () => {
  const satellite = new SingleSatellite(ISS);
  const trail = new OrbitTrail(satellite);
  const geometry = trail.update(NOW);
  const state = satellite.at(NOW);
  if (!state) throw new Error('propagation failed');
  const here = state.ecef.map((v) => v / EARTH_RADIUS_KM);

  it('samples one period of orbit and ±1 period of ground track', () => {
    expect(geometry.orbitCount).toBe(SAMPLES_PER_PERIOD + 1);
    expect(geometry.trackCount).toBe(2 * SAMPLES_PER_PERIOD + 1);
  });

  it('passes the orbit through the satellite now (within one sampling step)', () => {
    const stepKm = (7.66 * satellite.summary.period * 60) / SAMPLES_PER_PERIOD;
    let nearest = Infinity;
    for (let i = 0; i < geometry.orbitCount; i++) {
      const [x, y, z] = vertex(geometry.orbit, i);
      nearest = Math.min(
        nearest,
        Math.hypot(x - (here[0] ?? 0), y - (here[1] ?? 0), z - (here[2] ?? 0)),
      );
    }
    expect(nearest * EARTH_RADIUS_KM).toBeLessThan(stepKm);
  });

  it('marks past vertices with negative s and future with positive', () => {
    expect(vertex(geometry.orbit, 0)[3]).toBeLessThan(0);
    expect(vertex(geometry.orbit, geometry.orbitCount - 1)[3]).toBeGreaterThan(0);
    expect(vertex(geometry.orbit, 0)[3]).toBeGreaterThanOrEqual(-1.01);
  });

  it('keeps the ground track 5 km above the ellipsoid, within the inclination band', () => {
    for (let i = 0; i < geometry.trackCount; i++) {
      const [x, y, z] = vertex(geometry.track, i);
      const g = ecefToGeodetic(x * EARTH_RADIUS_KM, y * EARTH_RADIUS_KM, z * EARTH_RADIUS_KM);
      expect(g.height).toBeCloseTo(5, 3);
      // Geodetic latitude can exceed the (geocentric) inclination by up to ~0.19°.
      expect(Math.abs(g.latitude)).toBeLessThanOrEqual(((51.64 + 0.2) * Math.PI) / 180);
    }
  });

  it('reuses samples: a later update within the same step gives the same track', () => {
    const before = Array.from(geometry.track.subarray(0, geometry.trackCount * TRAIL_STRIDE));
    const after = trail.update(NOW + 1);
    // Only the time fractions shift; positions are identical cached samples.
    for (let i = 0; i < after.trackCount; i++) {
      expect(vertex(after.track, i).slice(0, 3)).toEqual(before.slice(i * 4, i * 4 + 3));
    }
  });
});
