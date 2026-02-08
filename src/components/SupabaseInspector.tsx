/**
 * Supabase Inspector Component
 * 
 * ⚠️ DATA INTEGRITY: This component ALWAYS fetches data directly from Supabase database
 * - Uses direct supabase.from() calls (no TanStack Query caching)
 * - No localStorage or sessionStorage usage
 * - Each query is a fresh HTTP request to Supabase
 * - All data displayed is the latest from the database
 * 
 * This ensures data integrity checks always see the current database state.
 */

import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../supabase';
import { fetchSenses, fetchWord, saveWordData, saveWordOnly, saveSenses, saveSubtitlesBatch, wordExistsInWords, wordHasCompleteData } from '../supabase';
import { fetchOrstMeanings } from '../services/meanings/fetchOrstMeanings';
import { normalizeSensesWithGPT } from '../services/meanings/gptNormalizeSenses';
import { createMeaningsWithGPT, type GPTMeaningContext } from '../services/meanings/gptMeaning';
import { enrichMeaningsWithGPT } from '../services/meanings/gptEnrichMeanings';
import { enrichMeaningsWithGPTV3 } from '../services/meanings/gptEnrichMeaningsV3';
import { getValidatedProcessingOrder, type PipelineContext, pipelineContextSchema } from '../schemas/processingOrderSchema';
import { executeStepsFromSchema } from '../services/processingPipeline';
import { subtitleThSchema, type SubtitleTh } from '../schemas/subtitleThSchema';
import { wordThSchema, type WordTh } from '../schemas/wordThSchema';
import { meaningThSchema, type MeaningTh } from '../schemas/meaningThSchema';
import { meaningThSchemaV2, type MeaningThV2 } from '../schemas/meaningThSchemaV2';
import { meaningThSchemaV3, type MeaningThV3 } from '../schemas/meaningThSchemaV3';
import { validateCompleteWord, validateNormalizedSenses, validateCompleteToken, validateV2CompleteSenses, needsV2Enrichment, needsV3Enrichment } from '../schemas/integrityValidation';
import { z } from 'zod';

// Helper function to only log errors/problems, not successful operations
function shouldLog(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  // Only log if it contains error/problem indicators
  return lowerMessage.includes('eject') ||
         lowerMessage.includes('error') ||
         lowerMessage.includes('failed') ||
         lowerMessage.includes('violation') ||
         lowerMessage.includes('invalid') ||
         lowerMessage.includes('missing') ||
         lowerMessage.includes('not found') ||
         lowerMessage.includes('fails') ||
         lowerMessage.includes('rejected') ||
         lowerMessage.includes('exception') ||
         lowerMessage.includes('critical') ||
         lowerMessage.includes('fatal') ||
         lowerMessage.includes('mismatch');
}

// Wrapper for debug logging - only sends if it's an error/problem
function debugLog(location: string, message: string, data: any, hypothesisId?: string) {
  if (shouldLog(message)) {
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        location,
        message,
        data,
        timestamp:Date.now(),
        sessionId:'debug-session',
        runId:'run1',
        hypothesisId: hypothesisId || 'ERROR'
      })
    }).catch(()=>{});
  }
}

