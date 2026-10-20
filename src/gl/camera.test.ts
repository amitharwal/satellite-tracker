import { describe, expect, it } from 'vitest';
import { MAX_ALTITUDE, MIN_ALTITUDE, OrbitCamera, wrapAngle } from './camera.ts';
import { mat4, transformPoint } from './math.ts';

/** Runs the camera at 60 fps for the given duration. */
function settle(camera: OrbitCamera, seconds = 3) {
  for (let t = 0; t < seconds; t += 1 / 60) camera.update(1 / 60);
}

describe('OrbitCamera', () => {
  it('places the eye from azimuth, elevation and distance (ECEF, z up)', () => {
    const camera = new OrbitCamera({ azimuth: Math.PI / 2, elevation: 0, distance: 2 });
    const [x, y, z] = camera.eye();
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(2, 12);
    expect(z).toBeCloseTo(0, 12);
  });

  it('looks at the Earth center', () => {
    const camera = new OrbitCamera({ azimuth: 1, elevation: 0.5, distance: 4 });
    const [x, y, z] = transformPoint(camera.viewMatrix(mat4()), [0, 0, 0]);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(0, 5);
    expect(z).toBeCloseTo(-4, 5);
  });

  it('smoothly converges to the target, independent of frame rate', () => {
    const a = new OrbitCamera();
    const b = new OrbitCamera();
    a.flyTo({ azimuth: 1, distance: 10 });
    b.flyTo({ azimuth: 1, distance: 10 });
    for (let i = 0; i < 30; i++) a.update(1 / 60);
    for (let i = 0; i < 15; i++) b.update(1 / 30);
    expect(a.current.azimuth).toBeCloseTo(b.current.azimuth, 9);
    expect(a.current.distance).toBeCloseTo(b.current.distance, 9);
    expect(a.current.azimuth).toBeLessThan(1);
    settle(a);
    expect(a.update(1 / 60)).toBe(false);
    expect(a.current).toEqual(a.target);
  });

  it('flies the short way around in azimuth', () => {
    const camera = new OrbitCamera({ azimuth: 3, elevation: 0, distance: 3 });
    camera.flyTo({ azimuth: -3 });
    expect(camera.target.azimuth).toBeCloseTo(2 * Math.PI - 3, 12);
  });

  it('clamps altitude and elevation', () => {
    const camera = new OrbitCamera();
    camera.zoom(1e-9);
    expect(camera.target.distance).toBeCloseTo(1 + MIN_ALTITUDE, 12);
    camera.zoom(1e9);
    expect(camera.target.distance).toBeCloseTo(1 + MAX_ALTITUDE, 12);
    camera.rotate(0, 1e6, 800);
    expect(camera.target.elevation).toBeLessThan(Math.PI / 2);
    camera.flyTo({ elevation: -10 });
    expect(camera.target.elevation).toBeGreaterThan(-Math.PI / 2);
  });

  it('rotates less per pixel when close to the surface', () => {
    const near = new OrbitCamera({ azimuth: 0, elevation: 0, distance: 1.1 });
    const far = new OrbitCamera({ azimuth: 0, elevation: 0, distance: 5 });
    near.rotate(100, 0, 800);
    far.rotate(100, 0, 800);
    expect(Math.abs(near.target.azimuth)).toBeLessThan(Math.abs(far.target.azimuth));
    // Dragging right moves the globe right, so the eye moves west.
    expect(far.target.azimuth).toBeLessThan(0);
  });

  it('keeps the near plane in front of the surface', () => {
    const camera = new OrbitCamera({ azimuth: 0, elevation: 0, distance: 1.05 });
    const proj = camera.projectionMatrix(mat4(), 1);
    const view = camera.viewMatrix(mat4());
    // The sub-camera surface point must have NDC z within (−1, 1).
    const [vx, vy, vz] = transformPoint(view, [1, 0, 0]);
    const [, , cz, cw] = transformPoint(proj, [vx, vy, vz]);
    expect(Math.abs(cz / cw)).toBeLessThan(1);
  });
});

describe('wrapAngle', () => {
  it('wraps into (−π, π]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-0.5)).toBeCloseTo(-0.5, 12);
    expect(wrapAngle(7)).toBeCloseTo(7 - 2 * Math.PI, 12);
  });
});
