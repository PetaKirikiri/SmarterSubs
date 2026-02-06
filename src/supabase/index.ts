/**
 * Supabase Database Service
 * 
 * All database operations using Supabase (PostgreSQL)
 * Tables: episodes, subtitles, words_th, meanings_th
 * 
 * ⚠️ DATA INTEGRITY: All queries in this file are DIRECT database calls.
 * - NO client-side caching (Supabase client doesn't cache by default)
 * - NO localStorage or sessionStorage usage
 * - NO TanStack Query caching (queries use direct supabase.from() calls)
 * - Each query is a fresh HTTP request to Supabase
 * 
 * For data integrity checks, these functions always return the latest data from the database.
 */

import { createClient } from '@supabase/supabase-js';
import { subtitleThSchema } from '../schemas/subtitleThSchema';
import { wordThSchema } from '../schemas/wordThSchema';
import { meaningThSchema } from '../schemas/meaningThSchema';
import { meaningThSchemaV2 } from '../schemas/meaningThSchemaV2';

// Supabase connection
// ⚠️ Direct database connection - no caching layer
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://gbsopnbovsxlstnmaaga.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '[YOUR-ANON-KEY]';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Re-export schema for Drizzle migrations
export * from './schema';

// Query functions
export async function fetchEpisodeLookups(limitCount: number = 10) {
  // #region agent log
  console.log('[DEBUG] fetchEpisodeLookups called with limitCount:', limitCount);
  // #endregion
  
  // Query episodes table
  // Columns: id (bigint), media_id (text), show_title (text), season_number (numeric), episode_number (numeric), episode_title (text)
  const { data, error } = await supabase
    .from('episodes')
    .select('*')
    .limit(limitCount);
  
  // #region agent log
  console.log('[DEBUG] fetchEpisodeLookups raw result:', {dataCount: data?.length || 0, error: error?.message, firstEpisode: data?.[0]});
  // #endregion
  
  if (error) {
    console.error('[DEBUG] fetchEpisodeLookups error:', error);
    throw error;
  }
  
  // Map episodes table format to EpisodeLookup format expected by the app
  // Database columns → EpisodeLookup interface:
  // id (bigint) → id (string)
  // media_id (text) → mediaId (string)
  // show_title (text) → showName (string)
  // season_number (numeric) → season (number)
  // episode_number (numeric) → episode (number)
  // episode_title (text) → episodeTitle (string)
  const mapped = (data || []).map((ep: any) => ({
    id: ep.id?.toString() || ep.media_id, // Convert bigint to string, fallback to media_id
    mediaId: ep.media_id, // camelCase for EpisodeLookup interface
    showName: ep.show_title || '', // camelCase for EpisodeLookup interface
    season: ep.season_number != null ? Number(ep.season_number) : undefined,
    episode: ep.episode_number != null ? Number(ep.episode_number) : undefined,
    episodeTitle: ep.episode_title || undefined, // camelCase for EpisodeLookup interface
  }));
  
  // #region agent log
  console.log('[DEBUG] fetchEpisodeLookups mapped result:', {originalCount: data?.length || 0, mappedCount: mapped.length, firstMapped: mapped[0]});
  // #endregion
  
  return mapped;
}

// REMOVED: fetchShow - shows table doesn't exist, show info is in episodes table

/**
 * Fetch an episode by show name and media ID
 * 
 * 📋 Validates against: src/schemas/episodeSchema.ts
 * Returns data that should be validated with episodeSchema before use
 */
export async function fetchEpisode(showName: string, mediaId: string) {
  // #region agent log
  console.log('[DEBUG] fetchEpisode called with:', {showName, mediaId});
  // #endregion
  
  // Zod schema field names: show_title, media_id
  const { data, error } = await supabase
    .from('episodes')
    .select('*')
    .eq('show_title', showName) // Zod schema: show_title
    .eq('media_id', mediaId) // Zod schema: media_id
    .single();
  
  // #region agent log
  console.log('[DEBUG] fetchEpisode result:', {found: !!data, error: error?.message, data: data ? Object.keys(data) : null});
  // #endregion
  
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

/**
 * Fetch subtitles for an episode
 * 
 * 📋 Validates against: src/schemas/subtitleThSchema.ts
 * Returns array that should be validated with subtitleThSchema[] before use
 * 
 * ⚠️ DATA INTEGRITY: Direct database query - always returns latest data from Supabase
 * - No caching, no localStorage, always fresh from database
 */
export async function fetchSubtitles(mediaId: string) {
  // #region agent log
  console.log('[DEBUG] fetchSubtitles called with mediaId:', mediaId);
  // #endregion
  
  // Subtitles_th table columns: id, thai, start_sec_th, end_sec_th, tokens_th (snake_case)
  // Filter subtitles by id pattern: `${mediaId}_${index}`
  const { data, error } = await supabase
    .from('subtitles_th')
    .select('*')
    .order('start_sec_th', { ascending: true });
  
  // #region agent log
  console.log('[DEBUG] fetchSubtitles - ALL subtitles from DB:', {
    dataCount: data?.length || 0, 
    error: error?.message, 
    firstSubtitle: data?.[0],
    allIds: data?.slice(0, 20).map((s: any) => s.id),
    mediaIdLookingFor: mediaId
  });
  // #endregion
  
  if (error) {
    console.error('[DEBUG] fetchSubtitles error:', error);
    throw error;
  }
  
  if (!data || data.length === 0) {
    console.warn('[DEBUG] fetchSubtitles: No subtitles found in database at all');
    return [];
  }
  
  // Filter by mediaId - subtitle IDs are formatted as `${mediaId}_${index}` (e.g., "Frieren: Beyond Journey's End_0")
  // Check if subtitle id starts with mediaId (exact prefix match)
  const filtered = (data || []).filter((sub: any) => {
    const subId = sub.id?.toString() || '';
    // Exact prefix match: subtitle ID should start with mediaId followed by underscore
    const matches = subId.startsWith(mediaId + '_') || subId === mediaId;
    return matches;
  });
  
  // Client-side sorting fallback to ensure proper chronological order
  const sorted = filtered.sort((a: any, b: any) => {
    const aTime = a.start_sec_th || 0;
    const bTime = b.start_sec_th || 0;
    return aTime - bTime;
  });
  
  // #region agent log
  console.log('[DEBUG] fetchSubtitles filtered result:', {
    originalCount: data?.length || 0, 
    filteredCount: sorted.length, 
    mediaId,
    sampleOriginalIds: data?.slice(0, 5).map((s: any) => s.id),
    filteredIds: sorted.slice(0, 5).map((s: any) => s.id),
    firstFilteredSubtitle: sorted[0]
  });
  // #endregion
  
  // If no matches, log for debugging but return empty (don't return all - that's wrong data)
  if (sorted.length === 0 && data.length > 0) {
    console.warn('[DEBUG] fetchSubtitles: No subtitles matched mediaId filter');
    console.warn('[DEBUG] MediaId was:', mediaId);
    console.warn('[DEBUG] Sample subtitle IDs in DB:', data.slice(0, 10).map((s: any) => s.id));
    console.warn('[DEBUG] Looking for IDs starting with or containing:', mediaId);
  }
  
  return sorted;
}

/**
 * Save multiple subtitles in batch
 * Validates each subtitle with subtitleThSchema before insertion
 * 
 * 📋 Validates against: src/schemas/subtitleThSchema.ts
 */
export async function saveSubtitlesBatch(subtitles: Array<{
  id: string;
  thai: string;
  start_sec_th?: number;
  end_sec_th?: number;
  tokens_th?: { tokens: string[] };
}>): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSubtitlesBatch',message:'Save subtitles batch started',data:{subtitleCount:subtitles?.length || 0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
  // #endregion
  console.log(`[Save] Saving ${subtitles?.length || 0} subtitles to Supabase`);
  
  if (!subtitles || subtitles.length === 0) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSubtitlesBatch',message:'No subtitles to save',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
    return;
  }

  // Validate all subtitles with Zod schema
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSubtitlesBatch',message:'Validating subtitles with Zod',data:{subtitleCount:subtitles.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
  // #endregion
  
  const validatedSubtitles = subtitles.map((sub, index) => {
    try {
      const validated = subtitleThSchema.parse(sub);
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSubtitlesBatch',message:'Subtitle Zod validation passed',data:{index,subtitleId:validated.id,hasTokens_th:!!validated.tokens_th},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
      // #endregion
      return validated;
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSubtitlesBatch',message:'Subtitle Zod validation failed',data:{index,subtitleId:sub.id,errorMessage:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
      // #endregion
      console.error(`[Save] Subtitle ${sub.id} validation failed:`, error);
      throw error;
    }
  });

  const subtitleDataArray = validatedSubtitles.map(validated => ({
    id: validated.id,
    thai: validated.thai,
    start_sec_th: validated.start_sec_th !== undefined ? validated.start_sec_th : null,
    end_sec_th: validated.end_sec_th !== undefined ? validated.end_sec_th : null,
    tokens_th: validated.tokens_th || null,
  }));

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSubtitlesBatch',message:'Calling Supabase upsert',data:{subtitleCount:subtitleDataArray.length,table:'subtitles_th'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
  // #endregion
  console.log(`[Save] Upserting ${subtitleDataArray.length} subtitles to 'subtitles_th' table`);

  const { error, data } = await supabase
    .from('subtitles_th')
    .upsert(subtitleDataArray, { onConflict: 'id' })
    .select();

  if (error) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSubtitlesBatch',message:'Supabase upsert failed',data:{errorMessage:error.message,errorCode:error.code,subtitleCount:subtitleDataArray.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
    console.error(`[Save] ✗ Failed to save subtitles:`, error);
    throw new Error(`Failed to save subtitles batch: ${error.message}`);
  }

  // #region agent log
  // Skip logging - successful operation
  // #endregion
  console.log(`[Save] ✓ Successfully saved ${data?.length || subtitleDataArray.length} subtitles to Supabase`);
}

/**
 * Fetch a word from words_th table
 * 
 * 📋 Validates against: src/schemas/wordThSchema.ts
 * Returns data that should be validated with wordThSchema before use
 * 
 * ⚠️ DATA INTEGRITY: Direct database query - always returns latest data from Supabase
 * - No caching, no localStorage, always fresh from database
 * 
 * @param wordTh - word_th (string) from Zod schema, primary key
 */
/**
 * Fetch word from words_th table by word_th (primary key)
 * 
 * 📋 Validates against: src/schemas/wordThSchema.ts
 * Returns data validated with wordThSchema before returning
 * 
 * Since word_th is the primary key, queries are immediate (no retry needed)
 */
