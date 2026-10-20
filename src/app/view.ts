import type { ViewMode } from '../gl/renderer.ts';
import { createStore } from '../lib/store.ts';
import { clock } from '../state.ts';

export const viewMode = createStore<ViewMode>('earth');

/** Rate presets per view (simulated seconds per second). */
export const RATE_PRESETS: Record<ViewMode, readonly number[]> = {
  earth: [-600, -60, 1, 10, 60, 600, 3600],
  solar: [-2_592_000, -86_400, 3600, 86_400, 604_800, 2_592_000],
};

/**
 * Switches views. Planets barely move at satellite rates and satellites are
 * meaningless at planetary rates, so an out-of-range rate is reset to the
 * new view's default (1 day/s in the solar view, real time on Earth).
 */
export function setViewMode(mode: ViewMode): void {
  if (viewMode.get() === mode) return;
  const rate = clock.store.get().rate;
  if (mode === 'solar' && Math.abs(rate) < 3600) clock.setRate(86_400);
  if (mode === 'earth' && Math.abs(rate) > 3600) clock.setRate(1);
  viewMode.set(mode);
}
