import { sunPos } from 'satellite.js';
import { describe, expect, it } from 'vitest';
import { eciToEcef, sunDirectionEcef, sunDirectionEci, type Vec3 } from './sun.ts';
import { gmst, julianDateFromUnixMs } from './time.ts';

const RAD2DEG = 180 / Math.PI;

function raDec([x, y, z]: Vec3): [number, number] {
  const ra = Math.atan2(y, x) * RAD2DEG;
  return [ra < 0 ? ra + 360 : ra, Math.asin(z) * RAD2DEG];
}

function angleDeg(a: Vec3, b: Vec3): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const na = Math.hypot(...a);
  const nb = Math.hypot(...b);
  return Math.acos(Math.min(1, dot / (na * nb))) * RAD2DEG;
}

describe('sunDirectionEci', () => {
  it('matches Meeus Example 25.a (1992-10-13 0h: RA 198.38083°, Dec −7.78507°) to 0.01°', () => {
    const [ra, dec] = raDec(sunDirectionEci({ jd: 2448908.5, frac: 0 }));
    expect(Math.abs(ra - 198.38083)).toBeLessThan(0.01);
    expect(Math.abs(dec - -7.78507)).toBeLessThan(0.01);
  });

  it('returns a unit vector', () => {
    const v = sunDirectionEci(julianDateFromUnixMs(Date.UTC(2026, 5, 21)));
    expect(Math.hypot(...v)).toBeCloseTo(1, 12);
  });

  it('agrees with satellite.js sunPos within 0.02° across 1990–2050', () => {
    for (let day = 0; day < 60 * 365; day += 97) {
      const date = julianDateFromUnixMs(Date.UTC(1990, 0, 1) + day * 86_400_000);
      const { rsun } = sunPos(date.jd + date.frac);
      expect(angleDeg(sunDirectionEci(date), [rsun.x, rsun.y, rsun.z])).toBeLessThan(0.02);
    }
  });

  it('puts the Sun near the solstice declinations', () => {
    const june = raDec(sunDirectionEci(julianDateFromUnixMs(Date.UTC(2026, 5, 21, 8, 24))));
    const december = raDec(sunDirectionEci(julianDateFromUnixMs(Date.UTC(2026, 11, 21, 20, 50))));
    expect(june[1]).toBeCloseTo(23.43, 1);
    expect(december[1]).toBeCloseTo(-23.43, 1);
  });
});

describe('eciToEcef', () => {
  it('rotates by −GMST about z', () => {
    const [x, y, z] = eciToEcef([1, 0, 0.5], Math.PI / 2);
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(-1, 12);
    expect(z).toBe(0.5);
  });
});

describe('sunDirectionEcef', () => {
  it('puts the subsolar point near 0° longitude at 12:00 UTC (within equation of time)', () => {
    // Equation of time is within about ±16.5 min, i.e. ±4.2° of longitude.
    for (let month = 0; month < 12; month++) {
      const date = julianDateFromUnixMs(Date.UTC(2026, month, 15, 12));
      const [x, y] = sunDirectionEcef(date);
      expect(Math.abs(Math.atan2(y, x) * RAD2DEG)).toBeLessThan(4.5);
    }
  });

  it('is the ECI direction rotated by GMST', () => {
    const date = julianDateFromUnixMs(Date.UTC(2026, 9, 20, 18));
    expect(sunDirectionEcef(date)).toEqual(eciToEcef(sunDirectionEci(date), gmst(date)));
  });
});
