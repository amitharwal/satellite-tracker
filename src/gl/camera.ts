import { lookAt, perspective, type Mat4, type Vec3 } from './math.ts';

/** Camera pose around the scene origin, with +z up (Earth's north, or ecliptic north). */
export interface Orbit {
  /** Longitude of the eye, radians (unbounded while dragging; wrapped on flyTo). */
  azimuth: number;
  /** Latitude of the eye, radians. */
  elevation: number;
  /** Distance from the origin, scene units (Earth radii or au). */
  distance: number;
}

export interface CameraLimits {
  /** Radius of the central body; altitude is measured from its surface. */
  radius: number;
  minAltitude: number;
  maxAltitude: number;
  /** How far beyond the origin the far plane reaches (scene units). */
  farMargin: number;
}

export const MIN_ALTITUDE = 0.02; // ~130 km above the equatorial radius
/** Far enough out to see the Moon's orbit (~60 Earth radii). */
export const MAX_ALTITUDE = 150;

/** Earth view: Earth radii, room for the Moon behind the globe. */
export const EARTH_LIMITS: CameraLimits = {
  radius: 1,
  minAltitude: MIN_ALTITUDE,
  maxAltitude: MAX_ALTITUDE,
  farMargin: 70,
};
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
  readonly limits: CameraLimits;

  constructor(
    initial: Orbit = { azimuth: 0, elevation: 0.35, distance: 3.5 },
    limits: CameraLimits = EARTH_LIMITS,
  ) {
    this.limits = limits;
    const pose = { ...initial, distance: this.clampDistance(initial.distance) };
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
      (this.fovY / viewportHeightPx) * clamp(this.target.distance - this.limits.radius, 0.002, 1.5);
    this.target.azimuth -= dxPx * radiansPerPx;
    this.target.elevation = clamp(
      this.target.elevation + dyPx * radiansPerPx,
      -MAX_ELEVATION,
      MAX_ELEVATION,
    );
  }

  /** Zooms by scaling altitude: factor < 1 moves closer. */
  zoom(factor: number): void {
    const r = this.limits.radius;
    this.target.distance = this.clampDistance(r + (this.target.distance - r) * factor);
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
    if (pose.distance !== undefined) this.target.distance = this.clampDistance(pose.distance);
  }

  /** Advances smoothing. Returns true while still moving. */
  update(dtSeconds: number): boolean {
    const k = 1 - Math.exp(-Math.max(0, dtSeconds) / SMOOTHING_TAU);
    const c = this.current;
    const t = this.target;
    c.azimuth += (t.azimuth - c.azimuth) * k;
    c.elevation += (t.elevation - c.elevation) * k;
    // Interpolate altitude geometrically so zoom feels uniform at all scales.
    const r = this.limits.radius;
    const altitude = (c.distance - r) * Math.pow((t.distance - r) / (c.distance - r), k);
    c.distance = r + altitude;

    const moving =
      Math.abs(t.azimuth - c.azimuth) > 1e-6 ||
      Math.abs(t.elevation - c.elevation) > 1e-6 ||
      Math.abs(t.distance - c.distance) > 1e-6 * t.distance;
    if (!moving) Object.assign(c, t);
    return moving;
  }

  private clampDistance(distance: number): number {
    const { radius, minAltitude, maxAltitude } = this.limits;
    return radius + clamp(distance - radius, minAltitude, maxAltitude);
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
    const altitude = this.current.distance - this.limits.radius;
    const near = clamp(altitude * 0.5, 0.001, 1);
    const far = this.current.distance + this.limits.farMargin;
    return perspective(out, effectiveFovY(this.fovY, aspect), aspect, near, far);
  }
}

/** Vertical field of view that keeps `fov` across the narrower viewport axis. */
export function effectiveFovY(fov: number, aspect: number): number {
  return aspect >= 1 ? fov : 2 * Math.atan(Math.tan(fov / 2) / aspect);
}

/** Wraps an angle to (−π, π]. */
export function wrapAngle(a: number): number {
  const r = ((((a + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;
  return r === -Math.PI ? Math.PI : r;
}
