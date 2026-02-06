/**
 * Supabase Migration Save Functions
 * 
 * Functions to save migrated data to Supabase with Zod schema validation
 * All functions validate data against Zod schemas before insertion
 * 
 * Note: This file works in both browser (Vite) and Node.js environments
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { episodeSchema, type Episode } from '../schemas/episodeSchema';
import { subtitleThSchema, type SubtitleTh } from '../schemas/subtitleThSchema';
import { wordThSchema, type WordTh } from '../schemas/wordThSchema';
import { meaningThSchema, type MeaningTh } from '../schemas/meaningThSchema';

// Load environment variables for Node.js
dotenv.config();

// Initialize Supabase client (works in both browser and Node.js)
// For migrations, prefer service role key (bypasses RLS), fallback to anon key
let supabaseUrl: string;
let supabaseKey: string;

if (typeof process !== 'undefined' && process.env) {
  // Node.js environment
  supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://gbsopnbovsxlstnmaaga.supabase.co';
  // Prefer service role key for migrations (bypasses RLS), fallback to anon key
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || '[YOUR-ANON-KEY]';
  // Use service role key if it's a valid JWT (starts with eyJ), otherwise use anon key
  supabaseKey = (serviceRoleKey && serviceRoleKey.startsWith('eyJ')) ? serviceRoleKey : anonKey;
} else {
  // Browser/Vite environment - use anon key only
  const meta = (globalThis as any).import?.meta || (window as any)?.import?.meta;
  supabaseUrl = meta?.env?.VITE_SUPABASE_URL || 'https://gbsopnbovsxlstnmaaga.supabase.co';
  supabaseKey = meta?.env?.VITE_SUPABASE_ANON_KEY || '[YOUR-ANON-KEY]';
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

/**
 * Save episode to Supabase
 * Validates with episodeSchema before insertion
 */
export async function saveEpisode(episode: Episode): Promise<void> {
  // Validate with Zod schema
  const validated = episodeSchema.parse(episode);

  // Convert bigint to number if it fits in safe integer range, otherwise string
  // Supabase/PostgreSQL bigint accepts both number and string
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
 * Save subtitle to Supabase
 * Validates with subtitleThSchema before insertion
 */
export async function saveSubtitle(subtitle: SubtitleTh): Promise<void> {
  // Validate with Zod schema
  const validated = subtitleThSchema.parse(subtitle);

  const subtitleData = {
    id: validated.id,
    thai: validated.thai,
    start_sec_th: validated.start_sec_th !== undefined ? validated.start_sec_th : null,
    end_sec_th: validated.end_sec_th !== undefined ? validated.end_sec_th : null,
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
 * Save word to Supabase
 * Validates with wordThSchema before insertion
 * Returns the inserted word ID (word_th as string) for FK relationships
 */
export async function saveWord(word: WordTh): Promise<string> {
  // Validate with Zod schema
  const validated = wordThSchema.parse(word);

  const wordData = {
    word_th: validated.word_th,
    g2p: validated.g2p || null,
    phonetic_en: validated.phonetic_en || null,
  };

  const { error } = await supabase
    .from('words_th')
    .upsert(wordData, { onConflict: 'word_th' });

  if (error) {
    throw new Error(`Failed to save word: ${error.message}`);
  }

  // Return the word_th as string for FK relationships
  return validated.word_th;
}

/**
 * Save meaning (sense) to Supabase
 * Validates with meaningThSchema before insertion
 * Requires word_th_id (text) for FK relationship
 */
export async function saveMeaning(meaning: MeaningTh): Promise<void> {
  // Validate with Zod schema
  const validated = meaningThSchema.parse(meaning);

  // Convert bigint to number if it fits in safe integer range, otherwise string
  const idValue = validated.id <= BigInt(Number.MAX_SAFE_INTEGER) 
    ? Number(validated.id) 
    : validated.id.toString();

  const meaningData = {
    id: idValue,
    definition_th: validated.definition_th,
    word_th_id: validated.word_th_id || null,
    source: validated.source || null,
    created_at: validated.created_at || null,
  };

  const { error } = await supabase
    .from('meanings_th')
    .upsert(meaningData, { onConflict: 'id' });

  if (error) {
    throw new Error(`Failed to save meaning: ${error.message}`);
  }
}
