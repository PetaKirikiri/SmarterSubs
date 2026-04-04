/**
 * Bundle pipeline preview for Supabase Edge:
 * - Writes `pipelinePreview.mjs` as plain ESM (esbuild). Edge/Deno loads it via `import('./pipelinePreview.mjs')`.
 * - Run: npx tsx scripts/build-edge-pipeline-preview.ts
 */
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as fs from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fnDir = join(root, 'supabase/functions/run-pipeline-preview');
const bundlePath = join(fnDir, 'pipelinePreview.mjs');

async function main() {
  await esbuild.build({
    entryPoints: [join(root, 'src/edge/pipelinePreviewBundleEntry.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundlePath,
    target: 'es2022',
    logLevel: 'info',
    sourcemap: false,
    treeShaking: true,
    minify: true,
    legalComments: 'none',
    define: {
      'import.meta.env': '{}',
    },
  });

  const bytes = fs.statSync(bundlePath).size;
  console.log('[build-edge-pipeline-preview]', {
    bundlePath,
    bytes,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
