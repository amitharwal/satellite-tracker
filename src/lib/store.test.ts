import { describe, expect, it, vi } from 'vitest';
import { createStore } from './store.ts';

describe('createStore', () => {
  it('sets values directly or via an updater and notifies listeners', () => {
    const store = createStore({ n: 1 });
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ n: 2 });
    store.set((s) => ({ n: s.n + 1 }));
    expect(store.get()).toEqual({ n: 3 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('skips notification when the value is identical', () => {
    const store = createStore(5);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(5);
    store.set((n) => n);
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', () => {
    const store = createStore(0);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set(1);
    expect(listener).not.toHaveBeenCalled();
  });
});