export async function fetchWord(wordTh: string): Promise<any> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchWord',message:'fetchWord called',data:{wordTh},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
  // #endregion
  console.log('[DEBUG] fetchWord called with wordTh:', wordTh);
  
  // Query by word_th (primary key)
  const { data: dataArray, error } = await supabase
    .from('words_th')
    .select('word_th, g2p, phonetic_en')
    .eq('word_th', wordTh)
    .limit(1);
  
  // Extract first row from array (or null if empty)
  const data = dataArray && dataArray.length > 0 ? dataArray[0] : null;
  
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchWord',message:'fetchWord query result',data:{wordTh,found:!!data,errorCode:error?.code,errorMessage:error?.message,hasData:!!data,dataKeys:data ? Object.keys(data) : null,hasG2P:!!data?.g2p,hasPhonetic:!!data?.phonetic_en,g2pValue:data?.g2p?.substring(0,30) || (data?.g2p === null ? 'null' : 'undefined'),phoneticValue:data?.phonetic_en?.substring(0,30) || (data?.phonetic_en === null ? 'null' : 'undefined'),rowCount:dataArray?.length || 0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
  // #endregion
  console.log('[DEBUG] fetchWord result:', {wordTh, found: !!data, error: error?.message, errorCode: error?.code, hasG2P: !!data?.g2p, hasPhonetic: !!data?.phonetic_en, rowCount: dataArray?.length || 0});
  
  // Handle errors (but not PGRST116 since we're not using .single())
  if (error && error.code !== 'PGRST116') {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchWord',message:'fetchWord error',data:{wordTh,errorCode:error.code,errorMessage:error.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
    throw error;
  }
  
  if (!data) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchWord',message:'Word not found',data:{wordTh},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
    return null;
  }
  
  // Normalize null to undefined for optional fields (Zod expects undefined, not null)
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchWord',message:'Normalizing null values',data:{wordTh,hasG2P:data.g2p !== null && data.g2p !== undefined,g2pIsNull:data.g2p === null,hasPhonetic:data.phonetic_en !== null && data.phonetic_en !== undefined,phoneticIsNull:data.phonetic_en === null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
  // #endregion
  
  if (data.g2p === null) {
    data.g2p = undefined;
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchWord',message:'Normalized g2p null to undefined',data:{wordTh},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
  }
  if (data.phonetic_en === null) {
    data.phonetic_en = undefined;
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchWord',message:'Normalized phonetic_en null to undefined',data:{wordTh},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
  }
  
  // Validate with Zod schema before returning
  try {
    const validated = wordThSchema.parse(data);
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchWord',message:'Word Zod validation passed',data:{wordTh:validated.word_th,hasG2P:!!validated.g2p,hasPhonetic:!!validated.phonetic_en},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
    return validated;
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchWord',message:'Word Zod validation failed',data:{wordTh,errorMessage:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
    console.error(`[Fetch] Word validation failed for "${wordTh}":`, error);
    throw error;
  }
}

/**
 * Generate a deterministic numeric ID from a word and index
 * Uses the same hash function as fetchOrstMeanings to ensure consistency
 * 📋 SOURCE OF TRUTH: Returns bigint to match meaningThSchema.id (bigintCoerce)
 */
