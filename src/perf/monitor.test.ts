import { describe, expect, it, vi } from 'vitest';
import { parseConfig } from '../config.ts';
import { PerfMonitor, type PropagationStats } from './monitor.ts';

function stats(over: Partial<PropagationStats> = {}): PropagationStats {
  return {
    workers: 4,
    satellites: 100,
    failed: 2,
    initMs: 5,
    targetHz: 10,
    totalWorkerMs: 0,
    totalRoundTripMs: 0,
    batches: 0,
    lateFrames: 0,
    ...over,
  };
}

describe('PerfMonitor', () => {
  it('publishes averages once per period, not per frame', () => {
    let now = 0;
    const monitor = new PerfMonitor(500, () => now);
    const listener = vi.fn();
    monitor.store.subscribe(listener);
    for (let i = 0; i < 30; i++) {
      now += 16;
      monitor.frame({ intervalMs: 16, cpuMs: i === 10 ? 5 : 1 });
    }
    expect(listener).toHaveBeenCalledTimes(0); // 480 ms
    now += 20;
    monitor.frame({ intervalMs: 20, cpuMs: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    const snap = monitor.store.get();
    expect(snap?.fps).toBeCloseTo(62, 0);
    expect(snap?.frameMs).toBeCloseTo(500 / 31, 6);
    expect(snap?.cpuMsMax).toBe(5);
    expect(snap?.propagation).toBeNull();
  });

  it('averages CPU time over every sample, including the first frame (no interval yet)', () => {
    let now = 0;
    const monitor = new PerfMonitor(500, () => now);
    monitor.frame({ intervalMs: 0, cpuMs: 30 }); // first frame: shader compile
    now = 600;
    monitor.frame({ intervalMs: 600, cpuMs: 2 });
    const snap = monitor.store.get();
    expect(snap?.cpuMs).toBe(16);
    expect(snap?.cpuMsMax).toBe(30);
  });

  it('reports propagation rates as deltas over the period', () => {
    let now = 0;
    let s = stats();
    const monitor = new PerfMonitor(1000, () => now);
    monitor.setSource(() => s);
    s = stats({ batches: 10, lateFrames: 3, totalWorkerMs: 15, totalRoundTripMs: 40 });
    now = 1000;
    monitor.frame({ intervalMs: 16, cpuMs: 1 });
    expect(monitor.store.get()?.propagation).toMatchObject({
      batchesPerSec: 10,
      lateFramesInPeriod: 3,
      workerMs: 1.5,
      roundTripMs: 4,
      failed: 2,
    });
  });
});

describe('parseConfig', () => {
  it('reads workers, hz and stats with clamping and defaults', () => {
    expect(parseConfig('')).toEqual({ workers: undefined, baseHz: 10, showStats: false });
    expect(parseConfig('?workers=3&hz=120&stats')).toEqual({
      workers: 3,
      baseHz: 60,
      showStats: true,
    });
    expect(parseConfig('?workers=abc&hz=-1')).toEqual({
      workers: undefined,
      baseHz: 10,
      showStats: false,
    });
  });
});