// Helper to replace verbose fetch calls - extracts location, message, data from fetch call
function logIfError(fetchCall: string) {
  try {
    // Extract JSON from fetch body
    const jsonMatch = fetchCall.match(/body:JSON\.stringify\(({.*?})\)/s);
    if (jsonMatch) {
      const logData = JSON.parse(jsonMatch[1].replace(/'/g, '"'));
      debugLog(logData.location, logData.message, logData.data, logData.hypothesisId);
    }
  } catch (e) {
    // If parsing fails, don't log
  }
}

export function SupabaseInspector() {
  const [subtitles, setSubtitles] = useState<SubtitleTh[]>([]);
  const [currentSubtitleIndex, setCurrentSubtitleIndex] = useState<number>(0);
  // Source of truth: tokens come directly from the current subtitle's tokens_th.tokens array
  // We'll compute tokens directly in render to ensure it's always fresh
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [wordData, setWordData] = useState<any>(null);
  const [senses, setSenses] = useState<(MeaningTh | MeaningThV2 | MeaningThV3)[]>([]);
  const [selectedMeaning, setSelectedMeaning] = useState<MeaningThV2 | MeaningThV3 | null>(null);
  const [tokenLabelMap, setTokenLabelMap] = useState<Map<string, string>>(new Map()); // token -> label_eng
  const [fetchingOrst, setFetchingOrst] = useState(false);
  const [normalizingGPT, setNormalizingGPT] = useState(false);
  const [processingSubtitle, setProcessingSubtitle] = useState(false);
  const [processingG2P, setProcessingG2P] = useState(false);
  const [processingPhonetic, setProcessingPhonetic] = useState(false);
  const [processingAll, setProcessingAll] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0); // Force refresh counter
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wordExistsMap, setWordExistsMap] = useState<Map<string, boolean>>(new Map());
  const [subtitleInputValue, setSubtitleInputValue] = useState<string>('');

  // Helper function to strip V2 fields from senses for V1 validation
  // This allows V1 validation to work even when V2 columns exist in the database
  const stripV2FieldsFromSenses = (senses: unknown[]): MeaningTh[] => {
    return senses.map(sense => {
      if (!sense || typeof sense !== 'object') {
        return sense as MeaningTh;
      }
      const { pos_th, pos_eng, definition_eng, label_eng, ...v1Sense } = sense as Record<string, unknown>;
      return v1Sense as MeaningTh;
    });
  };

  // Helper function to extract token text from token object or string
  const getTokenText = (token: unknown): string | null => {
    if (typeof token === 'string') {
      return token.trim() || null;
    }
    if (token && typeof token === 'object' && 't' in token) {
      const text = (token as any).t;
      return typeof text === 'string' ? text.trim() || null : null;
    }
    return null;
  };

  // Helper function to check if tokens array includes a token text
  const tokensInclude = (tokens: unknown[] | undefined, tokenText: string): boolean => {
    if (!tokens || !Array.isArray(tokens)) return false;
    return tokens.some(token => {
      const text = getTokenText(token);
      return text === tokenText;
    });
  };

  // Helper function to get token index in tokens array
  const getTokenIndex = (tokens: unknown[] | undefined, tokenText: string): number => {
    if (!tokens || !Array.isArray(tokens)) return -1;
    return tokens.findIndex(token => {
      const text = getTokenText(token);
      return text === tokenText;
    });
  };

  // Validation helper functions - validate data before setting state
  const validateSubtitleTh = (data: unknown): SubtitleTh | null => {
    try {
      // Convert old format (string[]) to new format ({t: string, meaning_id?: bigint}[]) if needed
      if (data && typeof data === 'object' && 'tokens_th' in data) {
        const tokensTh = (data as any).tokens_th;
        if (tokensTh && typeof tokensTh === 'object' && 'tokens' in tokensTh && Array.isArray(tokensTh.tokens)) {
          // Check if tokens are strings (old format) and convert to objects
          const needsConversion = tokensTh.tokens.some((t: unknown) => typeof t === 'string');
          if (needsConversion) {
            const convertedTokens = tokensTh.tokens.map((t: unknown) => {
              if (typeof t === 'string') {
                return { t: t.trim() };
              }
              return t;
            });
            (data as any).tokens_th = { tokens: convertedTokens };
          }
        }
      }
      
      const result = subtitleThSchema.parse(data);
      
      console.log(`[Zod Validation] ✓ Subtitle ${(data as any)?.id} passed subtitleThSchema validation`);
      return result;
    } catch (error) {
      console.error('[Zod Validation] ✗ Invalid subtitle data:', error);
      return null;
    }
  };

  const validateWord = (data: unknown): WordTh | null => {
    
    try {
      const result = wordThSchema.parse(data);
      
      console.log(`[Zod Validation] ✓ Word "${data?.word_th}" passed wordSchema validation`);
      return result;
    } catch (error) {
      
      console.error('[Zod Validation] ✗ Invalid word data:', error);
      return null;
    }
  };

  // Helper function to update word data completeness map
  const updateWordDataCompleteness = (token: string, wordData: WordTh | null) => {
    if (wordData && wordData.word_th && (wordData.g2p || wordData.phonetic_en)) {
      setWordExistsMap(prev => new Map(prev).set(token, true));
    } else {
      setWordExistsMap(prev => new Map(prev).set(token, false));
    }
  };

  // Helper function to refresh word data completeness for all tokens
  // Computes tokens directly from current subtitle (source of truth)
  const refreshWordDataCompleteness = async () => {
    const currentSubtitle = subtitles[currentSubtitleIndex];
    const rawTokens = currentSubtitle?.tokens_th?.tokens;
    // Handle both formats: array of strings OR array of objects with {t, meaning_id}
    const currentTokens: string[] = [];
    if (rawTokens && Array.isArray(rawTokens)) {
      for (const tokenItem of rawTokens) {
        if (typeof tokenItem === 'string') {
          const trimmed = tokenItem.trim();
          if (trimmed) currentTokens.push(trimmed);
        } else if (tokenItem && typeof tokenItem === 'object' && 't' in tokenItem) {
          const tokenText = (tokenItem as any).t?.trim();
          if (tokenText) currentTokens.push(tokenText);
        }
      }
    }

    if (currentTokens.length === 0) {
      setWordExistsMap(new Map());
      return;
    }

    const existsMap = new Map<string, boolean>();
    const checkPromises = currentTokens.map(async (token, index) => {
      try {
        const hasCompleteData = await wordHasCompleteData(token);
        existsMap.set(token, hasCompleteData);
      } catch (err) {
        console.error(`[ERROR] Failed to check word data completeness for ${token}:`, err);
        existsMap.set(token, false);
      }
    });
    
    await Promise.all(checkPromises);
    setWordExistsMap(existsMap);
  };

  const validateSenses = (data: unknown[]): (MeaningTh | MeaningThV2 | MeaningThV3)[] => {
    const validated: (MeaningTh | MeaningThV2 | MeaningThV3)[] = [];
    for (const sense of data) {
      try {
        // Try V3 schema first (backward compatible with V1/V2)
        const v3Result = meaningThSchemaV3.safeParse(sense);
        if (v3Result.success) {
          validated.push(v3Result.data);
        } else {
          // Try V2 schema (backward compatible with V1)
          const v2Result = meaningThSchemaV2.safeParse(sense);
          if (v2Result.success) {
            validated.push(v2Result.data);
          } else {
            // Fall back to V1 schema
            const v1Result = meaningThSchema.strict().safeParse(sense);
            if (v1Result.success) {
              validated.push(v1Result.data);
            } else {
              console.error('[Zod Validation] ✗ Invalid sense data, skipping:', v1Result.error);
            }
          }
        }
      } catch (error) {
        console.error('[Zod Validation] ✗ Invalid sense data, skipping:', error);
      }
    }
    return validated;
  };

  // Log component mount for debugging
  useEffect(() => {
    console.log('[DEBUG] SupabaseInspector component mounted');
    console.log('[DEBUG] Supabase client:', supabase ? 'initialized' : 'not initialized');
    console.log('[DEBUG] Supabase URL:', import.meta.env.VITE_SUPABASE_URL || 'not set');
    console.log('[DEBUG] Supabase Key:', import.meta.env.VITE_SUPABASE_ANON_KEY ? 'set' : 'not set');
  }, []);

  // Fetch subtitles - ALWAYS fresh from database, no caching
  // ⚠️ Direct database query - always fetches latest data from Supabase (no caching)
  const fetchSubtitles = async (): Promise<SubtitleTh[]> => {
    try {
      // Clear state FIRST to ensure we don't show stale data
      setSubtitles([]);
      setCurrentSubtitleIndex(0);
      setError(null);
      
      console.log('[DEBUG] ===== FETCHING FRESH SUBTITLES FROM SUPABASE =====');
      console.log('[DEBUG] Current React state cleared, fetching from DB...');
      
      const { data, error } = await supabase
        .from('subtitles_th')
        .select('*')
        .order('start_sec_th', { ascending: true });
      
      if (error) {
        console.error('[ERROR] Failed to fetch subtitles:', error);
        setError(`Failed to fetch subtitles: ${error.message}`);
        return [];
      }
    
    console.log('[DEBUG] Raw data from Supabase:', {
      count: data?.length || 0,
      first20Ids: data?.slice(0, 20).map((s) => {
        // Note: subtitleThSchema already has .strict() applied
        const validated = subtitleThSchema.safeParse(s);
        return validated.success ? validated.data.id : null;
      }).filter((id): id is string => id !== null),
      allIds: data?.map((s) => {
        // Note: subtitleThSchema already has .strict() applied
        const validated = subtitleThSchema.safeParse(s);
        return validated.success ? validated.data.id : null;
      }).filter((id): id is string => id !== null),
      idsWithHyphen: data?.filter((s) => {
        // Note: subtitleThSchema already has .strict() applied
        const validated = subtitleThSchema.safeParse(s);
        return validated.success && validated.data.id?.toString().includes('-');
      }).map((s) => {
        // Note: subtitleThSchema already has .strict() applied
        const validated = subtitleThSchema.safeParse(s);
        return validated.success ? validated.data.id : null;
      }).filter((id): id is string => id !== null)
    });
    
    // Filter out any IDs with hyphens (like "81726716-1") - these shouldn't exist
    const validData = (data || []).filter((subtitle: any) => {
      const id = subtitle.id?.toString() || '';
      if (id.includes('-') && !id.includes('_')) {
        console.warn('[DEBUG] ⚠️ Filtering out invalid ID with hyphen (not in DB):', id);
        return false;
      }
      return true;
    });
    
    console.log('[DEBUG] After filtering hyphens:', {
      originalCount: data?.length || 0,
      validCount: validData.length,
      filteredOut: (data?.length || 0) - validData.length
    });
    
    // Deduplicate by ID - if same ID appears multiple times, keep only the first one
    const seenIds = new Set<string>();
    const deduplicated: SubtitleTh[] = [];
    
    validData.forEach((subtitle: unknown) => {
      const id = subtitle.id?.toString() || '';
      if (!seenIds.has(id)) {
        seenIds.add(id);
        deduplicated.push(subtitle);
      } else {
        console.warn('[DEBUG] Duplicate subtitle ID found and removed:', id);
      }
    });
    
    console.log('[DEBUG] After deduplication:', {
      originalCount: data?.length || 0,
      deduplicatedCount: deduplicated.length,
      removed: validData.length - deduplicated.length,
      finalIds: deduplicated.slice(0, 10).map((s) => s.id)
    });
    
    // Client-side sorting fallback to ensure proper order
    const sorted = deduplicated.sort((a, b) => {
      const aTime = a.start_sec_th || 0;
      const bTime = b.start_sec_th || 0;
      return aTime - bTime;
    });
    
      console.log('[DEBUG] Setting React state with', sorted.length, 'subtitles');
      // Validate all subtitles before setting state
      const validatedSubtitles = sorted
        .map(sub => validateSubtitleTh(sub))
        .filter((sub): sub is SubtitleTh => sub !== null);
      
      if (validatedSubtitles.length !== sorted.length) {
        console.warn(`[VALIDATION] Filtered out ${sorted.length - validatedSubtitles.length} invalid subtitles`);
      }
      
      setSubtitles(validatedSubtitles);
      console.log('[useEffect:subtitles] Resetting currentSubtitleIndex to 0 - subtitles changed, length:', subtitles.length);
      setCurrentSubtitleIndex(0); // Reset to first subtitle when new data loads
      
      console.log('[DEBUG] ===== FETCH COMPLETE =====');
      return validatedSubtitles;
    } catch (err) {
      console.error('[ERROR] Unexpected error in fetchSubtitles:', err);
      setError(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchSubtitles().finally(() => {
      setLoading(false);
    });
  }, [refreshKey]); // Re-fetch when refreshKey changes

  // Clear selected token when subtitle changes (tokens are now derived, not state)
  useEffect(() => {
    setSelectedToken(null);
  }, [currentSubtitleIndex]);

  // Check word data completeness for all tokens when subtitle changes
  // Green = word has complete data (id, word_th, g2p or phonetic_en)
  // Red = word missing or incomplete data
  useEffect(() => {
    const currentSubtitle = subtitles[currentSubtitleIndex];
    const rawTokens = currentSubtitle?.tokens_th?.tokens;
    // Handle both formats: array of strings OR array of objects with {t, meaning_id}
    const currentTokens: string[] = [];
    if (rawTokens && Array.isArray(rawTokens)) {
      for (const tokenItem of rawTokens) {
        if (typeof tokenItem === 'string') {
          const trimmed = tokenItem.trim();
          if (trimmed) currentTokens.push(trimmed);
        } else if (tokenItem && typeof tokenItem === 'object' && 't' in tokenItem) {
          const tokenText = (tokenItem as any).t?.trim();
          if (tokenText) currentTokens.push(tokenText);
        }
      }
    }

    if (currentTokens.length === 0) {
      setWordExistsMap(new Map());
      return;
    }

    async function checkWordDataCompleteness() {
      const existsMap = new Map<string, boolean>();
      const checkPromises = currentTokens.map(async (token, index) => {
        try {
          const hasCompleteData = await wordHasCompleteData(token);
          existsMap.set(token, hasCompleteData);
        } catch (err) {
          console.error(`[ERROR] Failed to check word data completeness for ${token}:`, err);
          existsMap.set(token, false);
        }
      });
      
      await Promise.all(checkPromises);
      setWordExistsMap(existsMap);
    }

    checkWordDataCompleteness();
  }, [currentSubtitleIndex, subtitles]);

  // Reset selectedMeaning when selectedToken changes
  useEffect(() => {
    setSelectedMeaning(null);
  }, [selectedToken]);

  // Fetch label_eng for tokens that have meaning_id in subtitle data
  useEffect(() => {
    const index = currentSubtitleIndex;
    const subs = subtitles;
    const currentSubtitle = subs[index];
    const rawTokens = currentSubtitle?.tokens_th?.tokens;
    
    if (!rawTokens || !Array.isArray(rawTokens)) {
      setTokenLabelMap(new Map());
      return;
    }

    async function fetchTokenLabels() {
      const labelMap = new Map<string, string>();
      const fetchPromises: Promise<void>[] = [];

      for (const tokenItem of rawTokens) {
        if (tokenItem && typeof tokenItem === 'object' && 't' in tokenItem && 'meaning_id' in tokenItem) {
          const tokenText = (tokenItem as any).t?.trim();
          const meaningId = (tokenItem as any).meaning_id;
          
          if (tokenText && meaningId !== undefined && meaningId !== null) {
            fetchPromises.push(
              fetchMeaningById(meaningId).then(meaning => {
                if (meaning) {
                  const labelEng = (meaning as any)?.label_eng;
                  if (labelEng && typeof labelEng === 'string' && labelEng.trim().length > 0) {
                    labelMap.set(tokenText, labelEng.trim());
                    console.log(`[Token Labels] Found label_eng for token "${tokenText}": "${labelEng.trim()}"`);
                  } else {
                    console.log(`[Token Labels] Meaning ${meaningId} for token "${tokenText}" exists but has no label_eng`);
                  }
                } else {
                  console.warn(`[Token Labels] Meaning ${meaningId} for token "${tokenText}" not found`);
                }
              }).catch(err => {
                console.warn(`[Token Labels] Failed to fetch meaning ${meaningId} for token "${tokenText}":`, err);
              })
            );
          }
        }
      }

      await Promise.all(fetchPromises);
      console.log(`[Token Labels] Loaded ${labelMap.size} labels for current subtitle`);
      setTokenLabelMap(labelMap);
    }

    fetchTokenLabels();
  }, [currentSubtitleIndex, subtitles]);

  // Clear subtitle input when subtitle index changes externally (e.g., via Back/Next buttons)
  useEffect(() => {
    setSubtitleInputValue('');
  }, [currentSubtitleIndex]);

  // Fetch word data and senses when token is selected
  // ⚠️ Direct database queries - always fetches latest data from Supabase (no caching)
  useEffect(() => {
    if (!selectedToken) {
      setWordData(null);
      setSenses([]);
      return;
    }

    async function loadWordData() {
      if (!selectedToken) return; // Guard against null
      
      
      
      // Fetch word from words_th table (direct DB query)
      const word = await fetchWord(selectedToken);
      // Validate before setting state
      const validatedWord = word ? validateWord(word) : null;
      setWordData(validatedWord);
      
      // Update word data completeness map
      updateWordDataCompleteness(selectedToken, validatedWord);
      
      // Fetch senses for this token (direct DB query)
      // Now queries by BOTH deterministic IDs AND word_th_id
      
      const sensesData = await fetchSenses(selectedToken);
      // #region agent log - FETCH SENSES RESULT
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:useEffect',message:'FETCH SENSES RESULT',data:{
        selectedToken,
        sensesDataCount:sensesData?.length || 0,
        firstSense:sensesData?.[0] ? {
          id:sensesData[0].id?.toString(),
          hasDefinition:!!sensesData[0].definition_th,
          hasV2Fields:!!((sensesData[0] as any).pos_th || (sensesData[0] as any).pos_eng || (sensesData[0] as any).definition_eng),
          definitionThPreview:sensesData[0].definition_th?.substring(0, 30)
        } : null
      },timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_SENSES'})}).catch(()=>{});
      // #endregion
      
      // Validate before setting state
      const validatedSenses = validateSenses(sensesData || []);
      // #region agent log - VALIDATED SENSES
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:useEffect',message:'VALIDATED SENSES',data:{
        selectedToken,
        validatedCount:validatedSenses.length,
        firstValidated:validatedSenses[0] ? {
          id:validatedSenses[0].id?.toString(),
          hasDefinition:!!validatedSenses[0].definition_th,
          hasV2Fields:!!((validatedSenses[0] as any).pos_th || (validatedSenses[0] as any).pos_eng || (validatedSenses[0] as any).definition_eng),
          definitionThPreview:validatedSenses[0].definition_th?.substring(0, 30)
        } : null
      },timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_SENSES'})}).catch(()=>{});
      // #endregion
      
      setSenses(validatedSenses);
      // #region agent log - SENSES SET TO STATE
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:useEffect',message:'SENSES SET TO STATE',data:{selectedToken,sensesCount:validatedSenses.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_SENSES'})}).catch(()=>{});
      // #endregion
      
      // #region agent log - RENDERING SENSES (after state update)
      if (validatedSenses.length > 0) {
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:useEffect',message:'RENDERING SENSES',data:{sensesLength:validatedSenses.length,selectedToken,firstSenseHasDefinition:!!validatedSenses[0]?.definition_th},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'FETCH_SENSES'})}).catch(()=>{});
      }
      // #endregion
    }

    loadWordData();
  }, [selectedToken]);

  const handleFetchOrst = async () => {
    
    
    if (!selectedToken || fetchingOrst) {
      
      return;
    }
    
    setFetchingOrst(true);
    
    
    try {
      // Fetch meanings from ORST (returns Zod schema format)
      
      const meanings = await fetchOrstMeanings(selectedToken);
      
      
      if (meanings.length === 0) {
        
        alert(`No meanings found for "${selectedToken}"`);
        return;
      }
      
      // Prepare word data matching Zod schema (wordSchema.ts) for Supabase
      const wordDataToSave = {
        word_th: selectedToken, // Zod: word_th (string) - primary key, prevents duplicates
        senses: meanings, // Array of validated senseSchema objects (from fetchOrstMeanings)
        g2p: wordData?.g2p, // Zod: g2p (optional string)
        phonetic_en: wordData?.phonetic_en, // Zod: phonetic_en (optional string)
      };
      
      
      // Save to Supabase (words_th and meanings_th tables)
      await saveWordData(wordDataToSave);
      
      
      // Reload word data and senses from Supabase (direct DB queries - fresh data)
      // ⚠️ These queries always hit the database directly, ensuring we see the latest saved data
      
      const updatedWord = await fetchWord(selectedToken);
      // Validate before setting state
      const validatedUpdatedWord = updatedWord ? validateWord(updatedWord) : null;
      setWordData(validatedUpdatedWord);
      
      // Update word data completeness map
      if (selectedToken) {
        updateWordDataCompleteness(selectedToken, validatedUpdatedWord);
      }
      
      const updatedSenses = await fetchSenses(selectedToken);
      // Validate before setting state
      const validatedUpdatedSenses = validateSenses(updatedSenses || []);
      setSenses(validatedUpdatedSenses);
      
      
    } catch (err) {
      
      console.error('[ERROR] Failed to fetch ORST data:', err);
      alert(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setFetchingOrst(false);
      
    }
  };

  const handleNormalizeGPT = async () => {
    if (!selectedToken || normalizingGPT || senses.length === 0) {
      return;
    }

    setNormalizingGPT(true);

    try {
      // Normalize senses using GPT
      const normalizedSenses = await normalizeSensesWithGPT(senses, {
        textTh: selectedToken
      });

      if (normalizedSenses.length === 0) {
        alert('No normalized senses returned');
        return;
      }

      // Prepare word data with normalized senses
      const wordDataToSave = {
        id: wordData?.id || BigInt(0),
        word_th: selectedToken,
        senses: normalizedSenses,
        g2p: wordData?.g2p,
        phonetic_en: wordData?.phonetic_en,
      };

      // Save to Supabase
      await saveWordData(wordDataToSave);

      // Reload word data and senses from Supabase
      const updatedWord = await fetchWord(selectedToken);
      // Validate before setting state
      const validatedUpdatedWord = updatedWord ? validateWord(updatedWord) : null;
      setWordData(validatedUpdatedWord);
      
      // Update word data completeness map
      if (selectedToken) {
        updateWordDataCompleteness(selectedToken, validatedUpdatedWord);
      }

      const updatedSenses = await fetchSenses(selectedToken);
      // Validate before setting state
      const validatedUpdatedSenses = validateSenses(updatedSenses || []);
      setSenses(validatedUpdatedSenses);
    } catch (err) {
      console.error('[ERROR] Failed to normalize with GPT:', err);
      alert(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setNormalizingGPT(false);
    }
  };

  const handleTokenizeCurrentSubtitle = async () => {
    
    if (processingSubtitle || subtitles.length === 0) {
      
      return;
    }

    const currentSubtitle = subtitles[currentSubtitleIndex];
    if (!currentSubtitle) {
      
      alert('No subtitle selected');
      return;
    }

    // Skip if already has tokens_th
    if (currentSubtitle.tokens_th && currentSubtitle.tokens_th.tokens && currentSubtitle.tokens_th.tokens.length > 0) {
      
      alert('This subtitle already has tokens');
      return;
    }

    // Validate that subtitle.thai exists
    if (!currentSubtitle.thai || !currentSubtitle.thai.trim()) {
      
      alert('Subtitle has no Thai text to tokenize');
      return;
    }

    setError(null); // Clear previous errors
    setProcessingSubtitle(true);
    
    try {
      // Use workflow coordinator for tokenization (enforces schema-defined order)
      const workflow = getValidatedProcessingOrder();
      const context: PipelineContext = {
        thaiText: currentSubtitle.thai,
      };

      // Validate context before execution
      const validatedContext = pipelineContextSchema.safeParse(context);
      if (!validatedContext.success) {
        throw new Error(`Invalid context for subtitle ${currentSubtitle.id}: ${validatedContext.error.message}`);
      }

      const { results, finalContext } = await executeStepsFromSchema(workflow, validatedContext.data, ['tokenize']);
      
      const tokenizeResult = results.find(r => r.stepName === 'tokenize');
      if (!tokenizeResult || !tokenizeResult.success) {
        throw new Error(`Tokenization failed: ${tokenizeResult?.error?.message || 'Unknown error'}`);
      }

      if (!finalContext.tokens_th) {
        throw new Error('Tokenization completed but tokens_th is missing');
      }

      
      
      // Update the subtitle object with new tokens_th
      const updatedSubtitle = {
        ...currentSubtitle,
        tokens_th: finalContext.tokens_th,
      };

      // Validate immediately after creation
      const validatedSubtitle = validateSubtitleTh(updatedSubtitle);
      if (!validatedSubtitle) {
        throw new Error('Failed to validate updated subtitle - data integrity check failed');
      }

      // Save the single subtitle with tokenized data
      
      await saveSubtitlesBatch([updatedSubtitle]);
      
      
      // Refresh subtitles list from Supabase to show updated tokens
      // Use the same fetchSubtitles function to ensure deduplication
      await fetchSubtitles();
      
      // The useEffect hook will automatically update tokens when subtitles state changes
      // UI updates silently - no alert needed
    } catch (err) {
      
      console.error('[ERROR] Failed to tokenize subtitle:', err);
      alert(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setProcessingSubtitle(false);
      
    }
  };

  /**
   * Shared token processing function - used by both Process All and Process Current Sub
   * Processes a single token through the complete pipeline: G2P → phonetic → ORST → GPT normalize → V2 enrichment
   * 
   * @param token - The token to process
   * @param subtitleContext - Optional subtitle context for GPT-meaning/enrichment
   * @param workflow - The processing workflow schema
   * @param options - Options for processing behavior
   * @returns { processed: boolean, skipped: boolean } - Whether token was processed or skipped
   */
  const processSingleToken = async (
    token: string,
    subtitleContext: { subtitle?: SubtitleTh | null, subtitleIndex?: number | null } | null = null,
    workflow: ProcessingOrder,
    options: { 
      onSkip?: (reason: string) => void,
      onProcess?: () => void,
      skipReasons?: Record<string, number>,
      logPrefix?: string
    } = {}
  ): Promise<{ processed: boolean; skipped: boolean }> => {
    const logPrefix = options.logPrefix || '[Process]';
    const subtitle = subtitleContext?.subtitle;
    const subtitleIndex = subtitleContext?.subtitleIndex;
    
    try {
      // Fetch word and senses ONCE - reuse throughout
      const existingWord = await fetchWord(token);
      const existingSenses = await fetchSenses(token);
      
      // ⚠️ FAST SKIP: Use Zod contract validation - this is the ONLY way to determine completeness
      // If contract passes, skip immediately with NO API calls
      const tokenContractValidation = validateCompleteToken(token, existingWord, existingSenses);
      
      // CRITICAL: Check if senses have ORST source BEFORE fast skip
      // Even if contract validation passes, we MUST normalize ORST senses
      const hasSenses = existingSenses && existingSenses.length > 0;
      const hasOrstSenses = hasSenses && existingSenses.some(s => s.source === 'orst' || s.source === 'ORST');
      
      // Check if meanings need V2 enrichment (normalized V1 but missing V2 fields)
      const needsEnrichment = hasSenses && needsV2Enrichment(existingSenses);
      
      // FAST SKIP: If Zod contract passes AND senses exist AND senses are normalized AND V2 complete, skip workflow
      // ⚠️ CRITICAL: Cannot skip if:
      // - senses are missing
      // - senses have ORST source (must normalize)
      // - senses need V2 enrichment (must enrich V2 - next evolution stage)
      // Note: V3 will be checked naturally after V2 completes (next evolution)
      if (tokenContractValidation.passed && hasSenses && !hasOrstSenses && !needsEnrichment) {
        // Contract passes and V2 is complete - workflow can be skipped
        // V3 will be checked naturally in the pipeline after V2
      }
      
      // #region agent log - PROCESS SINGLE TOKEN NOT SKIPPING
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:processSingleToken',message:'PROCESS SINGLE TOKEN NOT SKIPPING',data:{token,tokenContractValidationPassed:tokenContractValidation.passed,hasSenses,hasOrstSenses,needsEnrichment,willProcess:true},timestamp:Date.now(),runId:'run1',hypothesisId:'PROCESS_ALL'})}).catch(()=>{});
      // #endregion
      
      // ⚠️ CRITICAL: Use Zod contract validation to determine what needs processing
      // NO manual checks - ALL decisions based on Zod contracts from integrityCheck.ts
      const wordContractValidation = validateCompleteWord(existingWord);
      const sensesContractValidation = validateNormalizedSenses(existingSenses || []);
      
      // Determine what to process based on Zod contract validation
      const stepsToProcess: string[] = [];
      
      // G2P: Needed if word contract fails (missing g2p OR phonetic_en)
      if (!wordContractValidation.passed) {
        const needsG2P = !existingWord?.g2p || existingWord.g2p.trim().length === 0;
        if (needsG2P) {
          stepsToProcess.push('g2p');
        }
      } else {
        options.skipReasons && (options.skipReasons['word_g2p_exists'] = (options.skipReasons['word_g2p_exists'] || 0) + 1);
      }
      
      // Phonetic: Needed if word contract fails OR G2P is missing (phonetic depends on G2P)
      if (!wordContractValidation.passed) {
        const needsPhonetic = !existingWord?.phonetic_en || existingWord.phonetic_en.trim().length === 0;
        const needsG2P = !existingWord?.g2p || existingWord.g2p.trim().length === 0;
        if (needsPhonetic) {
          if (needsG2P && !stepsToProcess.includes('g2p')) {
            stepsToProcess.push('g2p');
          }
          stepsToProcess.push('phonetic');
        }
      } else {
        options.skipReasons && (options.skipReasons['word_phonetic_exists'] = (options.skipReasons['word_phonetic_exists'] || 0) + 1);
      }
      
      // ORST: Needed if no senses exist
      // ⚠️ CRITICAL: Skip ORST if senses already exist and are normalized (V1 or V2)
      if (!existingSenses || existingSenses.length === 0) {
        stepsToProcess.push('orst');
      } else {
        options.skipReasons && (options.skipReasons['word_orst_exists'] = (options.skipReasons['word_orst_exists'] || 0) + 1);
      }
      
      // GPT Normalize: Needed if ORST senses exist OR senses exist but aren't normalized
      // ⚠️ CRITICAL: Skip normalize if senses are already normalized (V1 or V2)
      if (existingSenses && existingSenses.length > 0) {
        const hasOrstSensesCheck = existingSenses.some(s => s.source === 'orst' || s.source === 'ORST');
        if (hasOrstSensesCheck) {
          stepsToProcess.push('gpt_normalize');
        } else if (!sensesContractValidation.passed) {
          stepsToProcess.push('gpt_normalize');
        } else {
          // Senses are normalized - check if they need V2 enrichment
          if (needsEnrichment) {
            // Will enrich after workflow
          } else {
            options.skipReasons && (options.skipReasons['word_normalized_exists'] = (options.skipReasons['word_normalized_exists'] || 0) + 1);
          }
        }
      } else if (stepsToProcess.includes('orst')) {
        stepsToProcess.push('gpt_normalize');
      }

      // Check if V2 enrichment is needed (even if workflow steps are complete)
      const needsV2EnrichmentCheck = needsEnrichment;
      
      // ⚠️ PIPELINE EVOLUTION: V3 is the next evolution after V2
      // Don't check V3 early - let it happen naturally in the pipeline after V2 completes
      // The pipeline flows: workflow → V2 (if needed) → V3 (if needed, naturally after V2)
      
      if (stepsToProcess.length === 0) {
        if (needsV2EnrichmentCheck) {
          // V2 enrichment needed - skip workflow execution but continue to enrichment logic
          // Set up meanings and context for enrichment
          const meanings = existingSenses || [];
          const finalG2P = existingWord?.g2p;
          const finalPhonetic = existingWord?.phonetic_en;
          
          // Jump directly to enrichment (skip workflow execution)
          // V2 will happen, then V3 will happen naturally after V2 completes
        } else {
          // Check if V3 is needed (only after confirming V2 is complete)
          // This is the natural pipeline progression: V2 complete → check V3
          const needsV3Check = hasSenses && needsV3Enrichment(existingSenses);
          if (needsV3Check) {
            // V3 enrichment needed - skip workflow execution but continue to enrichment logic
            // Set up meanings and context for enrichment
            const meanings = existingSenses || [];
            const finalG2P = existingWord?.g2p;
            const finalPhonetic = existingWord?.phonetic_en;
            
            // Jump directly to enrichment (skip workflow execution)
            // V3 will happen naturally in the pipeline
          } else {
            // Everything complete - can skip
            options.onSkip?.('no_workflow_no_enrichment');
            options.skipReasons && (options.skipReasons['word_all_complete'] = (options.skipReasons['word_all_complete'] || 0) + 1);
            return { processed: false, skipped: true };
          }
        }
      }

      // Execute workflow for this token (ONLY if stepsToProcess is not empty)
      let validatedFinalContext: z.SafeParseReturnType<typeof pipelineContextSchema, PipelineContext> | null = null;
      let workflowResults: Array<{ stepName: string; success: boolean; error?: Error }> = [];
      
      if (stepsToProcess.length > 0) {
        // Build context for pipeline execution
        // Only include fields that are needed for the steps being executed
        const context: PipelineContext = {
          word_th: token, // NOT textTh - matches wordThSchema.word_th
        };
        
        // Only include G2P if it exists (for steps that might need it)
        if (existingWord?.g2p) {
          context.g2p = existingWord.g2p;
        }
        
        // CRITICAL: Only include orstSenses if gpt_normalize is in stepsToProcess
        // Including it for other steps causes validation errors because those steps' output schemas don't allow it
        // ⚠️ V1/V2 COMPATIBILITY: Strip V2 fields before adding to pipeline context to allow V1 validation
        const needsNormalize = stepsToProcess.includes('gpt_normalize');
        if (needsNormalize && existingSenses && existingSenses.length > 0) {
          context.orstSenses = stripV2FieldsFromSenses(existingSenses);
        }
        
        // ⚠️ CRITICAL: Validate context before execution with strict schema
        const validatedContext = pipelineContextSchema.strict().safeParse(context);
        if (!validatedContext.success) {
          console.error(`${logPrefix} ✗ Invalid context for token "${token}":`, validatedContext.error.errors);
          throw new Error(`Invalid context for token "${token}": ${validatedContext.error.message}`);
        }

        const { results, finalContext } = await executeStepsFromSchema(workflow, validatedContext.data, stepsToProcess);
        workflowResults = results;
        
        // Validate final context
        validatedFinalContext = pipelineContextSchema.safeParse(finalContext);
        if (!validatedFinalContext.success) {
          throw new Error(`Workflow produced invalid final context for "${token}": ${validatedFinalContext.error.message}`);
        }

        // Check results - throw on unacceptable failures (strict contract enforcement)
        const failedSteps = results.filter(r => !r.success);
        if (failedSteps.length > 0) {
          // Filter out acceptable failures (only ORST can fail)
          const unacceptableFailures = failedSteps.filter(f => {
            const step = workflow.steps.find(s => s.name === f.stepName);
            return !step?.acceptableFailure;
          });

          if (unacceptableFailures.length > 0) {
            const errorMessage = `[PROCESSING CONTRACT VIOLATION] Unacceptable failures for "${token}": ${unacceptableFailures.map(s => s.stepName).join(', ')}. Processing stopped.`;
            console.error(`${logPrefix} ✗ ${errorMessage}`);
            throw new Error(errorMessage);
          }

          // Log acceptable failures (ORST) but continue
          const acceptableFailures = failedSteps.filter(f => {
            const step = workflow.steps.find(s => s.name === f.stepName);
            return step?.acceptableFailure;
          });
          if (acceptableFailures.length > 0) {
            console.warn(`${logPrefix} ⚠ Acceptable failures for "${token}":`, 
              acceptableFailures.map(s => `${s.stepName}: ${s.error?.message}`).join(', '));
          }
        }
      }

      // Use final context data (normalized senses preferred, then GPT-meaning, then ORST, then existing)
      // ⚠️ CRITICAL: If workflow was skipped (stepsToProcess.length === 0 but needsV2EnrichmentCheck), use existing senses
      let meanings: MeaningTh[] = [];
      let finalG2P: string | undefined;
      let finalPhonetic: string | undefined;
      
      if (validatedFinalContext && validatedFinalContext.success) {
        meanings = validatedFinalContext.data.normalizedSenses || validatedFinalContext.data.gptMeanings || validatedFinalContext.data.orstSenses || existingSenses || [];
        finalG2P = validatedFinalContext.data.g2p || existingWord?.g2p;
        finalPhonetic = validatedFinalContext.data.phonetic_en || existingWord?.phonetic_en;
      } else if (stepsToProcess.length === 0 && needsV2EnrichmentCheck) {
        // Workflow was skipped but V2 enrichment is needed
        meanings = existingSenses || [];
        finalG2P = existingWord?.g2p;
        finalPhonetic = existingWord?.phonetic_en;
      } else {
        meanings = existingSenses || [];
        finalG2P = existingWord?.g2p;
        finalPhonetic = existingWord?.phonetic_en;
      }
      
      // ⚠️ PIPELINE EVOLUTION: V2 enrichment (natural progression from V1)
      // If meanings are normalized (V1) but missing V2 fields, enrich them
      // This is part of the natural pipeline flow: V1 → V2 → V3
      // Only enrich if meanings are already normalized (not ORST)
      // This check runs even if workflow was skipped (stepsToProcess.length === 0)
      const v2EnrichmentNeeded = meanings.length > 0 && needsV2Enrichment(meanings);
      // #region agent log - V2 ENRICHMENT CHECK
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:processSingleToken',message:'V2 ENRICHMENT CHECK',data:{token,meaningsCount:meanings.length,v2EnrichmentNeeded,meaningsSample:meanings.slice(0,2).map((m:any)=>({id:m.id?.toString(),hasV2Fields:!!(m.pos_th || m.pos_eng || m.definition_eng),source:m.source}))},timestamp:Date.now(),runId:'run1',hypothesisId:'V2_ENRICH'})}).catch(()=>{});
      // #endregion
      if (v2EnrichmentNeeded) {
        console.log(`${logPrefix} Enriching meanings with V2 fields (pos_th, pos_eng, definition_eng) for "${token}"...`);
        // #region agent log - V2 ENRICHMENT START
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:processSingleToken',message:'V2 ENRICHMENT START',data:{token,meaningsCount:meanings.length},timestamp:Date.now(),runId:'run1',hypothesisId:'V2_ENRICH'})}).catch(()=>{});
        // #endregion
        
        try {
          const enrichedMeanings = await enrichMeaningsWithGPT(meanings, {
            textTh: token,
            fullThaiText: subtitle?.thai || undefined,
            g2p: finalG2P || undefined,
            phonetic_en: finalPhonetic || undefined,
          });
          
          if (enrichedMeanings && enrichedMeanings.length > 0) {
            console.log(`${logPrefix} ✓ Enriched ${enrichedMeanings.length} meaning(s) with V2 fields for "${token}"`);
            meanings = enrichedMeanings; // Use enriched meanings
            
            // ⚠️ CRITICAL: Save V2 enriched meanings immediately (gate stage - must complete before V3)
            const sensesToSaveV2 = enrichedMeanings.map((meaning) => {
              const meaningAny = meaning as any;
              return {
                id: meaning.id,
                definition_th: meaning.definition_th,
                source: meaning.source,
                created_at: meaning.created_at,
                word_th_id: meaning.word_th_id || token,
                ...(meaningAny.pos_th && { pos_th: meaningAny.pos_th }),
                ...(meaningAny.pos_eng && { pos_eng: meaningAny.pos_eng }),
                ...(meaningAny.definition_eng && { definition_eng: meaningAny.definition_eng }),
              };
            });
            await saveSenses(sensesToSaveV2, token);
            console.log(`${logPrefix} ✓ Saved V2 enriched senses for "${token}"`);
            
            // ⚠️ CRITICAL: Refetch senses after V2 enrichment save (gate stage complete)
            // This ensures V3 check uses V2-complete senses from database
            const refreshedSensesAfterV2 = await fetchSenses(token);
            meanings = refreshedSensesAfterV2 || meanings; // Use refreshed V2-complete senses
            
            // ⚠️ CRITICAL: Update UI immediately if this is the currently selected token
            if (selectedToken === token) {
              const validatedRefreshedSenses = validateSenses(refreshedSensesAfterV2);
              setSenses(validatedRefreshedSenses);
              console.log(`${logPrefix} ✓ UI updated with V2 enriched senses for "${token}"`);
            }
          } else {
            console.warn(`${logPrefix} ⚠ V2 enrichment returned empty for "${token}"`);
            // ⚠️ CRITICAL: V2 is a strict gate stage - if enrichment returns empty, we cannot proceed
            throw new Error(`V2 enrichment returned empty for "${token}". V2 is a required gate stage and must complete before proceeding.`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`${logPrefix} ✗ V2 enrichment failed for "${token}":`, error);
          // ⚠️ CRITICAL: V2 is a strict gate stage - if enrichment fails, we cannot proceed
          throw new Error(`V2 enrichment failed for "${token}": ${errorMessage}. V2 is a required gate stage and must complete before proceeding.`);
        }
      }
      
      // ⚠️ PIPELINE EVOLUTION: V3 is the next natural evolution after V2
      // Check if V3 enrichment is needed (only if V2 is complete - natural progression)
      // This is part of the natural pipeline flow: V1 → V2 → V3
      const v2EnrichmentStillNeeded = meanings.length > 0 && needsV2Enrichment(meanings);
      const needsV3Check = !v2EnrichmentStillNeeded && meanings.length > 0 && needsV3Enrichment(meanings as MeaningThV2[]);
      
      // #region agent log - V3 ENRICHMENT DECISION (natural pipeline evolution)
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:processSingleToken',message:'V3 ENRICHMENT DECISION',data:{token,meaningsCount:meanings.length,needsV3Check,v2Complete:!v2EnrichmentStillNeeded,meaningsSample:meanings.slice(0,2).map((m:any)=>({id:m.id?.toString(),hasLabelEng:!!m.label_eng,hasV2Fields:!!(m.pos_th || m.pos_eng || m.definition_eng)})),finalG2P:!!finalG2P,finalPhonetic:!!finalPhonetic},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
      // #endregion
      
      // Natural pipeline evolution: V3 happens after V2 completes
      if (needsV3Check) {
        console.log(`${logPrefix} Pipeline evolution: enriching meanings to V3 (label_eng) for "${token}"...`);
        
        // #region agent log - V3 ENRICHMENT START (natural pipeline evolution)
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:processSingleToken',message:'V3 ENRICHMENT START',data:{token,meaningsCount:meanings.length,meaningsToEnrich:meanings.map((m:any)=>({id:m.id?.toString(),definitionTh:m.definition_th?.substring(0,30),posTh:m.pos_th,posEng:m.pos_eng,definitionEng:m.definition_eng?.substring(0,30),hasLabelEng:!!m.label_eng})),context:{textTh:token,fullThaiText:subtitle?.thai?.substring(0,50),hasG2P:!!finalG2P,hasPhonetic:!!finalPhonetic}},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
        // #endregion
        
        try {
          const enrichedMeaningsV3 = await enrichMeaningsWithGPTV3(meanings as MeaningThV2[], {
            textTh: token,
            fullThaiText: subtitle?.thai || undefined,
            g2p: finalG2P || undefined,
            phonetic_en: finalPhonetic || undefined,
          });
          
          // #region agent log - V3 ENRICHMENT RESULT
          fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:processSingleToken',message:'V3 ENRICHMENT RESULT',data:{token,enrichedCount:enrichedMeaningsV3?.length || 0,enrichedMeanings:enrichedMeaningsV3?.map((m:any)=>({id:m.id?.toString(),labelEng:m.label_eng,hasLabelEng:!!m.label_eng,definitionTh:m.definition_th?.substring(0,30)})),success:!!(enrichedMeaningsV3 && enrichedMeaningsV3.length > 0)},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
          // #endregion
          
          if (enrichedMeaningsV3 && enrichedMeaningsV3.length > 0) {
            console.log(`${logPrefix} ✓ Enriched ${enrichedMeaningsV3.length} meaning(s) with V3 fields for "${token}"`);
            meanings = enrichedMeaningsV3; // Use enriched meanings
            
            // #region agent log - V3 MEANINGS UPDATED
            fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:processSingleToken',message:'V3 MEANINGS UPDATED',data:{token,meaningsCount:meanings.length,meaningsWithLabelEng:meanings.filter((m:any)=>!!m.label_eng).length,selectedTokenMatches:selectedToken === token},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
            // #endregion
            
            // ⚠️ CRITICAL: Update UI immediately if this is the currently selected token
            if (selectedToken === token) {
              // #region agent log - V3 UI UPDATE START
              fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:processSingleToken',message:'V3 UI UPDATE START',data:{token,selectedToken},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
              // #endregion
              const refreshedSenses = await fetchSenses(token);
              const validatedRefreshedSenses = validateSenses(refreshedSenses);
              setSenses(validatedRefreshedSenses);
              // #region agent log - V3 UI UPDATE COMPLETE
              fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:processSingleToken',message:'V3 UI UPDATE COMPLETE',data:{token,refreshedSensesCount:refreshedSenses?.length || 0,validatedSensesCount:validatedRefreshedSenses.length},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
              // #endregion
              console.log(`${logPrefix} ✓ UI updated with V3 enriched senses for "${token}"`);
            }
          } else {
            // #region agent log - V3 ENRICHMENT EMPTY RESULT
            fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:processSingleToken',message:'V3 ENRICHMENT EMPTY RESULT',data:{token,enrichedMeaningsV3:enrichedMeaningsV3?.length || 0},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
            // #endregion
            console.warn(`${logPrefix} ⚠ V3 enrichment returned empty for "${token}"`);
          }
        } catch (error) {
          // #region agent log - V3 ENRICHMENT ERROR
          fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:processSingleToken',message:'V3 ENRICHMENT ERROR',data:{token,errorMessage:error instanceof Error ? error.message : String(error),errorStack:error instanceof Error ? error.stack?.substring(0,200) : undefined},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
          // #endregion
          console.warn(`${logPrefix} ⚠ V3 enrichment failed for "${token}":`, error);
          // Continue with existing meanings - don't stop processing
        }
      }
      
      // GPT-meaning fallback: If ORST returned empty AND no meanings exist, try GPT-meaning
      // CRITICAL: Skip GPT-meaning if meanings already exist from any source
      const hasAnyMeanings = meanings.length > 0 || 
                           (validatedFinalContext?.success && validatedFinalContext.data.normalizedSenses && validatedFinalContext.data.normalizedSenses.length > 0) ||
                           (validatedFinalContext?.success && validatedFinalContext.data.gptMeanings && validatedFinalContext.data.gptMeanings.length > 0) ||
                           (validatedFinalContext?.success && validatedFinalContext.data.orstSenses && validatedFinalContext.data.orstSenses.length > 0) ||
                           (existingSenses && existingSenses.length > 0);
      
      if (meanings.length === 0 && stepsToProcess.includes('orst') && !hasAnyMeanings) {
        // Check if ORST step executed and returned empty
        const orstStepResult = validatedFinalContext?.success ? workflowResults.find(r => r.stepName === 'orst') : null;
        const orstReturnedEmpty = orstStepResult?.success && (!validatedFinalContext?.data.orstSenses || validatedFinalContext.data.orstSenses.length === 0);
        
        if (orstReturnedEmpty) {
          console.log(`${logPrefix} ORST returned empty for "${token}", attempting GPT-meaning fallback...`);
          
          // Extract tokens array from subtitle
          const tokensArray = subtitle?.tokens_th && typeof subtitle.tokens_th === 'object' && 'tokens' in subtitle.tokens_th
            ? (subtitle.tokens_th as { tokens?: unknown[] }).tokens || []
            : [];
          
          // Extract token texts and find word position
          const tokenTexts = tokensArray.map(t => getTokenText(t)).filter((t): t is string => t !== null);
          const wordPosition = tokenTexts.indexOf(token);
          
          const gptContext: GPTMeaningContext = {
            fullThaiText: subtitle?.thai || '',
            allTokens: tokenTexts,
            wordPosition: wordPosition >= 0 ? wordPosition : undefined,
            g2p: finalG2P || undefined,
            phonetic_en: finalPhonetic || undefined,
          };
          
          try {
            const gptMeanings = await createMeaningsWithGPT(token, gptContext);
            
            if (gptMeanings && gptMeanings.length > 0) {
              // CRITICAL: Validate GPT-meaning results have word_th_id set correctly
              const invalidWordThIdMeanings = gptMeanings.filter(m => !m.word_th_id || m.word_th_id !== token);
              if (invalidWordThIdMeanings.length > 0) {
                throw new Error(`GPT-meaning returned ${invalidWordThIdMeanings.length} meaning(s) with invalid word_th_id`);
              }
              
              // Validate each GPT-meaning result with Zod schema
              const invalidSchemaMeanings = gptMeanings.filter(m => {
                const validation = meaningThSchema.safeParse(m);
                return !validation.success;
              });
              if (invalidSchemaMeanings.length > 0) {
                throw new Error(`GPT-meaning returned ${invalidSchemaMeanings.length} meaning(s) that fail Zod validation`);
              }
              
              console.log(`${logPrefix} ✓ GPT-meaning generated ${gptMeanings.length} meaning(s) for "${token}"`);
              meanings = gptMeanings; // Use GPT-meaning results
            } else {
              console.warn(`${logPrefix} ⚠ GPT-meaning returned empty for "${token}"`);
            }
          } catch (error) {
            // GPT-meaning failure is acceptable (similar to ORST) - log but continue
            console.warn(`${logPrefix} ⚠ GPT-meaning failed for "${token}":`, error);
            // Continue with empty meanings - don't stop processing
          }
        }
      }

      // ALWAYS save word data (word_th, g2p, phonetic_en) even if no senses
      const savedWordData = await saveWordOnly({
        word_th: token,
        g2p: finalG2P || undefined,
        phonetic_en: finalPhonetic || undefined,
      });
      
      console.log(`${logPrefix} ✓ Saved word data for "${token}" (g2p: ${!!finalG2P}, phonetic: ${!!finalPhonetic})`);
      
      // ⚠️ CRITICAL: Verify word was saved correctly and passes Zod validation
      const savedWord = await fetchWord(savedWordData.word_th);
      
      if (!savedWord) {
        throw new Error(`Word "${token}" not found in words_th table after save`);
      }
      
      // Validate saved word with Zod schema
      const wordValidation = wordThSchema.safeParse(savedWord);
      if (!wordValidation.success) {
        throw new Error(`Saved word "${token}" fails Zod validation: ${JSON.stringify(wordValidation.error.errors)}`);
      }
      
      // ⚠️ PROCESSING CONTRACT: Validate word matches complete contract
      const savedWordContractValidation = validateCompleteWord(savedWord);
      if (!savedWordContractValidation.passed) {
        throw new Error(`Word "${token}" doesn't match complete contract: ${savedWordContractValidation.errors.map(e => e.message).join(', ')}`);
      }
      
      console.log(`${logPrefix} ✓ Word contract validated for "${token}"`);

      // Save senses separately if we have them
      if (meanings.length > 0) {
        const sensesToSave = meanings.map((meaning) => {
          const meaningAny = meaning as any;
          return {
            id: meaning.id,
            definition_th: meaning.definition_th,
            source: meaning.source,
            created_at: meaning.created_at,
            word_th_id: meaning.word_th_id || token,
            // Add V2 fields if present
            ...(meaningAny.pos_th && { pos_th: meaningAny.pos_th }),
            ...(meaningAny.pos_eng && { pos_eng: meaningAny.pos_eng }),
            ...(meaningAny.definition_eng && { definition_eng: meaningAny.definition_eng }),
            // Add V3 fields if present
            ...(meaningAny.label_eng && { label_eng: meaningAny.label_eng }),
          };
        });
        
        // #region agent log - V3 SAVE SENSES
        const sensesWithLabelEngCount = sensesToSave.filter((s: any) => !!s.label_eng).length;
        const sensesToSaveSample = sensesToSave.slice(0, 3).map((s: any) => ({
          id: s.id?.toString(),
          hasLabelEng: !!s.label_eng,
          labelEng: s.label_eng,
          hasV2Fields: !!(s.pos_th || s.pos_eng || s.definition_eng)
        }));
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:processSingleToken',message:'V3 SAVE SENSES',data:{token,sensesToSaveCount:sensesToSave.length,sensesWithLabelEngCount,sensesToSaveSample},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
        // #endregion
        
        await saveSenses(sensesToSave, token);
        
        // #region agent log - V3 SAVE SENSES COMPLETE
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:processSingleToken',message:'V3 SAVE SENSES COMPLETE',data:{token,savedCount:sensesToSave.length},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
        // #endregion
        console.log(`${logPrefix} ✓ Saved ${sensesToSave.length} senses for "${token}"`);
        
        // ⚠️ CRITICAL: Update UI immediately after saving if this is the currently selected token
        if (selectedToken === token) {
          const refreshedSensesAfterSave = await fetchSenses(token);
          const validatedRefreshedSensesAfterSave = validateSenses(refreshedSensesAfterSave);
          setSenses(validatedRefreshedSensesAfterSave);
          console.log(`${logPrefix} ✓ UI updated after save for "${token}"`);
        }
        
        // ⚠️ CRITICAL: Verify senses were saved correctly and pass Zod validation
        const savedSenses = await fetchSenses(token);
        if (!savedSenses || savedSenses.length === 0) {
          throw new Error(`Senses for "${token}" not found in meanings_th table after save`);
        }
        
        // CRITICAL: Validate that all saved senses have word_th_id set correctly
        const sensesWithoutWordThId = savedSenses.filter(s => !s.word_th_id || s.word_th_id !== token);
        if (sensesWithoutWordThId.length > 0) {
          throw new Error(`${sensesWithoutWordThId.length} saved sense(s) missing or invalid word_th_id for "${token}"`);
        }
        
        // Validate each saved sense with Zod schema
        // ⚠️ V1/V2/V3 COMPATIBILITY: Check V3 first (most complete), then V2, then V1
        const invalidSenses = savedSenses.filter(sense => {
          const v3Validation = meaningThSchemaV3.safeParse(sense);
          if (v3Validation.success) {
            return false; // Valid V3
          }
          const v2Validation = meaningThSchemaV2.safeParse(sense);
          if (v2Validation.success) {
            return false; // Valid V2
          }
          const v1Validation = meaningThSchema.safeParse(sense);
          return !v1Validation.success; // Invalid if none match
        });
        
        if (invalidSenses.length > 0) {
          throw new Error(`${invalidSenses.length} saved senses for "${token}" fail Zod validation`);
        }
        
        // ⚠️ PROCESSING CONTRACT: Validate senses are normalized (if they exist)
        if (savedSenses && savedSenses.length > 0) {
          const sensesContractValidation = validateNormalizedSenses(savedSenses);
          
          if (!sensesContractValidation.passed) {
            throw new Error(`Token "${token}" has unnormalized senses: ${sensesContractValidation.errors.map(e => e.message).join(', ')}`);
          }
        }

        console.log(`${logPrefix} ✓ Senses contract validated for "${token}" (${savedSenses.length} senses)`);
      } else {
        console.log(`${logPrefix} ⚠ No meanings for "${token}", but word data saved`);
      }

      // ⚠️ PROCESSING CONTRACT: Final validation - ensure complete token state matches contract
      const finalWord = await fetchWord(token);
      let finalSenses = await fetchSenses(token);
      
      // ⚠️ CRITICAL: Check if V2 enrichment is needed before final validation (gate stage)
      // If V2 is incomplete, enrich it first before validating
      if (finalSenses && finalSenses.length > 0 && needsV2Enrichment(finalSenses)) {
        console.log(`${logPrefix} V2 enrichment needed before final validation - enriching "${token}"...`);
        try {
          const enrichedMeaningsV2 = await enrichMeaningsWithGPT(finalSenses, {
            textTh: token,
            fullThaiText: subtitle?.thai || undefined,
            g2p: finalG2P || undefined,
            phonetic_en: finalPhonetic || undefined,
          });
          
          if (enrichedMeaningsV2 && enrichedMeaningsV2.length > 0) {
            const sensesToSaveV2 = enrichedMeaningsV2.map((meaning) => {
              const meaningAny = meaning as any;
              return {
                id: meaning.id,
                definition_th: meaning.definition_th,
                source: meaning.source,
                created_at: meaning.created_at,
                word_th_id: meaning.word_th_id || token,
                ...(meaningAny.pos_th && { pos_th: meaningAny.pos_th }),
                ...(meaningAny.pos_eng && { pos_eng: meaningAny.pos_eng }),
                ...(meaningAny.definition_eng && { definition_eng: meaningAny.definition_eng }),
              };
            });
            await saveSenses(sensesToSaveV2, token);
            finalSenses = await fetchSenses(token); // Refetch after V2 enrichment
            console.log(`${logPrefix} ✓ V2 enrichment completed before final validation for "${token}"`);
          } else {
            // ⚠️ CRITICAL: V2 is a strict gate stage - if enrichment returns empty, we cannot proceed
            throw new Error(`V2 enrichment returned empty for "${token}" before final validation. V2 is a required gate stage and must complete before proceeding.`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`${logPrefix} ✗ V2 enrichment failed before final validation for "${token}":`, error);
          // ⚠️ CRITICAL: V2 is a strict gate stage - if enrichment fails, we cannot proceed
          throw new Error(`V2 enrichment failed for "${token}": ${errorMessage}. V2 is a required gate stage and must complete before final validation.`);
        }
      }
      
      // Validate complete token contract (word + senses together) - final check after processing
      const finalTokenContractValidation = validateCompleteToken(token, finalWord, finalSenses);
      if (!finalTokenContractValidation.passed) {
        throw new Error(`Token "${token}" doesn't match complete contract: ${finalTokenContractValidation.errors.map(e => e.message).join(', ')}`);
      }

      console.log(`${logPrefix} ✓ Complete token contract validated for "${token}"`);
      options.onProcess?.();
      return { processed: true, skipped: false };
    } catch (error) {
      console.error(`${logPrefix} ✗ Error processing token "${token}":`, error);
      throw error;
    }
  };

  /**
   * Process Current Subtitle - Full pipeline processing for current subtitle only
   * Cleans tokens with punctuation and migrates word data, then processes tokens using shared logic
   */
  const handleProcessCurrentSubtitle = async () => {
    console.log('[Process Current Sub] ===== FUNCTION CALLED =====');
    console.log('[Process Current Sub] Initial state:', {
      currentSubtitleIndex,
      subtitlesLength: subtitles.length,
      currentSubtitleId: subtitles[currentSubtitleIndex]?.id,
      processingSubtitle,
      processingG2P,
      processingPhonetic,
      processingAll
    });
    
    setError(null);
    
    if (processingSubtitle || processingG2P || processingPhonetic || processingAll || subtitles.length === 0) {
      console.log('[Process Current Sub] Early return - processing flags or no subtitles');
      return;
    }

    // Capture the subtitle index and ID BEFORE any async operations
    const initialSubtitleIndex = currentSubtitleIndex;
    const initialSubtitleId = subtitles[currentSubtitleIndex]?.id;
    
    console.log('[Process Current Sub] Captured initial subtitle:', {
      index: initialSubtitleIndex,
      id: initialSubtitleId
    });

    const currentSubtitle = subtitles[currentSubtitleIndex];
    if (!currentSubtitle) {
      console.error('[Process Current Sub] No subtitle found at index:', currentSubtitleIndex);
      alert('No subtitle selected');
      return;
    }

    if (!currentSubtitle.tokens_th?.tokens || currentSubtitle.tokens_th.tokens.length === 0) {
      console.warn('[Process Current Sub] Subtitle has no tokens:', {
        subtitleId: currentSubtitle.id,
        hasTokens_th: !!currentSubtitle.tokens_th,
        tokenCount: currentSubtitle.tokens_th?.tokens?.length || 0
      });
      alert('Subtitle has no tokens to process');
      return;
    }

    console.log('[Process Current Sub] Starting processing for subtitle:', {
      index: initialSubtitleIndex,
      id: initialSubtitleId,
      tokenCount: currentSubtitle.tokens_th.tokens.length
    });

    setProcessingAll(true);

    try {
      const workflow = getValidatedProcessingOrder();
      
      // Helper to clean token - remove punctuation
      const cleanToken = (token: string): string => {
        return token.replace(/[()\-.,;:!?"'\[\]{}\u2026\u2014\u2013\u201C\u201D\u2018\u2019]/g, '').trim();
      };
      
      // Helper to check if token has punctuation
      const hasInvalidPunctuation = (token: string): boolean => {
        return /[()\-.,;:!?"'\[\]{}\u2026\u2014\u2013\u201C\u201D\u2018\u2019]/.test(token);
      };

      // STEP 1: Clean tokens and migrate word data if needed
      console.log(`[Process Current Sub] Processing subtitle ${currentSubtitle.id}`);
      const originalTokens = currentSubtitle.tokens_th.tokens;
      const cleanedTokens: Array<{t: string, meaning_id?: bigint}> = [];
      const tokenMigrations: Array<{oldToken: string, newToken: string}> = [];

      for (const tokenItem of originalTokens) {
        const tokenText = getTokenText(tokenItem);
        if (!tokenText) {
          continue;
        }
        
        const trimmedToken = tokenText;
        const meaningId = tokenItem && typeof tokenItem === 'object' && 'meaning_id' in tokenItem 
          ? (tokenItem as any).meaning_id 
          : undefined;
        
        if (hasInvalidPunctuation(trimmedToken)) {
          const cleanedToken = cleanToken(trimmedToken);
          
          if (cleanedToken && cleanedToken.length > 0) {
            // Check if old token exists in database
            const oldWord = await fetchWord(trimmedToken);
            const oldSenses = await fetchSenses(trimmedToken);
            
            if (oldWord || (oldSenses && oldSenses.length > 0)) {
              // Migrate word data from old token to cleaned token
              console.log(`[Process Current Sub] Migrating word data from "${trimmedToken}" to "${cleanedToken}"`);
              
              // Create new word entry with cleaned token (copy data from old word)
              await saveWordOnly({
                word_th: cleanedToken,
                g2p: oldWord?.g2p,
                phonetic_en: oldWord?.phonetic_en,
              });
              
              // Update senses to point to new word_th_id
              if (oldSenses && oldSenses.length > 0) {
                const updatedSenses = oldSenses.map(sense => ({
                  ...sense,
                  word_th_id: cleanedToken, // Update to cleaned token
                }));
                await saveSenses(updatedSenses, cleanedToken);
              }
              
              // Delete old word entry
              const { error: deleteError } = await supabase
                .from('words_th')
                .delete()
                .eq('word_th', trimmedToken);
              
              if (deleteError) {
                console.warn(`[Process Current Sub] Failed to delete old word "${trimmedToken}":`, deleteError);
              }
              
              tokenMigrations.push({oldToken: trimmedToken, newToken: cleanedToken});
              // #region agent log
              debugLog('SupabaseInspector.tsx:handleProcessCurrentSubtitle','Token cleaned and migrated',{
                oldToken:trimmedToken,
                newToken:cleanedToken,
                hadWord:!!oldWord,
                hadSenses:oldSenses?.length || 0
              },'TOKEN_CLEAN');
              // #endregion
            }
            
            cleanedTokens.push({ t: cleanedToken, meaning_id: meaningId });
          } else {
            console.warn(`[Process Current Sub] Token "${trimmedToken}" cleaned to empty string - skipping`);
            // #region agent log
            debugLog('SupabaseInspector.tsx:handleProcessCurrentSubtitle','Token cleaned to empty - skipping',{oldToken:trimmedToken},'TOKEN_CLEAN');
            // #endregion
          }
        } else {
          cleanedTokens.push({ t: trimmedToken, meaning_id: meaningId });
        }
      }

      // Update subtitle with cleaned tokens
      const updatedSubtitle: SubtitleTh = {
        ...currentSubtitle,
        tokens_th: { tokens: cleanedTokens },
      };

      // Validate and save updated subtitle
      const validatedSubtitle = validateSubtitleTh(updatedSubtitle);
      if (!validatedSubtitle) {
        throw new Error('Failed to validate subtitle after token cleaning');
      }

      await saveSubtitlesBatch([validatedSubtitle]);
      console.log(`[Process Current Sub] Updated subtitle with ${cleanedTokens.length} cleaned tokens`);
      
      if (tokenMigrations.length > 0) {
        console.log(`[Process Current Sub] Migrated ${tokenMigrations.length} word(s):`, tokenMigrations);
      }

      // Refresh subtitles to get updated data
      console.log('[Process Current Sub] About to call fetchSubtitles() - current index:', currentSubtitleIndex, 'subtitle ID:', initialSubtitleId);
      const refreshedSubtitles = await fetchSubtitles();
      console.log('[Process Current Sub] fetchSubtitles() completed - refreshed count:', refreshedSubtitles.length);
      console.log('[Process Current Sub] After fetchSubtitles - currentSubtitleIndex state:', currentSubtitleIndex);
      
      // Find the subtitle index after refresh
      const refreshedSubtitleIndex = refreshedSubtitles.findIndex(sub => sub.id === initialSubtitleId);
      console.log('[Process Current Sub] Looking for subtitle ID:', initialSubtitleId, 'found at index:', refreshedSubtitleIndex);
      
      if (refreshedSubtitleIndex >= 0) {
        console.log('[Process Current Sub] Restoring subtitle index to:', refreshedSubtitleIndex);
        setCurrentSubtitleIndex(refreshedSubtitleIndex);
      } else {
        console.warn('[Process Current Sub] Could not find subtitle after refresh:', initialSubtitleId);
      }

      // STEP 2: Process cleaned tokens through full pipeline using shared logic
      // Extract unique token texts from cleaned token objects (same pattern as Process All)
      const uniqueTokens = new Set<string>();
      for (const tokenItem of cleanedTokens) {
        const tokenText = getTokenText(tokenItem);
        if (tokenText) {
          uniqueTokens.add(tokenText);
        }
      }
      console.log(`[Process Current Sub] === Processing ${uniqueTokens.size} Unique Tokens ===`);

      const tokensArray = Array.from(uniqueTokens);
      let processedTokenCount = 0;
      let skippedTokenCount = 0;
      const skipReasons: Record<string, number> = {};

      // Get refreshed subtitle for context (after token cleaning)
      const refreshedSubtitleForContext = refreshedSubtitles.find(sub => sub.id === initialSubtitleId);

      for (let i = 0; i < tokensArray.length; i++) {
        const token = tokensArray[i];
        setSelectedToken(token);

        try {
          const result = await processSingleToken(
            token,
            { subtitle: refreshedSubtitleForContext || currentSubtitle, subtitleIndex: refreshedSubtitleIndex },
            workflow,
            {
              logPrefix: '[Process Current Sub]',
              skipReasons,
              onSkip: (reason) => {
                skippedTokenCount++;
              },
              onProcess: () => {
                processedTokenCount++;
              }
            }
          );

          if (result.skipped) {
            skippedTokenCount++;
          } else if (result.processed) {
            processedTokenCount++;
          }
        } catch (error) {
          console.error(`[Process Current Sub] Error processing token "${token}":`, error);
          throw error;
        }
      }

      console.log(`[Process Current Sub] Complete: ${processedTokenCount} processed, ${skippedTokenCount} skipped`);

      // Refresh UI - final refresh
      console.log('[Process Current Sub] Final UI refresh - looking for subtitle ID:', initialSubtitleId);
      const finalRefreshedSubtitles = await fetchSubtitles();
      console.log('[Process Current Sub] Final refresh - subtitle count:', finalRefreshedSubtitles.length);
      
      // Restore subtitle index based on original subtitle ID
      const finalSubtitleIndex = finalRefreshedSubtitles.findIndex(sub => sub.id === initialSubtitleId);
      console.log('[Process Current Sub] Final subtitle lookup:', {
        lookingForId: initialSubtitleId,
        foundAtIndex: finalSubtitleIndex,
        currentStateIndex: currentSubtitleIndex
      });
      
      if (finalSubtitleIndex >= 0) {
        console.log('[Process Current Sub] Setting final subtitle index to:', finalSubtitleIndex);
        setCurrentSubtitleIndex(finalSubtitleIndex);
      } else {
        console.warn('[Process Current Sub] Could not find subtitle in final refresh:', initialSubtitleId);
      }
      
      if (selectedToken && finalRefreshedSubtitles.length > 0) {
        const subtitleIndex = finalRefreshedSubtitles.findIndex(sub => 
          tokensInclude(sub.tokens_th?.tokens, selectedToken)
        );
        console.log('[Process Current Sub] Token-based subtitle lookup:', {
          selectedToken,
          foundAtIndex: subtitleIndex
        });
        if (subtitleIndex >= 0) {
          console.log('[Process Current Sub] Setting subtitle index based on token to:', subtitleIndex);
          setCurrentSubtitleIndex(subtitleIndex);
        }
        
        const updatedWord = await fetchWord(selectedToken);
        const validatedUpdatedWord = updatedWord ? validateWord(updatedWord) : null;
        setWordData(validatedUpdatedWord);
        const updatedSenses = await fetchSenses(selectedToken);
        const validatedSenses = validateSenses(updatedSenses);
        setSenses(validatedSenses);
        updateWordDataCompleteness(selectedToken, validatedUpdatedWord);
      }

      await refreshWordDataCompleteness();
      
      console.log('[Process Current Sub] ===== FUNCTION COMPLETE =====');
      console.log('[Process Current Sub] Final state:', {
        currentSubtitleIndex,
        subtitleId: finalRefreshedSubtitles[currentSubtitleIndex]?.id,
        expectedId: initialSubtitleId
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('[Process Current Sub] Fatal error:', err);
      setError(`Process Current Sub failed: ${errorMessage}`);
      alert(`Process Current Sub failed: ${errorMessage}`);
    } finally {
      setProcessingAll(false);
    }
  };

  // Integrity check: verify tokens_th data exists and is valid
  const hasValidThaiTokens = (subtitle: unknown): boolean => {
    // Integrity check: verify tokens_th data exists and is valid
    if (!subtitle.tokens_th) {
      return false; // No tokens_th field
    }
    
    if (typeof subtitle.tokens_th !== 'object' || subtitle.tokens_th === null) {
      return false; // tokens_th is not an object or is null
    }
    
    if (!subtitle.tokens_th.tokens) {
      return false; // tokens property doesn't exist
    }
    
    if (!Array.isArray(subtitle.tokens_th.tokens)) {
      return false; // tokens is not an array
    }
    
    if (subtitle.tokens_th.tokens.length === 0) {
      return false; // tokens array is empty
    }
    
    // All checks passed - data is valid
    return true;
  };


  const handleTokenizeAll = async () => {
    if (processingSubtitle || subtitles.length === 0) {
      return;
    }

    setError(null); // Clear previous errors
    setProcessingSubtitle(true);

    try {
      // Helper function to fetch fresh subtitles from DB
      const fetchFreshSubtitles = async (): Promise<SubtitleTh[]> => {
        const { data, error } = await supabase
          .from('subtitle_th')
          .select('*')
          .order('start_sec_th', { ascending: true });
        
        if (error) {
          console.error('[ERROR] Failed to fetch subtitles:', error);
          return [];
        }
        
        // Filter out IDs with hyphens and deduplicate
        const validData = (data || []).filter((subtitle: unknown) => {
          const id = subtitle.id?.toString() || '';
          return !(id.includes('-') && !id.includes('_'));
        });
        
        const seenIds = new Set<string>();
        const deduplicated: SubtitleTh[] = [];
        validData.forEach((subtitle: unknown) => {
          const id = subtitle.id?.toString() || '';
          if (!seenIds.has(id)) {
            seenIds.add(id);
            deduplicated.push(subtitle);
          }
        });
        
        // Validate all subtitles before returning
        const validated = deduplicated
          .map(sub => validateSubtitleTh(sub))
          .filter((sub): sub is SubtitleTh => sub !== null);
        
        return validated.sort((a: SubtitleTh, b: SubtitleTh) => {
          const aTime = a.start_sec_th || 0;
          const bTime = b.start_sec_th || 0;
          return aTime - bTime;
        });
      };

      // Keep processing until no more subtitles need tokenization
      let hasMore = true;
      
      while (hasMore) {
        // Fetch fresh subtitles from database
        const currentSubtitles = await fetchFreshSubtitles();
        
        // Find next subtitle that needs tokenization
        // Check Thai only - using Zod schema field names directly
        const nextSubtitleIndex = currentSubtitles.findIndex((subtitle) => {
          // subtitle.thai matches subtitleThSchema field name
          const hasThai = subtitle.thai && subtitle.thai.trim();
          const isValidThaiTokenized = hasValidThaiTokens(subtitle);
          return hasThai && !isValidThaiTokenized;
        });

        if (nextSubtitleIndex === -1) {
          // No more subtitles need tokenization
          hasMore = false;
          break;
        }

        const subtitle = currentSubtitles[nextSubtitleIndex];
        
        // Update currentSubtitleIndex to show visual feedback
        setCurrentSubtitleIndex(nextSubtitleIndex);
        // Also update subtitles state so UI shows current data (validate first)
        const validatedCurrentSubtitles = currentSubtitles
          .map(sub => validateSubtitleTh(sub))
          .filter((sub): sub is SubtitleTh => sub !== null);
        setSubtitles(validatedCurrentSubtitles);

        try {
          // Use workflow coordinator for tokenization (enforces schema-defined order)
          const workflow = getValidatedProcessingOrder();
          const context: PipelineContext = {
            thaiText: subtitle.thai,
          };

          // Validate context before execution
          const validatedContext = pipelineContextSchema.safeParse(context);
          if (!validatedContext.success) {
            throw new Error(`Invalid context for subtitle ${subtitle.id}: ${validatedContext.error.message}`);
          }

          const { results, finalContext } = await executeStepsFromSchema(workflow, validatedContext.data, ['tokenize']);
          
          const tokenizeResult = results.find(r => r.stepName === 'tokenize');
          if (!tokenizeResult || !tokenizeResult.success) {
            throw new Error(`Tokenization failed: ${tokenizeResult?.error?.message || 'Unknown error'}`);
          }

          if (!finalContext.tokens_th) {
            throw new Error('Tokenization completed but tokens_th is missing');
          }
          
          // Update the subtitle object with tokenized data
          // tokens_th matches subtitleThSchema field name directly
          const updatedSubtitle = {
            ...subtitle,
            tokens_th: finalContext.tokens_th,  // Matches subtitleThSchema.tokens_th
          };

          // Validate before saving
          const validatedSubtitle = validateSubtitleTh(updatedSubtitle);
          if (!validatedSubtitle) {
            console.error(`[ERROR] Failed to validate subtitle ${subtitle.id} - skipping`);
            continue;
          }

          // Save the single subtitle with tokenized data
          await saveSubtitlesBatch([validatedSubtitle]);
          
          // Small delay to allow UI to update and show progress
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          // Log error but continue to next subtitle
          console.error(`[ERROR] Failed to tokenize subtitle ${subtitle.id}:`, err);
          // Continue to next subtitle even if this one failed
        }
      }

      // Final refresh to ensure UI is up to date
      await fetchSubtitles();
      // Refresh word data completeness for all tokens
      await refreshWordDataCompleteness();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('[ERROR] Failed during batch tokenization:', err);
      setError(`Tokenization failed: ${errorMessage}`);
      alert(`Tokenization failed: ${errorMessage}`);
    } finally {
      setProcessingSubtitle(false);
    }
  };


  const handleG2PAll = async () => {
    if (processingG2P || processingPhonetic || subtitles.length === 0) {
      return;
    }

    setError(null); // Clear previous errors
    setProcessingG2P(true);

    try {
      // Get all unique tokens from current subtitles
      const uniqueTokens = new Set<string>();
      for (const subtitle of subtitles) {
        if (subtitle.tokens_th?.tokens) {
          for (const tokenItem of subtitle.tokens_th.tokens) {
            const tokenText = getTokenText(tokenItem);
            if (tokenText) {
              uniqueTokens.add(tokenText);
            }
          }
        }
      }

      const tokensArray = Array.from(uniqueTokens);
      console.log('[G2P All] Processing', tokensArray.length, 'unique tokens');

      // Process each token sequentially
      for (let i = 0; i < tokensArray.length; i++) {
        const token = tokensArray[i];
        
        // Find subtitle containing this token for visual feedback
        const subtitleIndex = subtitles.findIndex(sub => 
          tokensInclude(sub.tokens_th?.tokens, token)
        );
        if (subtitleIndex >= 0) {
          setCurrentSubtitleIndex(subtitleIndex);
        }
        // Also select the token for visual feedback in token tabs
        setSelectedToken(token);

        try {
          // Fetch existing word data
          const existingWord = await fetchWord(token);
          
          // Skip if word already has G2P
          if (existingWord?.g2p) {
            console.log(`[G2P All] Skipping ${token} - already has G2P`);
            continue;
          }

          // Fetch existing senses (required for saveWordData)
          const existingSenses = await fetchSenses(token);
          
          // If no word exists and no senses, skip (word needs to exist or have senses)
          if (!existingWord && existingSenses.length === 0) {
            console.log(`[G2P All] Skipping ${token} - no word or senses found`);
            continue;
          }

          // Use workflow coordinator for G2P (enforces schema-defined order)
          const workflow = getValidatedProcessingOrder();
          const context: PipelineContext = {
            word_th: token, // NOT textTh - matches wordThSchema.word_th
          };

          // Validate context before execution
          const validatedContext = pipelineContextSchema.safeParse(context);
          if (!validatedContext.success) {
            throw new Error(`Invalid context for token "${token}": ${validatedContext.error.message}`);
          }

          const { results, finalContext } = await executeStepsFromSchema(workflow, validatedContext.data, ['g2p']);
          
          const g2pResult = results.find(r => r.stepName === 'g2p');
          if (!g2pResult || !g2pResult.success) {
            console.warn(`[G2P All] Failed to get G2P for ${token}: ${g2pResult?.error?.message || 'Unknown error'}`);
            continue;
          }

          // Validate final context
          const validatedFinalContext = pipelineContextSchema.safeParse(finalContext);
          if (!validatedFinalContext.success) {
            throw new Error(`Workflow produced invalid final context for token "${token}": ${validatedFinalContext.error.message}`);
          }

          const g2p = validatedFinalContext.data.g2p;
          if (!g2p) {
            console.warn(`[G2P All] Failed to get G2P for ${token}`);
            continue;
          }

          // Prepare word data with existing senses
          const wordDataToSave = {
            word_th: token, // Primary key - prevents duplicates
            g2p: g2p,
            phonetic_en: existingWord?.phonetic_en, // Preserve existing phonetic_en
            senses: existingSenses.length > 0 ? existingSenses.map(sense => ({
              id: typeof sense.id === 'bigint' ? sense.id : BigInt(sense.id),
              definition_th: sense.definition_th,
              source: sense.source,
              created_at: sense.created_at,
            })) : [{ // If no senses, create a placeholder (saveWordData requires at least one)
              id: BigInt(0),
              definition_th: 'Placeholder - needs ORST fetch',
              source: 'placeholder',
            }],
          };

          // Save updated word
          await saveWordData(wordDataToSave);
          console.log(`[G2P All] Updated G2P for ${token}`);

          // Small delay for visual feedback
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          console.error(`[ERROR] Failed to process G2P for ${token}:`, err);
          // Continue to next token
        }
      }

      // Refresh to show updated data
      await fetchSubtitles();
      // Refresh word data completeness for all tokens
      await refreshWordDataCompleteness();
      if (selectedToken) {
        const updatedWord = await fetchWord(selectedToken);
        // Validate before setting state
        const validatedUpdatedWord = updatedWord ? validateWord(updatedWord) : null;
        setWordData(validatedUpdatedWord);
        const updatedSenses = await fetchSenses(selectedToken);
        const validatedSenses = validateSenses(updatedSenses);
        setSenses(validatedSenses);
        updateWordDataCompleteness(selectedToken, validatedUpdatedWord);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('[ERROR] Failed during batch G2P processing:', err);
      setError(`G2P processing failed: ${errorMessage}`);
      alert(`G2P processing failed: ${errorMessage}`);
    } finally {
      setProcessingG2P(false);
    }
  };

  const handlePhoneticAll = async () => {
    if (processingG2P || processingPhonetic || subtitles.length === 0) {
      return;
    }

    setError(null); // Clear previous errors
    setProcessingPhonetic(true);

    try {
      // Get all unique tokens from current subtitles
      const uniqueTokens = new Set<string>();
      for (const subtitle of subtitles) {
        if (subtitle.tokens_th?.tokens) {
          for (const tokenItem of subtitle.tokens_th.tokens) {
            const tokenText = getTokenText(tokenItem);
            if (tokenText) {
              uniqueTokens.add(tokenText);
            }
          }
        }
      }

      const tokensArray = Array.from(uniqueTokens);
      console.log('[Phonetic All] Processing', tokensArray.length, 'unique tokens');

      // Process each token sequentially
      for (let i = 0; i < tokensArray.length; i++) {
        const token = tokensArray[i];
        
        // Find subtitle containing this token for visual feedback
        const subtitleIndex = subtitles.findIndex(sub => 
          tokensInclude(sub.tokens_th?.tokens, token)
        );
        if (subtitleIndex >= 0) {
          setCurrentSubtitleIndex(subtitleIndex);
        }
        // Also select the token for visual feedback in token tabs
        setSelectedToken(token);

        try {
          // Fetch existing word data
          const existingWord = await fetchWord(token);
          
          // Skip if word doesn't have G2P or already has phonetic_en
          if (!existingWord?.g2p) {
            console.log(`[Phonetic All] Skipping ${token} - no G2P found`);
            continue;
          }
          
          if (existingWord.phonetic_en) {
            console.log(`[Phonetic All] Skipping ${token} - already has phonetic_en`);
            continue;
          }

          // Fetch existing senses (required for saveWordData)
          const existingSenses = await fetchSenses(token);
          
          // Use workflow coordinator for phonetic (enforces g2p dependency via schema)
          const workflow = getValidatedProcessingOrder();
          const context: PipelineContext = {
            word_th: token, // NOT textTh - matches wordThSchema.word_th
            g2p: existingWord.g2p, // Provide G2P from existing word
          };

          // Validate context before execution
          const validatedContext = pipelineContextSchema.safeParse(context);
          if (!validatedContext.success) {
            throw new Error(`Invalid context for token "${token}": ${validatedContext.error.message}`);
          }

          const { results, finalContext } = await executeStepsFromSchema(workflow, validatedContext.data, ['phonetic']);
          
          const phoneticResult = results.find(r => r.stepName === 'phonetic');
          if (!phoneticResult || !phoneticResult.success) {
            console.warn(`[Phonetic All] Failed to parse phonetic for ${token}: ${phoneticResult?.error?.message || 'Unknown error'}`);
            continue;
          }

          // Validate final context
          const validatedFinalContext = pipelineContextSchema.safeParse(finalContext);
          if (!validatedFinalContext.success) {
            throw new Error(`Workflow produced invalid final context for token "${token}": ${validatedFinalContext.error.message}`);
          }

          const phonetic_en = validatedFinalContext.data.phonetic_en;
          if (!phonetic_en) {
            console.warn(`[Phonetic All] Failed to parse phonetic for ${token}`);
            continue;
          }

          // Prepare word data with existing senses
          const wordDataToSave = {
            word_th: token, // Primary key - prevents duplicates
            g2p: existingWord.g2p, // Preserve existing G2P
            phonetic_en: phonetic_en,
            senses: existingSenses.length > 0 ? existingSenses.map(sense => ({
              id: typeof sense.id === 'bigint' ? sense.id : BigInt(sense.id),
              definition_th: sense.definition_th,
              source: sense.source,
              created_at: sense.created_at,
            })) : [{ // If no senses, create a placeholder
              id: BigInt(0),
              definition_th: 'Placeholder - needs ORST fetch',
              source: 'placeholder',
            }],
          };

          // Save updated word
          await saveWordData(wordDataToSave);
          console.log(`[Phonetic All] Updated phonetic_en for ${token}`);

          // Small delay for visual feedback
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          console.error(`[ERROR] Failed to process phonetic for ${token}:`, err);
          // Continue to next token
        }
      }

      // Refresh to show updated data
      await fetchSubtitles();
      // Refresh word data completeness for all tokens
      await refreshWordDataCompleteness();
      if (selectedToken) {
        const updatedWord = await fetchWord(selectedToken);
        // Validate before setting state
        const validatedUpdatedWord = updatedWord ? validateWord(updatedWord) : null;
        setWordData(validatedUpdatedWord);
        const updatedSenses = await fetchSenses(selectedToken);
        const validatedSenses = validateSenses(updatedSenses);
        setSenses(validatedSenses);
        updateWordDataCompleteness(selectedToken, validatedUpdatedWord);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('[ERROR] Failed during batch phonetic processing:', err);
      setError(`Phonetic processing failed: ${errorMessage}`);
      alert(`Phonetic processing failed: ${errorMessage}`);
    } finally {
      setProcessingPhonetic(false);
    }
  };

  /**
   * Process All - Complete workflow processing with skip detection
   * Processes: tokenize → G2P → phonetic → ORST → GPT normalize
   * Logs when steps are skipped because data already exists and passes Zod validation
   */
  const handleProcessAll = async () => {
    setError(null); // Clear previous errors
    
    // #region agent log - PROCESS ALL ENTRY
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'PROCESS ALL ENTRY',data:{processingSubtitle,processingG2P,processingPhonetic,processingAll,subtitlesLength:subtitles.length},timestamp:Date.now(),runId:'run1',hypothesisId:'PROCESS_ALL'})}).catch(()=>{});
    // #endregion
    
    if (processingSubtitle || processingG2P || processingPhonetic || processingAll || subtitles.length === 0) {
      // #region agent log - PROCESS ALL BLOCKED
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'PROCESS ALL BLOCKED',data:{processingSubtitle,processingG2P,processingPhonetic,processingAll,subtitlesLength:subtitles.length,reason:processingSubtitle ? 'processingSubtitle' : processingG2P ? 'processingG2P' : processingPhonetic ? 'processingPhonetic' : processingAll ? 'processingAll' : 'no_subtitles'},timestamp:Date.now(),runId:'run1',hypothesisId:'PROCESS_ALL'})}).catch(()=>{});
      // #endregion
      return;
    }

    setProcessingAll(true);
    // #region agent log - PROCESS ALL STARTING
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'PROCESS ALL STARTING',data:{subtitlesLength:subtitles.length},timestamp:Date.now(),runId:'run1',hypothesisId:'PROCESS_ALL'})}).catch(()=>{});
    // #endregion
    console.log('[Process All] ===== STARTING COMPLETE PROCESSING WORKFLOW =====');
    console.log('[Process All] Subtitles to process:', subtitles.length);

    try {
      // #region agent log - PROCESS ALL TRY BLOCK ENTERED
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'PROCESS ALL TRY BLOCK ENTERED',data:{},timestamp:Date.now(),runId:'run1',hypothesisId:'PROCESS_ALL'})}).catch(()=>{});
      // #endregion
      // #region agent log - PROCESS ALL GETTING WORKFLOW
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'PROCESS ALL GETTING WORKFLOW',data:{},timestamp:Date.now(),runId:'run1',hypothesisId:'PROCESS_ALL'})}).catch(()=>{});
      // #endregion
      let workflow;
      try {
        workflow = getValidatedProcessingOrder();
      } catch (workflowError) {
        // #region agent log - PROCESS ALL WORKFLOW ERROR
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'PROCESS ALL WORKFLOW ERROR',data:{errorMessage:workflowError instanceof Error ? workflowError.message : String(workflowError),errorStack:workflowError instanceof Error ? workflowError.stack?.substring(0,500) : undefined},timestamp:Date.now(),runId:'run1',hypothesisId:'PROCESS_ALL'})}).catch(()=>{});
        // #endregion
        throw workflowError;
      }
      // #region agent log - PROCESS ALL WORKFLOW RETRIEVED
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'PROCESS ALL WORKFLOW RETRIEVED',data:{workflowSteps:workflow.steps?.map((s:any)=>s.name) || []},timestamp:Date.now(),runId:'run1',hypothesisId:'PROCESS_ALL'})}).catch(()=>{});
      // #endregion
      let processedSubtitleCount = 0;
      let skippedSubtitleCount = 0;
      let processedTokenCount = 0;
      let skippedTokenCount = 0;
      const skipReasons: Record<string, number> = {};

      // STEP 1: Process all subtitles (tokenize)
      // #region agent log - PROCESS ALL STEP 1 START
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'PROCESS ALL STEP 1 START',data:{subtitlesToProcess:subtitles.length},timestamp:Date.now(),runId:'run1',hypothesisId:'PROCESS_ALL'})}).catch(()=>{});
      // #endregion
      console.log('[Process All] === STEP 1: Tokenizing Subtitles ===');

      const processedSubtitles: SubtitleTh[] = [];
      for (let i = 0; i < subtitles.length; i++) {
        // #region agent log - PROCESS ALL PROCESSING SUBTITLE
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'PROCESS ALL PROCESSING SUBTITLE',data:{subtitleIndex:i,subtitleId:subtitles[i]?.id,totalSubtitles:subtitles.length},timestamp:Date.now(),runId:'run1',hypothesisId:'PROCESS_ALL'})}).catch(()=>{});
        // #endregion
        const subtitle = subtitles[i];
        setCurrentSubtitleIndex(i);
        
        // Check if already has valid tokens_th
        const hasValidThaiTokens = subtitle.tokens_th && subtitle.tokens_th.tokens && subtitle.tokens_th.tokens.length > 0;
        
        if (hasValidThaiTokens) {
          // Validate existing tokens_th with Zod strict schema
          // Note: subtitleThSchema already has .strict() applied
          const validationResult = subtitleThSchema.safeParse(subtitle);
          if (validationResult.success) {
            skippedSubtitleCount++;
            skipReasons['subtitle_tokens_exist'] = (skipReasons['subtitle_tokens_exist'] || 0) + 1;
            processedSubtitles.push(validationResult.data);
            continue;
          } else {
            console.warn(`[Process All] ⚠ Subtitle ${subtitle.id}: tokens_th exists but fails Zod validation - reprocessing`);
          }
        }

        // Tokenize using workflow
        try {
          const context: PipelineContext = {
            thaiText: subtitle.thai,
          };

          // ⚠️ CRITICAL: Validate context before execution with strict schema
          const validatedContext = pipelineContextSchema.strict().safeParse(context);
          if (!validatedContext.success) {
            console.error(`[Process All] ✗ Invalid context for subtitle ${subtitle.id}:`, validatedContext.error.errors);
            throw new Error(`Invalid context for subtitle ${subtitle.id}: ${validatedContext.error.message}`);
          }

          const { results, finalContext } = await executeStepsFromSchema(workflow, validatedContext.data, ['tokenize']);
          

          // Validate final context
          const validatedFinalContext = pipelineContextSchema.safeParse(finalContext);
          if (!validatedFinalContext.success) {
            throw new Error(`Workflow produced invalid final context for subtitle ${subtitle.id}: ${validatedFinalContext.error.message}`);
          }
          
          const tokenizeResult = results.find(r => r.stepName === 'tokenize');
          if (!tokenizeResult || !tokenizeResult.success) {
            throw new Error(`Tokenization failed: ${tokenizeResult?.error?.message || 'Unknown error'}`);
          }

          const updatedSubtitle = {
            ...subtitle,
            tokens_th: finalContext.tokens_th,
          };
          
          // Validate tokenized subtitle
          const validationResult = subtitleThSchema.safeParse(updatedSubtitle);
          if (validationResult.success) {
            processedSubtitles.push(validationResult.data);
            processedSubtitleCount++;
            // #region agent log
            debugLog('SupabaseInspector.tsx:handleProcessAll','Subtitle tokenized successfully',{subtitleId:subtitle.id,tokenCount:finalContext.tokens_th?.tokens?.length || 0},'H1');
            // #endregion
          } else {
            console.error(`[STRICT PIPELINE]   Validation: FAIL`);
            console.error(`[STRICT PIPELINE]   Errors:`, validationResult.error.errors);
            console.error(`[Process All] ✗ Subtitle ${subtitle.id} validation failed after tokenization:`, validationResult.error.errors);
          }
        } catch (error) {
          console.error(`[Process All] ✗ Error tokenizing subtitle ${subtitle.id}:`, error);
        }
      }

      // Save updated subtitles
      // #region agent log - PROCESS ALL AFTER SUBTITLE LOOP
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'PROCESS ALL AFTER SUBTITLE LOOP',data:{processedSubtitleCount,skippedSubtitleCount,processedSubtitlesLength:processedSubtitles.length},timestamp:Date.now(),runId:'run1',hypothesisId:'PROCESS_ALL'})}).catch(()=>{});
      // #endregion
      if (processedSubtitleCount > 0) {
        await saveSubtitlesBatch(processedSubtitles);
        console.log(`[Process All] Saved ${processedSubtitleCount} tokenized subtitles`);
      }

      // STEP 2: Extract unique tokens and validate them
      // #region agent log - PROCESS ALL STEP 2 START
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'PROCESS ALL STEP 2 START',data:{processedSubtitlesLength:processedSubtitles.length},timestamp:Date.now(),runId:'run1',hypothesisId:'PROCESS_ALL'})}).catch(()=>{});
      // #endregion
      const uniqueTokens = new Set<string>();
      const invalidTokens: Array<{token: string, reason: string}> = [];
      
      // Helper to check if token contains invalid punctuation
      const hasInvalidPunctuation = (token: string): boolean => {
        // Check for common punctuation and Unicode punctuation that shouldn't be in tokens
        return /[()\-.,;:!?"'\[\]{}\u2026\u2014\u2013\u201C\u201D\u2018\u2019]/.test(token);
      };
      
      // Track tokens per subtitle for sync debugging
      const tokensBySubtitle = new Map<string, Array<{t: string, meaning_id?: bigint}>>(); // subtitleId -> tokens[]
      
      // #region agent log - PROCESS ALL TOKEN EXTRACTION LOOP START
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'PROCESS ALL TOKEN EXTRACTION LOOP START',data:{processedSubtitlesLength:processedSubtitles.length},timestamp:Date.now(),runId:'run1',hypothesisId:'PROCESS_ALL'})}).catch(()=>{});
      // #endregion
      try {
        for (const subtitle of processedSubtitles) {
        // #region agent log - PROCESS ALL TOKEN EXTRACTION LOOP ITERATION
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'PROCESS ALL TOKEN EXTRACTION LOOP ITERATION',data:{subtitleId:subtitle.id,hasTokensTh:!!subtitle.tokens_th,hasTokens:!!subtitle.tokens_th?.tokens,tokensLength:subtitle.tokens_th?.tokens?.length || 0},timestamp:Date.now(),runId:'run1',hypothesisId:'PROCESS_ALL'})}).catch(()=>{});
        // #endregion
        if (subtitle.tokens_th?.tokens) {
          const subtitleTokens: Array<{t: string, meaning_id?: bigint}> = [];
          // #region agent log - PROCESS ALL TOKEN EXTRACTION INNER LOOP START
          fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'PROCESS ALL TOKEN EXTRACTION INNER LOOP START',data:{subtitleId:subtitle.id,tokensCount:subtitle.tokens_th.tokens.length},timestamp:Date.now(),runId:'run1',hypothesisId:'PROCESS_ALL'})}).catch(()=>{});
          // #endregion
          for (const tokenItem of subtitle.tokens_th.tokens) {
            try {
              const tokenText = getTokenText(tokenItem);
              if (!tokenText) continue;
            
            const meaningId = tokenItem && typeof tokenItem === 'object' && 'meaning_id' in tokenItem 
              ? (tokenItem as any).meaning_id 
              : undefined;
            
            // Validate token - reject if it contains punctuation
            if (hasInvalidPunctuation(tokenText)) {
              invalidTokens.push({token: tokenText, reason: 'contains_punctuation', subtitleId: subtitle.id});
              // #region agent log - TOKEN SYNC
              const subtitleTokensForLog = subtitle.tokens_th.tokens.map((t: any) => {
                if (typeof t === 'string') return t;
                if (t && typeof t === 'object') return { t: t.t, meaning_id: t.meaning_id?.toString() };
                return t;
              });
              fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'TOKEN SYNC - Invalid token skipped',data:{token:tokenText,subtitleId:subtitle.id,reason:'contains_punctuation',subtitleTokens:subtitleTokensForLog},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_SYNC'})}).catch(()=>{});
              // #endregion
              console.warn(`[Process All] ⚠ Invalid token detected: "${tokenText}" contains punctuation - skipping`);
              continue; // Skip invalid tokens
            }
            uniqueTokens.add(tokenText);
            subtitleTokens.push({ t: tokenText, meaning_id: meaningId });
            } catch (tokenItemError) {
              // #region agent log - PROCESS ALL TOKEN EXTRACTION TOKEN ITEM ERROR
              fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'PROCESS ALL TOKEN EXTRACTION TOKEN ITEM ERROR',data:{subtitleId:subtitle.id,tokenItem,tokenItemType:typeof tokenItem,errorMessage:tokenItemError instanceof Error ? tokenItemError.message : String(tokenItemError)},timestamp:Date.now(),runId:'run1',hypothesisId:'PROCESS_ALL'})}).catch(()=>{});
              // #endregion
              console.error(`[Process All] Error processing token item in subtitle ${subtitle.id}:`, tokenItemError);
              continue; // Skip this token item and continue
            }
          }
          if (subtitleTokens.length > 0) {
            tokensBySubtitle.set(subtitle.id, subtitleTokens);
            // #region agent log - TOKEN SYNC
            const tokensForLog = subtitleTokens.map(t => ({ t: t.t, meaning_id: t.meaning_id?.toString() }));
            fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'TOKEN SYNC - Subtitle tokens extracted',data:{subtitleId:subtitle.id,tokenCount:subtitleTokens.length,tokens:tokensForLog,originalTokensCount:subtitle.tokens_th.tokens.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_SYNC'})}).catch(()=>{});
            // #endregion
          }
        }
      }
      } catch (tokenExtractionError) {
        // #region agent log - PROCESS ALL TOKEN EXTRACTION ERROR
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'PROCESS ALL TOKEN EXTRACTION ERROR',data:{errorMessage:tokenExtractionError instanceof Error ? tokenExtractionError.message : String(tokenExtractionError),errorStack:tokenExtractionError instanceof Error ? tokenExtractionError.stack?.substring(0,500) : undefined},timestamp:Date.now(),runId:'run1',hypothesisId:'PROCESS_ALL'})}).catch(()=>{});
        // #endregion
        throw tokenExtractionError;
      }
      
      if (invalidTokens.length > 0) {
        console.warn(`[Process All] ⚠ Found ${invalidTokens.length} invalid tokens with punctuation - these will be skipped`);
        console.warn(`[Process All] Invalid tokens:`, invalidTokens.map(t => t.token));
      }
      
      // #region agent log - PROCESS ALL TOKEN EXTRACTION COMPLETE
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'PROCESS ALL TOKEN EXTRACTION COMPLETE',data:{uniqueTokensCount:uniqueTokens.size,invalidTokensCount:invalidTokens.length,processedSubtitlesLength:processedSubtitles.length},timestamp:Date.now(),runId:'run1',hypothesisId:'PROCESS_ALL'})}).catch(()=>{});
      // #endregion
      console.log(`[Process All] === STEP 2: Processing ${uniqueTokens.size} Unique Tokens ===`);

      // STEP 3: Process each token (G2P → phonetic → ORST → GPT normalize)
      const tokensArray = Array.from(uniqueTokens);
      // #region agent log - PROCESS ALL STEP 3 START
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'PROCESS ALL STEP 3 START',data:{tokensArrayLength:tokensArray.length},timestamp:Date.now(),runId:'run1',hypothesisId:'PROCESS_ALL'})}).catch(()=>{});
      // #endregion
      
      // #region agent log - TOKEN SYNC
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'TOKEN SYNC - Starting token processing',data:{totalUniqueTokens:tokensArray.length,tokensArray:tokensArray.slice(0,20),subtitleCount:processedSubtitles.length,tokensBySubtitleCount:tokensBySubtitle.size},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_SYNC'})}).catch(()=>{});
      // #endregion
      
      for (let i = 0; i < tokensArray.length; i++) {
        const token = tokensArray[i];
        
        // Find subtitle containing this token for visual feedback
        // CRITICAL: Use full subtitles array (not processedSubtitles) to match UI display
        const subtitleIndex = subtitles.findIndex(sub => 
          tokensInclude(sub.tokens_th?.tokens, token)
        );
        
        // Find which subtitles contain this token (for sync debugging)
        const containingSubtitles = processedSubtitles.filter(sub => 
          sub.tokens_th?.tokens?.includes(token)
        ).map(sub => ({id: sub.id, index: subtitles.findIndex(s => s.id === sub.id)}));
        
        // #region agent log - TOKEN SYNC
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'TOKEN SYNC - Processing token',data:{token,tokenIndex:i+1,totalTokens:tokensArray.length,subtitleIndex:subtitleIndex >= 0 ? subtitleIndex : null,containingSubtitles,foundInSubtitles:containingSubtitles.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_SYNC'})}).catch(()=>{});
        // #endregion
        
        if (subtitleIndex >= 0) {
          setCurrentSubtitleIndex(subtitleIndex);
        }
        setSelectedToken(token);

        try {
          // Use shared token processing logic - same as Process Current Sub
          const currentSubtitle = subtitleIndex >= 0 ? processedSubtitles.find(sub => subtitles.findIndex(s => s.id === sub.id) === subtitleIndex) : null;
          
          // #region agent log - V3 PROCESS ALL CALLING PROCESS SINGLE TOKEN
          fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'V3 PROCESS ALL CALLING PROCESS SINGLE TOKEN',data:{token,tokenIndex:i+1,totalTokens:tokensArray.length,subtitleIndex:subtitleIndex >= 0 ? subtitleIndex : null,hasCurrentSubtitle:!!currentSubtitle},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
          // #endregion
          
          const result = await processSingleToken(
            token,
            { subtitle: currentSubtitle || null, subtitleIndex: subtitleIndex >= 0 ? subtitleIndex : null },
            workflow,
            {
              logPrefix: '[Process All]',
              skipReasons,
              onSkip: (reason) => {
                // #region agent log - TOKEN SYNC
                fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'TOKEN SYNC - Token skipped',data:{token,subtitleIndex:subtitleIndex >= 0 ? subtitleIndex : null,containingSubtitles,skipReason:reason},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_SYNC'})}).catch(()=>{});
                // #endregion
              },
              onProcess: () => {
                // Callback called after successful processing
              }
            }
          );
          
          // #region agent log - V3 PROCESS ALL PROCESS SINGLE TOKEN RESULT
          fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'V3 PROCESS ALL PROCESS SINGLE TOKEN RESULT',data:{token,tokenIndex:i+1,totalTokens:tokensArray.length,resultProcessed:result.processed,resultSkipped:result.skipped},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
          // #endregion

          if (result.skipped) {
            skippedTokenCount++;
          } else if (result.processed) {
            // #region agent log - TOKEN SYNC
            const finalWord = await fetchWord(token);
            const finalSenses = await fetchSenses(token);
            fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'TOKEN SYNC - Token processing completed successfully',data:{token,tokenIndex:i+1,totalTokens:tokensArray.length,subtitleIndex:subtitleIndex >= 0 ? subtitleIndex : null,containingSubtitles,hasFinalWord:!!finalWord,hasFinalSenses:!!finalSenses,finalSenseCount:finalSenses?.length || 0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_SYNC'})}).catch(()=>{});
            // #endregion
            processedTokenCount++;
          }

          // Small delay for visual feedback
          await new Promise(resolve => setTimeout(resolve, 50));

          // Small delay for visual feedback
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (error) {
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'EJECT - Error processing token, stopping Process All',data:{token,errorMessage:error instanceof Error ? error.message : String(error),errorStack:error instanceof Error ? error.stack?.substring(0,500) : undefined,processedTokens:processedTokenCount,skippedTokens:skippedTokenCount,currentTokenIndex:i+1,totalTokens:tokensArray.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'EJECT'})}).catch(()=>{});
          // #endregion
          console.error(`[Process All] ✗ Error processing token "${token}":`, error);
          // ⚠️ PROCESSING CONTRACT: Re-throw to stop processing on any error
          throw error;
        }
      }

      // Final summary with detailed skip statistics
      const totalTokens = processedTokenCount + skippedTokenCount;
      const skipRate = totalTokens > 0 ? ((skippedTokenCount / totalTokens) * 100).toFixed(1) : '0';
      // #region agent log - PROCESS ALL COMPLETE
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'PROCESS ALL COMPLETE',data:{processedSubtitleCount,skippedSubtitleCount,processedTokenCount,skippedTokenCount,totalTokens,skipRate,skipReasons},timestamp:Date.now(),runId:'run1',hypothesisId:'PROCESS_ALL'})}).catch(()=>{});
      // #endregion
      console.log('[Process All] ===== PROCESSING COMPLETE =====');
      console.log(`[Process All] Subtitles: ${processedSubtitleCount} processed, ${skippedSubtitleCount} skipped`);
      console.log(`[Process All] Tokens: ${processedTokenCount} processed, ${skippedTokenCount} skipped (${skipRate}% skip rate)`);
      console.log('[Process All] Skip reasons:', skipReasons);
      
      // TOKEN SYNC VERIFICATION: Compare subtitle tokens vs words in database
      // #region agent log - TOKEN SYNC
      const syncVerification: any[] = [];
      const syncErrors: any[] = [];
      let syncVerificationCount = 0;
      const maxSyncChecks = 50; // Limit sync verification to prevent timeout
      
      for (const subtitle of processedSubtitles) {
        if (syncVerificationCount >= maxSyncChecks) {
          // #region agent log - TOKEN SYNC
          fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'TOKEN SYNC - Sync verification limited',data:{maxSyncChecks,checkedSubtitles:syncVerificationCount,totalSubtitles:processedSubtitles.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_SYNC'})}).catch(()=>{});
          // #endregion
          break; // Stop verification to prevent timeout
        }
        
        if (subtitle.tokens_th?.tokens && subtitle.tokens_th.tokens.length > 0) {
          // Handle both formats: array of strings OR array of objects with {t, meaning_id}
          const subtitleTokens: string[] = [];
          if (subtitle.tokens_th?.tokens && Array.isArray(subtitle.tokens_th.tokens)) {
            for (const tokenItem of subtitle.tokens_th.tokens) {
              if (typeof tokenItem === 'string') {
                const trimmed = tokenItem.trim();
                if (trimmed) subtitleTokens.push(trimmed);
              } else if (tokenItem && typeof tokenItem === 'object' && 't' in tokenItem) {
                const tokenText = (tokenItem as any).t?.trim();
                if (tokenText) subtitleTokens.push(tokenText);
              }
            }
          }
          const wordsInSubtitle = new Set<string>();
          const fetchErrors: string[] = [];
          
          // Check which tokens from subtitle exist in words_th table
          for (const token of subtitleTokens) {
            try {
              const word = await fetchWord(token);
              if (word) {
                wordsInSubtitle.add(token);
              }
            } catch (e) {
              const errorMsg = e instanceof Error ? e.message : String(e);
              fetchErrors.push(`${token}: ${errorMsg}`);
              // #region agent log - TOKEN SYNC
              fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'TOKEN SYNC - Sync verification fetchWord error',data:{subtitleId:subtitle.id,token,error:errorMsg},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_SYNC'})}).catch(()=>{});
              // #endregion
            }
          }
          
          const missingTokens = subtitleTokens.filter(t => !wordsInSubtitle.has(t));
          const extraTokens = Array.from(wordsInSubtitle).filter(t => !subtitleTokens.includes(t));
          
          if (missingTokens.length > 0 || extraTokens.length > 0 || fetchErrors.length > 0) {
            syncVerification.push({
              subtitleId: subtitle.id,
              subtitleTokens: subtitleTokens,
              wordsInSubtitle: Array.from(wordsInSubtitle),
              missingTokens,
              extraTokens,
              fetchErrors,
              syncStatus: missingTokens.length === 0 && extraTokens.length === 0 && fetchErrors.length === 0 ? 'in_sync' : 'out_of_sync'
            });
          }
          
          syncVerificationCount++;
        }
      }
      
      if (syncVerification.length > 0) {
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'TOKEN SYNC - Sync verification complete',data:{outOfSyncSubtitles:syncVerification.length,totalSubtitles:processedSubtitles.length,checkedSubtitles:syncVerificationCount,syncVerification},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_SYNC'})}).catch(()=>{});
      } else {
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'TOKEN SYNC - All checked subtitles in sync',data:{totalSubtitles:processedSubtitles.length,checkedSubtitles:syncVerificationCount,allInSync:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_SYNC'})}).catch(()=>{});
      }
      // #endregion
      // #region agent log
      // Skip logging - successful completion
      // #endregion

      // Refresh UI - fetch fresh data from database (source of truth)
      const refreshedSubtitles = await fetchSubtitles();
      
      // CRITICAL: After refresh, restore currentSubtitleIndex based on selectedToken
      // This ensures the UI shows the correct subtitle that contains the token being processed
      // The database is the source of truth, so we find the subtitle from the refreshed data
      if (selectedToken && refreshedSubtitles.length > 0) {
        // Find subtitle containing the selected token in the refreshed subtitles (from DB)
        const subtitleIndex = refreshedSubtitles.findIndex(sub => 
          sub.tokens_th?.tokens?.includes(selectedToken)
        );
        if (subtitleIndex >= 0) {
          setCurrentSubtitleIndex(subtitleIndex);
        }
        
        const updatedWord = await fetchWord(selectedToken);
        const validatedUpdatedWord = updatedWord ? validateWord(updatedWord) : null;
        setWordData(validatedUpdatedWord);
        const updatedSenses = await fetchSenses(selectedToken);
        const validatedSenses = validateSenses(updatedSenses);
        setSenses(validatedSenses);
        updateWordDataCompleteness(selectedToken, validatedUpdatedWord);
      }
      
      // Refresh word data completeness for all tokens (after subtitle index is set)
      await refreshWordDataCompleteness();
    } catch (err) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'EJECT - FATAL ERROR, Process All stopped',data:{errorMessage:err instanceof Error ? err.message : String(err),errorStack:err instanceof Error ? err.stack?.substring(0,500) : undefined,processedSubtitles:processedSubtitleCount,skippedSubtitles:skippedSubtitleCount,processedTokens:processedTokenCount,skippedTokens:skippedTokenCount,skipReasons},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'EJECT'})}).catch(()=>{});
      // #endregion
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('[Process All] ✗ Fatal error:', err);
      setError(`Process All failed: ${errorMessage}`);
      alert(`Process All failed: ${errorMessage}`);
    } finally {
      // #region agent log - PROCESS ALL FINALLY BLOCK
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SupabaseInspector.tsx:handleProcessAll',message:'PROCESS ALL FINALLY BLOCK',data:{},timestamp:Date.now(),runId:'run1',hypothesisId:'PROCESS_ALL'})}).catch(()=>{});
      // #endregion
      setProcessingAll(false);
    }
  };


  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto">
        {error && (
          <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
            <strong>Error:</strong> {error}
          </div>
        )}
        {loading && (
          <div className="mb-4 p-4 bg-blue-100 border border-blue-400 text-blue-700 rounded">
            Loading subtitles...
          </div>
        )}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-4xl font-bold text-gray-900">Supabase Inspector</h1>
          <button
            onClick={() => {
              console.log('[DEBUG] ===== MANUAL REFRESH TRIGGERED =====');
              console.log('[DEBUG] Current React state before refresh:', {
                subtitlesCount: subtitles.length,
                currentIndex: currentSubtitleIndex,
                currentSubtitleId: subtitles[currentSubtitleIndex]?.id,
                allIds: subtitles.map((s) => s.id)
              });
              setRefreshKey(prev => prev + 1);
            }}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            🔄 Refresh (Fresh from DB)
          </button>
        </div>
        
        {/* Subtitles Display */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-gray-900">
              Subtitles ({subtitles.length})
            </h2>
            {subtitles.length > 0 && (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max={subtitles.length}
                    value={subtitleInputValue || currentSubtitleIndex + 1}
                    onChange={(e) => setSubtitleInputValue(e.target.value)}
                    onBlur={(e) => {
                      const numValue = parseInt(e.target.value, 10);
                      if (!isNaN(numValue) && numValue >= 1 && numValue <= subtitles.length) {
                        setCurrentSubtitleIndex(numValue - 1);
                        setSubtitleInputValue('');
                      } else {
                        setSubtitleInputValue('');
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const numValue = parseInt(subtitleInputValue, 10);
                        if (!isNaN(numValue) && numValue >= 1 && numValue <= subtitles.length) {
                          setCurrentSubtitleIndex(numValue - 1);
                          setSubtitleInputValue('');
                        } else {
                          setSubtitleInputValue('');
                        }
                        e.currentTarget.blur();
                      }
                    }}
                    className="w-16 px-2 py-1 text-sm text-gray-900 border border-gray-300 rounded text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-600">
                    of {subtitles.length}
                  </span>
                </div>
                <div className="flex gap-2">
                  {/* #region agent log - BUTTON RENDER CHECK */}
                  {(() => {
                    
                    return null;
                  })()}
                  {/* #endregion */}
                  <button
                    onClick={() => {
                      // Wrap around: if at beginning (0), go to end; otherwise go back one
                      const newIndex = currentSubtitleIndex === 0 
                        ? subtitles.length - 1 
                        : currentSubtitleIndex - 1;
                      setCurrentSubtitleIndex(newIndex);
                    }}
                    disabled={subtitles.length === 0}
                    className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={() => setCurrentSubtitleIndex(Math.min(subtitles.length - 1, currentSubtitleIndex + 1))}
                    disabled={currentSubtitleIndex === subtitles.length - 1}
                    className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    Next →
                  </button>
                  <button
                    onClick={handleTokenizeAll}
                    disabled={processingSubtitle || processingG2P || processingPhonetic || processingAll || subtitles.length === 0}
                    className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {processingSubtitle ? 'Tokenizing All...' : 'Tokenize All'}
                  </button>
                  <button
                    onClick={handleG2PAll}
                    disabled={processingSubtitle || processingG2P || processingPhonetic || processingAll || subtitles.length === 0}
                    className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {processingG2P ? 'Processing G2P All...' : 'G2P All'}
                  </button>
                  <button
                    onClick={handlePhoneticAll}
                    disabled={processingSubtitle || processingG2P || processingPhonetic || processingAll || subtitles.length === 0}
                    className="px-4 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {processingPhonetic ? 'Processing Phonetic EN All...' : 'Phonetic EN All'}
                  </button>
                  <button
                    onClick={handleProcessCurrentSubtitle}
                    disabled={processingSubtitle || processingG2P || processingPhonetic || processingAll || subtitles.length === 0}
                    className="px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {processingAll ? 'Processing Current Sub...' : 'Process Current Sub'}
                  </button>
                  <button
                    onClick={handleProcessAll}
                    disabled={processingSubtitle || processingG2P || processingPhonetic || processingAll || subtitles.length === 0}
                    className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:bg-gray-400 disabled:cursor-not-allowed font-bold"
                  >
                    {processingAll ? 'Processing All...' : 'Process All'}
                  </button>
                </div>
              </div>
            )}
          </div>
          {subtitles.length > 0 ? (
            <div className={`border-2 rounded-lg p-4 bg-gray-50 ${
              (() => {
                const subtitle = subtitles[currentSubtitleIndex];
                const subtitleTokens = subtitle?.tokens_th?.tokens || [];
                if (subtitleTokens.length === 0) return 'border-gray-300';
                // Extract token texts and check if all tokens have complete word data
                const tokenTexts = subtitleTokens.map(t => getTokenText(t)).filter((t): t is string => t !== null);
                const tokenCompleteness = tokenTexts.map((token: string) => ({
                  token,
                  inMap: wordExistsMap.has(token),
                  value: wordExistsMap.get(token),
                  isComplete: wordExistsMap.get(token) === true
                }));
                const allTokensComplete = tokenTexts.every((token: string) => {
                  return wordExistsMap.get(token) === true;
                });
                
                return allTokensComplete ? 'border-green-500' : 'border-red-500';
              })()
            }`}>
              {(() => {
                const subtitle = subtitles[currentSubtitleIndex];
                const subtitleTokens = subtitle?.tokens_th?.tokens || [];
                // #region agent log
                // Skip logging - routine render operation
                // #endregion
                const allTokensComplete = subtitleTokens.length > 0 && subtitleTokens.every((token: string) => {
                  return wordExistsMap.get(token) === true;
                });
                return (
                  <div className="space-y-2">
                    {subtitleTokens.length > 0 && (
                      <div className={`text-xs font-medium mb-2 ${
                        allTokensComplete ? 'text-green-700' : 'text-red-700'
                      }`}>
                        {allTokensComplete 
                          ? '✓ All tokens fully processed' 
                          : `⚠ ${subtitleTokens.filter((t: string) => wordExistsMap.get(t) !== true).length} token(s) need processing`}
                      </div>
                    )}
                    <div>
                      <span className="text-xs font-medium text-gray-600">ID:</span>
                      <p className="text-sm mt-1 text-gray-800 font-mono">{subtitle.id}</p>
                    </div>
                    {subtitle.thai && (
                      <div>
                        <span className="text-xs font-medium text-gray-600">Thai:</span>
                        <p className="text-sm mt-1 text-gray-800">{subtitle.thai}</p>
                      </div>
                    )}
                    {subtitle.start_sec_th !== undefined && subtitle.end_sec_th !== undefined && (
                      <div>
                        <span className="text-xs font-medium text-gray-600">Time:</span>
                        <p className="text-sm mt-1 text-gray-800 font-mono">
                          {subtitle.start_sec_th}s - {subtitle.end_sec_th}s
                        </p>
                      </div>
                    )}
                    {subtitle.tokens_th && subtitle.tokens_th.tokens && (
                      <div>
                        <span className="text-xs font-medium text-gray-600">Tokens:</span>
                        <p className="text-sm mt-1 text-gray-800 font-mono">
                          {subtitle.tokens_th.tokens.map(t => getTokenText(t)).filter((t): t is string => t !== null).join(', ')}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="text-sm text-gray-500">No subtitles found</div>
          )}
        </div>
        
        {/* Words Display */}
        {/* Key forces React to recreate component when subtitle changes */}
        <div key={`words-${subtitles[currentSubtitleIndex]?.id || currentSubtitleIndex}`} className="bg-white rounded-lg shadow p-6">
          {(() => {
            // Source of truth: compute tokens directly from current subtitle in render
            // CRITICAL: Read currentSubtitleIndex and subtitles fresh on every render
            const index = currentSubtitleIndex;
            const subs = subtitles;
            const currentSubtitle = subs[index];
            const rawTokens = currentSubtitle?.tokens_th?.tokens;
            // Handle both formats: array of strings OR array of objects with {t, meaning_id}
            const tokens: string[] = [];
            const tokenMeaningIds: Map<string, bigint | number> = new Map();
            
            if (rawTokens && Array.isArray(rawTokens)) {
              for (const tokenItem of rawTokens) {
                if (typeof tokenItem === 'string') {
                  const trimmed = tokenItem.trim();
                  if (trimmed) tokens.push(trimmed);
                } else if (tokenItem && typeof tokenItem === 'object' && 't' in tokenItem) {
                  const tokenText = (tokenItem as any).t?.trim();
                  const meaningId = (tokenItem as any).meaning_id;
                  if (tokenText) {
                    tokens.push(tokenText);
                    if (meaningId !== undefined && meaningId !== null) {
                      tokenMeaningIds.set(tokenText, meaningId);
                    }
                  }
                }
              }
            }
            
            // #region agent log
            // Skip logging - tokens computed correctly from subtitle source of truth
            // #endregion
            
            return (
              <>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">
                  Words ({tokens.length})
                </h2>
                {/* #region agent log */}
                {/* Tokens computed directly from subtitle[currentSubtitleIndex] - source of truth */}
                {/* #endregion */}

                {/* Token Tabs */}
                {tokens.length > 0 && (
                  <div className="border-b border-gray-300 mb-4">
                    <div className="flex overflow-x-auto gap-1">
                      {tokens.map((token, index) => {
                  const isSelected = selectedToken === token;
                  const hasCompleteWordData = wordExistsMap.get(token) ?? false;
                  const isFirstToken = index === 0;
                  const inMap = wordExistsMap.has(token);
                  
                  
                  
                  // Get label_eng from subtitle meaning_id (if token has been selected/assigned a meaning)
                  const labelFromSubtitle = tokenLabelMap.get(token);
                  
                  // Also check if this is the currently selected token with a selected meaning
                  const selectedSense = isSelected && selectedMeaning 
                    ? senses.find(s => s.id?.toString() === selectedMeaning.id?.toString())
                    : null;
                  const labelFromSelected = selectedSense ? (selectedSense as any)?.label_eng : null;
                  
                  // Prefer label from subtitle meaning_id (token has been assigned), fallback to selected meaning
                  const labelEng = labelFromSubtitle || labelFromSelected;
                  const hasLabel = labelEng && typeof labelEng === 'string' && labelEng.trim().length > 0;
                  const hasMeaningAssigned = !!labelFromSubtitle; // Token has meaning_id in subtitle
                  
                  return (
                    <button
                      key={token}
                      onClick={() => {
                        
                        setSelectedToken(token);
                      }}
                      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex-shrink-0 ${
                        isSelected
                          ? 'border-blue-500 text-blue-600 bg-blue-50'
                          : hasCompleteWordData
                          ? 'border-green-500 text-gray-600 hover:text-gray-800 hover:border-green-600'
                          : 'border-red-500 text-gray-600 hover:text-gray-800 hover:border-red-600'
                      } ${hasMeaningAssigned ? 'ring-1 ring-green-400' : ''}`}
                      title={hasCompleteWordData ? 'Word has complete data (id, word_th, g2p/phonetic_en)' : 'Word missing or incomplete data'}
                    >
                      <div className="flex flex-col items-center gap-0.5">
                        {hasLabel && (
                          <span className="text-xs text-gray-700 font-semibold leading-tight">{labelEng}</span>
                        )}
                        <span className="font-mono text-base leading-tight">{token}</span>
                        {hasMeaningAssigned && !hasLabel && (
                          <span className="text-[8px] text-green-600 leading-tight">✓</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Selected Token Data */}
          {selectedToken && (
            <div className="mt-4 bg-blue-50 p-4 rounded-lg border border-blue-200 space-y-4">
              {/* #region agent log */}
              {/* Skip logging - routine render operation */}
              {/* #endregion */}
              <div>
                <h4 className="text-sm font-semibold text-gray-800 mb-3">
                  Word: <span className="font-mono text-base">{selectedToken}</span>
                </h4>
                {wordData ? (
                  <div className="bg-white p-4 rounded border space-y-3">
                    <h5 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Word Data (from Zod schema)</h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                      <div className="border-b pb-2">
                        <span className="font-medium text-gray-600 block mb-1">word_th (Primary Key):</span>
                        <span className="text-gray-800">{wordData.word_th || '-'}</span>
                      </div>
                      <div className="border-b pb-2">
                        <span className="font-medium text-gray-600 block mb-1">g2p:</span>
                        <span className="font-mono text-gray-800">{wordData.g2p || '-'}</span>
                      </div>
                      <div className="border-b pb-2">
                        <span className="font-medium text-gray-600 block mb-1">phonetic_en:</span>
                        <span className="text-gray-800">{wordData.phonetic_en || '-'}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-yellow-50 p-4 rounded border border-yellow-200">
                    <p className="text-sm text-gray-700 mb-3">Word not found in words_th table</p>
                    <div className="bg-white p-4 rounded border space-y-3">
                      <h5 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Word Data (from Zod schema)</h5>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        <div className="border-b pb-2">
                          <span className="font-medium text-gray-600 block mb-1">id:</span>
                          <span className="font-mono text-gray-400">-</span>
                        </div>
                        <div className="border-b pb-2">
                          <span className="font-medium text-gray-600 block mb-1">word_th:</span>
                          <span className="text-gray-400">-</span>
                        </div>
                        <div className="border-b pb-2">
                          <span className="font-medium text-gray-600 block mb-1">g2p:</span>
                          <span className="font-mono text-gray-400">-</span>
                        </div>
                        <div className="border-b pb-2">
                          <span className="font-medium text-gray-600 block mb-1">phonetic_en:</span>
                          <span className="text-gray-400">-</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Meanings */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h5 className="text-sm font-semibold text-gray-700">
                    Meanings ({senses.length}) {senses.length > 0 && senses.some((s) => s.word_th_id) && (
                      <span className="text-xs text-green-600 ml-2">(Linked via word_th_id)</span>
                    )}
                  </h5>
                  <div className="flex gap-2">
                    <button
                      onClick={handleFetchOrst}
                      disabled={fetchingOrst || normalizingGPT}
                      className="text-xs px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                      style={{ display: 'block', visibility: 'visible' }}
                    >
                      {fetchingOrst ? 'Fetching ORST...' : 'Fetch ORST'}
                    </button>
                    {senses.length > 0 && (
                      <button
                        onClick={handleNormalizeGPT}
                        disabled={normalizingGPT || fetchingOrst}
                        className="text-xs px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                        style={{ display: 'block', visibility: 'visible' }}
                      >
                        {normalizingGPT ? 'Normalizing...' : 'Normalize with GPT'}
                      </button>
                    )}
                  </div>
                </div>
                {senses.length > 0 ? (
                  <div className="space-y-2">
                    {senses.map((sense, senseIdx: number) => {
                      if (!sense) return null;
                      // Green = normalized (source !== 'orst' or source === 'gpt'), Red = only ORST or missing source
                      const isNormalized = sense.source && sense.source !== 'orst' && sense.source !== 'ORST';
                      // Check if V2 fields are present (must be non-empty strings, not just truthy)
                      // Use type assertion to access V2/V3 fields since we have union type
                      const senseV2V3 = sense as any;
                      const hasPosTh = !!(senseV2V3.pos_th && senseV2V3.pos_th.trim().length > 0);
                      const hasPosEng = !!(senseV2V3.pos_eng && senseV2V3.pos_eng.trim().length > 0);
                      const hasDefinitionEng = !!(senseV2V3.definition_eng && senseV2V3.definition_eng.trim().length > 0);
                      const hasV2Fields = hasPosTh || hasPosEng || hasDefinitionEng;
                      const isV2Complete = hasPosTh && hasPosEng && hasDefinitionEng;
                      
                      // Check if V3 fields are present
                      const hasLabelEng = !!(senseV2V3.label_eng && senseV2V3.label_eng.trim().length > 0);
                      const isV3Complete = isV2Complete && hasLabelEng;
                      const isSelected = selectedMeaning === sense;
                      
                      // #region agent log - V2/V3 UI DISPLAY
                      debugLog('SupabaseInspector.tsx:render','V2/V3 UI DISPLAY',{
                        senseIndex:senseIdx,
                        hasPosTh,
                        hasPosEng,
                        hasDefinitionEng,
                        isV2Complete,
                        hasV2Fields,
                        hasLabelEng,
                        isV3Complete,
                        posThValue:senseV2V3.pos_th,
                        posEngValue:senseV2V3.pos_eng,
                        definitionEngValue:senseV2V3.definition_eng,
                        labelEngValue:senseV2V3.label_eng,
                        wordThId:sense.word_th_id
                      },'V3_ENRICH');
                      // #endregion
                      
                      return (
                        <div 
                          key={senseIdx} 
                          onClick={() => setSelectedMeaning(sense as MeaningThV2 | MeaningThV3)}
                          className={`bg-white p-3 rounded border-2 cursor-pointer transition-all ${
                            isSelected 
                              ? 'border-blue-600 ring-2 ring-blue-300' 
                              : isNormalized 
                              ? 'border-green-500 hover:border-green-600' 
                              : 'border-red-500 hover:border-red-600'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-gray-700">Meaning {senseIdx + 1}</span>
                            <div className="flex items-center gap-2">
                              {/* Show V3 badge if V3 fields exist */}
                              {hasLabelEng && (
                                <span className={`text-xs px-2 py-0.5 rounded ${
                                  isV3Complete ? 'bg-purple-100 text-purple-700' : 'bg-purple-50 text-purple-600'
                                }`}>
                                  V3 ✓
                                </span>
                              )}
                              {/* Show V2 badge only if V2 fields exist (not just schema support) */}
                              {hasV2Fields && (
                                <span className={`text-xs px-2 py-0.5 rounded ${
                                  isV2Complete ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'
                                }`}>
                                  {isV2Complete ? 'V2 ✓' : 'V2 ⚠'}
                                </span>
                              )}
                              <span className={`text-xs font-mono ${
                                isNormalized ? 'text-green-700' : 'text-red-700'
                              }`}>
                                {isNormalized ? '✓ Normalized' : '⚠ ORST only'}
                              </span>
                            </div>
                          </div>
                          {sense.definition_th && (
                            <p className="text-sm text-gray-800 mb-2">{sense.definition_th}</p>
                          )}
                          {/* V3 field - Show label_eng if present */}
                          {hasLabelEng && (
                            <div className="text-xs text-gray-700 mb-2 border-t pt-2 mt-2">
                              <span className="font-medium">English Word: </span>
                              <span className="font-semibold text-blue-700">{senseV2V3.label_eng}</span>
                            </div>
                          )}
                          {/* V2 fields - Always show section, indicate missing fields */}
                          <div className="text-xs text-gray-600 mb-1 border-t pt-2 mt-2">
                            <div className="mb-1">
                              <span className="font-medium">POS: </span>
                              {senseV2V3.pos_th ? (
                                <span>{senseV2V3.pos_th}</span>
                              ) : (
                                <span className="text-gray-400 italic">—</span>
                              )}
                              {senseV2V3.pos_th && senseV2V3.pos_eng && <span> / </span>}
                              {senseV2V3.pos_eng ? (
                                <span className="italic">({senseV2V3.pos_eng})</span>
                              ) : senseV2V3.pos_th ? (
                                <span className="text-gray-400 italic">(—)</span>
                              ) : null}
                            </div>
                            <div className="mb-1">
                              <span className="font-medium">Definition (EN): </span>
                              {senseV2V3.definition_eng ? (
                                <span className="italic">{senseV2V3.definition_eng}</span>
                              ) : (
                                <span className="text-gray-400 italic">—</span>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-3 text-xs text-gray-500 flex-wrap">
                            {sense.word_th_id && (
                              <span className="font-mono text-green-700 font-semibold">
                                word_th_id: {sense.word_th_id}
                              </span>
                            )}
                            {sense.source && <span>Source: {sense.source}</span>}
                            {sense.created_at && <span>Created: {new Date(sense.created_at).toLocaleDateString()}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-sm text-gray-500 italic bg-white p-3 rounded border-2 border-red-500">No meanings found</div>
                )}
              </div>
            </div>
          )}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