function generateSenseId(textTh: string, index: number): bigint {
  const idPattern = `${textTh}-${index}`;
  let hash = 0;
  for (let i = 0; i < idPattern.length; i++) {
    const char = idPattern.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Ensure positive and add index for uniqueness
  const numericId = Math.abs(hash) * 1000 + index;
  return BigInt(numericId);
}

/**
 * Fetch meanings (senses) for a word from meanings_th table
 * 
 * 📋 Validates against: src/schemas/meaningThSchema.ts (V1) and meaningThSchemaV2.ts (V2)
 * Returns array validated with appropriate schema (V1 or V2) before returning
 * 
 * ⚠️ DATA INTEGRITY: Direct database query - always returns latest data from Supabase
 * - No caching, no localStorage, always fresh from database
 * 
 * ⚠️ SCHEMA HANDLING: Handles both V1 (no V2 fields) and V2 (with V2 fields) meanings
 * - V2 schema accepts V1-only data (V2 fields are optional)
 * - V1 schema fallback for edge cases
 * - Component can display V2 fields if present
 * 
 * Now queries by BOTH:
 * 1. Deterministic ID generation (for backward compatibility)
 * 2. word_th_id field (for meanings linked via word_th_id after patching)
 * 
 * @param wordTh - word_th (string) from Zod schema
 * @returns Array of MeaningTh (may include V2 fields if present in database)
 */
export async function fetchSenses(wordTh: string): Promise<MeaningTh[]> {
  // #region agent log
  console.log('[DEBUG] fetchSenses called with wordTh:', wordTh);
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'FETCH SENSES START',data:{wordTh},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_SENSES'})}).catch(()=>{});
  // #endregion
  
  // Method 1: Generate possible sense IDs for this word (indices 0-20, reasonable max)
  // Use the same hash function as fetchOrstMeanings to ensure we can find saved meanings
  // 📋 SOURCE OF TRUTH: Generate bigint IDs to match meaningThSchema.id (bigintCoerce)
  const possibleIds: bigint[] = [];
  for (let index = 0; index <= 20; index++) {
    possibleIds.push(generateSenseId(wordTh, index));
  }
  
  // Convert bigint (from Zod schema) to number or string for Supabase query
  // Supabase accepts number if it fits in safe integer range, otherwise string
  const possibleIdsForQuery = possibleIds.map(id => 
    id <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(id) : id.toString()
  );
  
  // Method 2: Query by word_th_id (for meanings linked via word_th_id after patching)
  // #region agent log - QUERY BY WORD_TH_ID
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'QUERY BY WORD_TH_ID',data:{wordTh},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_SENSES'})}).catch(()=>{});
  // #endregion
  const { data: dataByWordThId, error: errorByWordThId } = await supabase
    .from('meanings_th')
    .select('*')
    .eq('word_th_id', wordTh);
  
  // #region agent log - AFTER QUERY BY WORD_TH_ID
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'AFTER QUERY BY WORD_TH_ID',data:{wordTh,meaningsFoundByWordThId:dataByWordThId?.length || 0,hasError:!!errorByWordThId,error:errorByWordThId?.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_SENSES'})}).catch(()=>{});
  // #endregion
  
  // Query meanings by exact IDs (much more efficient than fetching all and filtering)
  // CRITICAL: Uses EXACT same query format as patchWordMeanings: .in('id', possibleIdsForQuery)
  // #region agent log - QUERY BY IDS
  console.log(`[fetchSenses] Querying meanings_th WHERE id IN [${possibleIdsForQuery.length} possible IDs] for wordTh: "${wordTh}"`);
  console.log(`[fetchSenses] First 3 IDs as bigint:`, possibleIds.slice(0, 3).map(id => id.toString()));
  console.log(`[fetchSenses] First 3 IDs for query:`, possibleIdsForQuery.slice(0, 3));
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'QUERY BY IDS',data:{wordTh,possibleIdsCount:possibleIdsForQuery.length,possibleIdsForQuery:possibleIdsForQuery.slice(0,5)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_SENSES'})}).catch(()=>{});
  // #endregion
  const { data: dataByIds, error: errorByIds } = await supabase
    .from('meanings_th')
    .select('*')
    .in('id', possibleIdsForQuery);
  
  // CRITICAL VALIDATION: Log the actual query results to verify meanings are found
  console.log(`[fetchSenses] Query returned:`, {
    error: errorByIds?.message || null,
    meaningsFound: dataByIds?.length || 0,
    meaningIds: dataByIds?.map(m => ({ id: m.id, idType: typeof m.id, word_th_id: m.word_th_id })) || []
  });
  
  // #region agent log - AFTER QUERY BY IDS
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'AFTER QUERY BY IDS',data:{wordTh,meaningsFoundByIds:dataByIds?.length || 0,hasError:!!errorByIds,error:errorByIds?.message,meaningIds:dataByIds?.map((m:any)=>({id:m.id,idType:typeof m.id,word_th_id:m.word_th_id}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_SENSES'})}).catch(()=>{});
  // #endregion
  
  // Combine results from both queries and deduplicate by ID
  const combinedData: any[] = [];
  const seenIds = new Set<string>();
  
  // Add meanings found by word_th_id
  if (dataByWordThId && !errorByWordThId) {
    for (const meaning of dataByWordThId) {
      const idStr = meaning.id?.toString();
      if (idStr && !seenIds.has(idStr)) {
        seenIds.add(idStr);
        combinedData.push(meaning);
      }
    }
  }
  
  // Add meanings found by deterministic IDs (if not already added)
  if (dataByIds && !errorByIds) {
    for (const meaning of dataByIds) {
      const idStr = meaning.id?.toString();
      if (idStr && !seenIds.has(idStr)) {
        seenIds.add(idStr);
        combinedData.push(meaning);
      }
    }
  }
  
  // #region agent log - COMBINED RESULTS
  const sampleCombined = combinedData.slice(0, 3).map((m: any) => ({
    id: m.id?.toString(),
    hasDefinitionTh: !!m.definition_th,
    hasPosTh: !!m.pos_th,
    hasPosEng: !!m.pos_eng,
    hasDefinitionEng: !!m.definition_eng,
    hasV2Fields: !!(m.pos_th || m.pos_eng || m.definition_eng),
    source: m.source,
    wordThId: m.word_th_id,
    definitionThPreview: m.definition_th?.substring(0, 30)
  }));
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'COMBINED RESULTS',data:{wordTh,meaningsByWordThId:dataByWordThId?.length || 0,meaningsByIds:dataByIds?.length || 0,combinedCount:combinedData.length,uniqueIds:seenIds.size,sampleCombined},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_SENSES'})}).catch(()=>{});
  // #endregion
  
  // #region agent log - RAW DATA CHECK
  if (combinedData.length === 0) {
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'NO MEANINGS FOUND',data:{wordTh,dataByWordThIdCount:dataByWordThId?.length || 0,dataByIdsCount:dataByIds?.length || 0,errorByWordThId:errorByWordThId?.message,errorByIds:errorByIds?.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_SENSES'})}).catch(()=>{});
  }
  // #endregion
  
  // Handle errors - if both queries fail, throw error
  if (errorByWordThId && errorByIds) {
    throw errorByWordThId; // Throw the first error
  }
  
  const data = combinedData;
  
  // #region agent log
  console.log('[DEBUG] fetchSenses fetched:', {wordTh, dataCount: data?.length || 0, byWordThId: dataByWordThId?.length || 0, byIds: dataByIds?.length || 0, combined: combinedData.length});
  // #endregion
  
  // #region agent log - BEFORE VALIDATION
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'BEFORE VALIDATION',data:{wordTh,combinedDataCount:combinedData.length,firstSenseKeys:combinedData[0] ? Object.keys(combinedData[0]) : [],firstSenseSample:combinedData[0] ? {id:combinedData[0].id?.toString(),hasDefinitionTh:!!combinedData[0].definition_th,hasPosTh:!!combinedData[0].pos_th,hasPosEng:!!combinedData[0].pos_eng,hasDefinitionEng:!!combinedData[0].definition_eng,definitionThPreview:combinedData[0].definition_th?.substring(0,30)} : null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_SENSES'})}).catch(()=>{});
  // #endregion
  
  // Normalize null to undefined and fix datetime format for optional fields (Zod expects undefined, not null)
  // Then validate each sense with Zod schema before returning
  const normalizedData = (data || []).map((sense, index) => {
    // #region agent log - PROCESSING SENSE
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'PROCESSING SENSE',data:{wordTh,index,senseId:sense.id?.toString(),senseWordThId:sense.word_th_id,hasWordThId:!!sense.word_th_id,hasDefinitionTh:!!sense.definition_th,hasPosTh:!!sense.pos_th,hasPosEng:!!sense.pos_eng,hasDefinitionEng:!!sense.definition_eng,rawKeys:Object.keys(sense)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_SENSES'})}).catch(()=>{});
    // #endregion
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'Normalizing sense data',data:{index,senseId:sense.id?.toString(),created_atType:typeof sense.created_at,created_atValue:sense.created_at,created_atIsNull:sense.created_at === null,created_atIsDate:sense.created_at instanceof Date},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
    
    if (sense.word_th_id === null) sense.word_th_id = undefined;
    if (sense.source === null) sense.source = undefined;
    
    // Normalize V2 fields: convert null to undefined (Zod expects undefined, not null)
    if (sense.pos_th === null) sense.pos_th = undefined;
    if (sense.pos_eng === null) sense.pos_eng = undefined;
    if (sense.definition_eng === null) sense.definition_eng = undefined;
    
    // Normalize created_at: convert Date objects to ISO string, null to undefined, invalid strings to undefined
    if (sense.created_at === null) {
      sense.created_at = undefined;
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'Normalized created_at null to undefined',data:{index,senseId:sense.id?.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
      // #endregion
    } else if (sense.created_at instanceof Date) {
      // Convert Date object to ISO string
      sense.created_at = sense.created_at.toISOString();
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'Converted created_at Date to ISO string',data:{index,senseId:sense.id?.toString(),isoString:sense.created_at},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
      // #endregion
    } else if (typeof sense.created_at === 'string') {
      // Validate datetime string format - if invalid, set to undefined
      try {
        // Try to parse as ISO datetime - if it fails, it's invalid
        const date = new Date(sense.created_at);
        if (isNaN(date.getTime())) {
          // Invalid date string
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'Invalid created_at string - setting to undefined',data:{index,senseId:sense.id?.toString(),invalidString:sense.created_at},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
          // #endregion
          sense.created_at = undefined;
        } else {
          // Valid date - ensure it's in ISO format
          sense.created_at = date.toISOString();
        }
      } catch (e) {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'Error parsing created_at - setting to undefined',data:{index,senseId:sense.id?.toString(),created_atValue:sense.created_at,error:String(e)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
        // #endregion
        sense.created_at = undefined;
      }
    }
    
    // Validate with Zod schema before returning
    // ⚠️ CRITICAL: Handle both V1 and V2 schemas - database may have V1-only or V2 meanings
    try {
      // #region agent log - VALIDATION START
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'VALIDATION START',data:{index,senseId:sense.id?.toString(),senseKeys:Object.keys(sense),hasDefinitionTh:!!sense.definition_th,hasPosTh:!!sense.pos_th,hasPosEng:!!sense.pos_eng,hasDefinitionEng:!!sense.definition_eng},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_SENSES'})}).catch(()=>{});
      // #endregion
      
      // Try V2 schema first (accepts V2 fields, backward compatible with V1-only data)
      // V2 schema has V2 fields as optional, so it accepts both V1 and V2 data
      const v2Result = meaningThSchemaV2.safeParse(sense);
      if (v2Result.success) {
        const hasV2Fields = !!(v2Result.data.pos_th || v2Result.data.pos_eng || v2Result.data.definition_eng);
        // #region agent log - V2 VALIDATION SUCCESS
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'V2 VALIDATION SUCCESS',data:{index,senseId:v2Result.data.id?.toString(),hasDefinition:!!v2Result.data.definition_th,hasV2Fields,isV1:!hasV2Fields,isV2:hasV2Fields,definitionTh:v2Result.data.definition_th?.substring(0,30)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_SENSES'})}).catch(()=>{});
        // #endregion
        // Return V2 data - it includes all V1 fields plus optional V2 fields
        // TypeScript will allow V2 fields to be accessed even though return type is MeaningTh[]
        // The component can check for and display V2 fields if present
        return v2Result.data as any as MeaningTh; // Cast to MeaningTh[] return type, but preserve V2 fields
      }
      
      // #region agent log - V2 VALIDATION FAILED, TRYING V1
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'V2 VALIDATION FAILED, TRYING V1',data:{index,senseId:sense.id?.toString(),v2Error:v2Result.error.message,v2Errors:v2Result.error.errors},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_SENSES'})}).catch(()=>{});
      // #endregion
      
      // Fall back to V1 schema if V2 fails (defensive - shouldn't happen but handles edge cases)
      // Remove V2 fields before V1 validation (V1 schema is strict and rejects unknown keys)
      const senseForV1 = { ...sense };
      delete senseForV1.pos_th;
      delete senseForV1.pos_eng;
      delete senseForV1.definition_eng;
      const v1Result = meaningThSchema.safeParse(senseForV1);
      if (v1Result.success) {
        // #region agent log - V1 VALIDATION SUCCESS
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'V1 VALIDATION SUCCESS',data:{index,senseId:v1Result.data.id?.toString(),hasDefinition:!!v1Result.data.definition_th,isV1:true,definitionTh:v1Result.data.definition_th?.substring(0,30)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_SENSES'})}).catch(()=>{});
        // #endregion
        return v1Result.data;
      }
      
      // #region agent log - BOTH VALIDATIONS FAILED
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'BOTH VALIDATIONS FAILED',data:{index,senseId:sense.id?.toString(),v2Error:v2Result.error.message,v1Error:v1Result.error.message,v2Errors:v2Result.error.errors,v1Errors:v1Result.error.errors},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_SENSES'})}).catch(()=>{});
      // #endregion
      
      // Both validations failed
      throw new Error(`V2 validation failed: ${v2Result.error.message}; V1 validation failed: ${v1Result.error.message}`);
    } catch (error) {
      // #region agent log - VALIDATION ERROR
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'VALIDATION ERROR',data:{index,senseId:sense.id?.toString(),errorMessage:error instanceof Error ? error.message : String(error),errorStack:error instanceof Error ? error.stack?.substring(0,200) : undefined,rawSenseKeys:Object.keys(sense)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_SENSES'})}).catch(()=>{});
      // #endregion
      console.error(`[Fetch] Sense ${index} validation failed for "${wordTh}":`, error);
      // Skip invalid senses instead of throwing - return null to filter out
      return null;
    }
  });
  
  // #region agent log - FINAL RESULTS
  const validSenses = normalizedData.filter((s): s is NonNullable<typeof s> => s !== null);
  const invalidCount = normalizedData.length - validSenses.length;
  const v1Count = validSenses.filter((s: any) => !(s.pos_th || s.pos_eng || s.definition_eng)).length;
  const v2Count = validSenses.filter((s: any) => !!(s.pos_th || s.pos_eng || s.definition_eng)).length;
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'FINAL RESULTS',data:{wordTh,totalSenses:normalizedData.length,validSenses:validSenses.length,invalidCount,v1Count,v2Count,firstValidSense:validSenses[0] ? {id:validSenses[0].id?.toString(),hasDefinition:!!validSenses[0].definition_th,hasV2Fields:!!(validSenses[0].pos_th || validSenses[0].pos_eng || validSenses[0].definition_eng),definitionThPreview:validSenses[0].definition_th?.substring(0,30)} : null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_SENSES'})}).catch(()=>{});
  // #endregion
  
  if (validSenses.length === 0 && combinedData.length > 0) {
    // #region agent log - ALL SENSES FILTERED OUT
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchSenses',message:'ALL SENSES FILTERED OUT',data:{wordTh,combinedDataCount:combinedData.length,validSensesCount:validSenses.length,invalidCount,rawSample:combinedData[0]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_SENSES'})}).catch(()=>{});
    // #endregion
  }
  
  return validSenses;
}

// REMOVED: failed_words and failed_word_senses tables don't exist in Supabase
// Only tables: episodes, subtitles, words_th, meanings_th

/**
 * Check if word exists in words_th table
 * 
 * @param wordTh - word_th (string) from Zod schema
 */
export async function wordExistsInWords(wordTh: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('words_th')
    .select('word_th')
    .eq('word_th', wordTh) // Query by word_th (primary key)
    .limit(1)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error;
  return !!data;
}

/**
 * Check if word has complete data (word_th, g2p, phonetic_en)
 * Returns true only if word exists AND has all required fields populated
 */
export async function wordHasCompleteData(wordTh: string): Promise<boolean> {
  // Query by word_th (primary key)
  const { data: dataArray, error } = await supabase
    .from('words_th')
    .select('word_th, g2p, phonetic_en')
    .eq('word_th', wordTh)
    .limit(1);
  
  if (error) {
    throw error;
  }
  
  // Extract first element from array
  const data = dataArray && dataArray.length > 0 ? dataArray[0] : null;
  
  if (!data) {
    return false;
  }
  
  // Normalize null to undefined for optional fields (consistent with Zod)
  const normalizedG2P = data.g2p === null ? undefined : data.g2p;
  const normalizedPhonetic = data.phonetic_en === null ? undefined : data.phonetic_en;
  
  // Check that word has word_th (primary key) and at least g2p or phonetic_en (non-empty strings)
  const hasWordTh = !!data.word_th && data.word_th.trim().length > 0;
  const hasG2P = !!normalizedG2P && normalizedG2P.trim().length > 0;
  const hasPhonetic = !!normalizedPhonetic && normalizedPhonetic.trim().length > 0;
  const hasCompleteData = hasWordTh && (hasG2P || hasPhonetic);
  
  return hasCompleteData;
}

/**
 * Delete a phonetic G2P rule by g2p_code
 * CRITICAL: Never deletes seeded vowels (IDs 1-31)
 * @param g2pCode - g2p_code to delete
 */
export async function deletePhoneticG2PRule(g2pCode: string): Promise<void> {
  // CRITICAL: Check if this g2p_code belongs to a seeded vowel (ID 1-31)
  const { data: existingRule } = await supabase
    .from('phonetic_g2p_rules')
    .select('id')
    .eq('g2p_code', g2pCode)
    .single();
  
  if (existingRule && existingRule.id >= 1 && existingRule.id <= 31) {
    throw new Error(`Cannot delete seeded vowel (ID ${existingRule.id}) - seeded vowels are protected`);
  }
  
  const { error } = await supabase
    .from('phonetic_g2p_rules')
    .delete()
    .eq('g2p_code', g2pCode);

  if (error) {
    throw new Error(`Failed to delete phonetic G2P rule: ${error.message}`);
  }
}

/**
 * Save phonetic G2P rule to phonetic_g2p_rules table
 * @param rule - Rule data with g2p_code (primary key), english_vowel, thai_vowel, phonetic_output, and evidence
 */
export async function savePhoneticG2PRule(rule: {
  g2p_code: string;
  english_vowel?: string;
  thai_vowel?: string;
  phonetic_output: string;
  evidence: string;
}): Promise<void> {
  // CRITICAL: Check if this g2p_code belongs to a seeded vowel (ID 1-31)
  // If so, always use hardcoded thai_vowel
  const { data: existingRule } = await supabase
    .from('phonetic_g2p_rules')
    .select('id, thai_vowel')
    .eq('g2p_code', rule.g2p_code)
    .single();
  
  let finalThaiVowel = rule.thai_vowel || null;
  if (existingRule && existingRule.id >= 1 && existingRule.id <= 31) {
    // This is a seeded vowel - always use hardcoded value
    const { THAI_VOWEL_SEEDS } = await import('../data/thaiVowelSeeds');
    finalThaiVowel = THAI_VOWEL_SEEDS[existingRule.id - 1]?.thai_vowel || rule.thai_vowel || null;
  }
  
  const { error } = await supabase
    .from('phonetic_g2p_rules')
    .upsert({
      g2p_code: rule.g2p_code,
      english_vowel: rule.english_vowel || null,
      thai_vowel: finalThaiVowel, // CRITICAL: Use hardcoded value for seeded vowels
      phonetic_output: rule.phonetic_output,
      evidence: rule.evidence,
    }, { onConflict: 'g2p_code' });

  if (error) {
    throw new Error(`Failed to save phonetic G2P rule: ${error.message}`);
  }
}

/**
 * Update only the evidence field for a phonetic G2P rule
 * @param g2p_code - The g2p_code to update
 * @param evidence - The evidence JSON string
 */
export async function updatePhoneticG2PRuleEvidence(g2p_code: string, evidence: string): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:updatePhoneticG2PRuleEvidence',message:'ENTRY - Updating evidence',data:{g2pCode:g2p_code,evidenceLength:evidence.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'UPDATE_EVIDENCE'})}).catch(()=>{});
  // #endregion
  
  // First check if row exists and get current values (including ID to check if it's a seeded vowel)
  const { data: existingRow, error: fetchError } = await supabase
    .from('phonetic_g2p_rules')
    .select('id, g2p_code, english_vowel, thai_vowel, phonetic_output')
    .eq('g2p_code', g2p_code)
    .single();

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:updatePhoneticG2PRuleEvidence',message:'AFTER fetch existing row',data:{g2pCode:g2p_code,hasError:!!fetchError,error:fetchError?.message,rowExists:!!existingRow,englishVowel:existingRow?.english_vowel,thaiVowel:existingRow?.thai_vowel},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'UPDATE_EVIDENCE'})}).catch(()=>{});
  // #endregion

  if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = no rows returned
    throw new Error(`Failed to fetch existing rule: ${fetchError.message}`);
  }

  // Use upsert to handle both insert and update, preserving existing values
  const updateData: any = { 
    g2p_code,
    evidence 
  };
  
  // Preserve existing values if row exists
  // CRITICAL: For seeded vowels (IDs 1-31), always use hardcoded thai_vowel
  if (existingRow) {
    updateData.english_vowel = existingRow.english_vowel;
    // Check if this is a seeded vowel (ID 1-31) and use hardcoded value
    if (existingRow.id >= 1 && existingRow.id <= 31) {
      const { THAI_VOWEL_SEEDS } = await import('../data/thaiVowelSeeds');
      const hardcodedThaiVowel = THAI_VOWEL_SEEDS[existingRow.id - 1]?.thai_vowel;
      updateData.thai_vowel = hardcodedThaiVowel || existingRow.thai_vowel; // CRITICAL: Always use hardcoded value
    } else {
      updateData.thai_vowel = existingRow.thai_vowel;
    }
    updateData.phonetic_output = existingRow.phonetic_output;
  } else {
    // If row doesn't exist, we need to provide required fields
    // But since we're only updating evidence, this shouldn't happen for seeded rows
    updateData.english_vowel = '';
    updateData.thai_vowel = '';
    updateData.phonetic_output = '';
  }

  const { error, data } = await supabase
    .from('phonetic_g2p_rules')
    .upsert(updateData, { onConflict: 'g2p_code' })
    .select();

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:updatePhoneticG2PRuleEvidence',message:'AFTER upsert',data:{g2pCode:g2p_code,hasError:!!error,error:error?.message,errorCode:error?.code,errorDetails:error?.details,updatedRows:data?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'UPDATE_EVIDENCE'})}).catch(()=>{});
  // #endregion

  if (error) {
    throw new Error(`Failed to update phonetic G2P rule evidence: ${error.message}`);
  }
}

/**
 * Fetch all words from words_th table
 * @returns Array of words with word_th, g2p, phonetic_en
 */
export async function fetchWordsTh(): Promise<Array<{
  word_th: string;
  g2p: string | null;
  phonetic_en: string | null;
}>> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchWordsTh',message:'ENTRY',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_WORDS'})}).catch(()=>{});
  // #endregion
  const { data, error } = await supabase
    .from('words_th')
    .select('word_th, g2p, phonetic_en');

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchWordsTh',message:'AFTER query',data:{hasError:!!error,error:error?.message,errorCode:error?.code,dataLength:data?.length||0,firstWord:data?.[0]?.word_th||null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_WORDS'})}).catch(()=>{});
  // #endregion

  if (error) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchWordsTh',message:'ERROR - throwing',data:{error:error.message,errorCode:error.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_WORDS'})}).catch(()=>{});
    // #endregion
    throw new Error(`Failed to fetch words: ${error.message}`);
  }

  const result = data || [];
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchWordsTh',message:'RETURN',data:{resultCount:result.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_WORDS'})}).catch(()=>{});
  // #endregion
  return result;
}

