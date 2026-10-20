import { useSyncExternalStore } from 'react';
import type { Store } from '@/lib/store';

/** Subscribes a component to a store. A selector must return a stable value. */
export function useStore<T>(store: Store<T>): T;
export function useStore<T, S>(store: Store<T>, selector: (state: T) => S): S;
export function useStore<T>(store: Store<T>, selector?: (state: T) => unknown): unknown {
  return useSyncExternalStore(store.subscribe, () =>
    selector ? selector(store.get()) : store.get(),
  );
}
