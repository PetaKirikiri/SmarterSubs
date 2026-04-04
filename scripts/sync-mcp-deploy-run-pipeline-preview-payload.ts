/**
 * Refreshes scripts/.mcp-deploy-run-pipeline-preview.payload.json from the function
 * folder so MCP / Management API deploys match `npm run build:edge-pipeline-preview`.
 */
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fnDir = join(root, 'supabase/functions/run-pipeline-preview');
const outPath = join(root, 'scripts/.mcp-deploy-run-pipeline-preview.payload.json');

function main() {
  const indexTs = fs.readFileSync(join(fnDir, 'index.ts'), 'utf8');
  const pipelinePreview = fs.readFileSync(join(fnDir, 'pipelinePreview.mjs'), 'utf8');
  if (pipelinePreview.includes('readTextFile') && pipelinePreview.includes('bundle.gz.b64')) {
    throw new Error(
      'pipelinePreview.mjs still uses readTextFile(bundle.gz.b64). Run npm run build:edge-pipeline-preview first.'
    );
  }
  if (
    pipelinePreview.includes('createObjectURL') &&
    (pipelinePreview.includes('import(u)') || pipelinePreview.includes('await import(u)'))
  ) {
    throw new Error(
      'pipelinePreview.mjs still uses blob URL dynamic import (not supported on Edge). Run npm run build:edge-pipeline-preview.'
    );
  }
  if (!pipelinePreview.includes('runPipelinePreviewFromEdge')) {
    throw new Error(
      'pipelinePreview.mjs missing runPipelinePreviewFromEdge export. Run npm run build:edge-pipeline-preview.'
    );
  }
  const payload = {
    name: 'run-pipeline-preview',
    entrypoint_path: 'index.ts',
    verify_jwt: false,
    files: [
      { name: 'index.ts', content: indexTs },
      { name: 'pipelinePreview.mjs', content: pipelinePreview },
    ],
  };
  fs.writeFileSync(outPath, JSON.stringify(payload), 'utf8');
  console.log('[sync-mcp-deploy-run-pipeline-preview-payload]', {
    outPath,
    pipelinePreviewChars: pipelinePreview.length,
  });
}

main();