/**
 * Fetch all phonetic G2P rules from phonetic_g2p_rules table
 * @returns Array of rules
 */
export async function fetchPhoneticG2PRules(): Promise<Array<{
  id: number;
  english_vowel: string | null;
  thai_vowel: string | null;
  g2p_code: string;
  phonetic_output: string | null;
  evidence: string | null;
}>> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchPhoneticG2PRules',message:'ENTRY',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_RULES'})}).catch(()=>{});
  // #endregion
  const { data, error } = await supabase
    .from('phonetic_g2p_rules')
    .select('id, english_vowel, thai_vowel, g2p_code, phonetic_output, evidence')
    .order('id', { ascending: true });

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchPhoneticG2PRules',message:'AFTER query',data:{hasError:!!error,error:error?.message,dataLength:data?.length||0,seededCount:data?.filter(r=>r.g2p_code.startsWith('SEED_')).length||0,seededIds:data?.filter(r=>r.g2p_code.startsWith('SEED_')).map(r=>`${r.g2p_code}:id=${r.id}`).slice(0,10)||[],allIds:data?.map(r=>r.id).slice(0,10)||[]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_RULES'})}).catch(()=>{});
  // #endregion

  if (error) {
    throw new Error(`Failed to fetch phonetic G2P rules: ${error.message}`);
  }

  const result = data || [];
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchPhoneticG2PRules',message:'RETURN',data:{resultCount:result.length,seededInResult:result.filter(r=>r.g2p_code.startsWith('SEED_')).length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_RULES'})}).catch(()=>{});
  // #endregion
  return result;
}

/**
 * Save multiple phonetic G2P rules in batch
 * @param rules - Array of rules to save
 */
export async function savePhoneticG2PRulesBatch(
  rules: Array<{
    g2p_code: string;
    english_vowel?: string;
    thai_vowel?: string;
    phonetic_output: string;
    evidence: string;
  }>
): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:savePhoneticG2PRulesBatch',message:'ENTRY',data:{rulesCount:rules.length,firstRule:rules[0]?{g2pCode:rules[0].g2p_code,hasEnglishVowel:!!rules[0].english_vowel,hasThaiVowel:!!rules[0].thai_vowel,englishVowel:rules[0].english_vowel,thaiVowel:rules[0].thai_vowel}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SAVE_RULES_BATCH'})}).catch(()=>{});
  // #endregion
  
  if (rules.length === 0) {
    // #region agent log
    // Skip logging - routine skip operation
    // #endregion
    return;
  }

  // CRITICAL: Fetch existing seeded vowels (IDs 1-31) to preserve their thai_vowel
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:savePhoneticG2PRulesBatch',message:'BEFORE fetch seeded vowels',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SAVE_RULES_BATCH'})}).catch(()=>{});
  // #endregion
  const { data: existingSeededVowels } = await supabase
    .from('phonetic_g2p_rules')
    .select('id, g2p_code, thai_vowel')
    .in('id', Array.from({ length: 31 }, (_, i) => i + 1));
  
  const seededVowelsMap = new Map<number, { id: number; g2p_code: string; thai_vowel: string | null }>();
  (existingSeededVowels || []).forEach(v => {
    seededVowelsMap.set(v.id, v);
  });
  
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:savePhoneticG2PRulesBatch',message:'AFTER fetch seeded vowels',data:{seededCount:seededVowelsMap.size,seededIds:Array.from(seededVowelsMap.keys()).sort((a,b)=>a-b)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SAVE_RULES_BATCH'})}).catch(()=>{});
  // #endregion

  // Separate seeded vowels (IDs 1-31) from other rules
  const seededRules: Array<{ id: number; g2p_code: string; english_vowel: string | null; thai_vowel: string; phonetic_output: string; evidence: string }> = [];
  const otherRules: Array<{ g2p_code: string; english_vowel: string | null; thai_vowel: string | null; phonetic_output: string; evidence: string }> = [];
  
  // Fetch existing rules to find which ones are seeded vowels
  const { data: allExistingRules } = await supabase
    .from('phonetic_g2p_rules')
    .select('id, g2p_code, thai_vowel');
  
  const g2pCodeToIdMap = new Map<string, number>();
  (allExistingRules || []).forEach(r => {
    if (r.id >= 1 && r.id <= 31) {
      g2pCodeToIdMap.set(r.g2p_code, r.id);
    }
  });

  for (const rule of rules) {
    const existingId = g2pCodeToIdMap.get(rule.g2p_code);
    const isSeededVowel = existingId !== undefined && existingId >= 1 && existingId <= 31;
    
    if (isSeededVowel) {
      // This is a seeded vowel - preserve thai_vowel from existing record
      const existingSeeded = seededVowelsMap.get(existingId);
      const preservedThaiVowel = existingSeeded?.thai_vowel || rule.thai_vowel || '';
      
      seededRules.push({
        id: existingId,
        g2p_code: rule.g2p_code,
        english_vowel: rule.english_vowel !== undefined ? rule.english_vowel : null,
        thai_vowel: preservedThaiVowel, // CRITICAL: Preserve thai_vowel from seed
        phonetic_output: rule.phonetic_output,
        evidence: rule.evidence,
      });
    } else {
      // Regular rule - use as-is
      otherRules.push({
        g2p_code: rule.g2p_code,
        english_vowel: rule.english_vowel !== undefined ? rule.english_vowel : null,
        thai_vowel: rule.thai_vowel !== undefined ? rule.thai_vowel : null,
        phonetic_output: rule.phonetic_output,
        evidence: rule.evidence,
      });
    }
  }

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:savePhoneticG2PRulesBatch',message:'BEFORE separate saves',data:{seededCount:seededRules.length,otherCount:otherRules.length,seededIds:seededRules.map(r=>r.id).sort((a,b)=>a-b)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SAVE_RULES_BATCH'})}).catch(()=>{});
  // #endregion

  // Update seeded vowels by ID (preserves IDs 1-31 and thai_vowel)
  // CRITICAL: Fetch hardcoded thai_vowel values to ensure they're never overwritten
  const { THAI_VOWEL_SEEDS } = await import('../data/thaiVowelSeeds');
  const hardcodedThaiVowels = new Map<number, string>();
  THAI_VOWEL_SEEDS.forEach((seed, index) => {
    hardcodedThaiVowels.set(index + 1, seed.thai_vowel);
  });
  
  for (const seededRule of seededRules) {
    // CRITICAL: Always use hardcoded thai_vowel from seed data, never allow it to be cleared
    const hardcodedThaiVowel = hardcodedThaiVowels.get(seededRule.id);
    if (!hardcodedThaiVowel) {
      console.error(`[savePhoneticG2PRulesBatch] CRITICAL: No hardcoded thai_vowel found for ID ${seededRule.id}`);
      continue; // Skip this rule - shouldn't happen
    }
    
    const { error: updateError } = await supabase
      .from('phonetic_g2p_rules')
      .update({
        g2p_code: seededRule.g2p_code,
        english_vowel: seededRule.english_vowel,
        thai_vowel: hardcodedThaiVowel, // CRITICAL: Always use hardcoded value, never allow override
        phonetic_output: seededRule.phonetic_output,
        evidence: seededRule.evidence,
      })
      .eq('id', seededRule.id);
    
    if (updateError) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:savePhoneticG2PRulesBatch',message:'ERROR updating seeded vowel',data:{id:seededRule.id,g2pCode:seededRule.g2p_code,hardcodedThaiVowel,error:updateError.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SAVE_RULES_BATCH'})}).catch(()=>{});
      // #endregion
      throw new Error(`Failed to update seeded vowel ID ${seededRule.id}: ${updateError.message}`);
    }
  }

  // CRITICAL: Do NOT save other rules - only the 31 seeded vowels should exist
  // Skip saving any rules that are not seeded vowels (IDs 1-31)
  if (otherRules.length > 0) {
    console.log(`[savePhoneticG2PRulesBatch] SKIPPING ${otherRules.length} non-seeded rules - only 31 seeded vowels allowed`);
    // #region agent log
    // Skip logging - routine skip operation
    // #endregion
  }
  
  // #region agent log
  // Skip logging - successful operation
  // #endregion
}

