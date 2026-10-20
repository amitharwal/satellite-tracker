import { describe, expect, it, vi } from 'vitest';
import { SimClock, simTimeMs } from './clock.ts';

function fakeWall(start = 1_000_000) {
  let t = start;
  return { wall: () => t, advance: (ms: number) => (t += ms) };
}

describe('SimClock', () => {
  it('starts at wall time, running at rate 1', () => {
    const { wall, advance } = fakeWall();
    const clock = new SimClock(wall);
    expect(clock.now()).toBe(1_000_000);
    advance(500);
    expect(clock.now()).toBe(1_000_500);
  });

  it('changes rate without a jump in simulated time', () => {
    const { wall, advance } = fakeWall();
    const clock = new SimClock(wall);
    advance(1000);
    clock.setRate(60);
    expect(clock.now()).toBe(1_001_000);
    advance(1000);
    expect(clock.now()).toBe(1_061_000);
  });

  it('supports negative rates', () => {
    const { wall, advance } = fakeWall();
    const clock = new SimClock(wall);
    clock.setRate(-10);
    advance(100);
    expect(clock.now()).toBe(999_000);
  });

  it('freezes while paused and resumes at the same rate', () => {
    const { wall, advance } = fakeWall();
    const clock = new SimClock(wall);
    clock.setRate(2);
    advance(100);
    clock.pause();
    advance(5000);
    expect(clock.now()).toBe(1_000_200);
    clock.resume();
    advance(100);
    expect(clock.now()).toBe(1_000_400);
  });

  it('sets time and jumps back to now', () => {
    const { wall, advance } = fakeWall();
    const clock = new SimClock(wall);
    clock.setRate(100);
    clock.setTime(0);
    advance(10);
    expect(clock.now()).toBe(1000);
    clock.jumpToNow();
    expect(clock.now()).toBe(1_000_010);
    expect(clock.store.get()).toMatchObject({ rate: 1, paused: false });
  });

  it('rejects non-finite input', () => {
    const clock = new SimClock(fakeWall().wall);
    expect(() => {
      clock.setRate(Number.NaN);
    }).toThrow(RangeError);
    expect(() => {
      clock.setTime(Number.POSITIVE_INFINITY);
    }).toThrow(RangeError);
  });

  it('notifies subscribers on state changes only', () => {
    const { wall, advance } = fakeWall();
    const clock = new SimClock(wall);
    const listener = vi.fn();
    const unsubscribe = clock.store.subscribe(listener);
    advance(1000);
    clock.now();
    expect(listener).not.toHaveBeenCalled();
    clock.setRate(5);
    clock.pause();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    clock.resume();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('exposes plain state that simTimeMs evaluates identically (for workers)', () => {
    const { wall, advance } = fakeWall();
    const clock = new SimClock(wall);
    clock.setRate(30);
    advance(250);
    const state = structuredClone(clock.store.get());
    expect(simTimeMs(state, wall())).toBe(clock.now());
  });
});
