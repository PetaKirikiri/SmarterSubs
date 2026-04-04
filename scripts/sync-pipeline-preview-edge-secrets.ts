/**
 * Push AI4Thai / OpenAI / Google TTS keys from `.env` to Supabase Edge Function secrets
 * (used by `run-pipeline-preview`). Same API as Dashboard → Edge Functions → Secrets.
 *
 * Requires a Supabase Personal Access Token (Dashboard → Account → Access Tokens):
 * set SUPABASE_ACCESS_TOKEN in `.env`, or reuse SUPABASE_SERVICE_ROLE_KEY if it is an `sbp_` PAT.
 *
 * Run: npx tsx scripts/sync-pipeline-preview-edge-secrets.ts
 * Or:  npm run sync:pipeline-preview-edge-secrets
 */
import * as dotenv from 'dotenv';

dotenv.config();

const PROJECT_REF =
  process.env.SUPABASE_PROJECT_REF?.trim() || 'gbsopnbovsxlstnmaaga';

function pickEnv(...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  return undefined;
}

function managementToken(): string | undefined {
  const t =
    process.env.SUPABASE_ACCESS_TOKEN?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (t?.startsWith('sbp_')) return t;
  return undefined;
}

async function main() {
  const token = managementToken();
  if (!token) {
    console.error(
      'Missing PAT: set SUPABASE_ACCESS_TOKEN (sbp_…) in .env. Dashboard → Account → Access Tokens.'
    );
    process.exit(1);
  }

  /** Names must not start with SUPABASE_ (API rule). Edge reads these via seedProcessEnvFromDeno in index.ts. */
  const body: { name: string; value: string }[] = [];

  const ai = pickEnv('AI4THAI_API_KEY', 'VITE_AI4THAI_API_KEY');
  if (ai) body.push({ name: 'AI4THAI_API_KEY', value: ai });

  const openai = pickEnv('OPENAI_API_KEY', 'VITE_OPENAI_API_KEY');
  if (openai) body.push({ name: 'OPENAI_API_KEY', value: openai });

  const tts = pickEnv('GOOGLE_TTS_API_KEY', 'VITE_GOOGLE_TTS_API_KEY');
  if (tts) body.push({ name: 'GOOGLE_TTS_API_KEY', value: tts });

  const lextoNorm = pickEnv('VITE_AI4THAI_LEXTO_NORM', 'AI4THAI_LEXTO_NORM');
  if (lextoNorm) body.push({ name: 'VITE_AI4THAI_LEXTO_NORM', value: lextoNorm });

  if (body.length === 0) {
    console.error(
      'No keys found in .env. Add at least one of:\n' +
        '  AI4THAI_API_KEY or VITE_AI4THAI_API_KEY\n' +
        '  OPENAI_API_KEY or VITE_OPENAI_API_KEY\n' +
        '  GOOGLE_TTS_API_KEY or VITE_GOOGLE_TTS_API_KEY'
    );
    process.exit(1);
  }

  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Secrets API error:', res.status, text.slice(0, 2000));
    process.exit(1);
  }

  console.log(
    '[sync-pipeline-preview-edge-secrets] OK — set Edge secret name(s):',
    body.map((b) => b.name).join(', ')
  );
  if (!ai) console.warn('  (optional) AI4THAI_API_KEY not in .env — tokenize/POS/G2P/spellcheck/th2en will fail on Edge.');
  if (!openai) console.warn('  (optional) OPENAI_API_KEY not in .env — GPT steps will fail on Edge.');
  if (!tts) console.warn('  (optional) GOOGLE_TTS_API_KEY not in .env — audio step will fail on Edge.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
