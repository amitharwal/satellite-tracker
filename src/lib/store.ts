/**
 * Minimal external store: an immutable snapshot plus change listeners. React
 * reads it via useSyncExternalStore (see src/ui/useStore.ts); non-React code
 * (renderer, workers' coordinator) reads `get()` directly.
 */
export interface Store<T> {
  // Function-typed properties (not methods) so they can be passed around unbound.
  get: () => T;
  set: (next: T | ((prev: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      const value = typeof next === 'function' ? (next as (prev: T) => T)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
