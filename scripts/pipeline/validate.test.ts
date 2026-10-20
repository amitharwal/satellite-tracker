import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.ts';
import { OMM_CSV_HEADER, validateOmmCsv } from './validate.ts';

const fixture = readFileSync(
  new URL('../../test/fixtures/omm-sample.csv', import.meta.url),
  'utf8',
);
const options = {
  now: new Date('2026-10-21T00:00:00Z'),
  maxEpochAgeDays: 60,
  maxEpochFutureDays: 7,
};

const HEADER = OMM_CSV_HEADER.join(',');
const GOOD_ROW =
  'SAT,2000-001A,2026-10-20T00:00:00.000000,15.5,.001,51.6,10,20,30,0,U,12345,999,1,.1E-3,.1E-4,0';

/** Returns GOOD_ROW with the named column replaced. */
function rowWith(column: (typeof OMM_CSV_HEADER)[number], value: string): string {
  const fields = GOOD_ROW.split(',');
  fields[OMM_CSV_HEADER.indexOf(column)] = value;
  return fields.join(',');
}

function validate(...rows: string[]) {
  return validateOmmCsv(parseCsv([HEADER, ...rows].join('\n')), options);
}

describe('validateOmmCsv', () => {
  it('accepts every row of the fixture, including 6-digit catalog numbers', () => {
    const { records, rejections } = validateOmmCsv(parseCsv(fixture), options);
    expect(rejections).toEqual([]);
    expect(records.map((r) => r.noradId)).toEqual([25544, 900, 45000, 40000, 101108]);
  });

  it('parses values exactly as Number() does on the source text', () => {
    const { records } = validateOmmCsv(parseCsv(fixture), options);
    const iss = records[0];
    expect(iss).toMatchObject({
      objectName: 'ISS (ZARYA)',
      objectId: '1998-067A',
      epoch: '2026-10-20T12:00:00.123456',
      meanMotion: 15.50103472,
      eccentricity: 0.0004781,
      bstar: 0.00018403,
      meanMotionDot: 0.0001027,
    });
    expect(iss?.epochMs).toBe(Date.UTC(2026, 9, 20, 12, 0, 0, 123));
  });

  it('throws on a header that does not match exactly', () => {
    const header = HEADER.replace('BSTAR', 'B_STAR');
    expect(() => validateOmmCsv(parseCsv(`${header}\n${GOOD_ROW}`), options)).toThrow(
      /Unexpected CSV header/,
    );
  });

  it.each([
    ['ECCENTRICITY', '1.0', /ECCENTRICITY out of range/],
    ['ECCENTRICITY', '-.1', /ECCENTRICITY out of range/],
    ['INCLINATION', '180.1', /INCLINATION out of range/],
    ['MEAN_ANOMALY', '360.5', /MEAN_ANOMALY out of range/],
    ['MEAN_MOTION', '0', /MEAN_MOTION must be > 0/],
    ['MEAN_MOTION', 'abc', /MEAN_MOTION is not a number/],
    ['BSTAR', '', /BSTAR is not a number/],
    ['NORAD_CAT_ID', '12a', /NORAD_CAT_ID is not an integer/],
    ['NORAD_CAT_ID', '0', /NORAD_CAT_ID out of range/],
    ['EPHEMERIS_TYPE', '2', /unsupported EPHEMERIS_TYPE/],
    ['EPOCH', '2026-10-20 00:00:00', /EPOCH malformed/],
    ['EPOCH', '2026-02-30T00:00:00', /EPOCH invalid/],
    ['EPOCH', '2026-10-29T00:00:00', /EPOCH more than 7 days ahead/],
    ['EPOCH', '2026-08-01T00:00:00', /EPOCH older than 60 days/],
  ] as const)('rejects %s = "%s"', (column, value, reason) => {
    const { records, rejections } = validate(rowWith(column, value));
    expect(records).toEqual([]);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]?.reason).toMatch(reason);
  });

  it('rejects duplicate catalog numbers, keeping the first', () => {
    const { records, rejections } = validate(GOOD_ROW, GOOD_ROW);
    expect(records).toHaveLength(1);
    expect(rejections).toEqual([{ row: 2, noradId: '12345', reason: 'duplicate NORAD_CAT_ID' }]);
  });

  it('accepts epochs a few days ahead (long-period HEO objects)', () => {
    const { records } = validate(rowWith('EPOCH', '2026-10-22T00:11:19.657824'));
    expect(records).toHaveLength(1);
  });

  it('allows blank object names', () => {
    const { records } = validate(rowWith('OBJECT_NAME', ''));
    expect(records[0]?.objectName).toBe('');
  });
});
