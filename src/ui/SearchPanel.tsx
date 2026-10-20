import { Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { flyTo, select } from '@/app/interaction';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { GROUPS } from '@/data/groups';
import { search, visibilityMask } from '@/data/search';
import { catalogIndex, filter } from '@/state';
import { displayName } from '@/ui/format';
import { useStore } from '@/ui/useStore';

const REGIME_LABELS = ['LEO', 'MEO', 'GEO', 'HEO', 'Other'];

function counts(values: Int8Array | Uint8Array, buckets: number): number[] {
  const result = new Array<number>(buckets).fill(0);
  for (const v of values) {
    if (v >= 0 && v < buckets) result[v] = (result[v] ?? 0) + 1;
  }
  return result;
}

export function SearchPanel() {
  const data = useStore(catalogIndex);
  const current = useStore(filter);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(() => window.matchMedia('(min-width: 768px)').matches);

  const index = useMemo(
    () =>
      data && {
        names: data.catalog.columns.objectName,
        noradIds: data.catalog.columns.noradId,
        objectIds: data.catalog.columns.objectId,
      },
    [data],
  );
  const results = useMemo(() => (index ? search(index, query, 50) : []), [index, query]);
  const groupCounts = useMemo(() => (data ? counts(data.groups, GROUPS.length) : []), [data]);
  const regimeCounts = useMemo(() => (data ? counts(data.regimes, 5) : []), [data]);
  const shown = useMemo(() => {
    if (!data) return 0;
    return visibilityMask(data.groups, data.regimes, current).reduce((n, v) => n + v, 0);
  }, [data, current]);

  if (!open) {
    return (
      <Button
        variant="secondary"
        size="sm"
        className="pointer-events-auto"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Search /> Search &amp; filter
      </Button>
    );
  }

  const filtered = current.groups.size > 0 || current.regimes.size > 0;

  return (
    <Card className="pointer-events-auto flex max-h-[calc(100vh-11rem)] w-80 flex-col gap-3 bg-black/75 p-3 text-neutral-100 backdrop-blur">
      <div className="flex items-center gap-2">
        <Input
          type="search"
          placeholder="Name, NORAD ID or designator"
          aria-label="Search satellites"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          disabled={!data}
        />
        <Button
          size="icon"
          variant="ghost"
          aria-label="Close panel"
          onClick={() => {
            setOpen(false);
          }}
        >
          <X />
        </Button>
      </div>

      {query.trim() !== '' && (
        <ScrollArea className="max-h-56 min-h-0">
          {results.length === 0 ? (
            <p className="px-1 text-sm text-neutral-400">No matches</p>
          ) : (
            <ul className="space-y-0.5" aria-label="Search results">
              {results.map((i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="flex w-full justify-between gap-2 rounded px-2 py-1 text-left text-sm hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
                    onClick={() => {
                      select(i);
                      flyTo(i);
                    }}
                  >
                    <span className="truncate">
                      {displayName(data?.catalog.columns.objectName[i])}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-neutral-400">
                      {data?.catalog.columns.noradId[i]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      )}

      <section aria-label="Filters" className="min-h-0 space-y-2 overflow-y-auto">
        <div className="flex items-center justify-between text-xs text-neutral-400">
          <span>
            Showing {shown.toLocaleString()} of {data?.catalog.count.toLocaleString() ?? '…'}
          </span>
          {filtered && (
            <button
              type="button"
              className="underline hover:text-neutral-200"
              onClick={() => {
                filter.set({ groups: new Set(), regimes: new Set() });
              }}
            >
              Clear filters
            </button>
          )}
        </div>
        <h2 className="text-xs font-medium tracking-wide text-neutral-400 uppercase">Orbit</h2>
        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          className="flex-wrap justify-start"
          value={[...current.regimes].map(String)}
          onValueChange={(values) => {
            filter.set((f) => ({ ...f, regimes: new Set(values.map(Number)) }));
          }}
          aria-label="Filter by orbit regime"
        >
          {REGIME_LABELS.map((label, i) => (
            <ToggleGroupItem key={label} value={String(i)} className="px-2">
              {label} <span className="text-neutral-400">{regimeCounts[i]?.toLocaleString()}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <h2 className="text-xs font-medium tracking-wide text-neutral-400 uppercase">
          Constellation
        </h2>
        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          className="flex-wrap justify-start"
          value={[...current.groups].map(String)}
          onValueChange={(values) => {
            filter.set((f) => ({ ...f, groups: new Set(values.map(Number)) }));
          }}
          aria-label="Filter by constellation"
        >
          {GROUPS.map((g, i) => (
            <ToggleGroupItem key={g.id} value={String(i)} className="px-2">
              {g.label} <span className="text-neutral-400">{groupCounts[i]?.toLocaleString()}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-neutral-500">
          Constellations are matched by name and may miss renamed objects.
        </p>
      </section>
    </Card>
  );
}
