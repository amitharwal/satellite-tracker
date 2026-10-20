import { describe, expect, it } from 'vitest';
import { lookAt, mat4, multiply, perspective, transformPoint } from './math.ts';

function expectClose(actual: readonly number[], expected: readonly number[], digits = 5) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((v, i) => {
    expect(v).toBeCloseTo(expected[i] ?? Number.NaN, digits);
  });
}

describe('lookAt', () => {
  it('maps the eye to the origin and the target onto −z', () => {
    const view = lookAt(mat4(), [3, 0, 0], [0, 0, 0], [0, 0, 1]);
    expectClose(transformPoint(view, [3, 0, 0]), [0, 0, 0, 1]);
    expectClose(transformPoint(view, [0, 0, 0]), [0, 0, -3, 1]);
    // ECEF +z (north) is screen up; +y is screen right when looking from +x.
    expectClose(transformPoint(view, [0, 0, 1]), [0, 1, -3, 1]);
    expectClose(transformPoint(view, [0, 1, 0]), [1, 0, -3, 1]);
  });
});

describe('perspective', () => {
  it('maps near and far planes to NDC −1 and +1', () => {
    const proj = perspective(mat4(), Math.PI / 2, 1, 0.5, 10);
    const near = transformPoint(proj, [0, 0, -0.5]);
    const far = transformPoint(proj, [0, 0, -10]);
    expect(near[2] / near[3]).toBeCloseTo(-1, 5);
    expect(far[2] / far[3]).toBeCloseTo(1, 5);
  });

  it('maps the frustum edge to NDC ±1 (90° fov, aspect 2)', () => {
    const proj = perspective(mat4(), Math.PI / 2, 2, 0.1, 100);
    const p = transformPoint(proj, [2, 1, -1]);
    expect(p[0] / p[3]).toBeCloseTo(1, 5);
    expect(p[1] / p[3]).toBeCloseTo(1, 5);
  });
});

describe('multiply', () => {
  it('composes transforms right-to-left and tolerates aliasing', () => {
    const view = lookAt(mat4(), [0, 0, 5], [0, 0, 0], [0, 1, 0]);
    const proj = perspective(mat4(), Math.PI / 3, 1.5, 0.1, 50);
    const viewProj = multiply(mat4(), proj, view);
    const point = [0.3, -0.2, 1] as const;
    const direct = transformPoint(viewProj, point);
    const [x, y, z] = transformPoint(view, point);
    expectClose(direct, transformPoint(proj, [x, y, z]));

    const aliased = multiply(view, proj, view);
    expectClose(Array.from(aliased), Array.from(viewProj));
  });

  it('treats the identity as neutral', () => {
    const m = lookAt(mat4(), [1, 2, 3], [0, 0, 0], [0, 0, 1]);
    expectClose(Array.from(multiply(mat4(), mat4(), m)), Array.from(m));
  });
});
