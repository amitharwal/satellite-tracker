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

/**
 * Julian date from calendar UTC (valid 1900–2100), as Vallado's jday_SGP4.
 * `sec` may carry a fraction.
 */
export function julianDate(
  year: number,
  mon: number,
  day: number,
  hr: number,
  minute: number,
  sec: number,
): JulianDate {
  let jd =
    367 * year -
    Math.floor(7 * (year + Math.floor((mon + 9) / 12)) * 0.25) +
    Math.floor((275 * mon) / 9) +
    day +
    1721013.5;
  let frac = (sec + minute * 60 + hr * 3600) / 86400;
  if (Math.abs(frac) > 1) {
    const whole = Math.floor(frac);
    jd += whole;
    frac -= whole;
  }
  return { jd, frac };
}

/**
 * Splits a fractional day-of-year into calendar parts, as Vallado's
 * days2mdhms_SGP4 (including its leap-year rule, valid 1901–2099).
 */
export function daysToMdhms(year: number, days: number) {
  const lmonth = [0, 31, year % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const dayofyr = Math.floor(days);
  let i = 1;
  let inttemp = 0;
  while (dayofyr > inttemp + (lmonth[i] ?? 0) && i < 12) {
    inttemp += lmonth[i] ?? 0;
    i++;
  }
  let temp = (days - dayofyr) * 24;
  const hr = Math.floor(temp);
  temp = (temp - hr) * 60;
  const minute = Math.floor(temp);
  const sec = (temp - minute) * 60;
  return { mon: i, day: dayofyr - inttemp, hr, minute, sec };
}

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
