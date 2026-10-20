import {
  FLOATS_PER_SATELLITE,
  type FromWorker,
  type OrbitalColumns,
  type ToWorker,
} from './protocol.ts';

/** The subset of Worker the pool uses, so tests can substitute fakes. */
export interface WorkerLike {
  postMessage(message: ToWorker, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

export interface SliceResult {
  /** Index of this slice's first satellite in the catalog. */
  offset: number;
  count: number;
  positions: Float32Array;
  status: Uint8Array;
}

export interface Batch {
  id: number;
  t0Ms: number;
  t1Ms: number;
  slices: SliceResult[];
  /** Slowest worker's propagation time for this batch. */
  workerMs: number;
  failed: number;
}

export const MAX_WORKERS = 8;

/** cores − 1, clamped to [1, MAX_WORKERS]; an explicit override wins (≥ 1). */
export function poolSize(hardwareConcurrency: number | undefined, override?: number): number {
  if (override !== undefined && Number.isFinite(override)) return Math.max(1, Math.floor(override));
  return Math.min(MAX_WORKERS, Math.max(1, (hardwareConcurrency ?? 2) - 1));
}

/** Splits `count` items into `parts` contiguous ranges whose sizes differ by at most one. */
export function sliceRanges(count: number, parts: number): { offset: number; count: number }[] {
  const n = Math.max(1, Math.min(parts, count || 1));
  const base = Math.floor(count / n);
  const extra = count % n;
  const ranges = [];
  let offset = 0;
  for (let i = 0; i < n; i++) {
    const size = base + (i < extra ? 1 : 0);
    ranges.push({ offset, count: size });
    offset += size;
  }
  return ranges;
}

function sliceColumns(columns: OrbitalColumns, offset: number, count: number): OrbitalColumns {
  const end = offset + count;
  return {
    noradId: columns.noradId.slice(offset, end),
    epoch: columns.epoch.slice(offset, end),
    meanMotion: columns.meanMotion.slice(offset, end),
    eccentricity: columns.eccentricity.slice(offset, end),
    inclination: columns.inclination.slice(offset, end),
    raOfAscNode: columns.raOfAscNode.slice(offset, end),
    argOfPericenter: columns.argOfPericenter.slice(offset, end),
    meanAnomaly: columns.meanAnomaly.slice(offset, end),
    bstar: columns.bstar.slice(offset, end),
    meanMotionDot: columns.meanMotionDot.slice(offset, end),
    meanMotionDdot: columns.meanMotionDdot.slice(offset, end),
  };
}

interface Member {
  worker: WorkerLike;
  offset: number;
  count: number;
  /** Buffers returned by the main thread, ready to be transferred back (ping-pong). */
  spare: { positions: ArrayBuffer; status: ArrayBuffer }[];
  pending: ((message: FromWorker) => void) | null;
}

export interface PoolInfo {
  workers: number;
  satellites: number;
  initFailures: number;
  /** Slowest worker's SGP4 initialisation time. */
  initMs: number;
}

/**
 * A fixed set of workers, each owning a contiguous slice of the catalog.
 * One batch is in flight at a time; buffers are transferred, never copied.
 */
export class PropagationPool {
  readonly info: PoolInfo;
  private readonly members: Member[];
  private nextId = 1;
  private busy = false;
  private disposed = false;

  private constructor(members: Member[], info: PoolInfo) {
    this.members = members;
    this.info = info;
  }

  static async create(
    columns: OrbitalColumns,
    workerCount: number,
    createWorker: () => WorkerLike,
  ): Promise<PropagationPool> {
    const ranges = sliceRanges(columns.noradId.length, workerCount);
    const members: Member[] = ranges.map(({ offset, count }) => ({
      worker: createWorker(),
      offset,
      count,
      spare: [],
      pending: null,
    }));
    for (const m of members) {
      m.worker.onmessage = (event) => {
        const resolve = m.pending;
        m.pending = null;
        resolve?.(event.data);
      };
      m.worker.onerror = (event) => {
        const resolve = m.pending;
        m.pending = null;
        resolve?.({ type: 'error', message: event.message || 'worker error' });
      };
    }

    try {
      const replies = await Promise.all(
        members.map((m) =>
          send(m, { type: 'init', columns: sliceColumns(columns, m.offset, m.count) }, []),
        ),
      );
      let initFailures = 0;
      let initMs = 0;
      for (const reply of replies) {
        if (reply.type !== 'ready') throw new Error(workerError(reply));
        initFailures += reply.initFailures;
        initMs = Math.max(initMs, reply.initMs);
      }
      return new PropagationPool(members, {
        workers: members.length,
        satellites: columns.noradId.length,
        initFailures,
        initMs,
      });
    } catch (error) {
      for (const m of members) m.worker.terminate();
      throw error;
    }
  }

  /** Propagates every slice to t0 and t1 (Unix ms). */
  async request(t0Ms: number, t1Ms: number): Promise<Batch> {
    if (this.disposed) throw new Error('pool disposed');
    if (this.busy) throw new Error('a batch is already in flight');
    this.busy = true;
    const id = this.nextId++;
    try {
      const replies = await Promise.all(
        this.members.map((m) => {
          const spare = m.spare.pop();
          return send(
            m,
            {
              type: 'propagate',
              id,
              t0Ms,
              t1Ms,
              positions: spare?.positions ?? null,
              status: spare?.status ?? null,
            },
            spare ? [spare.positions, spare.status] : [],
          );
        }),
      );
      const slices: SliceResult[] = [];
      let workerMs = 0;
      let failed = 0;
      replies.forEach((reply, i) => {
        const m = this.members[i];
        if (!m || reply.type !== 'positions' || reply.id !== id)
          throw new Error(workerError(reply));
        slices.push({
          offset: m.offset,
          count: m.count,
          positions: new Float32Array(reply.positions),
          status: new Uint8Array(reply.status),
        });
        workerMs = Math.max(workerMs, reply.elapsedMs);
        failed += reply.failed;
      });
      return { id, t0Ms, t1Ms, slices, workerMs, failed };
    } finally {
      this.busy = false;
    }
  }

  /** Hands a batch's buffers back for reuse once their data has been consumed. */
  release(batch: Batch): void {
    batch.slices.forEach((slice, i) => {
      const m = this.members[i];
      if (m && slice.positions.byteLength === m.count * FLOATS_PER_SATELLITE * 4) {
        m.spare.push({
          positions: slice.positions.buffer as ArrayBuffer,
          status: slice.status.buffer as ArrayBuffer,
        });
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const m of this.members) {
      m.worker.terminate();
      m.pending?.({ type: 'error', message: 'pool disposed' });
      m.pending = null;
    }
  }
}

function send(m: Member, message: ToWorker, transfer: Transferable[]): Promise<FromWorker> {
  return new Promise((resolve) => {
    m.pending = resolve;
    m.worker.postMessage(message, transfer);
  });
}

function workerError(reply: FromWorker): string {
  return reply.type === 'error'
    ? `Worker error: ${reply.message}`
    : `Unexpected reply: ${reply.type}`;
}
