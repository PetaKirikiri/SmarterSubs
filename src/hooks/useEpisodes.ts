import { useQuery } from '@tanstack/react-query';
import {
  fetchEpisodeLookups,
  fetchEpisode,
  fetchSubtitles,
  fetchWord,
  fetchSenses,
} from '../supabase';
import { wordThSchema } from '../schemas/wordThSchema';

interface EpisodeLookup {
  id: string;
  mediaId: string;
  showName: string;
  season?: number;
  episode?: number;
  episodeTitle?: string;
}

interface FullEpisodeData extends EpisodeLookup {
  show?: any;
  episode?: any;
  subtitles?: any[];
}

/**
 * Parse word reference string (format: "word_th:senseIndex")
 * Returns word_th to match Zod schema field name
 */
function parseWordReference(wordRef: string): { word_th: string | null; senseIndex: number | null } {
  if (!wordRef || typeof wordRef !== 'string') {
    return { word_th: null, senseIndex: null };
  }
  const parts = wordRef.split(':');
  const word_th = parts[0] && parts[0].trim() !== '' ? parts[0].trim() : null;
  const senseIndex = parts.length > 1 && parts[1] !== '' ? parseInt(parts[1], 10) : null;
  return { word_th, senseIndex };
}

/**
 * Load words and senses for a subtitle
 */
async function loadWordsAndSenses(subtitleData: any): Promise<any> {
  // subtitleData matches subtitleThSchema - use fields as-is
  const result = { ...subtitleData };
  
  // Extract word references from tokens_th (subtitleThSchema.tokens_th: {tokens: Array<{t: string, meaning_id?: bigint}>})
  // tokens_th format: { "tokens": [{t: "เนื้อ", meaning_id: 123}, ...] } - extract t field
  const wordRefs: string[] = [];
  if (subtitleData.tokens_th && typeof subtitleData.tokens_th === 'object') {
    // Extract token texts from objects
    if (subtitleData.tokens_th.tokens && Array.isArray(subtitleData.tokens_th.tokens)) {
      for (const tokenItem of subtitleData.tokens_th.tokens) {
        if (typeof tokenItem === 'string') {
          // Legacy format - plain string
          const trimmed = tokenItem.trim();
          if (trimmed) wordRefs.push(trimmed);
        } else if (tokenItem && typeof tokenItem === 'object' && 't' in tokenItem) {
          // New format - object with t field
          const t = (tokenItem as any).t;
          if (typeof t === 'string') {
            const trimmed = t.trim();
            if (trimmed) wordRefs.push(trimmed);
          }
        }
      }
    }
  }
  
  
  if (wordRefs.length > 0) {
    const thaiWordIds = new Set<string>();
    for (const wordRef of wordRefs) {
      // tokens_th.tokens contains plain strings (word_th values) - use directly, no parsing needed
      const word_th = wordRef.trim();
      if (word_th) {
        thaiWordIds.add(word_th);
      }
    }
    
    // Load words from words_th table
    const thaiWords = [];
    const seenWordIds = new Set<string>();
    
    for (const wordTh of thaiWordIds) {
      if (seenWordIds.has(wordTh)) {
        continue;
      }
      
      // Query words_th table by word_th
      const word = await fetchWord(wordTh);
      
      if (word) {
        // Validate word data with Zod schema
        const wordData = wordThSchema.parse(word);
        
        // Load senses for this word from meanings_th table
        const rawSensesData = await fetchSenses(wordTh);
        const rawSenses = rawSensesData.map(sense => {
          const senseObj: any = {
            senseId: sense.id,
            definition_th: sense.definition_th,
            source: sense.source,
          };
          return senseObj;
        });
        
        // Prepare word data - use Zod schema field names
        const rawWordData: any = { 
          word_th: wordData.word_th, // Zod schema: word_th (string, primary key)
          senses: rawSenses, // computed field
          g2p: wordData.g2p,
          phonetic_en: wordData.phonetic_en,
        };
        
        
        // Validate and transform through Zod schema
        const wordValidationResult = wordThSchema.safeParse(rawWordData);
        
        
        if (wordValidationResult.success) {
          const validatedWordData = wordValidationResult.data;
          thaiWords.push({
            ...validatedWordData,
            senseCount: rawSenses.length, // computed field
            senses: rawSenses, // computed field
          });
          seenWordIds.add(wordTh);
          if (validatedWordData.word_th && validatedWordData.word_th !== wordTh) {
            seenWordIds.add(validatedWordData.word_th);
          }
        } else {
          // Skip invalid words - don't use rawWordData without validation
          console.warn(`[WARN] Skipping invalid word "${wordTh}" - validation failed:`, wordValidationResult.error.errors);
        }
      }
      // REMOVED: failed_words table doesn't exist in Supabase - only use words_th
    }
    
    result.thaiWords = thaiWords;
  }
  
  return result;
}

