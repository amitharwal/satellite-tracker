export interface SearchIndex {
  names: readonly string[];
  noradIds: readonly number[];
  objectIds: readonly string[];
}

export interface Filter {
  /** Group indices to show; empty means no group filter. */
  groups: ReadonlySet<number>;
  /** Regimes to show; empty means no regime filter. */
  regimes: ReadonlySet<number>;
}

/**
 * Finds satellites by name (case-insensitive substring), NORAD ID (prefix of
 * the digits) or international designator (prefix). NORAD-ID, designator and
 * name-prefix matches rank before other name matches; results are capped at `limit`.
 */
export function search(index: SearchIndex, query: string, limit = 50): number[] {
  const q = query.trim().toUpperCase();
  if (q === '') return [];
  const isNumber = /^\d+$/.test(q);
  const prefix: number[] = [];
  const other: number[] = [];
  for (let i = 0; i < index.names.length; i++) {
    const name = index.names[i]?.toUpperCase() ?? '';
    if (isNumber && String(index.noradIds[i]).startsWith(q)) {
      prefix.push(i);
    } else if (name.startsWith(q) || index.objectIds[i]?.toUpperCase().startsWith(q)) {
      prefix.push(i);
    } else if (name.includes(q)) {
      other.push(i);
    }
    if (prefix.length >= limit) break;
  }
  return prefix.concat(other).slice(0, limit);
}

/** 1 = visible, 0 = filtered out. An empty set in a dimension means "all". */
export function visibilityMask(groups: Int8Array, regimes: Uint8Array, filter: Filter): Uint8Array {
  const mask = new Uint8Array(groups.length);
  for (let i = 0; i < groups.length; i++) {
    const groupOk = filter.groups.size === 0 || filter.groups.has(groups[i] ?? -1);
    const regimeOk = filter.regimes.size === 0 || filter.regimes.has(regimes[i] ?? -1);
    mask[i] = groupOk && regimeOk ? 1 : 0;
  }
  return mask;
}
