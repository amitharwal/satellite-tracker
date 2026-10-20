import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CatalogFile } from '../../src/data/schema.ts';
import { parseCsv } from './csv.ts';
import { buildCatalog, serializeCatalog } from './transform.ts';
import { OMM_CSV_HEADER, validateOmmCsv } from './validate.ts';

const fixture = readFileSync(
  new URL('../../test/fixtures/omm-sample.csv', import.meta.url),
  'utf8',
);
const now = new Date('2026-10-21T00:00:00Z');
const { records } = validateOmmCsv(parseCsv(fixture), {
  now,
  maxEpochAgeDays: 60,
  maxEpochFutureDays: 7,
});
const source = {
  url: 'https://example.test',
  fetchedAt: now.toISOString(),
  rowsRead: 5,
  rowsRejected: 0,
};

describe('buildCatalog', () => {
  it('produces equal-length columns sorted by NORAD ID', () => {
    const catalog = buildCatalog(records, now);
    expect(catalog.count).toBe(5);
    expect(catalog.columns.noradId).toEqual([900, 25544, 40000, 45000, 101108]);
    for (const column of Object.values(catalog.columns)) {
      expect(column).toHaveLength(5);
    }
    expect(catalog.columns.objectName[1]).toBe('ISS (ZARYA)');
  });
});

describe('serializeCatalog', () => {
  const { fileName, body, manifest } = serializeCatalog(buildCatalog(records, now), source);

  it('names the file by content hash and records it in the manifest', () => {
    const sha256 = createHash('sha256').update(body).digest('hex');
    expect(fileName).toBe(`catalog.${sha256.slice(0, 12)}.json`);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      count: 5,
      file: fileName,
      sha256,
      bytes: Buffer.byteLength(body),
      source,
    });
  });

  it('round-trips every numeric field bit-exactly against the source text', () => {
    const parsed = JSON.parse(body) as CatalogFile;
    const rows = parseCsv(fixture).slice(1);
    const col = (name: (typeof OMM_CSV_HEADER)[number]) => OMM_CSV_HEADER.indexOf(name);
    const pairs = [
      ['meanMotion', 'MEAN_MOTION'],
      ['eccentricity', 'ECCENTRICITY'],
      ['inclination', 'INCLINATION'],
      ['raOfAscNode', 'RA_OF_ASC_NODE'],
      ['argOfPericenter', 'ARG_OF_PERICENTER'],
      ['meanAnomaly', 'MEAN_ANOMALY'],
      ['bstar', 'BSTAR'],
      ['meanMotionDot', 'MEAN_MOTION_DOT'],
      ['meanMotionDdot', 'MEAN_MOTION_DDOT'],
    ] as const;
    for (const row of rows) {
      const i = parsed.columns.noradId.indexOf(Number(row[col('NORAD_CAT_ID')]));
      for (const [key, column] of pairs) {
        expect(Object.is(parsed.columns[key][i], parseFloat(row[col(column)] ?? ''))).toBe(true);
      }
    }
  });
});
