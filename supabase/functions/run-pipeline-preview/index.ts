/**
 * Runs the same sentence pipeline preview as the web app (bundled JS), server-side.
 * Deploy: `npm run build:edge-pipeline-preview` (writes `pipelinePreview.mjs` ESM bundle + MCP payload), then
 * `supabase functions deploy run-pipeline-preview` or deploy via Management API / `scripts/.mcp-deploy-run-pipeline-preview.payload.json`.
 *
 * Secrets (Dashboard → Edge Functions → Secrets): auto-set `SUPABASE_URL`, `SUPABASE_ANON_KEY`;
 * you may use a modern **publishable** client key instead of the legacy anon JWT — set
 * `SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_PUBLISHABLE_KEY` (same value you get from MCP/tooling
 * `get_publishable_keys` / Dashboard API keys). Also add `VITE_AI4THAI_API_KEY` or `AI4THAI_API_KEY`,
 * `VITE_OPENAI_API_KEY` or `OPENAI_API_KEY`, and `GOOGLE_TTS_API_KEY` or `VITE_GOOGLE_TTS_API_KEY`
 * if the `audio` step is enabled.
 *
 * Responses are always JSON with `ok`; use `meta.envHints` (booleans only) to see which secrets are set.
 *
 * Avoid `node:process` and avoid assigning to Deno's `process.env` proxy (throws `NotSupported` on Edge).
 * Replace `globalThis.process` with a plain `{ env }` object, then copy `Deno.env` into it for the bundle.
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  /** Must list every header the browser sends; missing `apikey` breaks preflight → TypeError: Failed to fetch */
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, apikey, x-client-info, X-Client-Info, prefer, Prefer',
};

const SERVICE = 'run-pipeline-preview';

/** Safe summary of POST body for error/success meta (no raw Thai text). */
function summarizeRequestBody(body: unknown): Record<string, unknown> {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const thai = typeof b.thaiText === 'string' ? b.thaiText : '';
  const stepEnabled =
    b.stepEnabled && typeof b.stepEnabled === 'object'
      ? (b.stepEnabled as Record<string, boolean>)
      : {};
  const togglesOff = Object.entries(stepEnabled)
    .filter(([, v]) => v === false)
    .map(([k]) => k);
  return {
    thaiTextCharLength: thai.length,
    mode: typeof b.mode === 'string' ? b.mode : undefined,
    tokenizer: typeof b.tokenizer === 'string' ? b.tokenizer : undefined,
    tokenIndex: typeof b.tokenIndex === 'number' ? b.tokenIndex : undefined,
    stepEnabledFalse: togglesOff.slice(0, 24),
    spellcheckOption: b.spellcheck,
    translateTh2EnOption: b.translateTh2En,
  };
}

