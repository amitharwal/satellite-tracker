import type { SingleSatellite } from './details.ts';
import { EARTH_RADIUS_KM } from './frames.ts';
import { geodeticToEcef } from './geodetic.ts';
import { sunDirectionEcef } from './sun.ts';
import { julianDateFromUnixMs } from './time.ts';

export interface Observer {
  /** Geodetic latitude and longitude, rad. */
  latitude: number;
  longitude: number;
  /** Height above the WGS84 ellipsoid, km. */
  height: number;
}

export interface LookAngles {
  /** rad, clockwise from north. */
  azimuth: number;
  /** rad above the horizon (no refraction). */
  elevation: number;
  /** km. */
  range: number;
}

export interface PassPoint extends LookAngles {
  /** Unix ms. */
  t: number;
}

export interface Pass {
  /** Null when the pass was already in progress at the start of the search window. */
  rise: PassPoint | null;
  peak: PassPoint;
  /** Null when the satellite is still up at the end of the search window. */
  set: PassPoint | null;
  /** Interval during which it is visible to the naked eye, if any. */
  visible: { start: number; end: number } | null;
}

export interface PassOptions {
  /** Search window start (Unix ms) and length (ms). */
  startMs: number;
  durationMs: number;
  /** Passes whose peak is below this are dropped, rad. Default 0. */
  minPeakElevation?: number;
  /** Stop after this many passes. */
  maxPasses?: number;
}

const DEG = Math.PI / 180;
/** Observer must be in at least civil twilight. */
const OBSERVER_DARK_SUN_ELEVATION = -6 * DEG;
/** Below this a satellite is hard to see even when sunlit. */
const VISIBLE_MIN_ELEVATION = 10 * DEG;
const REFINE_MS = 500;

/** Observer position (km, ECEF) and local east/north/up unit vectors. */
export function observerFrame(o: Observer) {
  const position = [0, 0, 0];
  geodeticToEcef(o.latitude, o.longitude, o.height, position);
  const sl = Math.sin(o.latitude);
  const cl = Math.cos(o.latitude);
  const so = Math.sin(o.longitude);
  const co = Math.cos(o.longitude);
  return {
    position,
    east: [-so, co, 0],
    north: [-sl * co, -sl * so, cl],
    up: [cl * co, cl * so, sl],
  };
}

type Frame = ReturnType<typeof observerFrame>;
const dot = (a: readonly number[], b: readonly number[]) =>
  (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);

/** Topocentric azimuth/elevation/range of an ECEF position (km). */
export function lookAngles(frame: Frame, ecef: readonly number[]): LookAngles {
  const rho = [
    (ecef[0] ?? 0) - (frame.position[0] ?? 0),
    (ecef[1] ?? 0) - (frame.position[1] ?? 0),
    (ecef[2] ?? 0) - (frame.position[2] ?? 0),
  ];
  const range = Math.hypot(...rho);
  const e = dot(rho, frame.east);
  const n = dot(rho, frame.north);
  const u = dot(rho, frame.up);
  let azimuth = Math.atan2(e, n);
  if (azimuth < 0) azimuth += 2 * Math.PI;
  // Clamp: rounding can push |u / range| just past 1 directly overhead.
  return { azimuth, elevation: Math.asin(Math.min(1, Math.max(-1, u / range))), range };
}

/** True if an ECEF position (km) is in Earth's (cylindrical) shadow. */
export function inEarthShadow(ecef: readonly number[], sun: readonly number[]): boolean {
  const along = dot(ecef, sun);
  if (along >= 0) return false;
  const perp = Math.sqrt(Math.max(0, dot(ecef, ecef) - along * along));
  return perp < EARTH_RADIUS_KM;
}

/**
 * Finds passes of one satellite over an observer: coarse scan, then rise/set
 * refined by bisection (< 1 s) and the peak by golden-section search.
 */
