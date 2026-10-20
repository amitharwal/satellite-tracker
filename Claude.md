# Satellite Tracker (working name)

Static, browser-based 3D tracker for the active satellite catalog, deployed to GitHub Pages.

## Roles
- The user is the decision-maker. You are the implementer.
- Surface every non-obvious design decision as explicit options with tradeoffs. Do not decide silently.
- Never add a dependency without asking first and justifying it.
- If uncertain about an external fact (API endpoint, data format, browser support, license), verify it by fetching or reading docs before writing code. If it cannot be verified, say so.
- Work one phase at a time. Stop at the end of each phase for review. One commit per logical step, using conventional commit messages.

## Hard constraints
- GitHub Pages is static hosting: no server, no custom HTTP headers.
  - Therefore no SharedArrayBuffer (it needs COOP/COEP headers). Use Transferable ArrayBuffers with double-buffering between workers and the main thread.
- Graphics: raw WebGL2 only. No Three.js or other rendering libraries. Write shaders in GLSL ES 3.00, imported via Vite `?raw`.
- SGP4/SDP4 is implemented from scratch, deep-space included (GEO satellites need it).
  - `satellite.js` is allowed ONLY as a devDependency test oracle. It must never be imported from `src/`.
- Runtime dependencies: React, React DOM, Tailwind, and shadcn/ui primitives. Anything else needs approval.

## Stack
- Vite + React 18+ (functional components, hooks), TypeScript strict mode, ES modules.
- Tailwind v4 and shadcn/ui for the UI chrome only.
- Vitest for tests. ESLint + Prettier: 2-space indent, semicolons.
- Node 20+, npm.

## Architecture
- Data pipeline (GitHub Actions, scheduled every few hours plus on push to main):
  - Fetch GP data from CelesTrak's active group.
    - Prefer OMM (JSON/CSV) over TLE, since 5-digit catalog numbers are running out.
    - Verify the current endpoint and usage policy, and respect its rate guidance.
  - Validate, then transform into a compact, versioned data file plus a manifest (schema version, generated-at time, count).
  - Build the site and deploy to Pages in the same workflow.
  - Data is NEVER committed to git.
  - If the fetch fails, fail the workflow so the last good deployment stays live.
- Orbit library (`src/orbit/`): pure TypeScript, no DOM.
  - Parse elements, initialize SGP4, propagate.
  - Convert from the SGP4 output frame (TEME) to Earth-fixed coordinates (ECEF) using IAU-82 GMST; polar motion is ignored.
  - Use split Julian dates (whole day + fraction) to keep time precision.
  - Fully unit-tested.
- Workers (`src/workers/`): a pool sized to `navigator.hardwareConcurrency - 1`, each owning a slice of the catalog.
  - Propagate at a measured, tunable rate (start at about 10 Hz), not every frame.
  - Return positions at t0 and t1 as Float32Array (Earth radii, ECEF) via transfer.
  - The GPU interpolates between them each frame.
  - Satellites whose propagation fails (decayed or errored) are flagged, not thrown.
- Renderer (`src/gl/`): imperative, framework-agnostic, owns its own requestAnimationFrame loop.
  - Thin typed helpers for shaders, buffers, VAOs, and textures.
  - Instanced billboard quads for satellites (not gl.POINTS, because of point-size limits).
  - Textured Earth sphere with a day/night terminator from a low-precision sun-position model; texture must be public domain, e.g. NASA Blue Marble, license verified.
  - Orbit-ish camera with smooth transitions.
  - GPU picking via an R32UI ID render target, read back asynchronously (PBO + fence) to avoid pipeline stalls.
- UI (`src/ui/`): React renders chrome only — search, filters, time controls, info panel.
  - React state never drives per-frame rendering.
  - Bridge React and the renderer with a small external store consumed via useSyncExternalStore (no state library).
- Simulated time: one clock source (epoch + rate multiplier) shared by UI, workers and renderer.

## Verification
- SGP4 matches the reference verification test cases from Vallado et al., "Revisiting Spacetrack Report #3" (AIAA 2006-6753).
  - Locate the published test inputs and expected outputs and verify their provenance.
  - Check the license of any reference code before porting, and attribute it.
  - Position error must be under 1 m against the reference output.
  - Error cases must reproduce the reference error codes.
- Differential test: propagate the full catalog at several times with both our SGP4 and satellite.js; report the max and p99 position difference.
- Performance: report worker propagation time per batch and frame time. Target 60 fps with the full catalog on a mid-range laptop.
- Before marking a phase done: typecheck, lint, all tests pass, `npm run build` succeeds.

## Phases
1. Scaffold: Vite + React + TS + Tailwind + shadcn/ui, lint/test setup, Pages deploy workflow with correct Vite `base`, data pipeline job producing the catalog file.
2. WebGL2 foundation: GL helpers, camera, textured Earth with terminator, render loop decoupled from React.
3. Orbit library: element parsing, SGP4/SDP4, TEME to ECEF, the verification suite above.
4. Scale-up: worker pool, double-buffered transfers, instanced satellites, GPU interpolation, perf instrumentation.
5. Interaction: async GPU picking, search/filter by name/NORAD ID/group, time controls (pause, rate, jump to now), info panel.
6. Stretch (only on user approval): pass predictions for user location, orbit trails, solar-system zoom-out mode.
