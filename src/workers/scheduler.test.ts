import { describe, expect, it, vi } from 'vitest';
import { SimClock } from '../time/clock.ts';
import type { Batch } from './pool.ts';
import {
  DEFAULT_SCHEDULER_OPTIONS,
  PropagationScheduler,
  windowSpan,
  type BatchSource,
} from './scheduler.ts';

/** A batch source whose requests resolve only when the test says so. */
class ManualSource implements BatchSource {
  requests: { t0Ms: number; t1Ms: number; resolve: () => void; reject: (e: Error) => void }[] = [];
  released: Batch[] = [];

  request(t0Ms: number, t1Ms: number): Promise<Batch> {
    return new Promise((resolve, reject) => {
      this.requests.push({
        t0Ms,
        t1Ms,
        resolve: () => {
          resolve({ id: this.requests.length, t0Ms, t1Ms, slices: [], workerMs: 1, failed: 0 });
        },
        reject,
      });
    });
  }

  release(batch: Batch): void {
    this.released.push(batch);
  }

  last() {
    const r = this.requests.at(-1);
    if (!r) throw new Error('no request');
    return r;
  }
}

function setup() {
  let wall = 1_000_000;
  const clock = new SimClock(() => wall);
  const source = new ManualSource();
  const onBatch = vi.fn<(batch: Batch) => void>();
  const onSwap = vi.fn();
  const scheduler = new PropagationScheduler(
    source,
    clock,
    { onBatch, onSwap },
    DEFAULT_SCHEDULER_OPTIONS,
    () => wall,
  );
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return {
    clock,
    source,
    scheduler,
    onBatch,
    onSwap,
    flush,
    advance: (ms: number) => (wall += ms),
  };
}

describe('windowSpan', () => {
  it('runs at the base rate up to the span limit, then raises the rate up to the cap', () => {
    expect(windowSpan(1, false, DEFAULT_SCHEDULER_OPTIONS)).toEqual({ hz: 10, spanSimMs: 100 });
    expect(windowSpan(100, false, DEFAULT_SCHEDULER_OPTIONS)).toEqual({
      hz: 10,
      spanSimMs: 10_000,
    });
    expect(windowSpan(300, false, DEFAULT_SCHEDULER_OPTIONS)).toEqual({
      hz: 30,
      spanSimMs: 10_000,
    });
    expect(windowSpan(3600, false, DEFAULT_SCHEDULER_OPTIONS)).toEqual({
      hz: 60,
      spanSimMs: 60_000,
    });
  });

  it('handles reverse time and pause', () => {
    expect(windowSpan(-60, false, DEFAULT_SCHEDULER_OPTIONS)).toEqual({ hz: 10, spanSimMs: -6000 });
    expect(windowSpan(5, true, DEFAULT_SCHEDULER_OPTIONS)).toEqual({ hz: 10, spanSimMs: 0 });
  });
});

describe('PropagationScheduler', () => {
  it('requests the first window at "now", then interpolates and chains windows', async () => {
    const { source, scheduler, onBatch, onSwap, flush, advance } = setup();
    expect(scheduler.tick()).toBeNull();
    expect(source.requests).toHaveLength(1);
    expect(source.last()).toMatchObject({ t0Ms: 1_000_000, t1Ms: 1_000_100 });

    source.last().resolve();
    await flush();
    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(source.released).toHaveLength(1);

    advance(25);
    expect(scheduler.tick()).toBeCloseTo(0.25, 9);
    expect(onSwap).toHaveBeenCalledTimes(1);
    // The next window was requested as soon as the first became the front.
    expect(source.last()).toMatchObject({ t0Ms: 1_000_100, t1Ms: 1_000_200 });

    source.last().resolve();
    await flush();
    advance(50);
    expect(scheduler.tick()).toBeCloseTo(0.75, 9); // still the first window
    advance(30);
    expect(scheduler.tick()).toBeCloseTo(0.05, 9); // swapped at 105 ms
    expect(onSwap).toHaveBeenCalledTimes(2);
  });

  it('holds at the end of the window and counts late frames when workers fall behind', async () => {
    const { source, scheduler, flush, advance } = setup();
    scheduler.tick();
    source.last().resolve();
    await flush();
    scheduler.tick();
    advance(150);
    expect(scheduler.tick()).toBe(1);
    expect(scheduler.stats.lateFrames).toBe(1);

    // When the late window [100, 200] is only swapped in after it has expired,
    // the next request resyncs to now instead of chaining from its end.
    source.last().resolve();
    await flush();
    advance(60);
    scheduler.tick();
    expect(source.last().t0Ms).toBe(1_000_210);
  });

  it('drops in-flight results after a clock change and recomputes from the new time', async () => {
    const { clock, source, scheduler, onBatch, flush } = setup();
    scheduler.tick();
    clock.setTime(5_000_000);
    source.requests[0]?.resolve();
    await flush();
    expect(onBatch).not.toHaveBeenCalled();
    expect(source.released).toHaveLength(1);
    expect(source.last()).toMatchObject({ t0Ms: 5_000_000 });
  });

  it('swaps a post-change window in immediately, mid-window', async () => {
    const { clock, source, scheduler, onSwap, flush, advance } = setup();
    scheduler.tick();
    source.last().resolve();
    await flush();
    scheduler.tick();
    await flush();
    source.last().resolve(); // next window ready, not yet due
    await flush();

    clock.setRate(60); // invalidates the queued window's generation for new requests
    source.last().resolve();
    await flush();
    advance(1);
    scheduler.tick();
    expect(onSwap).toHaveBeenCalledTimes(2);
    expect(source.last().t1Ms - source.last().t0Ms).toBe(6000);
  });

  it('issues one zero-length window while paused, then stops requesting', async () => {
    const { clock, source, scheduler, flush, advance } = setup();
    clock.pause();
    scheduler.tick();
    const count = source.requests.length;
    source.last().resolve();
    await flush();
    for (let i = 0; i < 10; i++) {
      advance(16);
      expect(scheduler.tick()).toBe(0);
    }
    expect(source.requests.length).toBe(count);
    expect(scheduler.stats.lateFrames).toBe(0);
  });

  it('retries after a failed batch with a backoff', async () => {
    const { source, scheduler, flush, advance } = setup();
    const onError = vi.fn();
    Object.assign(scheduler, { callbacks: { onBatch: vi.fn(), onSwap: vi.fn(), onError } });
    scheduler.tick();
    source.last().reject(new Error('worker crashed'));
    await flush();
    expect(onError).toHaveBeenCalled();
    scheduler.tick();
    expect(source.requests).toHaveLength(1);
    advance(1001);
    scheduler.tick();
    expect(source.requests).toHaveLength(2);
  });
});
