import { describe, expect, it } from 'vitest';
import { occluded } from './labels.ts';

describe('occluded', () => {
  const eye = [5, 0, 0] as const;
  it('hides points behind the sphere', () => {
    expect(occluded(eye, [-60, 0, 0], 1)).toBe(true);
  });
  it('shows points in front of or beside the sphere', () => {
    expect(occluded(eye, [2, 0, 0], 1)).toBe(false);
    expect(occluded(eye, [-60, 30, 0], 1)).toBe(false);
  });
});
