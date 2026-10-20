import { catalogIndex, selection } from '@/state';
import { displayName } from '@/ui/format';
import { useStore } from '@/ui/useStore';

export function HoverTooltip() {
  const hovered = useStore(selection, (s) => s.hovered);
  const at = useStore(selection, (s) => s.hoverAt);
  const data = useStore(catalogIndex);
  if (hovered === null || !at || !data) return null;
  return (
    <div
      className="pointer-events-none absolute z-10 rounded bg-black/80 px-2 py-1 text-xs whitespace-nowrap text-neutral-100"
      style={{ left: at.x + 14, top: at.y + 14 }}
      role="tooltip"
    >
      {displayName(data.catalog.columns.objectName[hovered])}{' '}
      <span className="font-mono text-neutral-400">{data.catalog.columns.noradId[hovered]}</span>
    </div>
  );
}