export function findPasses(
  satellite: SingleSatellite,
  observer: Observer,
  options: PassOptions,
): Pass[] {
  const frame = observerFrame(observer);
  const minPeak = options.minPeakElevation ?? 0;
  const maxPasses = options.maxPasses ?? Infinity;
  // ~1/300 of an orbit, clamped to [10 s, 120 s]: short LEO passes aren't skipped.
  const stepMs = Math.min(120_000, Math.max(10_000, (satellite.summary.period * 60_000) / 300));
  const endMs = options.startMs + options.durationMs;

  const look = (t: number): PassPoint | null => {
    const state = satellite.at(t);
    return state ? { t, ...lookAngles(frame, state.ecef) } : null;
  };
  const elevation = (t: number) => look(t)?.elevation ?? -Math.PI / 2;

  /** Bisects the horizon crossing between a (below/above) and b (opposite). */
  const crossing = (a: number, b: number): PassPoint | null => {
    const aboveAtA = elevation(a) > 0;
    let lo = a;
    let hi = b;
    while (hi - lo > REFINE_MS) {
      const mid = (lo + hi) / 2;
      if (elevation(mid) > 0 === aboveAtA) lo = mid;
      else hi = mid;
    }
    return look((lo + hi) / 2);
  };

  /** Golden-section search for the elevation maximum in [a, b]. */
  const peakIn = (a: number, b: number): PassPoint | null => {
    const g = (Math.sqrt(5) - 1) / 2;
    let lo = a;
    let hi = b;
    let x1 = hi - g * (hi - lo);
    let x2 = lo + g * (hi - lo);
    let f1 = elevation(x1);
    let f2 = elevation(x2);
    while (hi - lo > REFINE_MS) {
      if (f1 < f2) {
        lo = x1;
        x1 = x2;
        f1 = f2;
        x2 = lo + g * (hi - lo);
        f2 = elevation(x2);
      } else {
        hi = x2;
        x2 = x1;
        f2 = f1;
        x1 = hi - g * (hi - lo);
        f1 = elevation(x1);
      }
    }
    return look((lo + hi) / 2);
  };

  const visibility = (start: number, end: number): Pass['visible'] => {
    let first: number | null = null;
    let last: number | null = null;
    const step = Math.max(5_000, (end - start) / 120);
    for (let t = start; t <= end; t += step) {
      const state = satellite.at(t);
      if (!state) continue;
      const angles = lookAngles(frame, state.ecef);
      const sun = sunDirectionEcef(julianDateFromUnixMs(t));
      const observerSunElevation = Math.asin(dot(frame.up, sun));
      const visible =
        angles.elevation >= VISIBLE_MIN_ELEVATION &&
        observerSunElevation < OBSERVER_DARK_SUN_ELEVATION &&
        !inEarthShadow(state.ecef, sun);
      if (visible) {
        first ??= t;
        last = t;
      }
    }
    return first !== null && last !== null ? { start: first, end: last } : null;
  };

  const passes: Pass[] = [];
  let prevT = options.startMs;
  let prevUp = elevation(prevT) > 0;
  let riseT: number | null = prevUp ? null : NaN; // null: already up at the window start
  let rise: PassPoint | null = null;

  const finish = (setT: number | null, set: PassPoint | null) => {
    const from = rise?.t ?? options.startMs;
    const to = setT ?? endMs;
    const peak = peakIn(from, to);
    if (peak && peak.elevation >= minPeak) {
      passes.push({ rise, peak, set, visible: visibility(from, to) });
    }
  };

  for (
    let t = options.startMs + stepMs;
    t <= endMs + stepMs && passes.length < maxPasses;
    t += stepMs
  ) {
    const now = Math.min(t, endMs);
    const up = elevation(now) > 0;
    if (up && !prevUp) {
      rise = crossing(prevT, now);
      riseT = rise?.t ?? now;
    } else if (!up && prevUp) {
      const set = crossing(prevT, now);
      finish(set?.t ?? now, set);
      rise = null;
      riseT = NaN;
    }
    prevT = now;
    prevUp = up;
    if (now === endMs) break;
  }
  // Still up at the end of the window (includes satellites that never set).
  if (prevUp && passes.length < maxPasses && (riseT === null || !Number.isNaN(riseT))) {
    finish(null, null);
  }
  return passes;
}
