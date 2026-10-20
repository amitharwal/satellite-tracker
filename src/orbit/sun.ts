import { daysSinceJ2000, gmst, type JulianDate } from './time.ts';

export type Vec3 = [number, number, number];

const DEG2RAD = Math.PI / 180;

/**
 * Unit vector toward the Sun in the true-of-date equatorial frame, from the
 * Astronomical Almanac low-precision formula (about 0.01° for 1950–2050).
 * Good enough for a day/night terminator; not for eclipse prediction.
 */
export function sunDirectionEci(date: JulianDate): Vec3 {
  const n = daysSinceJ2000(date);
  const meanLongitude = (280.46 + 0.9856474 * n) * DEG2RAD;
  const meanAnomaly = (357.528 + 0.9856003 * n) * DEG2RAD;
  const eclipticLongitude =
    meanLongitude + (1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * DEG2RAD;
  const obliquity = (23.439 - 0.0000004 * n) * DEG2RAD;

  const sinLon = Math.sin(eclipticLongitude);
  return [Math.cos(eclipticLongitude), Math.cos(obliquity) * sinLon, Math.sin(obliquity) * sinLon];
}

/** Rotates an inertial (equator-of-date) vector into Earth-fixed coordinates. */
export function eciToEcef([x, y, z]: Vec3, gmstRad: number): Vec3 {
  const c = Math.cos(gmstRad);
  const s = Math.sin(gmstRad);
  return [c * x + s * y, -s * x + c * y, z];
}

/** Unit vector toward the Sun in Earth-fixed coordinates (polar motion ignored). */
export function sunDirectionEcef(date: JulianDate): Vec3 {
  return eciToEcef(sunDirectionEci(date), gmst(date));
}
