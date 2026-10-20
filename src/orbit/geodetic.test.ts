import { eciToGeodetic } from 'satellite.js';
import { describe, expect, it } from 'vitest';
import { SingleSatellite } from './details.ts';
import { EARTH_RADIUS_KM } from './frames.ts';
import { ecefToGeodetic } from './geodetic.ts';

const DEG = Math.PI / 180;

describe('ecefToGeodetic', () => {
  it('handles the equator, prime meridian and poles', () => {
    const equator = ecefToGeodetic(EARTH_RADIUS_KM, 0, 0);
    expect(equator.latitude).toBe(0);
    expect(equator.longitude).toBe(0);
    expect(equator.height).toBeCloseTo(0, 9);
    const pole = ecefToGeodetic(0, 0, 6356.752314245 + 100);
    expect(pole.latitude).toBeCloseTo(Math.PI / 2, 12);
    expect(pole.height).toBeCloseTo(100, 6);
    expect(ecefToGeodetic(0, -7000, 0).longitude).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('agrees with satellite.js eciToGeodetic (gmst = 0) to < 1 m', () => {
    for (const [x, y, z] of [
      [6778, 0, 0],
      [-3000, 5000, 4200],
      [1000, -2000, 6800],
      [42164, 100, 50],
      [-20000, -15000, -12000],
    ] as const) {
      const ours = ecefToGeodetic(x, y, z);
      const theirs = eciToGeodetic({ x, y, z }, 0);
      expect(Math.abs(ours.latitude - theirs.latitude)).toBeLessThan(1e-7);
      expect(Math.abs(ours.longitude - theirs.longitude)).toBeLessThan(1e-12);
      expect(Math.abs(ours.height - theirs.height)).toBeLessThan(1e-3);
    }
  });
});

describe('SingleSatellite', () => {
  const omm = {
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

  it('summarises the orbit (ISS-like: ~92.9 min, ~410-420 km)', () => {
    const sat = new SingleSatellite(omm);
    expect(sat.summary.period).toBeCloseTo(92.9, 1);
    expect(sat.summary.perigee).toBeGreaterThan(400);
    expect(sat.summary.apogee).toBeLessThan(430);
    expect(sat.summary.epochMs).toBe(Date.UTC(2026, 9, 20, 12));
  });

  it('reports a plausible state: altitude, speed, latitude within the inclination', () => {
    const sat = new SingleSatellite(omm);
    const state = sat.at(Date.UTC(2026, 9, 20, 13));
    expect(state).not.toBeNull();
    expect(state?.height).toBeGreaterThan(395);
    expect(state?.height).toBeLessThan(440);
    expect(state?.speed).toBeCloseTo(7.66, 1);
    expect(Math.abs(state?.latitude ?? 99)).toBeLessThanOrEqual(51.7 * DEG);
  });

  it('returns null for an element set that fails at initialisation', () => {
    const sat = new SingleSatellite({ ...omm, meanMotion: 0.00001, eccentricity: 0.56 });
    expect(sat.initError).toBe(3);
    expect(sat.at(Date.UTC(2026, 9, 20, 13))).toBeNull();
  });
});