/**
 * Check how many seeded Thai vowels exist in the database
 * Checks by ID (1-31) instead of g2p_code prefix, since g2p_code can change
 * @returns Number of records with IDs 1-31 that have thai_vowel set
 */
export async function checkSeededVowelsCount(): Promise<number> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:checkSeededVowelsCount',message:'ENTRY',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SEED_COUNT'})}).catch(()=>{});
  // #endregion
  // Check by ID (1-31) instead of g2p_code prefix, since g2p_code can change
  const { data, error } = await supabase
    .from('phonetic_g2p_rules')
    .select('id, thai_vowel')
    .in('id', Array.from({ length: 31 }, (_, i) => i + 1))
    .not('thai_vowel', 'is', null);

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:checkSeededVowelsCount',message:'AFTER query',data:{hasError:!!error,error:error?.message,dataLength:data?.length||0,idsWithThaiVowel:data?.map(r=>r.id).sort((a,b)=>a-b)||[]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SEED_COUNT'})}).catch(()=>{});
  // #endregion

  if (error) {
    throw new Error(`Failed to check seeded vowels count: ${error.message}`);
  }

  const count = data?.length || 0;
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:checkSeededVowelsCount',message:'RETURN',data:{count,ids:data?.map(r=>r.id).sort((a,b)=>a-b)||[]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SEED_COUNT'})}).catch(()=>{});
  // #endregion
  return count;
}

/**
 * Seed Thai vowel patterns into phonetic_g2p_rules table
 * Uses placeholder g2p_code values (SEED_1, SEED_2, etc.) that will be replaced
 * when actual g2p_code patterns are discovered from words
 */
export async function seedThaiVowels(): Promise<void> {
  const { THAI_VOWEL_SEEDS } = await import('../data/thaiVowelSeeds');
  
  // Create seed data with explicit IDs starting at 1
  // Use empty strings as placeholders instead of null to avoid NOT NULL constraint issues
  const rulesToSeed = THAI_VOWEL_SEEDS.map((seed, index) => ({
    id: index + 1, // Explicit IDs: 1, 2, 3, ..., 31
    g2p_code: `SEED_${String(index + 1).padStart(2, '0')}`, // SEED_01, SEED_02, ..., SEED_31
    thai_vowel: seed.thai_vowel,
    english_vowel: '', // Placeholder - will be populated by GPT analysis
    phonetic_output: '', // Placeholder - will be populated when patterns are discovered
    evidence: '', // Placeholder - will be populated with example words
  }));

  // CRITICAL: Don't delete existing seeded records - we'll update them by ID instead
  // This prevents creating duplicates and ensures IDs 1-31 are always preserved
  // CRITICAL: Clean up any duplicate IDs (1-31) before seeding
  // This ensures we never have more than one record per ID
  
  // Fetch all records with IDs 1-31 to find duplicates
  const { data: allSeededRecords } = await supabase
    .from('phonetic_g2p_rules')
    .select('id, g2p_code')
    .in('id', Array.from({ length: 31 }, (_, i) => i + 1));
  
  // Group by ID to find duplicates
  const recordsById = new Map<number, Array<{ id: number; g2p_code: string }>>();
  (allSeededRecords || []).forEach(r => {
    if (!recordsById.has(r.id)) {
      recordsById.set(r.id, []);
    }
    recordsById.get(r.id)!.push(r);
  });
  
  // Delete duplicates - keep only the first one for each ID
  for (const [id, records] of recordsById.entries()) {
    if (records.length > 1) {
      console.log(`[seedThaiVowels] Found ${records.length} duplicate records for ID ${id}, keeping first one`);
      // Keep the first record, delete the rest
      for (let i = 1; i < records.length; i++) {
        const duplicate = records[i];
        console.log(`[seedThaiVowels] Deleting duplicate: ID ${duplicate.id}, g2p_code="${duplicate.g2p_code}"`);
        await supabase
          .from('phonetic_g2p_rules')
          .delete()
          .eq('g2p_code', duplicate.g2p_code);
      }
    }
  }
  
  // CRITICAL: Delete ALL records with IDs > 31 to ensure only the 31 seeded vowels exist
  
  // Fetch all records with IDs > 31
  const { data: recordsToDelete } = await supabase
    .from('phonetic_g2p_rules')
    .select('id, g2p_code')
    .gt('id', 31);
  
  if (recordsToDelete && recordsToDelete.length > 0) {
    console.log(`[seedThaiVowels] Deleting ${recordsToDelete.length} records with IDs > 31`);
    // Delete by g2p_code (primary key)
    for (const record of recordsToDelete) {
      if (record.g2p_code) {
        await supabase
          .from('phonetic_g2p_rules')
          .delete()
          .eq('g2p_code', record.g2p_code);
      }
    }
  }
  
  
  // CRITICAL: Since g2p_code is the primary key (not id), we need a different strategy:
  // 1. First, check if records with IDs 1-31 exist (they might have different g2p_codes)
  // 2. Also check if the g2p_codes we want to insert already exist with different IDs
  // 3. Update existing records by ID to set the correct thai_vowel and g2p_code
  // 4. For any IDs that don't exist, insert new records
  // 5. Handle conflicts where g2p_code already exists but with different ID
  
  let successCount = 0;
  let failCount = 0;
  
  // First, fetch existing records with IDs 1-31
  const { data: existingSeeded } = await supabase
    .from('phonetic_g2p_rules')
    .select('id, g2p_code')
    .in('id', Array.from({ length: 31 }, (_, i) => i + 1));
  
  // Also fetch all records to check for g2p_code conflicts
  const { data: allExisting } = await supabase
    .from('phonetic_g2p_rules')
    .select('id, g2p_code');
  
  const existingIds = new Set((existingSeeded || []).map(r => r.id));
  const existingG2pCodes = new Map<string, number>(); // g2p_code -> id
  (allExisting || []).forEach(r => {
    if (r.g2p_code) {
      existingG2pCodes.set(r.g2p_code, r.id);
    }
  });
  
  for (const rule of rulesToSeed) {
    const existsById = existingIds.has(rule.id);
    const existingIdForG2pCode = existingG2pCodes.get(rule.g2p_code);
    
    // CRITICAL: If the g2p_code we want already exists with a different ID, delete it first
    // This prevents primary key conflicts
    if (existingIdForG2pCode && existingIdForG2pCode !== rule.id) {
      console.log(`[seedThaiVowels] Deleting conflicting record: g2p_code="${rule.g2p_code}" has ID ${existingIdForG2pCode}, need ID ${rule.id}`);
      const { error: deleteError } = await supabase
        .from('phonetic_g2p_rules')
        .delete()
        .eq('g2p_code', rule.g2p_code);
      
      if (deleteError) {
        console.warn(`[seedThaiVowels] Failed to delete conflicting record: ${deleteError.message}`);
      }
      // Remove from map so we don't check it again
      existingG2pCodes.delete(rule.g2p_code);
    }
    
    if (existsById) {
      // Record with this ID exists - update it by ID
      const { error: updateError } = await supabase
        .from('phonetic_g2p_rules')
        .update({
          g2p_code: rule.g2p_code,
          thai_vowel: rule.thai_vowel, // CRITICAL: Always set hardcoded thai_vowel
          english_vowel: rule.english_vowel,
          phonetic_output: rule.phonetic_output,
          evidence: rule.evidence,
        })
        .eq('id', rule.id);
      
      if (updateError) {
        console.error(`[seedThaiVowels] Failed to update ID ${rule.id} (${rule.thai_vowel}): ${updateError.message}`);
        failCount++;
      } else {
        successCount++;
        if (rule.id === 1) {
          console.log(`[seedThaiVowels] ✓ Successfully updated ID 1 (${rule.thai_vowel})`);
        }
      }
    } else {
      // Record with this ID doesn't exist - insert it
      const { error: insertError } = await supabase
        .from('phonetic_g2p_rules')
        .insert(rule);
      
      if (insertError) {
        console.error(`[seedThaiVowels] Failed to insert ID ${rule.id} (${rule.thai_vowel}): ${insertError.message}`);
        failCount++;
      } else {
        successCount++;
        if (rule.id === 1) {
          console.log(`[seedThaiVowels] ✓ Successfully inserted ID 1 (${rule.thai_vowel})`);
        }
      }
    }
  }

  if (failCount > 0) {
    console.warn(`[seedThaiVowels] Warning: ${failCount} out of ${rulesToSeed.length} seeds failed to insert`);
  }
  
  if (successCount === 0) {
    throw new Error(`Failed to seed any Thai vowels - all ${rulesToSeed.length} inserts failed`);
  }

  console.log(`[seedThaiVowels] Seeded ${rulesToSeed.length} Thai vowel patterns with IDs 1-${rulesToSeed.length}`);
}

/**
 * Save phonetic G2P evidence (GPT analysis per word)
 * @param evidence - Evidence data with g2p_code, word_id, and GPT outputs
 */
