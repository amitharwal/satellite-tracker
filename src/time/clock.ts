import { createStore, type Store } from '@/lib/store';

/**
 * Simulated time is a linear function of wall time, re-anchored whenever the
 * rate, pause state or time is changed. The state is plain data so it can be
 * posted to workers, which evaluate `simTimeMs` against the same wall clock
 * (performance.timeOrigin + performance.now() is comparable across workers).
 */
export interface ClockState {
  /** Wall time (Unix ms) at the anchor. */
  anchorWallMs: number;
  /** Simulated time (Unix ms) at the anchor. */
  anchorSimMs: number;
  /** Simulated seconds per wall second; kept while paused. */
  rate: number;
  paused: boolean;
}

export type WallClock = () => number;

export const systemWallClock: WallClock = () => performance.timeOrigin + performance.now();

export function simTimeMs(state: ClockState, wallMs: number): number {
  if (state.paused) return state.anchorSimMs;
  return state.anchorSimMs + (wallMs - state.anchorWallMs) * state.rate;
}

export class SimClock {
  readonly store: Store<ClockState>;
  private readonly wall: WallClock;

  constructor(wall: WallClock = systemWallClock) {
    this.wall = wall;
    const now = wall();
    this.store = createStore<ClockState>({
      anchorWallMs: now,
      anchorSimMs: now,
      rate: 1,
      paused: false,
    });
  }

  /** Current simulated time, Unix ms. */
  now(): number {
    return simTimeMs(this.store.get(), this.wall());
  }

  setRate(rate: number): void {
    if (!Number.isFinite(rate)) throw new RangeError(`Invalid clock rate: ${rate}`);
    this.reanchor({ rate });
  }

  pause(): void {
    this.reanchor({ paused: true });
  }

  resume(): void {
    this.reanchor({ paused: false });
  }

  setTime(simMs: number): void {
    if (!Number.isFinite(simMs)) throw new RangeError(`Invalid time: ${simMs}`);
    this.store.set((s) => ({ ...s, anchorWallMs: this.wall(), anchorSimMs: simMs }));
  }

  /** Real time at real rate. */
  jumpToNow(): void {
    const now = this.wall();
    this.store.set({ anchorWallMs: now, anchorSimMs: now, rate: 1, paused: false });
  }

  private reanchor(change: Partial<Pick<ClockState, 'rate' | 'paused'>>): void {
    const wallMs = this.wall();
    this.store.set((s) => ({
      ...s,
      ...change,
      anchorWallMs: wallMs,
      anchorSimMs: simTimeMs(s, wallMs),
    }));
  }
}
