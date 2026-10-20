import { describe, expect, it } from 'vitest';
import { assignGroups, GROUPS } from './groups.ts';
import { search, visibilityMask } from './search.ts';

const index = {
  names: [
    'ISS (ZARYA)',
    'STARLINK-1008',
    'STARLINK-30001',
    'COSMOS 2545',
    'COSMOS 2558',
    'NOAA 15',
  ],
  noradIds: [25544, 44714, 60001, 45358, 53328, 25338],
  objectIds: ['1998-067A', '2019-074B', '2024-101A', '2020-018A', '2022-089A', '1998-030A'],
};

const group = (id: string) => GROUPS.findIndex((g) => g.id === id);

describe('assignGroups', () => {
  it('matches constellations by name and GLONASS by name plus orbit', () => {
    const groups = assignGroups(
      index.names,
      [15.5, 15.06, 15.06, 2.1314, 15.9, 14.26],
      [51.6, 53, 43, 64.8, 97.6, 98.6],
    );
    expect(Array.from(groups)).toEqual([
      group('stations'),
      group('starlink'),
      group('starlink'),
      group('glonass'),
      -1, // a LEO Cosmos is not GLONASS
      -1,
    ]);
  });
});

describe('search', () => {
  it('finds by name substring, case-insensitively, prefixes first', () => {
    expect(search(index, 'star')).toEqual([1, 2]);
    expect(search(index, '15')).toEqual([5]); // digits also match inside names (NOAA 15)
    expect(search(index, 'noaa')).toEqual([5]);
    expect(search(index, 'link')).toEqual([1, 2]);
  });

  it('finds by NORAD ID prefix and international designator', () => {
    expect(search(index, '2554')).toEqual([0]);
    expect(search(index, '1998-0')).toEqual([0, 5]);
  });

  it('caps results and ignores blank queries', () => {
    expect(search(index, 'S', 2)).toHaveLength(2);
    expect(search(index, '  ')).toEqual([]);
  });
});

describe('visibilityMask', () => {
  const groups = Int8Array.from([0, 0, 1, -1]);
  const regimes = Uint8Array.from([0, 0, 1, 2]);

  it('shows everything with no filters', () => {
    expect(
      Array.from(visibilityMask(groups, regimes, { groups: new Set(), regimes: new Set() })),
    ).toEqual([1, 1, 1, 1]);
  });

  it('intersects group and regime filters', () => {
    expect(
      Array.from(
        visibilityMask(groups, regimes, { groups: new Set([0, 1]), regimes: new Set([1]) }),
      ),
    ).toEqual([0, 0, 1, 0]);
    expect(
      Array.from(visibilityMask(groups, regimes, { groups: new Set(), regimes: new Set([2]) })),
    ).toEqual([0, 0, 0, 1]);
  });
});
