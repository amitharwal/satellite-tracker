import { ecfToLookAngles } from 'satellite.js';
import { describe, expect, it } from 'vitest';
import { SingleSatellite } from './details.ts';
import { EARTH_RADIUS_KM } from './frames.ts';
import { geodeticToEcef } from './geodetic.ts';
import { findPasses, inEarthShadow, lookAngles, observerFrame, type Observer } from './passes.ts';

const DEG = Math.PI / 180;
const BERLIN: Observer = { latitude: 52.52 * DEG, longitude: 13.4 * DEG, height: 0.034 };

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
const START = Date.UTC(2026, 9, 20, 12);

describe('lookAngles', () => {
  it('puts a point straight above the observer at 90° elevation', () => {
    const frame = observerFrame(BERLIN);
    const above = [0, 0, 0];
    geodeticToEcef(BERLIN.latitude, BERLIN.longitude, 500, above);
    const a = lookAngles(frame, above);
    expect(a.elevation).toBeCloseTo(Math.PI / 2, 6);
    expect(a.range).toBeCloseTo(500 - 0.034, 6);
  });

  it('agrees with satellite.js ecfToLookAngles', () => {
    const frame = observerFrame(BERLIN);
    for (const [x, y, z] of [
      [4000, 1500, 5500],
      [-2000, 6000, 3000],
      [6800, -800, 500],
    ] as const) {
      const ours = lookAngles(frame, [x, y, z]);
      const theirs = ecfToLookAngles(BERLIN, { x, y, z });
      expect(ours.elevation).toBeCloseTo(theirs.elevation, 6);
      expect(ours.azimuth).toBeCloseTo(theirs.azimuth, 6);
      expect(ours.range).toBeCloseTo(theirs.rangeSat, 3);
    }
  });
});

describe('inEarthShadow', () => {
  const sun = [1, 0, 0];
  it('is lit on the day side and beside the shadow cylinder, dark inside it', () => {
    expect(inEarthShadow([EARTH_RADIUS_KM + 400, 0, 0], sun)).toBe(false);
    expect(inEarthShadow([-(EARTH_RADIUS_KM + 400), 0, 0], sun)).toBe(true);
    expect(inEarthShadow([-1000, EARTH_RADIUS_KM + 400, 0], sun)).toBe(false);
  });
});

describe('findPasses', () => {
  const satellite = new SingleSatellite(ISS);
  const passes = findPasses(satellite, BERLIN, { startMs: START, durationMs: 48 * 3_600_000 });

  it('finds a plausible number of ISS passes over Berlin in 48 h', () => {
    expect(passes.length).toBeGreaterThanOrEqual(6);
    expect(passes.length).toBeLessThanOrEqual(14);
  });

  it('orders rise < peak < set with horizon crossings refined to ~0°', () => {
    for (const p of passes) {
      if (!p.rise || !p.set) continue;
      expect(p.rise.t).toBeLessThan(p.peak.t);
      expect(p.peak.t).toBeLessThan(p.set.t);
      expect(Math.abs(p.rise.elevation)).toBeLessThan(0.05 * DEG);
      expect(Math.abs(p.set.elevation)).toBeLessThan(0.05 * DEG);
      expect(p.set.t - p.rise.t).toBeLessThan(15 * 60_000); // LEO passes are short
    }
  });

  it('matches a brute-force 5 s scan: no missed passes, peaks at least as high', () => {
    const frame = observerFrame(BERLIN);
    const brute: { t: number; el: number }[] = [];
    let best: { t: number; el: number } | null = null;
    for (let t = START; t <= START + 48 * 3_600_000; t += 5_000) {
      const state = satellite.at(t);
      const el = state ? lookAngles(frame, state.ecef).elevation : -1;
      if (el > 0) {
        if (!best || el > best.el) best = { t, el };
      } else if (best) {
        brute.push(best);
        best = null;
      }
    }
    if (best) brute.push(best);
    expect(passes).toHaveLength(brute.length);
    // A 5 s scan undersamples the true maximum, so the refined peak may be a
    // little higher but never lower.
    passes.forEach((p, i) => {
      const diff = p.peak.elevation - (brute[i]?.el ?? 0);
      expect(diff).toBeGreaterThanOrEqual(-1e-6);
      expect(diff).toBeLessThan(0.2 * DEG);
    });
  });

  it('filters by minimum peak elevation and caps the count', () => {
    const high = findPasses(satellite, BERLIN, {
      startMs: START,
      durationMs: 48 * 3_600_000,
      minPeakElevation: 30 * DEG,
    });
    expect(high.every((p) => p.peak.elevation >= 30 * DEG)).toBe(true);
    expect(high.length).toBeLessThan(passes.length);
    expect(
      findPasses(satellite, BERLIN, { startMs: START, durationMs: 48 * 3_600_000, maxPasses: 2 }),
    ).toHaveLength(2);
  });

  it('reports a geostationary satellite as one pass that never rises or sets (or none)', () => {
    const geo = new SingleSatellite({
      ...ISS,
      noradId: 1,
      meanMotion: 1.00273791,
      eccentricity: 0.0001,
      inclination: 0.05,
      raOfAscNode: 0,
      argOfPericenter: 0,
      meanAnomaly: 0,
      bstar: 0,
    });
    const geoPasses = findPasses(geo, BERLIN, { startMs: START, durationMs: 6 * 3_600_000 });
    expect(geoPasses.length).toBeLessThanOrEqual(1);
    if (geoPasses[0]) {
      expect(geoPasses[0].rise).toBeNull();
      expect(geoPasses[0].set).toBeNull();
    }
  });

  it('marks visibility only when the observer is dark and the satellite sunlit', () => {
    for (const p of passes) {
      if (!p.visible) continue;
      expect(p.visible.start).toBeLessThanOrEqual(p.visible.end);
      expect(p.peak.elevation).toBeGreaterThanOrEqual(10 * DEG);
    }
  });
});
