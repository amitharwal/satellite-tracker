# Satellite Tracker

Static, browser-based 3D tracker for the active satellite catalog, deployed to GitHub Pages.
See [CLAUDE.md](CLAUDE.md) for architecture, constraints and the phase plan.

## Requirements

- Node 24 LTS (see `.nvmrc`), npm

## Scripts

| Command                | Purpose                                                    |
| ---------------------- | ---------------------------------------------------------- |
| `npm run dev`          | Vite dev server                                            |
| `npm run build`        | Typecheck and production build to `dist/`                  |
| `npm run typecheck`    | `tsc -b` over app and Node projects                        |
| `npm run lint`         | ESLint (type-aware)                                        |
| `npm run format`       | Prettier write (`format:check` to verify)                  |
| `npm test`             | Vitest, single run (`test:watch` for watch mode)           |
| `npm run data:fetch`   | Fetch the catalog from CelesTrak into `public/data/`       |
| `npm run data:offline` | Rebuild `public/data/` from the local cache, never fetches |
| `npm run verify:diff`  | Full-catalog SGP4 comparison against satellite.js          |

## Catalog data

Source: [CelesTrak](https://celestrak.org) GP data for the `active` group, as OMM CSV.
OMM is used instead of TLE because new objects have 6-digit catalog numbers, which TLE
cannot represent.

The pipeline (`scripts/pipeline/`) follows CelesTrak's
[usage policy](https://celestrak.org/NORAD/documentation/gp-data-formats.php):

- Data updates every 2 hours, and repeat downloads within a window get HTTP 403. The raw
  response is cached in `.cache/celestrak/` and reused while under 2 hours old.
- One attempt per run, with no retries. Any non-200 response (including redirects) fails the run.

It then validates rows and writes `public/data/manifest.json` plus a content-hashed
`catalog.<hash>.json` (columnar JSON, schema in `src/data/schema.ts`). The run fails if more
than 1% of rows are rejected, if fewer than 5,000 objects remain, or if the count drops more
than 20% from the last good run.

Generated data is never committed. Locally, run `npm run data:fetch` at most once per 2 hours.

## Orbit propagation

`src/orbit/` implements SGP4/SDP4 from scratch, ported from David Vallado's C++ reference
for "Revisiting Spacetrack Report #3" (AIAA 2006-6753,
<https://celestrak.org/publications/AIAA/2006-6753/>). Positions are converted from TEME to
Earth-fixed coordinates with IAU-82 GMST; polar motion is ignored.

Verification:

- `npm test` runs all 33 Vallado verification cases in both opsmodes against the reference
  output: every position is within 1 m (max observed 4.1 mm), and error codes match. Fixture
  provenance: [test/fixtures/sgp4-verification/README.md](test/fixtures/sgp4-verification/README.md).
- `npm run verify:diff` propagates the whole catalog in `public/data/` at six times with both
  this implementation and [satellite.js](https://github.com/shashwatak/satellite-js), which is
  used only as a dev-time test oracle. It reports max/p99/median differences and fails on
  algorithm disagreement of 1 m or more. CI runs it on every deploy and writes the report to
  the job summary.

## Using the app

- **Drag** to rotate, **scroll** or pinch to zoom.
- **Hover** a satellite for its name; **click** to select it and open the info panel (live
  position, altitude, speed, orbit summary, element age). **Fly to** centres the camera on it;
  **Follow** keeps it centred until you drag. <kbd>Esc</kbd> deselects.
- **Search & filter** (top left): find by name, NORAD ID or international designator; filter
  by orbit regime and constellation. Constellations are matched by object name, since the
  catalog carries no group membership.
- **Time** (bottom): pause, rates from −600× to 3600×, and **Now**.
- **Orbit and ground track**: the selected satellite's orbit (one period, inertial frame) and
  its ground track (± one period) are drawn; the past half is dimmed.
- **Passes**: set a location ("Use my location" or typed coordinates; stored only in your
  browser) to list the next passes within 48 h, with direction, duration, peak elevation and
  naked-eye visibility (satellite sunlit, observer's Sun below −6°, elevation ≥ 10°). Click a
  pass to jump the clock to it.
- **Moon and solar system**: zoom out to see the Moon and its orbit. **Solar system** switches
  to a heliocentric view of the Sun and planets with day-scale time rates.

Picking is done on the GPU: satellite IDs are rendered into an integer target around the
pointer and read back asynchronously (pixel-pack buffer + fence), so it never stalls a frame.

## Rendering and performance

Workers propagate the catalog off the main thread: a pool of `cores − 1` workers (at most
8), each owning a contiguous slice. They return ECEF positions at the start and end of a
short window as transferred `Float32Array`s (no copies, no SharedArrayBuffer), and the GPU
interpolates linearly between them every frame. While one window is drawn, the next is
computed and uploaded to a second set of buffers. The update rate is 10 Hz at real time and
rises (up to 60 Hz) at high time multipliers so a window never spans more than 10 s of
simulated time. Satellites whose propagation fails are hidden and counted, never thrown.

Press <kbd>`</kbd> (backquote) for the performance overlay. URL parameters for tuning:

| Parameter    | Effect                                   |
| ------------ | ---------------------------------------- |
| `?stats`     | Show the performance overlay at startup  |
| `?workers=N` | Override the worker count                |
| `?hz=N`      | Base propagation rate, 1–60 (default 10) |

`npm run bench:propagation` times one full-catalog batch on a single thread.

## Deployment

`.github/workflows/deploy.yml` runs on push to `main`, every 4 hours and on manual dispatch.
It checks the code, fetches the catalog, builds and deploys to GitHub Pages. If any step
fails, nothing is deployed and the previous site stays live.

One-time setup: in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.

Note: GitHub disables scheduled workflows in public repositories after 60 days without
repository activity. Re-enable it from the Actions tab if the data stops updating.

## Attribution

- Orbital data courtesy of [CelesTrak](https://celestrak.org) (Dr. T.S. Kelso).
- SGP4 ported from David Vallado's reference implementation (Vallado, Crawford, Hujsak and
  Kelso, AIAA 2006-6753), <https://celestrak.org/publications/AIAA/2006-6753/>.
- Planet positions: E. M. Standish and J. G. Williams, "Keplerian Elements for Approximate
  Positions of the Major Planets", JPL Solar System Dynamics,
  <https://ssd.jpl.nasa.gov/planets/approx_pos.html> (Table 1, valid 1800–2050). Checked
  against JPL Horizons (DE441).
- Moon and Sun: low-precision formulae from the Astronomical Almanac.
- Earth textures: NASA Earth Observatory (Blue Marble: Next Generation; Black Marble 2016).
  See [public/textures/CREDITS.md](public/textures/CREDITS.md).
