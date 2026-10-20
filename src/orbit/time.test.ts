import { gstime, jday } from 'satellite.js';
import { describe, expect, it } from 'vitest';
import { daysSinceJ2000, gmst, julianDateFromUnixMs, MS_PER_DAY } from './time.ts';

const RAD2DEG = 180 / Math.PI;

describe('julianDateFromUnixMs', () => {
  it('splits at 0h UTC', () => {
    expect(julianDateFromUnixMs(Date.UTC(2000, 0, 1, 12))).toEqual({ jd: 2451544.5, frac: 0.5 });
    expect(julianDateFromUnixMs(0)).toEqual({ jd: 2440587.5, frac: 0 });
  });

  it('handles times before the Unix epoch', () => {
    expect(julianDateFromUnixMs(-MS_PER_DAY / 4)).toEqual({ jd: 2440586.5, frac: 0.75 });
  });

  it('keeps sub-millisecond resolution in the fraction', () => {
    const a = julianDateFromUnixMs(Date.UTC(2026, 9, 20, 12));
    const b = julianDateFromUnixMs(Date.UTC(2026, 9, 20, 12) + 1);
    expect(b.jd).toBe(a.jd);
    expect((b.frac - a.frac) * MS_PER_DAY).toBeCloseTo(1, 6);
  });

  it('agrees with satellite.js jday', () => {
    const ms = Date.UTC(2026, 9, 20, 18, 34, 20, 500);
    const { jd, frac } = julianDateFromUnixMs(ms);
    expect(jd + frac).toBeCloseTo(jday(new Date(ms)), 8);
  });
});

describe('gmst', () => {
  it('matches Vallado Example 3-5 (1992-08-20 12:14 UT1 → 152.578787810°)', () => {
    const date = julianDateFromUnixMs(Date.UTC(1992, 7, 20, 12, 14));
    expect(gmst(date) * RAD2DEG).toBeCloseTo(152.57878781, 7);
  });

  it('agrees with satellite.js gstime across 1980–2060', () => {
    for (let year = 1980; year <= 2060; year += 3) {
      const ms = Date.UTC(year, (year * 7) % 12, 1 + (year % 28), year % 24, 17, 31);
      const date = julianDateFromUnixMs(ms);
      // satellite.js takes a single double JD (~40 µs resolution near 2.46e6),
      // which limits agreement to ~3e-9 rad; our split date is more precise.
      expect(Math.abs(gmst(date) - gstime(date.jd + date.frac))).toBeLessThan(1e-8);
    }
  });

  it('returns a value in [0, 2π)', () => {
    for (let h = 0; h < 48; h++) {
      const theta = gmst(julianDateFromUnixMs(Date.UTC(2026, 0, 1, h)));
      expect(theta).toBeGreaterThanOrEqual(0);
      expect(theta).toBeLessThan(2 * Math.PI);
    }
  });
});

describe('daysSinceJ2000', () => {
  it('is zero at J2000.0', () => {
    expect(daysSinceJ2000({ jd: 2451544.5, frac: 0.5 })).toBe(0);
  });
});