export async function savePhoneticG2PEvidence(evidence: {
  g2p_code: string;
  word_id: string;
  text_th: string;
  g2p?: string | null;
  parser_phonetic?: string | null;
  thai_vowel_label?: string | null;
  gpt_phonetic?: string | null;
}): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:savePhoneticG2PEvidence',message:'ENTRY',data:{g2pCode:evidence.g2p_code,wordId:evidence.word_id,textTh:evidence.text_th,hasThaiVowelLabel:!!evidence.thai_vowel_label,hasGptPhonetic:!!evidence.gpt_phonetic,thaiVowelLabel:evidence.thai_vowel_label,gptPhonetic:evidence.gpt_phonetic},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SAVE_EVIDENCE_SINGLE'})}).catch(()=>{});
  // #endregion
  
  const { error, data } = await supabase
    .from('phonetic_g2p_evidence')
    .upsert({
      g2p_code: evidence.g2p_code,
      word_id: evidence.word_id,
      text_th: evidence.text_th,
      g2p: evidence.g2p || null,
      parser_phonetic: evidence.parser_phonetic || null,
      thai_vowel_label: evidence.thai_vowel_label || null,
      gpt_phonetic: evidence.gpt_phonetic || null,
    }, { onConflict: 'g2p_code,word_id' })
    .select();

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:savePhoneticG2PEvidence',message:'AFTER upsert',data:{hasError:!!error,error:error?.message,errorCode:error?.code,errorDetails:error?.details,savedCount:data?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SAVE_EVIDENCE_SINGLE'})}).catch(()=>{});
  // #endregion

  if (error) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:savePhoneticG2PEvidence',message:'ERROR - Save failed',data:{error:error.message,errorCode:error.code,errorDetails:error.details,g2pCode:evidence.g2p_code,wordId:evidence.word_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SAVE_EVIDENCE_SINGLE'})}).catch(()=>{});
    // #endregion
    throw new Error(`Failed to save phonetic G2P evidence: ${error.message}`);
  }
  
  // #region agent log
  // Skip logging - successful operation
  // #endregion
}

/**
 * Save multiple phonetic G2P evidence records in batch
 * @param evidenceArray - Array of evidence records to save
 */
export async function savePhoneticG2PEvidenceBatch(
  evidenceArray: Array<{
    g2p_code: string;
    word_id: string;
    text_th: string;
    g2p?: string | null;
    parser_phonetic?: string | null;
    thai_vowel_label?: string | null;
    gpt_phonetic?: string | null;
  }>
): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:savePhoneticG2PEvidenceBatch',message:'ENTRY',data:{evidenceCount:evidenceArray.length,firstEvidence:evidenceArray[0]?{g2pCode:evidenceArray[0].g2p_code,wordId:evidenceArray[0].word_id,textTh:evidenceArray[0].text_th,hasThaiVowelLabel:!!evidenceArray[0].thai_vowel_label,hasGptPhonetic:!!evidenceArray[0].gpt_phonetic}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SAVE_EVIDENCE_BATCH'})}).catch(()=>{});
  // #endregion
  
  if (evidenceArray.length === 0) {
    // #region agent log
    // Skip logging - routine skip operation
    // #endregion
    return;
  }

  const evidenceToSave = evidenceArray.map(evidence => ({
    g2p_code: evidence.g2p_code,
    word_id: evidence.word_id,
    text_th: evidence.text_th,
    g2p: evidence.g2p || null,
    parser_phonetic: evidence.parser_phonetic || null,
    thai_vowel_label: evidence.thai_vowel_label || null,
    gpt_phonetic: evidence.gpt_phonetic || null,
  }));

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:savePhoneticG2PEvidenceBatch',message:'BEFORE upsert',data:{evidenceToSaveCount:evidenceToSave.length,withGPT:evidenceToSave.filter(e=>e.thai_vowel_label&&e.gpt_phonetic).length,withoutGPT:evidenceToSave.filter(e=>!e.thai_vowel_label||!e.gpt_phonetic).length,firstRecord:evidenceToSave[0]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SAVE_EVIDENCE_BATCH'})}).catch(()=>{});
  // #endregion

  const { error, data } = await supabase
    .from('phonetic_g2p_evidence')
    .upsert(evidenceToSave, { onConflict: 'g2p_code,word_id' })
    .select();

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:savePhoneticG2PEvidenceBatch',message:'AFTER upsert',data:{hasError:!!error,error:error?.message,errorCode:error?.code,errorDetails:error?.details,savedCount:data?.length||0,requestedCount:evidenceToSave.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SAVE_EVIDENCE_BATCH'})}).catch(()=>{});
  // #endregion

  if (error) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:savePhoneticG2PEvidenceBatch',message:'ERROR - Save failed',data:{error:error.message,errorCode:error.code,errorDetails:error.details,evidenceCount:evidenceToSave.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SAVE_EVIDENCE_BATCH'})}).catch(()=>{});
    // #endregion
    throw new Error(`Failed to save phonetic G2P evidence batch: ${error.message}`);
  }
  
  // #region agent log
  // Skip logging - successful operation
  // #endregion
}

/**
 * Fetch phonetic G2P evidence
 * @param g2pCode - Optional filter by g2p_code pattern
 * @returns Array of evidence records
 */
export async function fetchPhoneticG2PEvidence(g2pCode?: string): Promise<Array<{
  id: number;
  g2p_code: string;
  word_id: string;
  text_th: string;
  g2p: string | null;
  parser_phonetic: string | null;
  thai_vowel_label: string | null;
  gpt_phonetic: string | null;
}>> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchPhoneticG2PEvidence',message:'ENTRY',data:{hasG2pCode:!!g2pCode,g2pCode:g2pCode||null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_EVIDENCE'})}).catch(()=>{});
  // #endregion
  let query = supabase
    .from('phonetic_g2p_evidence')
    .select('id, g2p_code, word_id, text_th, g2p, parser_phonetic, thai_vowel_label, gpt_phonetic')
    .order('g2p_code, word_id');

  if (g2pCode) {
    query = query.eq('g2p_code', g2pCode);
  }

  const { data, error } = await query;

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchPhoneticG2PEvidence',message:'AFTER query',data:{hasError:!!error,error:error?.message,errorCode:error?.code,dataLength:data?.length||0,g2pCode:g2pCode||null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_EVIDENCE'})}).catch(()=>{});
  // #endregion

  if (error) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchPhoneticG2PEvidence',message:'ERROR - throwing',data:{error:error.message,errorCode:error.code,g2pCode:g2pCode||null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_EVIDENCE'})}).catch(()=>{});
    // #endregion
    throw new Error(`Failed to fetch phonetic G2P evidence: ${error.message}`);
  }

  const result = data || [];
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:fetchPhoneticG2PEvidence',message:'RETURN',data:{resultCount:result.length,g2pCode:g2pCode||null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_EVIDENCE'})}).catch(()=>{});
  // #endregion
  return result;
}

/**
 * Fetch phonetic G2P evidence by word ID
 * @param wordId - word_id to filter by (words_th.word_th)
 * @returns Array of evidence records for the word
 */
export async function fetchPhoneticG2PEvidenceByWord(wordId: string): Promise<Array<{
  id: number;
  g2p_code: string;
  word_id: string;
  text_th: string;
  g2p: string | null;
  parser_phonetic: string | null;
  thai_vowel_label: string | null;
  gpt_phonetic: string | null;
}>> {
  const { data, error } = await supabase
    .from('phonetic_g2p_evidence')
    .select('id, g2p_code, word_id, text_th, g2p, parser_phonetic, thai_vowel_label, gpt_phonetic')
    .eq('word_id', wordId)
    .order('g2p_code');

  if (error) {
    throw new Error(`Failed to fetch phonetic G2P evidence by word: ${error.message}`);
  }

  return data || [];
}

/**
 * Save word data only (without senses) to words_th table
 * Used when we want to ensure word exists in table even without senses
 * word_th is the primary key, preventing duplicate words
 */
export async function saveWordOnly(wordData: {
  word_th: string;
  g2p?: string;
  phonetic_en?: string;
}): Promise<{ word_th: string; g2p?: string; phonetic_en?: string }> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveWordOnly',message:'Save word only started',data:{wordTh:wordData.word_th,hasG2P:!!wordData.g2p,hasPhonetic:!!wordData.phonetic_en},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
  // #endregion
  console.log(`[Save] Saving word "${wordData.word_th}" to words_th (without senses)`);
  
  if (!wordData.word_th) {
    throw new Error('word_th is required');
  }

  // ⚠️ SCHEMA ENFORCEMENT: Validate word data with Zod before saving
  // Use validated result directly - no manual construction that bypasses types
  const wordToValidate = {
    word_th: wordData.word_th,
    g2p: wordData.g2p,
    phonetic_en: wordData.phonetic_en,
  };
  
  let validatedWord: { word_th: string; g2p?: string; phonetic_en?: string };
  try {
    validatedWord = wordThSchema.parse(wordToValidate);
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveWordOnly',message:'Word Zod validation passed',data:{wordTh:validatedWord.word_th,hasG2P:!!validatedWord.g2p,hasPhonetic:!!validatedWord.phonetic_en},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveWordOnly',message:'Word Zod validation failed',data:{wordTh:wordData.word_th,errorMessage:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
    console.error(`[Save] Word validation failed for "${wordData.word_th}":`, error);
    throw error;
  }

  // Use validated word data directly - typed, guaranteed to match schema
  // No manual construction that could bypass validation
  const wordRowData: {
    word_th: string;
    g2p?: string;
    phonetic_en?: string;
  } = {
    word_th: validatedWord.word_th,
    ...(validatedWord.g2p !== undefined && { g2p: validatedWord.g2p }),
    ...(validatedWord.phonetic_en !== undefined && { phonetic_en: validatedWord.phonetic_en }),
  };

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveWordOnly',message:'Upserting word to words_th',data:{wordTh:wordRowData.word_th,hasG2P:!!wordRowData.g2p,g2pValue:wordRowData.g2p?.substring(0,50) || 'null/undefined',hasPhonetic:!!wordRowData.phonetic_en,phoneticValue:wordRowData.phonetic_en?.substring(0,50) || 'null/undefined',wordRowDataKeys:Object.keys(wordRowData)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
  // #endregion
  
  // Try upsert with word_th as conflict target (primary key)
  let { error: wordError, data: savedWordData } = await supabase
    .from('words_th')
    .upsert(wordRowData, { onConflict: 'word_th' })
    .select();
  
  // If upsert fails due to missing constraint (42P10), fall back to manual insert/update
  if (wordError && wordError.code === '42P10') {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveWordOnly',message:'word_th constraint not found, falling back to manual insert/update',data:{wordTh:wordData.word_th},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
    
    // Check if word exists (query by word_th)
    const { data: existingWord } = await supabase
      .from('words_th')
      .select('word_th')
      .eq('word_th', wordData.word_th)
      .limit(1)
      .single();
    
    if (existingWord) {
      // Update existing word
      const { error: updateError, data: updateData } = await supabase
        .from('words_th')
        .update(wordRowData)
        .eq('word_th', wordData.word_th)
        .select();
      wordError = updateError;
      savedWordData = updateData;
    } else {
      // Insert new word
      const { error: insertError, data: insertData } = await supabase
        .from('words_th')
        .insert(wordRowData)
        .select();
      wordError = insertError;
      savedWordData = insertData;
    }
  }
  
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveWordOnly',message:'Upsert response received',data:{wordTh:wordData.word_th,hasError:!!wordError,errorCode:wordError?.code,errorMessage:wordError?.message,hasData:!!savedWordData,dataLength:savedWordData?.length,firstItemWordTh:savedWordData?.[0]?.word_th},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
  // #endregion
  
  if (wordError) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveWordOnly',message:'Word upsert failed',data:{wordTh:wordData.word_th,errorMessage:wordError.message,errorCode:wordError.code,errorDetails:wordError.details,errorHint:wordError.hint},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
    console.error(`[Save] ✗ Failed to save word:`, wordError);
    throw new Error(`Failed to save word: ${wordError.message}`);
  }
  
  // #region agent log
  // Skip logging - successful operation
  // #endregion
  console.log(`[Save] ✓ Successfully saved word "${wordData.word_th}" to words_th table (without senses)`);
  
  // Return saved word data for integrity checks
  if (!savedWordData?.[0]?.word_th) {
    throw new Error(`Failed to get saved word word_th for "${wordData.word_th}"`);
  }
  
  return {
    word_th: savedWordData[0].word_th,
    g2p: savedWordData[0].g2p || undefined,
    phonetic_en: savedWordData[0].phonetic_en || undefined,
  };
}

