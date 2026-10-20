import { describe, expect, it } from 'vitest';
import { nearestId } from './picking.ts';

/** Builds a w×h RGBA_INTEGER block with IDs at the given (col, row) cells. */
function block(w: number, h: number, ids: [number, number, number][]): Uint32Array {
  const texels = new Uint32Array(w * h * 4);
  for (const [col, row, id] of ids) texels[(row * w + col) * 4] = id;
  return texels;
}

describe('nearestId', () => {
  it('returns null when nothing was drawn', () => {
    expect(nearestId(block(5, 5, []), 5, 5, 2, 2)).toBeNull();
  });

  it('returns the instance index (ID − 1) nearest to the centre', () => {
    const texels = block(5, 5, [
      [0, 0, 7],
      [3, 2, 42],
      [4, 4, 9],
    ]);
    expect(nearestId(texels, 5, 5, 2, 2)).toBe(41);
  });

  it('handles an off-centre (clamped) region', () => {
    const texels = block(3, 3, [
      [0, 0, 5],
      [2, 2, 6],
    ]);
    expect(nearestId(texels, 3, 3, 0, 0)).toBe(4);
  });
});
