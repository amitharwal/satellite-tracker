import { visibilityMask } from '../data/search.ts';
import type { Renderer, RendererOptions } from '../gl/renderer.ts';
import { EARTH_RADIUS_KM } from '../orbit/frames.ts';
import { SingleSatellite } from '../orbit/details.ts';
import { catalogIndex, clock, filter, selection } from '../state.ts';

let cached: { index: number; satellite: SingleSatellite } | null = null;

/** Main-thread propagator for one catalog entry (cached for the current selection). */
export function satelliteAt(index: number): SingleSatellite | null {
  const data = catalogIndex.get();
  if (!data) return null;
  if (cached?.index === index) return cached.satellite;
  const c = data.catalog.columns;
  const satellite = new SingleSatellite({
    noradId: c.noradId[index] ?? 0,
    epoch: c.epoch[index] ?? '',
    meanMotion: c.meanMotion[index] ?? NaN,
    eccentricity: c.eccentricity[index] ?? NaN,
    inclination: c.inclination[index] ?? NaN,
    raOfAscNode: c.raOfAscNode[index] ?? NaN,
    argOfPericenter: c.argOfPericenter[index] ?? NaN,
    meanAnomaly: c.meanAnomaly[index] ?? NaN,
    bstar: c.bstar[index] ?? NaN,
    meanMotionDot: c.meanMotionDot[index] ?? NaN,
    meanMotionDdot: c.meanMotionDdot[index] ?? NaN,
  });
  cached = { index, satellite };
  return satellite;
}

let activeRenderer: Renderer | null = null;

/** Smoothly moves the camera above a satellite, far enough out to see it. */
export function flyTo(index: number): void {
  const state = satelliteAt(index)?.at(clock.now());
  if (!state || !activeRenderer) return;
  const [x, y, z] = state.ecef;
  const r = Math.hypot(x, y, z) / EARTH_RADIUS_KM;
  activeRenderer.camera.flyTo({
    azimuth: Math.atan2(y, x),
    elevation: Math.atan2(z, Math.hypot(x, y)),
    distance: r * 1.4 + 0.6,
  });
}

export function select(index: number | null): void {
  selection.set((s) => ({ ...s, selected: index, follow: index === null ? false : s.follow }));
}

/** Renderer callbacks for pointer interaction; pass into the Renderer options. */
export function interactionCallbacks(
  renderer: () => Renderer | null,
): Pick<RendererOptions, 'onHover' | 'onLeave' | 'onTap' | 'onPick' | 'onUserRotate'> {
  return {
    onHover: (x, y) => {
      renderer()?.requestPick(x, y, 'hover');
      selection.set((s) => ({ ...s, hoverAt: { x, y } }));
    },
    onLeave: () => {
      selection.set((s) => ({ ...s, hovered: null, hoverAt: null }));
    },
    onTap: (x, y) => {
      renderer()?.requestPick(x, y, 'click');
    },
    onPick: (result) => {
      if (result.purpose === 'hover') {
        if (selection.get().hovered !== result.index) {
          selection.set((s) => ({ ...s, hovered: result.index }));
        }
      } else {
        select(result.index);
      }
    },
    onUserRotate: () => {
      if (selection.get().follow) selection.set((s) => ({ ...s, follow: false }));
    },
  };
}

/** Keeps the renderer in sync with selection and filters. Returns a disconnect function. */
export function connectInteraction(renderer: Renderer): () => void {
  activeRenderer = renderer;

  const applySelection = () => {
    const s = selection.get();
    renderer.setSatelliteHighlight({ selected: s.selected ?? -1, hovered: s.hovered ?? -1 });
    const index = s.selected;
    renderer.setFollowTarget(
      s.follow && index !== null
        ? () => {
            const state = satelliteAt(index)?.at(clock.now());
            if (!state) return null;
            const [x, y, z] = state.ecef;
            return [x / EARTH_RADIUS_KM, y / EARTH_RADIUS_KM, z / EARTH_RADIUS_KM];
          }
        : null,
    );
  };

  const applyFilter = () => {
    const data = catalogIndex.get();
    if (!data) return;
    renderer.setSatelliteVisibility(visibilityMask(data.groups, data.regimes, filter.get()));
  };

  const unsubscribe = [
    selection.subscribe(applySelection),
    filter.subscribe(applyFilter),
    catalogIndex.subscribe(() => {
      cached = null;
      selection.set((s) => ({ ...s, selected: null, hovered: null, follow: false }));
      applyFilter();
    }),
  ];
  applySelection();
  applyFilter();

  return () => {
    for (const u of unsubscribe) u();
    if (activeRenderer === renderer) activeRenderer = null;
  };
}