/**
 * Save senses (meanings) to meanings_th table
 * 
 * 📋 Validates against: src/schemas/meaningThSchema.ts or meaningThSchemaV2.ts
 * 
 * Saves senses separately to meanings_th table.
 * Each sense is validated with meaningThSchema (V1) or meaningThSchemaV2 (V2) before saving.
 * Automatically detects schema version based on presence of V2 fields.
 */
export async function saveSenses(senses: Array<{
  id: bigint;
  definition_th: string;
  source?: string;
  created_at?: string;
  word_th_id?: string;
  pos_th?: string;
  pos_eng?: string;
  definition_eng?: string;
  [key: string]: any;
}>, wordTh: string): Promise<void> {
  // CRITICAL: wordTh is required - word_th_id must never be null
  if (!wordTh || !wordTh.trim()) {
    throw new Error('wordTh is required when saving senses - word_th_id must never be null');
  }
  
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'Save senses started',data:{senseCount:senses.length,wordTh},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
  // #endregion
  console.log(`[Save] Saving ${senses.length} senses to meanings_th table with wordTh="${wordTh}"`);
  
  if (!senses || senses.length === 0) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'No senses to save',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
    return; // No senses to save, that's fine
  }

  // Validate senses with Zod before saving
  const validatedSenses = senses.map((sense, index) => {
    try {
      // Detect schema version: try V2 first if V2 fields are present
      const hasV2Fields = !!(sense.pos_th || sense.pos_eng || sense.definition_eng);
      let validated;
      
      if (hasV2Fields) {
        // Validate with V2 schema
        validated = meaningThSchemaV2.strict().parse(sense);
        // #region agent log - V2 SCHEMA VALIDATION
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'V2 SCHEMA VALIDATION PASSED',data:{index,senseId:validated.id?.toString(),hasPosTh:!!validated.pos_th,hasPosEng:!!validated.pos_eng,hasDefinitionEng:!!validated.definition_eng,isV2Complete:!!(validated.pos_th && validated.pos_eng && validated.definition_eng)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'V2_ENRICH'})}).catch(()=>{});
        // #endregion
      } else {
        // Validate with V1 schema
        validated = meaningThSchema.strict().parse(sense);
      }
      
      return validated;
    } catch (error) {
      // #region agent log - V2 SCHEMA VALIDATION ERROR
      const hasV2Fields = !!(sense.pos_th || sense.pos_eng || sense.definition_eng);
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'V2 SCHEMA VALIDATION FAILED',data:{index,senseId:sense.id?.toString(),hasV2Fields,errorMessage:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'V2_ENRICH'})}).catch(()=>{});
      // #endregion
      console.error(`[Save] Sense ${index} validation failed:`, error);
      throw error;
    }
  });

  // ⚠️ SCHEMA ENFORCEMENT: Use validated sense data directly - typed, guaranteed to match schema
  // No manual construction that could bypass validation
  // validatedSenses contains validated Sense objects from meaningThSchema.parse()
  // 📋 SOURCE OF TRUTH: meaningThSchema.id is bigint (from bigintCoerce)
  // Convert bigint to number if it fits in safe integer range, otherwise string (Supabase accepts both)
  console.log(`[Save] Ensuring word_th_id for ${validatedSenses.length} senses with wordTh="${wordTh}"`);
  
  const meaningData: Array<{
    id: number | string;
    definition_th: string;
    word_th_id: string;
    source: string | null;
    created_at: string | null;
    pos_th?: string | null;
    pos_eng?: string | null;
    definition_eng?: string | null;
    metadata?: Record<string, unknown>;
  }> = validatedSenses.map((sense, index) => {
    // Use validated sense directly - it's already typed correctly
    // CRITICAL: word_th_id must never be null - use sense.word_th_id if set, otherwise use wordTh parameter
    const wordThId = sense.word_th_id || wordTh;
    
    // VALIDATION: Ensure word_th_id is never null or empty
    if (!wordThId || !wordThId.trim()) {
      console.error(`[Save] CRITICAL: word_th_id is null/empty for sense:`, sense);
      throw new Error(`word_th_id cannot be null or empty for sense ${sense.id} (index ${index})`);
    }
    
    console.log(`[Save] Sense ${index}: word_th_id="${wordThId}" (from sense: ${!!sense.word_th_id}, fallback: ${!sense.word_th_id})`);
    
    // Convert bigint (from Zod schema) to number or string for Supabase
    const idValue = sense.id <= BigInt(Number.MAX_SAFE_INTEGER) 
      ? Number(sense.id) 
      : sense.id.toString();
    
    const meaningRow: {
      id: number | string;
      definition_th: string;
      word_th_id: string;
      source: string | null;
      created_at: string | null;
      pos_th?: string | null;
      pos_eng?: string | null;
      definition_eng?: string | null;
      metadata?: Record<string, unknown>;
    } = {
      id: idValue, // meaningThSchema.id (bigint) - convert to number or string for Supabase
      definition_th: sense.definition_th, // meaningThSchema.definition_th
      word_th_id: wordThId, // CRITICAL: Guaranteed non-null - word_th_id (text, Thai word string)
      source: sense.source || null, // meaningThSchema.source
      created_at: sense.created_at || null, // meaningThSchema.created_at
    };

    // Add V2 fields if present
    if ('pos_th' in sense && sense.pos_th !== undefined) {
      meaningRow.pos_th = sense.pos_th || null;
    }
    if ('pos_eng' in sense && sense.pos_eng !== undefined) {
      meaningRow.pos_eng = sense.pos_eng || null;
    }
    if ('definition_eng' in sense && sense.definition_eng !== undefined) {
      meaningRow.definition_eng = sense.definition_eng || null;
    }

    // Handle any extra fields (though meaningThSchema.strict() should reject them)
    // This is defensive - if passthrough was used, capture metadata
    const { id, definition_th, word_th_id, source, created_at, pos_th, pos_eng, definition_eng, ...senseMetadata } = sense;
    if (Object.keys(senseMetadata).length > 0) {
      meaningRow.metadata = senseMetadata as Record<string, unknown>;
    }

    return meaningRow;
  });

  // Check which meanings already exist in the database
  const meaningIds = meaningData.map(m => m.id);
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'Checking for existing meanings',data:{meaningIdsCount:meaningIds.length,meaningIds:meaningIds.slice(0,5)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
  // #endregion
  
  const { data: existingMeanings, error: checkError } = await supabase
    .from('meanings_th')
    .select('id')
    .in('id', meaningIds);
  
  if (checkError) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'Error checking existing meanings',data:{errorMessage:checkError.message,errorCode:checkError.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
    console.warn(`[Save] ⚠ Warning: Failed to check existing meanings: ${checkError.message}. Proceeding with upsert.`);
  }
  
  const existingIdSet = new Set(existingMeanings?.map(m => m.id) || []);
  const newMeanings = meaningData.filter(m => !existingIdSet.has(m.id));
  const existingCount = existingIdSet.size;
  
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'Existence check complete',data:{totalMeanings:meaningData.length,existingCount,newCount:newMeanings.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
  // #endregion
  
  if (existingCount > 0) {
    console.log(`[Save] ⚡ ${existingCount} meanings already exist - will update them with upsert`);
  }
  
  // Use upsert to update existing meanings (e.g., when normalizing changes source from "orst" to "gpt-normalized")
  // This ensures that normalized senses update the source field even if they already exist
  // #region agent log
  const sourcesToUpsert = meaningData.map(m => m.source).filter(Boolean);
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'Upserting meanings to meanings_th (will update existing)',data:{totalMeanings:meaningData.length,existingCount,newCount:newMeanings.length,sourcesToUpsert:sourcesToUpsert.slice(0,5),firstMeaningSource:meaningData[0]?.source,firstMeaningId:meaningData[0]?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
  // #endregion
  
  try {
    // CRITICAL: Supabase upsert with select() may only return inserted rows, not updated ones
    // We need to explicitly request all rows to be returned, or fetch separately after upsert
    // #region agent log
    const sampleMeaningData = meaningData.slice(0, 2).map(m => ({ 
      id: m.id, 
      idType: typeof m.id,
      idValue: m.id,
      source: m.source, 
      definition_th: m.definition_th?.substring(0, 30) 
    }));
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'BEFORE upsert - Data being sent',data:{totalMeanings:meaningData.length,sampleData:sampleMeaningData,firstMeaningId:meaningData[0]?.id,firstMeaningIdType:typeof meaningData[0]?.id,firstMeaningSource:meaningData[0]?.source,onConflictTarget:'id'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'UPSERT_UPDATE'})}).catch(()=>{});
    // #endregion
    const { error: meaningsError, data: meaningsData } = await supabase
      .from('meanings_th')
      .upsert(meaningData, { onConflict: 'id' })
      .select('*');
    
    // #region agent log
    const returnedData = meaningsData?.slice(0, 2).map(m => ({ id: m.id, source: m.source, definition_th: m.definition_th?.substring(0, 30) }));
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'AFTER upsert - Data returned',data:{hasError:!!meaningsError,errorMessage:meaningsError?.message,errorCode:meaningsError?.code,returnedCount:meaningsData?.length || 0,returnedData,firstReturnedId:meaningsData?.[0]?.id,firstReturnedSource:meaningsData?.[0]?.source},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'UPSERT_UPDATE'})}).catch(()=>{});
    // #endregion
    
    if (meaningsError) {
      // If upsert fails due to missing constraint (42P10), fall back to manual update/insert
      if (meaningsError.code === '42P10' || meaningsError.message.includes('no unique or exclusion constraint')) {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'Upsert failed - falling back to manual update/insert',data:{errorMessage:meaningsError.message,errorCode:meaningsError.code,existingCount,newCount:newMeanings.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'UPSERT_UPDATE'})}).catch(()=>{});
        // #endregion
        console.warn(`[Save] ⚠ Upsert failed (missing constraint) - falling back to manual update/insert`);
        
        // Manual update for existing meanings
        if (existingCount > 0) {
          const updatePromises = meaningData
            .filter(m => existingIdSet.has(m.id))
            .map(async (meaning) => {
              const { error: updateError } = await supabase
                .from('meanings_th')
                .update({
                  definition_th: meaning.definition_th,
                  source: meaning.source || null,
                  created_at: meaning.created_at || null,
                  word_th_id: meaning.word_th_id || null,
                })
                .eq('id', meaning.id);
              
              if (updateError) {
                console.error(`[Save] ✗ Failed to update meaning ${meaning.id}:`, updateError);
                throw new Error(`Failed to update meaning ${meaning.id}: ${updateError.message}`);
              }
            });
          
          await Promise.all(updatePromises);
          console.log(`[Save] ✓ Manually updated ${existingCount} existing meanings`);
        }
        
        // Manual insert for new meanings
        if (newMeanings.length > 0) {
          const { error: insertError } = await supabase
            .from('meanings_th')
            .insert(newMeanings);
          
          if (insertError) {
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'Manual insert failed',data:{errorMessage:insertError.message,errorCode:insertError.code,newMeaningsCount:newMeanings.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'UPSERT_UPDATE'})}).catch(()=>{});
            // #endregion
            console.error(`[Save] ✗ Failed to insert new meanings:`, insertError);
            throw new Error(`Failed to insert new meanings: ${insertError.message}`);
          }
          console.log(`[Save] ✓ Manually inserted ${newMeanings.length} new meanings`);
        }
        
        // Skip the rest of the upsert success path since we handled it manually
        meaningsData = meaningData; // Set for post-save validation
      } else if (meaningsError.code === '23505' || meaningsError.message.includes('duplicate') || meaningsError.message.includes('unique')) {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'Duplicate key violation (meanings already exist)',data:{errorMessage:meaningsError.message,errorCode:meaningsError.code,newMeaningsCount:newMeanings.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
        // #endregion
        console.warn(`[Save] ⚠ Duplicate key violation - meanings already exist. This is expected if meanings were inserted between check and insert. Skipping.`);
        return; // Don't throw - meanings already exist, which is fine
      } else {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'Meanings upsert failed',data:{errorMessage:meaningsError.message,errorCode:meaningsError.code,newMeaningsCount:newMeanings.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
        // #endregion
        console.error(`[Save] ✗ Failed to save meanings:`, meaningsError);
        throw new Error(`Failed to save meanings: ${meaningsError.message}`);
      }
    }
    
    // #region agent log
    const returnedSources = meaningsData?.map(m => m.source).filter(Boolean) || [];
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'Save senses complete',data:{savedMeaningsCount:meaningsData?.length || meaningData.length,totalMeanings:meaningData.length,updatedCount:existingCount,insertedCount:newMeanings.length,returnedSources:returnedSources.slice(0,5),firstReturnedSource:meaningsData?.[0]?.source},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
    console.log(`[Save] ✓ Successfully upserted ${meaningsData?.length || meaningData.length} meanings to meanings_th table (${newMeanings.length} inserted, ${existingCount} updated)`);
    
    // CRITICAL: Verify database was actually updated by fetching immediately after upsert
    // Supabase select() after upsert may only return inserted rows, not updated ones
    // So we need to fetch separately to verify the update worked
    if (wordTh && meaningData.length > 0 && existingCount > 0) {
      try {
        // #region agent log
        const expectedSources = meaningData.map(m => m.source).filter(Boolean);
        const updatedIds = Array.from(existingIdSet);
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'Post-upsert verification: Fetching meanings to verify update',data:{wordTh,totalMeanings:meaningData.length,existingCount,expectedSources:expectedSources.slice(0,5),firstExpectedId:meaningData[0]?.id,firstExpectedSource:expectedSources[0],updatedIdsCount:updatedIds.length,firstUpdatedId:updatedIds[0]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'UPSERT_UPDATE'})}).catch(()=>{});
        // #endregion
        
        // Small delay to ensure database write is complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const fetchedMeanings = await fetchSenses(wordTh);
        const fetchedSources = fetchedMeanings.map(m => m.source).filter(Boolean);
        
        // Check if source fields were updated correctly for existing meanings
        const sourcesMatch = updatedIds.every(id => {
          const expected = meaningData.find(m => {
            const mId = typeof m.id === 'bigint' ? m.id.toString() : String(m.id);
            const compareId = typeof id === 'bigint' ? id.toString() : String(id);
            return mId === compareId;
          });
          const fetched = fetchedMeanings.find(f => {
            const fId = typeof f.id === 'bigint' ? f.id.toString() : String(f.id);
            const compareId = typeof id === 'bigint' ? id.toString() : String(id);
            return fId === compareId;
          });
          return expected && fetched && fetched.source === expected.source;
        });
        
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'Post-upsert verification: Source field check',data:{wordTh,fetchedCount:fetchedMeanings.length,expectedSources:expectedSources.slice(0,5),fetchedSources:fetchedSources.slice(0,5),sourcesMatch,updatedIdsCount:updatedIds.length,firstExpectedSource:expectedSources[0],firstFetchedSource:fetchedSources[0],firstUpdatedId:updatedIds[0]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'UPSERT_UPDATE'})}).catch(()=>{});
        // #endregion
        
        if (!sourcesMatch) {
          console.error(`[Save] ✗ CRITICAL: Upsert did not update source fields in database! Expected: ${expectedSources.slice(0,3).join(', ')}, Got: ${fetchedSources.slice(0,3).join(', ')}`);
        } else {
          console.log(`[Save] ✓ Post-upsert verification: Source fields updated correctly in database`);
        }
      } catch (verificationError) {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'Post-upsert verification error',data:{wordTh,errorMessage:verificationError instanceof Error ? verificationError.message : String(verificationError)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'UPSERT_UPDATE'})}).catch(()=>{});
        // #endregion
        console.warn(`[Save] ⚠ Post-upsert verification failed for "${wordTh}":`, verificationError);
      }
    }
    
    // Post-save validation: Verify meanings can be fetched back and check source field was updated
    // Check all meanings (both new and updated) since upsert updates existing ones
    if (wordTh && meaningData.length > 0) {
      try {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'Post-save validation: Fetching meanings back',data:{wordTh,totalMeanings:meaningData.length,expectedSources:meaningData.map(m=>m.source).filter(Boolean).slice(0,5)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
        // #endregion
        
        const fetchedMeanings = await fetchSenses(wordTh);
        const fetchedSources = fetchedMeanings.map(m => m.source).filter(Boolean);
        const expectedSources = meaningData.map(m => m.source).filter(Boolean);
        
        // Check if source fields were updated correctly
        const sourcesMatch = meaningData.every(meaning => {
          const fetched = fetchedMeanings.find(f => f.id.toString() === meaning.id.toString());
          return fetched && fetched.source === meaning.source;
        });
        
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'Post-save validation: Source field check',data:{wordTh,fetchedCount:fetchedMeanings.length,expectedSources:expectedSources.slice(0,5),fetchedSources:fetchedSources.slice(0,5),sourcesMatch,firstExpectedSource:expectedSources[0],firstFetchedSource:fetchedSources[0]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
        // #endregion
        
        if (!sourcesMatch) {
          console.warn(`[Save] ⚠ Post-save validation: Source fields don't match expected values after upsert. Expected: ${expectedSources.slice(0,3).join(', ')}, Got: ${fetchedSources.slice(0,3).join(', ')}`);
        }
        
        const savedIds = new Set(meaningData.map(m => m.id.toString()));
        const fetchedIds = new Set(fetchedMeanings.map(m => m.id.toString()));
        
        // Check if all saved meanings can be found
        const missingIds = meaningData.filter(m => !fetchedIds.has(m.id.toString())).map(m => m.id);
        
        if (missingIds.length > 0) {
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'Post-save validation WARNING: Some meanings not found after save',data:{wordTh,savedCount:meaningData.length,fetchedCount:fetchedMeanings.length,missingCount:missingIds.length,missingIds:missingIds.slice(0,5)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
          // #endregion
          console.warn(`[Save] ⚠ Post-save validation: ${missingIds.length} of ${meaningData.length} saved meanings not found when fetching for "${wordTh}". This may indicate an ID generation mismatch.`);
        } else {
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'Post-save validation PASSED: All meanings found after save',data:{wordTh,savedCount:meaningData.length,fetchedCount:fetchedMeanings.length,sourcesMatch},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
          // #endregion
          console.log(`[Save] ✓ Post-save validation passed: All ${meaningData.length} meanings found when fetching for "${wordTh}"`);
        }
      } catch (validationError) {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'Post-save validation error',data:{wordTh,errorMessage:validationError instanceof Error ? validationError.message : String(validationError)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
        // #endregion
        console.warn(`[Save] ⚠ Post-save validation failed for "${wordTh}":`, validationError);
        // Don't throw - validation failure doesn't mean save failed, just log warning
      }
    }
  } catch (error) {
    // Handle any unexpected errors
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveSenses',message:'Unexpected error during upsert',data:{errorMessage:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
    // #endregion
    throw error;
  }
}

// Write functions
// Use Zod schema field names consistently
export interface WordDataToSave {
  word_th: string; // Primary key - matches wordThSchema.word_th, prevents duplicates
  senses: Array<{
    id: bigint; // Matches meaningThSchema.id
    definition_th: string; // Matches meaningThSchema.definition_th
    source?: string; // Matches meaningThSchema.source
    created_at?: string; // Matches meaningThSchema.created_at
    word_th_id?: string; // Matches meaningThSchema.word_th_id (Thai word string)
    [key: string]: any;
  }>;
  g2p?: string; // Matches wordThSchema.g2p
  phonetic_en?: string; // Matches wordThSchema.phonetic_en
  [key: string]: any;
}

/**
 * Save word data and meanings to Supabase (words_th and meanings_th tables)
 * 
 * 📋 Validates against: src/schemas/wordThSchema.ts and src/schemas/meaningThSchema.ts
 * 
 * This function saves word data to words_th and senses to meanings_th separately.
 * Both are validated with their respective Zod schemas before saving.
 */
export async function saveWordData(wordData: WordDataToSave): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/index.ts:saveWordData',message:'Save word data started',data:{wordTh:wordData.word_th,hasG2P:!!wordData.g2p,hasPhonetic:!!wordData.phonetic_en,senseCount:wordData.senses?.length || 0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
  // #endregion
  console.log(`[Save] Saving word "${wordData.word_th}" to Supabase`);
  
  // Use Zod schema field names consistently
  if (!wordData.word_th) {
    throw new Error('word_th is required');
  }

  // Save word data to words_th table (separate from senses)
  await saveWordOnly({
    word_th: wordData.word_th,
    g2p: wordData.g2p,
    phonetic_en: wordData.phonetic_en,
  });

  // Save senses to meanings_th table (separate from word data) if provided
  // Pass word_th to populate word_th_id in meanings
  if (wordData.senses && wordData.senses.length > 0) {
    // Ensure all senses have word_th_id populated
    const sensesWithWordThId = wordData.senses.map(sense => ({
      ...sense,
      word_th_id: sense.word_th_id || wordData.word_th, // Populate if missing
    }));
    await saveSenses(sensesWithWordThId, wordData.word_th);
  }
}
