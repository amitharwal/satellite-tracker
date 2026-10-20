import { lookAt, perspective, type Mat4, type Vec3 } from './math.ts';

/** Camera pose around the Earth's center, ECEF-aligned with +z (north) up. */
export interface Orbit {
  /** Longitude of the eye, radians (unbounded while dragging; wrapped on flyTo). */
  azimuth: number;
  /** Latitude of the eye, radians. */
  elevation: number;
  /** Distance from the Earth's center, Earth radii. */
  distance: number;
}

export const MIN_ALTITUDE = 0.02; // ~130 km above the equatorial radius
export const MAX_ALTITUDE = 60;
const MAX_ELEVATION = Math.PI / 2 - 0.01;
const FOV_Y = (45 * Math.PI) / 180;
/** Time constant of the exponential smoothing, seconds. */
const SMOOTHING_TAU = 0.12;
const TWO_PI = 2 * Math.PI;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Orbit camera: input moves a target pose, and the current pose follows it
 * with frame-rate-independent exponential smoothing.
 */
export class OrbitCamera {
  readonly fovY = FOV_Y;
  readonly current: Orbit;
  readonly target: Orbit;

  constructor(initial: Orbit = { azimuth: 0, elevation: 0.35, distance: 3.5 }) {
    const pose = { ...initial, distance: clampDistance(initial.distance) };
    pose.elevation = clamp(pose.elevation, -MAX_ELEVATION, MAX_ELEVATION);
    this.current = { ...pose };
    this.target = { ...pose };
  }

  /**
   * Rotates by a pointer drag. Scaled by altitude so the surface roughly
   * follows the cursor up close and the globe doesn't spin wildly from afar.
   */
  rotate(dxPx: number, dyPx: number, viewportHeightPx: number): void {
    const radiansPerPx =
      (this.fovY / viewportHeightPx) * clamp(this.target.distance - 1, 0.002, 1.5);
    this.target.azimuth -= dxPx * radiansPerPx;
    this.target.elevation = clamp(
      this.target.elevation + dyPx * radiansPerPx,
      -MAX_ELEVATION,
      MAX_ELEVATION,
    );
  }

  /** Zooms by scaling altitude: factor < 1 moves closer. */
  zoom(factor: number): void {
    this.target.distance = clampDistance(1 + (this.target.distance - 1) * factor);
  }

  /** Smoothly moves to a pose, taking the short way around in azimuth. */
  flyTo(pose: Partial<Orbit>): void {
    if (pose.azimuth !== undefined) {
      const delta = wrapAngle(pose.azimuth - this.current.azimuth);
      this.target.azimuth = this.current.azimuth + delta;
    }
    if (pose.elevation !== undefined) {
      this.target.elevation = clamp(pose.elevation, -MAX_ELEVATION, MAX_ELEVATION);
    }
    if (pose.distance !== undefined) this.target.distance = clampDistance(pose.distance);
  }

  /** Advances smoothing. Returns true while still moving. */
  update(dtSeconds: number): boolean {
    const k = 1 - Math.exp(-Math.max(0, dtSeconds) / SMOOTHING_TAU);
    const c = this.current;
    const t = this.target;
    c.azimuth += (t.azimuth - c.azimuth) * k;
    c.elevation += (t.elevation - c.elevation) * k;
    // Interpolate altitude geometrically so zoom feels uniform at all scales.
    const altitude = (c.distance - 1) * Math.pow((t.distance - 1) / (c.distance - 1), k);
    c.distance = 1 + altitude;

    const moving =
      Math.abs(t.azimuth - c.azimuth) > 1e-6 ||
      Math.abs(t.elevation - c.elevation) > 1e-6 ||
      Math.abs(t.distance - c.distance) > 1e-6 * t.distance;
    if (!moving) Object.assign(c, t);
    return moving;
  }

  eye(): Vec3 {
    const { azimuth, elevation, distance } = this.current;
    const cosEl = Math.cos(elevation);
    return [
      distance * cosEl * Math.cos(azimuth),
      distance * cosEl * Math.sin(azimuth),
      distance * Math.sin(elevation),
    ];
  }

  viewMatrix(out: Mat4): Mat4 {
    return lookAt(out, this.eye(), [0, 0, 0], [0, 0, 1]);
  }

  /**
   * Near/far planes adapt to altitude to keep depth precision usable. In
   * portrait viewports the field of view is held horizontally instead, so
   * the globe fits the narrow dimension.
   */
  projectionMatrix(out: Mat4, aspect: number): Mat4 {
    const altitude = this.current.distance - 1;
    const near = clamp(altitude * 0.5, 0.001, 1);
    const far = this.current.distance + 12; // beyond GEO (6.6 ER) on the far side
    return perspective(out, effectiveFovY(this.fovY, aspect), aspect, near, far);
  }
}

/** Vertical field of view that keeps `fov` across the narrower viewport axis. */
export function effectiveFovY(fov: number, aspect: number): number {
  return aspect >= 1 ? fov : 2 * Math.atan(Math.tan(fov / 2) / aspect);
}

function clampDistance(distance: number): number {
  return 1 + clamp(distance - 1, MIN_ALTITUDE, MAX_ALTITUDE);
}

/** Wraps an angle to (−π, π]. */
export function wrapAngle(a: number): number {
  const r = ((((a + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;
  return r === -Math.PI ? Math.PI : r;
}
