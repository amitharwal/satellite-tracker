/**
 * Julian date split into a whole part and a fraction to preserve precision.
 * `jd` is a whole day boundary (ends in .5, i.e. 0h UTC); `frac` is in [0, 1).
 */
export interface JulianDate {
  jd: number;
  frac: number;
}

export const MS_PER_DAY = 86_400_000;
/** Julian date of the Unix epoch, 1970-01-01T00:00:00Z. */
export const JD_UNIX_EPOCH = 2440587.5;
/** Julian date of J2000.0, 2000-01-01T12:00:00 TT. */
export const JD_J2000 = 2451545.0;

const TWO_PI = 2 * Math.PI;
const DEG2RAD = Math.PI / 180;

export function julianDateFromUnixMs(ms: number): JulianDate {
  const days = Math.floor(ms / MS_PER_DAY);
  return { jd: JD_UNIX_EPOCH + days, frac: (ms - days * MS_PER_DAY) / MS_PER_DAY };
}

/** Days since J2000.0, computed from the split parts to avoid cancellation. */
export function daysSinceJ2000(date: JulianDate): number {
  return date.jd - JD_J2000 + date.frac;
}

/**
 * Greenwich mean sidereal time (IAU-82), in radians in [0, 2π).
 * Uses UTC as an approximation of UT1 (|UT1 − UTC| < 0.9 s, about 4e-3°).
 * Reference: Vallado, "Fundamentals of Astrodynamics and Applications", eq. 3-45.
 */
export function gmst(date: JulianDate): number {
  const tut1 = daysSinceJ2000(date) / 36525;
  const seconds =
    -6.2e-6 * tut1 * tut1 * tut1 +
    0.093104 * tut1 * tut1 +
    (876600 * 3600 + 8640184.812866) * tut1 +
    67310.54841;
  // 1 second of sidereal time is 1/240 degree.
  const theta = ((seconds * DEG2RAD) / 240) % TWO_PI;
  return theta < 0 ? theta + TWO_PI : theta;
}
