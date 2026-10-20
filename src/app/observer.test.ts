import { describe, expect, it } from 'vitest';
import { parseObserver } from './observer.ts';

describe('parseObserver', () => {
  it('accepts valid stored locations', () => {
    expect(parseObserver({ latitude: 52.52, longitude: 13.4, source: 'device' })).toEqual({
      latitude: 52.52,
      longitude: 13.4,
      source: 'device',
    });
    expect(parseObserver({ latitude: -33.9, longitude: 151.2 })?.source).toBe('manual');
  });

  it('rejects malformed or out-of-range values', () => {
    expect(parseObserver(null)).toBeNull();
    expect(parseObserver('52,13')).toBeNull();
    expect(parseObserver({ latitude: '52', longitude: 13 })).toBeNull();
    expect(parseObserver({ latitude: 91, longitude: 0 })).toBeNull();
    expect(parseObserver({ latitude: 0, longitude: Number.NaN })).toBeNull();
  });
});
