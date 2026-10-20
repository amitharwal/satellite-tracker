import { describe, expect, it } from 'vitest';
import { createEllipsoidMesh, WGS84_FLATTENING } from './ellipsoid.ts';

const mesh = createEllipsoidMesh(8, 16);

type Vec = [number, number, number];

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function vertex(array: Float32Array, i: number): Vec {
  return [array[i * 3] ?? NaN, array[i * 3 + 1] ?? NaN, array[i * 3 + 2] ?? NaN];
}

describe('createEllipsoidMesh', () => {
  it('has (lat+1)×(lon+1) vertices and 6 indices per quad', () => {
    expect(mesh.positions.length).toBe(9 * 17 * 3);
    expect(mesh.uvs.length).toBe(9 * 17 * 2);
    expect(mesh.indices.length).toBe(8 * 16 * 6);
    expect(mesh.indices).toBeInstanceOf(Uint16Array);
  });

  it('switches to 32-bit indices past 65,536 vertices', () => {
    expect(createEllipsoidMesh(256, 512).indices).toBeInstanceOf(Uint32Array);
  });

  it('places every vertex on the WGS84 ellipsoid', () => {
    const b = 1 - WGS84_FLATTENING;
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      const [x, y, z] = vertex(mesh.positions, i);
      expect(x * x + y * y + (z * z) / (b * b)).toBeCloseTo(1, 6);
    }
  });

  it('puts the north pole at the top row, lon −180° at u = 0, and 0° lon at +x', () => {
    expect(vertex(mesh.positions, 0)[2]).toBeCloseTo(1 - WGS84_FLATTENING, 6);
    // Row 4 is the equator; column 8 of 16 is longitude 0.
    const equatorLon0 = 4 * 17 + 8;
    expect(vertex(mesh.positions, equatorLon0)).toEqual([1, 0, 0]);
    expect([mesh.uvs[equatorLon0 * 2], mesh.uvs[equatorLon0 * 2 + 1]]).toEqual([0.5, 0.5]);
    // Column 12 is +90° (east), which is +y in ECEF.
    const [x, y] = vertex(mesh.positions, 4 * 17 + 12);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(1, 6);
  });

  it('has unit normals and counter-clockwise triangles seen from outside', () => {
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [ia, ib, ic] = [
        mesh.indices[t] ?? 0,
        mesh.indices[t + 1] ?? 0,
        mesh.indices[t + 2] ?? 0,
      ];
      const a = vertex(mesh.positions, ia);
      const b = vertex(mesh.positions, ib);
      const c = vertex(mesh.positions, ic);
      const e1 = sub(b, a);
      const e2 = sub(c, a);
      const n = cross(e1, e2);
      if (Math.hypot(...n) < 1e-9) continue; // degenerate triangles at the poles
      const centroid: Vec = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
      const outward = dot(n, centroid);
      expect(outward).toBeGreaterThan(0);
    }
    for (let i = 0; i < mesh.normals.length / 3; i++) {
      expect(Math.hypot(...vertex(mesh.normals, i))).toBeCloseTo(1, 6);
    }
  });
});
