/** CelesTrak OMM CSV columns, in the order CelesTrak currently emits them. */
export const OMM_CSV_HEADER = [
  'OBJECT_NAME',
  'OBJECT_ID',
  'EPOCH',
  'MEAN_MOTION',
  'ECCENTRICITY',
  'INCLINATION',
  'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER',
  'MEAN_ANOMALY',
  'EPHEMERIS_TYPE',
  'CLASSIFICATION_TYPE',
  'NORAD_CAT_ID',
  'ELEMENT_SET_NO',
  'REV_AT_EPOCH',
  'BSTAR',
  'MEAN_MOTION_DOT',
  'MEAN_MOTION_DDOT',
] as const;

type OmmColumn = (typeof OMM_CSV_HEADER)[number];

export interface OmmRecord {
  noradId: number;
  objectName: string;
  objectId: string;
  epoch: string;
  epochMs: number;
  meanMotion: number;
  eccentricity: number;
  inclination: number;
  raOfAscNode: number;
  argOfPericenter: number;
  meanAnomaly: number;
  bstar: number;
  meanMotionDot: number;
  meanMotionDdot: number;
}

export interface Rejection {
  /** 1-based data row number (excluding the header). */
  row: number;
  noradId: string;
  reason: string;
}

export interface ValidationOptions {
  /** Reference time for epoch sanity checks. */
  now: Date;
  /** Reject element sets older than this many days. */
  maxEpochAgeDays: number;
  /**
   * Reject element sets whose epoch is more than this many days ahead. CelesTrak
   * publishes future epochs for some long-period, highly eccentric orbits.
   */
  maxEpochFutureDays: number;
}

export interface ValidationResult {
  records: OmmRecord[];
  rejections: Rejection[];
}

const DAY_MS = 86_400_000;
// CelesTrak emits e.g. 2026-10-20T09:24:57.921984 (UTC, no zone designator).
const EPOCH_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;
const DECIMAL_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const INTEGER_RE = /^\d+$/;

class RowError extends Error {}

function decimal(value: string, column: OmmColumn): number {
  if (!DECIMAL_RE.test(value)) throw new RowError(`${column} is not a number: "${value}"`);
  return Number(value);
}

function inRange(value: number, column: OmmColumn, min: number, max: number, maxInclusive = true) {
  const ok = value >= min && (maxInclusive ? value <= max : value < max);
  if (!ok) throw new RowError(`${column} out of range: ${value}`);
  return value;
}

/**
 * Checks the header matches exactly, then validates each row. Rows that fail
 * are returned as rejections rather than thrown, so the caller can decide
 * whether the rejection rate is acceptable.
 */
export function validateOmmCsv(rows: string[][], options: ValidationOptions): ValidationResult {
  const [header, ...data] = rows;
  if (!header) throw new Error('CSV is empty');
  if (header.join(',') !== OMM_CSV_HEADER.join(',')) {
    throw new Error(
      `Unexpected CSV header.\n  expected: ${OMM_CSV_HEADER.join(',')}\n  received: ${header.join(',')}`,
    );
  }

  const records: OmmRecord[] = [];
  const rejections: Rejection[] = [];
  const seen = new Set<number>();
  const nowMs = options.now.getTime();

  data.forEach((fields, index) => {
    const get = (column: OmmColumn): string => fields[OMM_CSV_HEADER.indexOf(column)] ?? '';
    try {
      const idText = get('NORAD_CAT_ID');
      if (!INTEGER_RE.test(idText))
        throw new RowError(`NORAD_CAT_ID is not an integer: "${idText}"`);
      const noradId = Number(idText);
      if (noradId < 1 || noradId > 999_999_999) {
        throw new RowError(`NORAD_CAT_ID out of range: ${noradId}`);
      }
      if (seen.has(noradId)) throw new RowError('duplicate NORAD_CAT_ID');

      // SGP4 mean elements only; other ephemeris types need a different propagator.
      if (get('EPHEMERIS_TYPE') !== '0') {
        throw new RowError(`unsupported EPHEMERIS_TYPE: "${get('EPHEMERIS_TYPE')}"`);
      }

      const epoch = get('EPOCH');
      if (!EPOCH_RE.test(epoch)) throw new RowError(`EPOCH malformed: "${epoch}"`);
      const epochMs = Date.parse(`${epoch}Z`);
      // Date.parse rolls over impossible dates (Feb 30 -> Mar 2), so round-trip it.
      if (
        Number.isNaN(epochMs) ||
        new Date(epochMs).toISOString().slice(0, 19) !== epoch.slice(0, 19)
      ) {
        throw new RowError(`EPOCH invalid: "${epoch}"`);
      }
      if (epochMs - nowMs > options.maxEpochFutureDays * DAY_MS) {
        throw new RowError(`EPOCH more than ${options.maxEpochFutureDays} days ahead: ${epoch}`);
      }
      if (nowMs - epochMs > options.maxEpochAgeDays * DAY_MS) {
        throw new RowError(`EPOCH older than ${options.maxEpochAgeDays} days: ${epoch}`);
      }

      const record: OmmRecord = {
        noradId,
        // CelesTrak may leave names blank for analyst objects; the UI falls back to the ID.
        objectName: get('OBJECT_NAME').trim(),
        objectId: get('OBJECT_ID').trim(),
        epoch,
        epochMs,
        meanMotion: decimal(get('MEAN_MOTION'), 'MEAN_MOTION'),
        eccentricity: inRange(
          decimal(get('ECCENTRICITY'), 'ECCENTRICITY'),
          'ECCENTRICITY',
          0,
          1,
          false,
        ),
        inclination: inRange(decimal(get('INCLINATION'), 'INCLINATION'), 'INCLINATION', 0, 180),
        raOfAscNode: inRange(
          decimal(get('RA_OF_ASC_NODE'), 'RA_OF_ASC_NODE'),
          'RA_OF_ASC_NODE',
          0,
          360,
        ),
        argOfPericenter: inRange(
          decimal(get('ARG_OF_PERICENTER'), 'ARG_OF_PERICENTER'),
          'ARG_OF_PERICENTER',
          0,
          360,
        ),
        meanAnomaly: inRange(decimal(get('MEAN_ANOMALY'), 'MEAN_ANOMALY'), 'MEAN_ANOMALY', 0, 360),
        bstar: decimal(get('BSTAR'), 'BSTAR'),
        meanMotionDot: decimal(get('MEAN_MOTION_DOT'), 'MEAN_MOTION_DOT'),
        meanMotionDdot: decimal(get('MEAN_MOTION_DDOT'), 'MEAN_MOTION_DDOT'),
      };
      if (!(record.meanMotion > 0))
        throw new RowError(`MEAN_MOTION must be > 0: ${record.meanMotion}`);

      seen.add(noradId);
      records.push(record);
    } catch (error) {
      if (!(error instanceof RowError)) throw error;
      rejections.push({ row: index + 1, noradId: get('NORAD_CAT_ID'), reason: error.message });
    }
  });

  return { records, rejections };
}
