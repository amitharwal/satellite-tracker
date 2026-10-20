import { describe, expect, it } from 'vitest';
import { poolSize, PropagationPool, sliceRanges, type WorkerLike } from './pool.ts';
import {
  FLOATS_PER_SATELLITE,
  type FromWorker,
  type OrbitalColumns,
  type ToWorker,
} from './protocol.ts';
import { SlicePropagator } from './slice.ts';

/**
 * In-process stand-in for the worker: runs the same SlicePropagator and moves
 * messages with structuredClone + transfer, so detaching behaves as in a browser.
 */
class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  received: ToWorker[] = [];
  /** Byte length of the positions buffer each propagate message arrived with. */
  receivedBytes: number[] = [];
  private slice: SlicePropagator | null = null;

  postMessage(message: ToWorker, transfer: Transferable[]): void {
    const msg = structuredClone(message, { transfer });
    this.received.push(msg);
    if (msg.type === 'propagate') this.receivedBytes.push(msg.positions?.byteLength ?? 0);
    queueMicrotask(() => {
      this.handle(msg);
    });
  }

  terminate(): void {
    this.terminated = true;
  }

  private reply(data: FromWorker, transfer: Transferable[] = []) {
    const cloned = structuredClone(data, { transfer });
    this.onmessage?.({ data: cloned } as MessageEvent<FromWorker>);
  }

  private handle(msg: ToWorker) {
    if (msg.type === 'init') {
      this.slice = new SlicePropagator(msg.columns);
      this.reply({ type: 'ready', count: this.slice.count, initMs: 1, initFailures: 0 });
      return;
    }
    const slice = this.slice;
    if (!slice) throw new Error('not initialised');
    const positions = msg.positions
      ? new Float32Array(msg.positions)
      : new Float32Array(slice.count * FLOATS_PER_SATELLITE);
    const status = msg.status ? new Uint8Array(msg.status) : new Uint8Array(slice.count);
    const failed = slice.propagate(msg.t0Ms, msg.t1Ms, positions, status);
    this.reply(
      {
        type: 'positions',
        id: msg.id,
        t0Ms: msg.t0Ms,
        t1Ms: msg.t1Ms,
        positions: positions.buffer,
        status: status.buffer,
        elapsedMs: 0.5,
        failed,
      },
      [positions.buffer, status.buffer],
    );
  }
}

function columns(count: number): OrbitalColumns {
  const col = <T>(v: T) => Array.from({ length: count }, () => v);
  return {
    noradId: Array.from({ length: count }, (_, i) => i + 1),
    epoch: col('2026-10-20T00:00:00.000000'),
    meanMotion: Array.from({ length: count }, (_, i) => 15 + i * 0.01),
    eccentricity: col(0.001),
    inclination: col(51.6),
    raOfAscNode: Array.from({ length: count }, (_, i) => i * 7),
    argOfPericenter: col(20),
    meanAnomaly: col(30),
    bstar: col(0.0001),
    meanMotionDot: col(0),
    meanMotionDdot: col(0),
  };
}

describe('poolSize', () => {
  it('uses cores − 1, at least 1 and at most 8, unless overridden', () => {
    expect(poolSize(8)).toBe(7);
    expect(poolSize(1)).toBe(1);
    expect(poolSize(32)).toBe(8);
    expect(poolSize(undefined)).toBe(1);
    expect(poolSize(32, 12)).toBe(12);
    expect(poolSize(8, 0)).toBe(1);
  });
});

describe('sliceRanges', () => {
  it('covers every item with contiguous, balanced ranges', () => {
    expect(sliceRanges(10, 3)).toEqual([
      { offset: 0, count: 4 },
      { offset: 4, count: 3 },
      { offset: 7, count: 3 },
    ]);
    expect(sliceRanges(2, 5)).toHaveLength(2);
  });
});

describe('PropagationPool', () => {
  it('splits the catalog, assembles batches in catalog order, and matches a single slice', async () => {
    const workers: FakeWorker[] = [];
    const pool = await PropagationPool.create(columns(10), 3, () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    expect(pool.info).toMatchObject({ workers: 3, satellites: 10, initFailures: 0 });

    const t0 = Date.UTC(2026, 9, 20, 1);
    const batch = await pool.request(t0, t0 + 100);
    expect(batch.slices.map((s) => [s.offset, s.count])).toEqual([
      [0, 4],
      [4, 3],
      [7, 3],
    ]);

    const whole = new SlicePropagator(columns(10));
    const expected = new Float32Array(10 * FLOATS_PER_SATELLITE);
    whole.propagate(t0, t0 + 100, expected, new Uint8Array(10));
    for (const s of batch.slices) {
      expect(Array.from(s.positions)).toEqual(
        Array.from(expected.subarray(s.offset * 6, (s.offset + s.count) * 6)),
      );
    }
    pool.dispose();
    expect(workers.every((w) => w.terminated)).toBe(true);
  });

  it('recycles released buffers by transferring them back (ping-pong)', async () => {
    const workers: FakeWorker[] = [];
    const pool = await PropagationPool.create(columns(4), 1, () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    const first = await pool.request(0, 100);
    const firstBytes = first.slices[0]?.positions.byteLength;
    pool.release(first);

    const second = await pool.request(100, 200);
    // First request allocated in the worker; the second arrived with the recycled buffer.
    expect(workers[0]?.receivedBytes).toEqual([0, firstBytes]);
    // Transferred away: the released view is now detached.
    expect(first.slices[0]?.positions.byteLength).toBe(0);
    expect(second.slices[0]?.positions.byteLength).toBe(firstBytes);
    pool.dispose();
  });

  it('allows one batch in flight at a time', async () => {
    const pool = await PropagationPool.create(columns(2), 1, () => new FakeWorker());
    const pending = pool.request(0, 1);
    await expect(pool.request(0, 1)).rejects.toThrow(/already in flight/);
    await pending;
    pool.dispose();
  });

  it('rejects a batch when a worker reports an error', async () => {
    const pool = await PropagationPool.create(columns(2), 1, () => {
      const w = new FakeWorker();
      w.postMessage = function (message: ToWorker) {
        if (message.type === 'init') {
          queueMicrotask(() => {
            this.onmessage?.({
              data: { type: 'ready', count: 2, initMs: 0, initFailures: 0 },
            } as MessageEvent<FromWorker>);
          });
        } else {
          queueMicrotask(() => {
            this.onmessage?.({
              data: { type: 'error', message: 'boom' },
            } as MessageEvent<FromWorker>);
          });
        }
      };
      return w;
    });
    await expect(pool.request(0, 1)).rejects.toThrow(/boom/);
    pool.dispose();
  });
});
