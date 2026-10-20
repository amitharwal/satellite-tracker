import { twoline2satrec } from 'satellite.js';
import { describe, expect, it } from 'vitest';
import { elementsFromOmm, parseOmmEpoch, parseTle } from './elements.ts';
import { daysToMdhms, julianDate } from './time.ts';

// Case 00005 from SGP4-VER.TLE (Vallado's "TEME example").
const LINE1 = '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753';
const LINE2 = '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667';

describe('parseTle', () => {
  it('converts to SGP4 units exactly as satellite.js twoline2satrec does', () => {
    const ours = parseTle(LINE1, LINE2);
    const theirs = twoline2satrec(LINE1, LINE2);
    expect(ours.satnum).toBe('00005');
    expect(ours.bstar).toBe(theirs.bstar);
    expect(ours.ecco).toBe(theirs.ecco);
    expect(ours.inclo).toBe(theirs.inclo);
    expect(ours.nodeo).toBe(theirs.nodeo);
    expect(ours.argpo).toBe(theirs.argpo);
    expect(ours.mo).toBe(theirs.mo);
    // satellite.js keeps the Kozai mean motion in `nokozai` (`no` becomes un-Kozai'd at init).
    expect(ours.noKozai).toBe(theirs.nokozai);
    expect(ours.ndot).toBe(theirs.ndot);
    expect(ours.epoch.jd + ours.epoch.frac).toBeCloseTo(theirs.jdsatepoch, 9);
  });

  it('parses implied-exponent fields with signs', () => {
    const l1 = '1 16925U 86065D   06151.67415771  .02550794 -30915-6  18784-3 0  4486';
    const l2 = '2 16925  62.0906 295.0239 5596327 245.1593  47.9690  4.88511875148616';
    const e = parseTle(l1, l2);
    expect(e.bstar).toBeCloseTo(0.18784e-3, 15);
    expect(e.nddot * (1440 / (2 * Math.PI)) * 1440 * 1440).toBeCloseTo(-0.30915e-6, 15);
  });

  it('maps two-digit years 57–99 to 19xx and 00–56 to 20xx', () => {
    const e1957 = parseTle(LINE1.replace('00179', '57179'), LINE2);
    const e2056 = parseTle(LINE1.replace('00179', '56179'), LINE2);
    expect(e1957.epoch.jd).toBeLessThan(2436500);
    expect(e2056.epoch.jd).toBeGreaterThan(2471000);
  });

  it('rejects lines that are not a TLE', () => {
    expect(() => parseTle(LINE2, LINE1)).toThrow(/Not a TLE/);
  });
});

describe('parseOmmEpoch', () => {
  it('keeps microsecond precision in the fraction', () => {
    const a = parseOmmEpoch('2026-10-20T09:24:57.921984');
    const b = parseOmmEpoch('2026-10-20T09:24:57.921985');
    expect(a.jd).toBe(2461333.5);
    expect((b.frac - a.frac) * 86400e6).toBeCloseTo(1, 3);
  });

  it('accepts a trailing Z and rejects garbage', () => {
    expect(parseOmmEpoch('2026-01-01T00:00:00Z')).toEqual({ jd: 2461041.5, frac: 0 });
    expect(() => parseOmmEpoch('2026-01-01 00:00:00')).toThrow(/Invalid OMM epoch/);
  });
});

describe('elementsFromOmm', () => {
  it('converts degrees and rev/day to radians and rad/min', () => {
    const e = elementsFromOmm({
      noradId: 101108,
      epoch: '2026-10-20T06:00:00.000001',
      meanMotion: 15.2,
      eccentricity: 0.001,
      inclination: 97.5,
      raOfAscNode: 10,
      argOfPericenter: 20,
      meanAnomaly: 30,
      bstar: -0.000011606,
      meanMotionDot: -0.00000064,
      meanMotionDdot: 1.2e-11,
    });
    expect(e.satnum).toBe('101108');
    expect(e.inclo).toBeCloseTo((97.5 * Math.PI) / 180, 15);
    expect(e.noKozai).toBeCloseTo((15.2 * 2 * Math.PI) / 1440, 15);
    expect(e.bstar).toBe(-0.000011606);
  });
});

describe('julianDate / daysToMdhms', () => {
  it('matches known Julian dates', () => {
    expect(julianDate(2000, 1, 1, 12, 0, 0)).toEqual({ jd: 2451544.5, frac: 0.5 });
    expect(julianDate(1957, 10, 4, 19, 26, 24)).toEqual({ jd: 2436115.5, frac: 0.81 });
  });

  it('splits day-of-year, including leap years', () => {
    expect(daysToMdhms(2024, 60.5)).toMatchObject({ mon: 2, day: 29, hr: 12, minute: 0 });
    expect(daysToMdhms(2023, 60.5)).toMatchObject({ mon: 3, day: 1, hr: 12 });
    expect(daysToMdhms(2026, 365)).toMatchObject({ mon: 12, day: 31 });
  });
});