/**
 * Fetch full episode data including subtitles and words
 */
async function fetchFullEpisodeData(episodeLookup: EpisodeLookup): Promise<FullEpisodeData> {
  const result: FullEpisodeData = { ...episodeLookup };
  
  try {
    // Fetch episode
    const episodeData = await fetchEpisode(episodeLookup.showName, episodeLookup.mediaId);
    if (episodeData) {
      // Use Zod schema field names directly: media_id, show_title, season_number, episode_number, episode_title
      result.episode = {
        id: episodeData.id?.toString() || episodeData.media_id, // Convert bigint to string
        media_id: episodeData.media_id, // Zod schema: media_id
        show_title: episodeData.show_title, // Zod schema: show_title
        season_number: episodeData.season_number != null ? Number(episodeData.season_number) : undefined, // Zod schema: season_number
        episode_number: episodeData.episode_number != null ? Number(episodeData.episode_number) : undefined, // Zod schema: episode_number
        episode_title: episodeData.episode_title || undefined, // Zod schema: episode_title
      };
    }
    
    // Fetch subtitles - returns data matching subtitleThSchema
    // Use mediaId from episodeLookup (camelCase interface field)
    const mediaIdForSubtitles = episodeLookup.mediaId;
    console.log('[DEBUG] Fetching subtitles for mediaId:', mediaIdForSubtitles, 'from episodeLookup:', {id: episodeLookup.id, mediaId: episodeLookup.mediaId, showName: episodeLookup.showName});
    const subtitlesData = await fetchSubtitles(mediaIdForSubtitles);
    
    // Load words and senses for each subtitle
    result.subtitles = await Promise.all(
      subtitlesData.map(async (subtitle, idx) => {
        const result = await loadWordsAndSenses(subtitle);
        return result;
      })
    );
    
    console.log('[DEBUG] Completed loading all subtitles for episode:', {
      mediaId: episodeLookup.mediaId,
      subtitleCount: result.subtitles.length,
      totalWords: result.subtitles.reduce((sum, s) => sum + (s.thaiWords?.length || 0), 0),
      resultKeys: Object.keys(result),
      resultSubtitles: result.subtitles.map((s: any) => ({
        id: s.id,
        thai: s.thai?.substring(0, 30),
        tokens_th: s.tokens_th,
        thaiWordsCount: s.thaiWords?.length || 0
      }))
    });
    
  } catch (err) {
    // Errors logged but not displayed to user
  }
  
  
  return result;
}

/**
 * TanStack Query hook for fetching episode lookups
 */
export function useEpisodeLookups(limitCount: number = 10) {
  return useQuery({
    queryKey: ['episodeLookups', limitCount],
    queryFn: async () => {
      const episodesDataRaw = await fetchEpisodeLookups(limitCount);
      return episodesDataRaw.map(row => ({
        id: row.id,
        mediaId: row.mediaId, // fetchEpisodeLookups returns camelCase
        showName: row.showName, // fetchEpisodeLookups returns camelCase
        season: row.season || undefined,
        episode: row.episode || undefined,
        episodeTitle: row.episodeTitle || undefined, // fetchEpisodeLookups returns camelCase
      })) as EpisodeLookup[];
    },
    staleTime: 0, // Always fetch fresh (per user requirement)
  });
}

/**
 * TanStack Query hook for fetching full episode data
 */
export function useFullEpisodeData(episodeLookup: EpisodeLookup | null) {
  return useQuery({
    queryKey: ['fullEpisodeData', episodeLookup?.id],
    queryFn: () => {
      if (!episodeLookup) throw new Error('No episode lookup provided');
      return fetchFullEpisodeData(episodeLookup);
    },
    enabled: !!episodeLookup,
    staleTime: 0, // Always fetch fresh (per user requirement)
  });
}

/**
 * TanStack Query hook for fetching multiple full episode data
 */
export function useFullEpisodesData(episodeLookups: EpisodeLookup[]) {
  
  return useQuery({
    queryKey: ['fullEpisodesData', episodeLookups.map(e => e.id).join(',')],
    queryFn: async () => {
      const result = await Promise.all(episodeLookups.map(ep => fetchFullEpisodeData(ep)));
      return result;
    },
    enabled: episodeLookups.length > 0,
    staleTime: 0, // Always fetch fresh (per user requirement)
  });
}
