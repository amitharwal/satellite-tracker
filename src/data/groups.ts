/**
 * Constellation groups, inferred from object names (the catalog carries no
 * group membership). Patterns were checked against the active catalog; they
 * can miss renamed objects or catch unrelated ones with similar names.
 */
export interface GroupDefinition {
  id: string;
  label: string;
  /** Matches the object name. */
  name: RegExp;
  /** Optional extra check on mean motion (rev/day) and inclination (deg). */
  orbit?: (meanMotion: number, inclination: number) => boolean;
}

export const GROUPS: readonly GroupDefinition[] = [
  { id: 'starlink', label: 'Starlink', name: /^STARLINK/ },
  { id: 'oneweb', label: 'OneWeb', name: /^ONEWEB/ },
  { id: 'kuiper', label: 'Kuiper', name: /^KUIPER/ },
  { id: 'qianfan', label: 'Qianfan', name: /^QIANFAN/ },
  { id: 'guowang', label: 'Guowang', name: /^(GUOWANG|HULIANWANG)/ },
  { id: 'iridium', label: 'Iridium', name: /^IRIDIUM/ },
  { id: 'globalstar', label: 'Globalstar', name: /^GLOBALSTAR/ },
  { id: 'gps', label: 'GPS', name: /^(NAVSTAR|GPS)/ },
  {
    id: 'glonass',
    label: 'GLONASS',
    // Named "COSMOS nnnn"; told apart from other Cosmos satellites by orbit:
    // ~2.13 rev/day (11 h 15 min) at ~64.8° inclination.
    name: /^COSMOS \d+|GLONASS/,
    orbit: (n, i) => n > 2.1 && n < 2.16 && i > 63 && i < 67,
  },
  { id: 'galileo', label: 'Galileo', name: /^GSAT0|GALILEO/ },
  { id: 'beidou', label: 'BeiDou', name: /^BEIDOU/ },
  { id: 'stations', label: 'Space stations', name: /^(ISS \(|CSS \()/ },
];

/** Index into GROUPS per satellite, or -1 for none. First match wins. */
export function assignGroups(
  names: readonly string[],
  meanMotion: readonly number[],
  inclination: readonly number[],
): Int8Array {
  const result = new Int8Array(names.length).fill(-1);
  names.forEach((name, i) => {
    const n = meanMotion[i] ?? 0;
    const inc = inclination[i] ?? 0;
    const g = GROUPS.findIndex((def) => def.name.test(name) && (!def.orbit || def.orbit(n, inc)));
    result[i] = g;
  });
  return result;
}
