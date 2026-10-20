import { setViewMode, viewMode } from '@/app/view';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useStore } from '@/ui/useStore';

export function ViewToggle() {
  const mode = useStore(viewMode);
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      className="pointer-events-auto bg-black/60"
      value={mode}
      onValueChange={(value) => {
        if (value === 'earth' || value === 'solar') setViewMode(value);
      }}
      aria-label="View"
    >
      <ToggleGroupItem value="earth" className="px-3">
        Earth
      </ToggleGroupItem>
      <ToggleGroupItem value="solar" className="px-3">
        Solar system
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
