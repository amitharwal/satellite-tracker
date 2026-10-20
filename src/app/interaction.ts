import { visibilityMask } from '../data/search.ts';
import type { Renderer, RendererOptions } from '../gl/renderer.ts';
import { EARTH_RADIUS_KM } from '../orbit/frames.ts';
import { SingleSatellite } from '../orbit/details.ts';
import { OrbitTrail } from '../orbit/trail.ts';
import { moonOverlay, solarOverlay } from './scenes.ts';
import { viewMode } from './view.ts';
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

const ORBIT_STYLE = { color: [1, 1, 1, 0.75], pastAlpha: 0.3, widthPx: 1.5 } as const;
const TRACK_STYLE = { color: [0.99, 0.83, 0.3, 0.9], pastAlpha: 0.35, widthPx: 1.5 } as const;

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

  let trailFor: number | null = null;
  let trail: OrbitTrail | null = null;
  const applyTrail = (index: number | null) => {
    if (index === trailFor) return;
    trailFor = index;
    const satellite = index === null ? null : satelliteAt(index);
    trail = satellite?.initError === 0 ? new OrbitTrail(satellite) : null;
  };

  const moon = moonOverlay();
  renderer.setOverlay('earth', {
    markers: moon.markers,
    polylines: (simMs) => {
      const lines = moon.polylines(simMs);
      if (!trail) return lines;
      const g = trail.update(simMs);
      return [
        ...lines,
        { polyline: { vertices: g.track, count: g.trackCount }, style: TRACK_STYLE },
        { polyline: { vertices: g.orbit, count: g.orbitCount }, style: ORBIT_STYLE },
      ];
    },
  });
  renderer.setOverlay('solar', solarOverlay());

  const applySelection = () => {
    const s = selection.get();
    applyTrail(s.selected);
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
    viewMode.subscribe(() => {
      renderer.setMode(viewMode.get());
    }),
    selection.subscribe(applySelection),
    filter.subscribe(applyFilter),
    catalogIndex.subscribe(() => {
      cached = null;
      trailFor = null;
      selection.set((s) => ({ ...s, selected: null, hovered: null, follow: false }));
      applyFilter();
    }),
  ];
  renderer.setMode(viewMode.get());
  applySelection();
  applyFilter();

  return () => {
    for (const u of unsubscribe) u();
    if (activeRenderer === renderer) activeRenderer = null;
  };
}
