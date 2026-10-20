// CLI entry point: node scripts/pipeline/fetch-catalog.ts [--out dir] [--cache dir] [--offline]
import { parseArgs } from 'node:util';
import { runPipeline } from './pipeline.ts';

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'public/data' },
    cache: { type: 'string', default: '.cache/celestrak' },
    offline: { type: 'boolean', default: false },
  },
});

const repo = process.env.GITHUB_REPOSITORY;
const userAgent = `satellite-tracker-pipeline/1.0${repo ? ` (+https://github.com/${repo})` : ''}`;

try {
  await runPipeline({
    outDir: values.out,
    cacheDir: values.cache,
    offline: values.offline,
    now: new Date(),
    fetchImpl: fetch,
    userAgent,
    log: (message) => {
      console.log(message);
    },
  });
} catch (error) {
  console.error(`Pipeline failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
