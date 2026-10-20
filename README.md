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

## Deployment

`.github/workflows/deploy.yml` runs on push to `main`, every 4 hours and on manual dispatch.
It checks the code, fetches the catalog, builds and deploys to GitHub Pages. If any step
fails, nothing is deployed and the previous site stays live.

One-time setup: in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.

Note: GitHub disables scheduled workflows in public repositories after 60 days without
repository activity. Re-enable it from the Actions tab if the data stops updating.

## Attribution

Orbital data courtesy of [CelesTrak](https://celestrak.org) (Dr. T.S. Kelso).
