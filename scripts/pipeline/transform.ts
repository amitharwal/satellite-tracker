import { createHash } from 'node:crypto';
import { SCHEMA_VERSION, type CatalogFile, type Manifest } from '../../src/data/schema.ts';
import type { OmmRecord } from './validate.ts';

/** Builds the columnar catalog, sorted by NORAD ID for deterministic output. */
export function buildCatalog(records: readonly OmmRecord[], generatedAt: Date): CatalogFile {
  const sorted = [...records].sort((a, b) => a.noradId - b.noradId);
  const pick = <K extends keyof OmmRecord>(key: K) => sorted.map((r) => r[key]);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    count: sorted.length,
    columns: {
      noradId: pick('noradId'),
      objectName: pick('objectName'),
      objectId: pick('objectId'),
      epoch: pick('epoch'),
      meanMotion: pick('meanMotion'),
      eccentricity: pick('eccentricity'),
      inclination: pick('inclination'),
      raOfAscNode: pick('raOfAscNode'),
      argOfPericenter: pick('argOfPericenter'),
      meanAnomaly: pick('meanAnomaly'),
      bstar: pick('bstar'),
      meanMotionDot: pick('meanMotionDot'),
      meanMotionDdot: pick('meanMotionDdot'),
    },
  };
}

export interface SerializedCatalog {
  fileName: string;
  body: string;
  manifest: Manifest;
}

/**
 * Serializes the catalog and its manifest. JSON.stringify emits the shortest
 * decimal that round-trips each double, so the app parses back exactly the
 * values Number() produced from the CelesTrak text.
 */
export function serializeCatalog(
  catalog: CatalogFile,
  source: Manifest['source'],
): SerializedCatalog {
  const body = JSON.stringify(catalog);
  const sha256 = createHash('sha256').update(body).digest('hex');
  const fileName = `catalog.${sha256.slice(0, 12)}.json`;
  return {
    fileName,
    body,
    manifest: {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: catalog.generatedAt,
      count: catalog.count,
      file: fileName,
      sha256,
      bytes: Buffer.byteLength(body),
      source,
    },
  };
}
