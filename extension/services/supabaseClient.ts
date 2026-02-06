/**
 * Supabase Client for Chrome Extension
 * Saves episodes and subtitles to Supabase
 */

import { createClient } from '@supabase/supabase-js';
import { episodeSchema, type Episode } from '@/schemas/episodeSchema';
import { subtitleThSchema, type SubtitleTh } from '@/schemas/subtitleThSchema';

// Get Supabase config from environment variables (injected by Vite)
function getSupabaseConfig() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://gbsopnbovsxlstnmaaga.supabase.co';
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '[YOUR-ANON-KEY]';
  
  if (supabaseKey === '[YOUR-ANON-KEY]') {
    throw new Error('VITE_SUPABASE_ANON_KEY is not set. Please set it in your .env file and rebuild the extension.');
  }
  
  return { supabaseUrl, supabaseKey };
}

let supabaseClient: ReturnType<typeof createClient> | null = null;

function getSupabaseClient() {
  if (!supabaseClient) {
    const { supabaseUrl, supabaseKey } = getSupabaseConfig();
    supabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }
  return supabaseClient;
}

/**
 * Save episode to Supabase
 * Validates with episodeSchema before insertion
 */
export async function saveEpisode(episode: Episode): Promise<void> {
  const validated = episodeSchema.parse(episode);
  const supabase = getSupabaseClient();

  const idValue = validated.id <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(validated.id)
    : validated.id.toString();

  const episodeData = {
    id: idValue,
    media_id: validated.media_id,
    show_title: validated.show_title || null,
    season_number: validated.season_number !== undefined ? validated.season_number : null,
    episode_number: validated.episode_number !== undefined ? validated.episode_number : null,
    episode_title: validated.episode_title || null,
  };

  const { error } = await supabase
    .from('episodes')
    .upsert(episodeData, { onConflict: 'id' });

  if (error) {
    throw new Error(`Failed to save episode: ${error.message}`);
  }
}

/**
 * Fetch existing subtitles by IDs
 * Returns a Map<id, subtitle> for quick lookup
 */
async function fetchExistingSubtitlesByIds(ids: string[]): Promise<Map<string, any>> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('subtitles_th')
    .select('id, tokens_th')
    .in('id', ids);
  
  if (error) {
    throw new Error(`Failed to fetch existing subtitles: ${error.message}`);
  }
  
  const map = new Map();
  (data || []).forEach(sub => {
    map.set(sub.id, sub);
  });
  return map;
}

/**
 * Save subtitle to Supabase
 * Validates with subtitleThSchema before insertion
 */
export async function saveSubtitle(subtitle: SubtitleTh): Promise<void> {
  const validated = subtitleThSchema.parse(subtitle);
  const supabase = getSupabaseClient();

  const subtitleData = {
    id: validated.id,
    thai: validated.thai,
    start_sec_th: validated.start_sec_th,
    end_sec_th: validated.end_sec_th,
    tokens_th: validated.tokens_th || null,
  };

  const { error } = await supabase
    .from('subtitles_th')
    .upsert(subtitleData, { onConflict: 'id' });

  if (error) {
    throw new Error(`Failed to save subtitle: ${error.message}`);
  }
}

/**
 * Save multiple subtitles in batch
 * @param subtitles - Array of subtitles to save
 * @param preserveTokens - If true, fetches existing subtitles and preserves their tokens_th field
 */
export async function saveSubtitlesBatch(
  subtitles: SubtitleTh[], 
  preserveTokens: boolean = false
): Promise<void> {
  const supabase = getSupabaseClient();
  const validatedSubtitles = subtitles.map(sub => subtitleThSchema.parse(sub));

  let subtitleDataArray;
  
  if (preserveTokens) {
    // Fetch existing subtitles to preserve tokens
    const ids = validatedSubtitles.map(s => s.id);
    const existingMap = await fetchExistingSubtitlesByIds(ids);
    
    subtitleDataArray = validatedSubtitles.map(validated => {
      const existing = existingMap.get(validated.id);
      return {
        id: validated.id,
        thai: validated.thai,
        start_sec_th: validated.start_sec_th,
        end_sec_th: validated.end_sec_th,
        // Preserve existing tokens if they exist, otherwise use new data or null
        tokens_th: existing?.tokens_th || validated.tokens_th || null,
      };
    });
  } else {
    // Original behavior: no token preservation
    subtitleDataArray = validatedSubtitles.map(validated => ({
      id: validated.id,
      thai: validated.thai,
      start_sec_th: validated.start_sec_th,
      end_sec_th: validated.end_sec_th,
      tokens_th: validated.tokens_th || null,
    }));
  }

  const { error } = await supabase
    .from('subtitles_th')
    .upsert(subtitleDataArray, { onConflict: 'id' });

  if (error) {
    throw new Error(`Failed to save subtitles batch: ${error.message}`);
  }
}
