import { gmst, type JulianDate } from './time.ts';

/** Earth rotation rate, rad/s (Vallado's teme2ecef, length-of-day correction ignored). */
export const EARTH_ROTATION_RAD_S = 7.29211514670698e-5;
/**
 * WGS84 equatorial radius, km. Positions handed to the renderer are divided by
 * this, matching the WGS84 ellipsoid it draws.
 */
export const EARTH_RADIUS_KM = 6378.137;

/**
 * TEME → ECEF (pseudo Earth-fixed): rotation by IAU-82 GMST about z, polar
 * motion ignored. `gmstRad` should come from `gmst()` at the same instant.
 * Writes into `out` at `offset` (xyz).
 */
export function temeToEcefPosition(
  r: ArrayLike<number>,
  gmstRad: number,
  out: Float64Array | Float32Array | number[],
  offset = 0,
  scale = 1,
): void {
  const c = Math.cos(gmstRad);
  const s = Math.sin(gmstRad);
  const x = r[0] ?? 0;
  const y = r[1] ?? 0;
  out[offset] = (c * x + s * y) * scale;
  out[offset + 1] = (-s * x + c * y) * scale;
  out[offset + 2] = (r[2] ?? 0) * scale;
}

/** TEME → ECEF velocity (km/s), including the Earth-rotation term ω × r. */
export function temeToEcefVelocity(
  r: ArrayLike<number>,
  v: ArrayLike<number>,
  gmstRad: number,
  out: Float64Array | number[],
): void {
  const c = Math.cos(gmstRad);
  const s = Math.sin(gmstRad);
  const rx = c * (r[0] ?? 0) + s * (r[1] ?? 0);
  const ry = -s * (r[0] ?? 0) + c * (r[1] ?? 0);
  const vx = c * (v[0] ?? 0) + s * (v[1] ?? 0);
  const vy = -s * (v[0] ?? 0) + c * (v[1] ?? 0);
  out[0] = vx + EARTH_ROTATION_RAD_S * ry;
  out[1] = vy - EARTH_ROTATION_RAD_S * rx;
  out[2] = v[2] ?? 0;
}

/** Minutes from an element-set epoch to `date`, computed from split dates. */
export function minutesSinceEpoch(epoch: JulianDate, date: JulianDate): number {
  return (date.jd - epoch.jd + (date.frac - epoch.frac)) * 1440;
}

export { gmst };
