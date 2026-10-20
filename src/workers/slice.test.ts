import { describe, expect, it } from 'vitest';
import { elementsFromOmm, type OmmElements } from '../orbit/elements.ts';
import { EARTH_RADIUS_KM, minutesSinceEpoch, temeToEcefPosition } from '../orbit/frames.ts';
import { sgp4, sgp4init } from '../orbit/sgp4.ts';
import { gmst, julianDateFromUnixMs } from '../orbit/time.ts';
import { FLOATS_PER_SATELLITE, type OrbitalColumns } from './protocol.ts';
import { classifyRegime, Regime } from './regime.ts';
import { SlicePropagator } from './slice.ts';

const BASE: OmmElements = {
  noradId: 1,
  epoch: '2026-10-20T00:00:00.000000',
  meanMotion: 15.5,
  eccentricity: 0.0005,
  inclination: 51.6,
  raOfAscNode: 120,
  argOfPericenter: 45,
  meanAnomaly: 300,
  bstar: 0.0002,
  meanMotionDot: 0,
  meanMotionDdot: 0,
};

const SATS: OmmElements[] = [
  BASE,
  { ...BASE, noradId: 2, meanMotion: 1.0027, eccentricity: 0.0002, inclination: 0.05 }, // GEO
  // Fails at init like Vallado case 33334 (mean motion ~0, error 3).
  { ...BASE, noradId: 3, meanMotion: 0.00001, eccentricity: 0.5602877, inclination: 68.4714 },
  // Re-enters within hours (Vallado case 28872-like elements, enormous drag).
  { ...BASE, noradId: 4, meanMotion: 16.46, eccentricity: 0.0304, bstar: 0.5 },
];

function columns(sats: OmmElements[]): OrbitalColumns {
  return {
    noradId: sats.map((s) => Number(s.noradId)),
    epoch: sats.map((s) => s.epoch),
    meanMotion: sats.map((s) => s.meanMotion),
    eccentricity: sats.map((s) => s.eccentricity),
    inclination: sats.map((s) => s.inclination),
    raOfAscNode: sats.map((s) => s.raOfAscNode),
    argOfPericenter: sats.map((s) => s.argOfPericenter),
    meanAnomaly: sats.map((s) => s.meanAnomaly),
    bstar: sats.map((s) => s.bstar),
    meanMotionDot: sats.map((s) => s.meanMotionDot),
    meanMotionDdot: sats.map((s) => s.meanMotionDdot),
  };
}

const t0 = Date.UTC(2026, 9, 20, 6);
const t1 = t0 + 100;

describe('SlicePropagator', () => {
  const slice = new SlicePropagator(columns(SATS));
  const positions = new Float32Array(SATS.length * FLOATS_PER_SATELLITE);
  const status = new Uint8Array(SATS.length);
  const failed = slice.propagate(t0, t1, positions, status);

  it('flags init failures and propagation errors without throwing', () => {
    expect(slice.initFailures).toBe(1);
    expect(status[0]).toBe(0);
    expect(status[1]).toBe(0);
    expect(status[2]).toBe(3);
    expect(status[3]).not.toBe(0);
    expect(failed).toBe(2);
  });

  it('matches direct SGP4 + TEME→ECEF in Earth radii at both ends of the window', () => {
    const satrec = sgp4init(elementsFromOmm(BASE), { opsMode: 'i' });
    const epoch = { jd: satrec.jdsatepoch, frac: satrec.jdsatepochF };
    [t0, t1].forEach((ms, slot) => {
      const date = julianDateFromUnixMs(ms);
      const r = new Float64Array(3);
      sgp4(satrec, minutesSinceEpoch(epoch, date), r, new Float64Array(3));
      const expected = [0, 0, 0];
      temeToEcefPosition(r, gmst(date), expected, 0, 1 / EARTH_RADIUS_KM);
      for (let k = 0; k < 3; k++) {
        expect(positions[slot * 3 + k]).toBeCloseTo(expected[k] ?? NaN, 6);
      }
    });
  });

  it('puts LEO near 1.06 Earth radii and GEO near 6.6', () => {
    const radius = (i: number) =>
      Math.hypot(
        positions[i * FLOATS_PER_SATELLITE] ?? 0,
        positions[i * FLOATS_PER_SATELLITE + 1] ?? 0,
        positions[i * FLOATS_PER_SATELLITE + 2] ?? 0,
      );
    expect(radius(0)).toBeGreaterThan(1.04);
    expect(radius(0)).toBeLessThan(1.08);
    expect(radius(1)).toBeCloseTo(6.61, 1);
  });

  it('zeroes positions of flagged satellites and resets status between calls', () => {
    for (let k = 0; k < FLOATS_PER_SATELLITE; k++) {
      expect(positions[2 * FLOATS_PER_SATELLITE + k]).toBe(0);
    }
    status.fill(9);
    slice.propagate(t0, t1, positions, status);
    expect(status[0]).toBe(0);
  });
});

describe('classifyRegime', () => {
  it.each([
    [15.5, 0.001, Regime.LEO],
    [2.0056, 0.005, Regime.MEO], // GPS
    [1.0027, 0.0002, Regime.GEO],
    [2.006, 0.72, Regime.HEO], // Molniya
    [0.25, 0.1, Regime.OTHER],
  ])('n=%f e=%f → %i', (n, e, regime) => {
    expect(classifyRegime(n, e)).toBe(regime);
  });
});
