// Shared contract between the data pipeline (scripts/pipeline) and the app.
// Bump SCHEMA_VERSION on any incompatible change to CatalogFile or Manifest.

export const SCHEMA_VERSION = 1;

export const MANIFEST_FILE = 'manifest.json';

/**
 * Columnar catalog: every array in `columns` has length `count`, and index i
 * across all columns describes one object. Element values are the CelesTrak
 * OMM mean elements (SGP4 theory), parsed to IEEE-754 doubles.
 */
export interface CatalogFile {
  schemaVersion: typeof SCHEMA_VERSION;
  generatedAt: string;
  count: number;
  columns: CatalogColumns;
}

export interface CatalogColumns {
  /** NORAD catalog number (may exceed 5 digits). */
  noradId: number[];
  objectName: string[];
  /** International designator, e.g. "1998-067A". */
  objectId: string[];
  /** Element set epoch, UTC, ISO 8601 without zone (microsecond precision). */
  epoch: string[];
  /** rev/day */
  meanMotion: number[];
  eccentricity: number[];
  /** deg */
  inclination: number[];
  /** deg */
  raOfAscNode: number[];
  /** deg */
  argOfPericenter: number[];
  /** deg */
  meanAnomaly: number[];
  /** 1/earth radii */
  bstar: number[];
  /** rev/day^2 (not used by SGP4; informational) */
  meanMotionDot: number[];
  /** rev/day^3 (not used by SGP4; informational) */
  meanMotionDdot: number[];
}

export interface Manifest {
  schemaVersion: typeof SCHEMA_VERSION;
  generatedAt: string;
  count: number;
  /** Catalog file name, relative to the manifest. Content-hashed for caching. */
  file: string;
  sha256: string;
  bytes: number;
  source: {
    url: string;
    fetchedAt: string;
    rowsRead: number;
    rowsRejected: number;
  };
}
