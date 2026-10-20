import { eciToEcf, gstime, json2satrec, propagate } from 'satellite.js';
import { describe, expect, it } from 'vitest';
import { elementsFromOmm } from './elements.ts';
import {
  EARTH_RADIUS_KM,
  minutesSinceEpoch,
  temeToEcefPosition,
  temeToEcefVelocity,
} from './frames.ts';
import { sgp4, sgp4init } from './sgp4.ts';
import { gmst, julianDateFromUnixMs } from './time.ts';

describe('temeToEcefPosition', () => {
  it('matches satellite.js eciToEcf for the same GMST', () => {
    const r = [5094.1801621, 6127.6446595, 6380.3445327];
    for (const theta of [0, 0.3, 2.1, 4.9]) {
      const out = [0, 0, 0];
      temeToEcefPosition(r, theta, out);
      const expected = eciToEcf({ x: r[0] ?? 0, y: r[1] ?? 0, z: r[2] ?? 0 }, theta);
      expect(out[0]).toBeCloseTo(expected.x, 9);
      expect(out[1]).toBeCloseTo(expected.y, 9);
      expect(out[2]).toBeCloseTo(expected.z, 9);
    }
  });

  it('applies a scale and offset (Earth radii into a packed array)', () => {
    const out = new Float32Array(6);
    temeToEcefPosition([EARTH_RADIUS_KM, 0, 0], 0, out, 3, 1 / EARTH_RADIUS_KM);
    expect(Array.from(out)).toEqual([0, 0, 0, 1, 0, 0]);
  });
});

describe('temeToEcefVelocity', () => {
  it('removes Earth rotation: a geostationary satellite is nearly at rest in ECEF', () => {
    // A GEO element set (INTELSAT-class, 0.02° inclination, near-zero eccentricity).
    const elements = elementsFromOmm({
      noradId: 26900,
      epoch: '2026-10-20T00:00:00.000000',
      meanMotion: 1.00273847,
      eccentricity: 0.0003319,
      inclination: 0.0164,
      raOfAscNode: 266.5378,
      argOfPericenter: 86.1794,
      meanAnomaly: 182.259,
      bstar: 0.0001,
      meanMotionDot: 0,
      meanMotionDdot: 0,
    });
    const satrec = sgp4init(elements);
    const r = new Float64Array(3);
    const v = new Float64Array(3);
    expect(sgp4(satrec, 600, r, v)).toBe(0);
    const date = julianDateFromUnixMs(Date.UTC(2026, 9, 20, 10));
    const ecefV = [0, 0, 0];
    temeToEcefVelocity(r, v, gmst(date), ecefV);
    expect(Math.hypot(...v)).toBeGreaterThan(3); // ~3.07 km/s inertial
    expect(Math.hypot(...ecefV)).toBeLessThan(0.01); // < 10 m/s Earth-fixed
  });
});

describe('minutesSinceEpoch', () => {
  it('uses split dates without cancellation', () => {
    expect(minutesSinceEpoch({ jd: 2461000.5, frac: 0.25 }, { jd: 2461001.5, frac: 0.75 })).toBe(
      2160,
    );
  });
});

describe('end-to-end ECEF vs satellite.js', () => {
  it('agrees within 10 m for an ISS-like orbit (same ms-rounded epoch)', () => {
    const omm = {
      OBJECT_NAME: 'ISS (ZARYA)',
      OBJECT_ID: '1998-067A',
      EPOCH: '2026-10-20T12:00:00.123',
      MEAN_MOTION: 15.50103472,
      ECCENTRICITY: 0.0004781,
      INCLINATION: 51.6393,
      RA_OF_ASC_NODE: 123.4567,
      ARG_OF_PERICENTER: 45.6789,
      MEAN_ANOMALY: 314.5678,
      NORAD_CAT_ID: 25544,
      ELEMENT_SET_NO: 999,
      BSTAR: 0.00018403,
      MEAN_MOTION_DOT: 0.0001027,
      MEAN_MOTION_DDOT: 0,
    };
    const satrec = sgp4init(
      elementsFromOmm({
        noradId: 25544,
        epoch: omm.EPOCH,
        meanMotion: omm.MEAN_MOTION,
        eccentricity: omm.ECCENTRICITY,
        inclination: omm.INCLINATION,
        raOfAscNode: omm.RA_OF_ASC_NODE,
        argOfPericenter: omm.ARG_OF_PERICENTER,
        meanAnomaly: omm.MEAN_ANOMALY,
        bstar: omm.BSTAR,
        meanMotionDot: omm.MEAN_MOTION_DOT,
        meanMotionDdot: omm.MEAN_MOTION_DDOT,
      }),
    );
    const oracle = json2satrec(omm);
    const when = new Date(Date.UTC(2026, 9, 20, 18, 30));
    const date = julianDateFromUnixMs(when.getTime());

    const r = new Float64Array(3);
    const v = new Float64Array(3);
    const epoch = { jd: satrec.jdsatepoch, frac: satrec.jdsatepochF };
    expect(sgp4(satrec, minutesSinceEpoch(epoch, date), r, v)).toBe(0);
    const ours = [0, 0, 0];
    temeToEcefPosition(r, gmst(date), ours);

    const pv = propagate(oracle, when);
    if (!pv?.position) throw new Error('oracle failed');
    const theirs = eciToEcf(pv.position, gstime(when));
    const diffKm = Math.hypot(
      (ours[0] ?? 0) - theirs.x,
      (ours[1] ?? 0) - theirs.y,
      (ours[2] ?? 0) - theirs.z,
    );
    expect(diffKm).toBeLessThan(0.01);
  });
});