function envHints(): Record<string, boolean> {
  const g = (k: string) => (Deno.env.get(k)?.trim() ? true : false);
  return {
    supabaseUrl: g('SUPABASE_URL') || g('VITE_SUPABASE_URL'),
    supabaseAnon:
      g('SUPABASE_ANON_KEY') ||
      g('VITE_SUPABASE_ANON_KEY') ||
      g('SUPABASE_PUBLISHABLE_KEY') ||
      g('VITE_SUPABASE_PUBLISHABLE_KEY'),
    ai4thai: g('AI4THAI_API_KEY') || g('VITE_AI4THAI_API_KEY'),
    openai: g('OPENAI_API_KEY') || g('VITE_OPENAI_API_KEY'),
    googleTts: g('GOOGLE_TTS_API_KEY') || g('VITE_GOOGLE_TTS_API_KEY'),
  };
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function seedProcessEnvFromDeno(): void {
  const env: Record<string, string | undefined> = {};
  const pairs: readonly (readonly [string, readonly string[]])[] = [
    ['VITE_SUPABASE_URL', ['SUPABASE_URL', 'VITE_SUPABASE_URL']],
    [
      'VITE_SUPABASE_ANON_KEY',
      [
        'SUPABASE_ANON_KEY',
        'VITE_SUPABASE_ANON_KEY',
        'SUPABASE_PUBLISHABLE_KEY',
        'VITE_SUPABASE_PUBLISHABLE_KEY',
      ],
    ],
    ['VITE_AI4THAI_API_KEY', ['VITE_AI4THAI_API_KEY', 'AI4THAI_API_KEY']],
    ['VITE_OPENAI_API_KEY', ['VITE_OPENAI_API_KEY', 'OPENAI_API_KEY']],
    ['VITE_GOOGLE_TTS_API_KEY', ['VITE_GOOGLE_TTS_API_KEY', 'GOOGLE_TTS_API_KEY']],
    ['VITE_AI4THAI_LEXTO_NORM', ['VITE_AI4THAI_LEXTO_NORM']],
  ] as const;

  for (const [viteKey, denoKeys] of pairs) {
    for (const dk of denoKeys) {
      const v = Deno.env.get(dk)?.trim();
      if (v) {
        env[viteKey] = v;
        break;
      }
    }
  }

  const g = globalThis as unknown as { process?: { env: Record<string, string | undefined> } };
  g.process = { env };
}

let pipelineMod: typeof import('./pipelinePreview.mjs') | null = null;

async function loadPipeline(): Promise<typeof import('./pipelinePreview.mjs')> {
  if (!pipelineMod) {
    seedProcessEnvFromDeno();
    pipelineMod = await import('./pipelinePreview.mjs');
  }
  return pipelineMod;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method === 'GET') {
    return jsonResponse(200, {
      ok: true,
      service: SERVICE,
      meta: { envHints: envHints(), hint: 'POST JSON body: EdgePipelinePreviewBody (see src/edge/pipelinePreviewBundleEntry.ts)' },
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, {
      ok: false,
      error: 'Method not allowed',
      meta: { envHints: envHints(), service: SERVICE },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, {
      ok: false,
      error: 'Invalid JSON body',
      meta: { envHints: envHints(), service: SERVICE },
    });
  }

  const t0 = performance.now();
  const requestSummary = summarizeRequestBody(body);
  let loadPhase: 'before_bundle' | 'bundle_loaded' | 'pipeline_running' = 'before_bundle';
  try {
    loadPhase = 'before_bundle';
    const mod = await loadPipeline();
    loadPhase = 'bundle_loaded';
    const { runPipelinePreviewFromEdge } = mod;
    loadPhase = 'pipeline_running';
    const { report, checklist, diagnostics } = await runPipelinePreviewFromEdge(body as never);
    const durationMs = Math.round(performance.now() - t0);
    return jsonResponse(200, {
      ok: true,
      service: SERVICE,
      meta: {
        durationMs,
        envHints: envHints(),
        checklistSteps: checklist.length,
        requestSummary,
        diagnostics,
        hint:
          'meta.diagnostics (v3): subtitleMockExplain, subareaBlockers, checklistFull, tokenTextPreview, wordPipelineSummaries, stepFeedback, per-step API errors. envHints are booleans only (no secret values).',
      },
      report,
      checklist,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const durationMs = Math.round(performance.now() - t0);
    console.error(`[${SERVICE}]`, e);
    const clipErr = (s: string, max: number) => {
      const t = s.trim();
      return t.length <= max ? t : `${t.slice(0, max - 1)}...`;
    };
    const errMeta: Record<string, unknown> = {
      durationMs,
      envHints: envHints(),
      service: SERVICE,
      loadPhase,
      requestSummary,
    };
    if (e instanceof Error) {
      errMeta.errorName = e.name;
      errMeta.errorMessageFull = clipErr(e.message, 4000);
      if (e.stack) {
        errMeta.stackPreview = e.stack.slice(0, 6000);
      }
      const cause = (e as Error & { cause?: unknown }).cause;
      if (cause != null) {
        if (cause instanceof Error) {
          errMeta.errorCause = {
            name: cause.name,
            message: clipErr(cause.message, 2000),
            stackPreview: cause.stack ? cause.stack.slice(0, 4000) : undefined,
          };
        } else {
          errMeta.errorCause = { message: clipErr(String(cause), 2000) };
        }
      }
    }
    errMeta.hint =
      'loadPhase: before_bundle = crashed importing pipeline bundle; bundle_loaded = crash before run; pipeline_running = crash inside runPipelinePreview. Full stack in Dashboard, Edge Functions, Logs. meta.errorMessageFull / stackPreview / errorCause summarize the worker exception (no secrets).';
    return jsonResponse(500, {
      ok: false,
      error: msg,
      meta: errMeta,
    });
  }
});
