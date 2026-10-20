import { createStore } from '../lib/store.ts';

/** Observer location in degrees. Kept only in this browser; never sent anywhere. */
export interface ObserverLocation {
  latitude: number;
  longitude: number;
  source: 'device' | 'manual';
}

const STORAGE_KEY = 'satellite-tracker.observer';

export function parseObserver(raw: unknown): ObserverLocation | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { latitude, longitude, source } = raw as Record<string, unknown>;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!(Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180)) return null;
  return { latitude, longitude, source: source === 'device' ? 'device' : 'manual' };
}

function load(): ObserverLocation | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? parseObserver(JSON.parse(raw)) : null;
  } catch {
    return null; // storage blocked or corrupt: just start without a location
  }
}

export const observer = createStore<ObserverLocation | null>(load());

observer.subscribe(() => {
  try {
    const value = observer.get();
    if (value) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Persistence is a convenience; ignore storage failures.
  }
});
