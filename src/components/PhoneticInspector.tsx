/**
 * Phonetic Inspector Component
 * 
 * Displays a reference table of vowels found in the phonetic system.
 * Shows G2P patterns, phonetic parser outputs, and example words from the database.
 */

import { useEffect, useState, useRef } from 'react';
import { supabase } from '../supabase';
import { extractVowelPatterns } from '../utils/extractVowelPatterns';
import { getVowelParserOutput } from '../utils/getVowelParserOutput';
import { savePhoneticG2PRulesBatch, savePhoneticG2PRule, updatePhoneticG2PRuleEvidence, fetchPhoneticG2PRules, savePhoneticG2PEvidenceBatch, fetchPhoneticG2PEvidence, seedThaiVowels, checkSeededVowelsCount, deletePhoneticG2PRule } from '../supabase';
import { SEEDED_VOWEL_COUNT } from '../data/thaiVowelSeeds';
import { analyzePhoneticWithGPT, analyzeRuleVowelsWithGPT } from '../services/gpt/phoneticAnalysis';
import { comparePhonetics } from '../utils/phoneticComparison';
import { 
  usePhoneticG2PRules, 
  useWordsTh, 
  useWordsThWithG2P,
  usePhoneticG2PEvidence,
  useUpdatePhoneticG2PRuleEvidence,
  useSavePhoneticG2PEvidenceBatch,
  useSavePhoneticG2PRulesBatch,
  useSavePhoneticG2PRule,
} from '../hooks/usePhoneticData';
import {
  safeValidatePhoneticG2PRule,
  safeValidatePhoneticG2PEvidence,
  safeValidateVowelData,
  validateSeededVowelCount,
  vowelExampleSchema,
  phoneticG2PRuleSchema,
  phoneticG2PEvidenceSchema,
  vowelDataSchema,
  type PhoneticG2PRule,
  type PhoneticG2PEvidence,
  type VowelData as ValidatedVowelData,
} from '../schemas/phoneticInspectorSchema';
import { wordThSchema } from '../schemas/wordThSchema';

interface VowelExample {
  word_th: string;
  g2p: string;
  phonetic_en: string; // parser_phonetic
  // GPT fields (nullable until processed, loaded from evidence table)
  thai_vowel_label?: string | null;
  gpt_phonetic?: string | null;
}

interface VowelData {
  pattern: string;
  parserOutput: string;
  examples: VowelExample[];
}

export function PhoneticInspector() {
  
  // TanStack Query hooks for cached data fetching
  const { data: rulesData, isLoading: rulesLoading, error: rulesError, refetch: refetchRules } = usePhoneticG2PRules();
  
  const { data: wordsData, isLoading: wordsLoading } = useWordsTh();
  
  const { data: wordsWithG2PData } = useWordsThWithG2P();
  
  const { data: evidenceData, isLoading: evidenceLoading } = usePhoneticG2PEvidence();
  
  // Mutations for optimistic updates
  const updateEvidenceMutation = useUpdatePhoneticG2PRuleEvidence();
  const saveEvidenceBatchMutation = useSavePhoneticG2PEvidenceBatch();
  const saveRulesBatchMutation = useSavePhoneticG2PRulesBatch();
  const saveRuleMutation = useSavePhoneticG2PRule();
  

  const [vowelData, setVowelData] = useState<VowelData[]>([]);
  const [allRules, setAllRules] = useState<Array<{
    id: number;
    g2p_code: string;
    english_vowel: string | null;
    thai_vowel: string | null;
    phonetic_output: string | null;
    evidence: string | null;
  }>>([]);
  const [allEvidence, setAllEvidence] = useState<Array<{
    id: number;
    g2p_code: string;
    word_id: string;
    word_th: string;
    g2p: string | null;
    parser_phonetic: string | null;
    thai_vowel_label: string | null;
    gpt_phonetic: string | null;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedVowels, setExpandedVowels] = useState<Set<string>>(new Set());
  const [expandedEvidence, setExpandedEvidence] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [processingGPT, setProcessingGPT] = useState(false);
  const [gptProgress, setGptProgress] = useState<{ current: number; total: number; currentWord: string } | null>(null);
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [discoveringPatterns, setDiscoveringPatterns] = useState(false);
  const [enrichmentProgress, setEnrichmentProgress] = useState<{ current: number; total: number } | null>(null);
  const [processingRuleVowels, setProcessingRuleVowels] = useState(false); // Prevent concurrent GPT processing

  // Sync TanStack Query data to local state when it changes
  useEffect(() => {
    if (rulesData) {
      try {
        setAllRules(rulesData);
      } catch (err) {
        console.error('[PhoneticInspector] Error setting rules data:', err);
      }
    }
  }, [rulesData]);

  // CRITICAL: Initialize allRules immediately when rulesData is available (before loadInitialData runs)
  useEffect(() => {
    if (rulesData && rulesData.length > 0 && allRules.length === 0) {
      // Validate and set rules immediately so table shows data right away
      const validatedRules = rulesData
        .map(rule => safeValidatePhoneticG2PRule(rule))
        .filter((rule): rule is PhoneticG2PRule => rule !== null);
      if (validatedRules.length > 0) {
        setAllRules(validatedRules);
      }
    }
  }, [rulesData, allRules.length]);


  // Track if initialization has run to prevent multiple calls
  const initializationRef = useRef(false);
  const loadInitialDataRef = useRef(false);
  const initializeAndDiscoverRef = useRef(false);
  
  useEffect(() => {
    // Prevent multiple initializations
    if (initializationRef.current) {
      return;
    }
    
    initializationRef.current = true;
    
    // SIMPLE LOAD: Just pull data from database and display it
    // NO processing, NO GPT calls, NO token waste
    let isMounted = true;
    initializeAndDiscover().catch((err) => {
      if (isMounted) {
        console.error('[PhoneticInspector] Unhandled error in initializeAndDiscover:', err);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Expose fix function to window for console access
  useEffect(() => {
    (window as any).fixPhoneticNullableConstraint = async () => {
      console.log('[PhoneticInspector] Attempting to fix nullable constraint...');
      try {
        const { supabase } = await import('../supabase');
        // Try to call the RPC function if it exists
        const { data, error } = await supabase.rpc('fix_phonetic_g2p_rules_nullable');
        if (error) {
          if (error.message.includes('Could not find the function')) {
            console.error('❌ RPC function does not exist yet.');
            console.error('You need to run the SQL script first:');
            console.error('1. Go to: https://supabase.com/dashboard/project/gbsopnbovsxlstnmaaga/sql/new');
            console.error('2. Copy SQL from: scripts/fix-phonetic-g2p-rules-nullable-rpc.sql');
            console.error('3. Paste and click "Run"');
            console.error('4. Then run this function again: fixPhoneticNullableConstraint()');
            return { success: false, error: 'RPC function does not exist. Run SQL script first.' };
          }
          throw error;
        }
        console.log('✅ Constraint fixed successfully!', data);
        console.log('✅ Now try seeding again - refresh the page or call initializeAndDiscover()');
        return { success: true, data };
      } catch (err: any) {
        console.error('❌ Error:', err.message);
        return { success: false, error: err.message };
      }
    };
    return () => {
      delete (window as any).fixPhoneticNullableConstraint;
    };
  }, []);

  /**
   * Fast initial load - shows table immediately with rules + existing evidence
   * Uses TanStack Query cached data, validates with Zod schemas, returns immediately
   */
  async function loadInitialData() {
    // Prevent multiple calls - if already loaded, skip immediately
    if (loadInitialDataRef.current) {
      console.log('[PhoneticInspector] loadInitialData: Already loaded, skipping...');
      return;
    }
    
    // Mark as loading immediately to prevent duplicate calls
    loadInitialDataRef.current = true;
    
    console.log('[PhoneticInspector] loadInitialData: Starting fast initial load...', {
      rulesLoading,
      evidenceLoading,
      hasRulesData: !!rulesData,
      rulesDataLength: rulesData?.length || 0,
      hasEvidenceData: !!evidenceData,
      evidenceDataLength: evidenceData?.length || 0
    });
    
    try {
      // CRITICAL: Wait for TanStack Query data if still loading
      if (rulesLoading || evidenceLoading) {
        let waitCount = 0;
        while ((rulesLoading || evidenceLoading) && waitCount < 50) {
          await new Promise(resolve => setTimeout(resolve, 100));
          waitCount++;
        }
      }
      
      // Early exit if no rules data
      if (!rulesData || rulesData.length === 0) {
        console.log('[PhoneticInspector] loadInitialData: No rules data available yet', {
          rulesLoading,
          evidenceLoading,
          hasRulesData: !!rulesData,
          rulesDataLength: rulesData?.length || 0
        });
        setVowelData([]);
        setAllRules([]);
        return;
      }

      // Validate all rules using Zod schemas (skip invalid ones)
      const validationResults = rulesData.map(rule => {
        const result = safeValidatePhoneticG2PRule(rule);
        if (!result) {
        }
        return result;
      });
      const validatedRules = validationResults.filter((rule): rule is PhoneticG2PRule => rule !== null);
      
      

      // Early validation: Check seeded vowel count
      if (!validateSeededVowelCount(validatedRules, SEEDED_VOWEL_COUNT)) {
        const seededCount = validatedRules.filter(r => r.id >= 1 && r.id <= 31).length;
        console.warn(`[PhoneticInspector] loadInitialData: Expected ${SEEDED_VOWEL_COUNT} seeded vowels, got ${seededCount}`);
        // Continue with what we have - don't block
      }

      // Store validated rules (CRITICAL - this populates the table)
      setAllRules(validatedRules);

      // Validate and process evidence
      const evidenceValidationResults = (evidenceData || []).map(evidence => {
        const result = safeValidatePhoneticG2PEvidence(evidence);
        if (!result) {
        }
        return result;
      });
      const validatedEvidence = evidenceValidationResults.filter((evidence): evidence is PhoneticG2PEvidence => evidence !== null);
      
      setAllEvidence(validatedEvidence);
      

      // Group evidence by g2p_code
      const evidenceByPattern = new Map<string, PhoneticG2PEvidence[]>();
      validatedEvidence.forEach(e => {
        if (!evidenceByPattern.has(e.g2p_code)) {
          evidenceByPattern.set(e.g2p_code, []);
        }
        evidenceByPattern.get(e.g2p_code)!.push(e);
      });

      // Build VowelData from validated rules + evidence only (no word fetching)
      const vowelDataArray: VowelData[] = [];
      
      for (const rule of validatedRules) {
        const evidence = evidenceByPattern.get(rule.g2p_code) || [];
        
        // Convert evidence to VowelExample format
        const examples: VowelExample[] = evidence.map(e => ({
          word_th: e.word_th,
          g2p: e.g2p || '',
          phonetic_en: e.parser_phonetic || '',
          thai_vowel_label: e.thai_vowel_label || null,
          gpt_phonetic: e.gpt_phonetic || null,
        }));

        // Build VowelData
        const vowelData: VowelData = {
          pattern: rule.g2p_code,
          parserOutput: rule.phonetic_output || '',
          examples,
        };

        // Validate VowelData before adding
        const validatedVowelData = safeValidateVowelData(vowelData);
        if (validatedVowelData) {
          vowelDataArray.push(validatedVowelData);
        } else {
          console.warn(`[PhoneticInspector] loadInitialData: Skipping invalid VowelData for ${rule.g2p_code}`);
        }
      }


      // Set state immediately with validated data
      setVowelData(vowelDataArray);
      
      

      console.log(`[PhoneticInspector] loadInitialData: Loaded ${vowelDataArray.length} vowel patterns with ${vowelDataArray.reduce((sum, v) => sum + v.examples.length, 0)} examples`);
    } catch (err) {
      loadInitialDataRef.current = false; // Reset on error so it can retry
      console.error('[PhoneticInspector] loadInitialData: Error:', err);
      // Set empty data on error - don't block UI
      setVowelData([]);
    }
  }

  /**
   * REMOVED: enrichDataInBackground() - No longer called automatically
   * All processing operations are now button-triggered:
   * - Seeding vowels: handled manually if needed
   * - Pattern discovery: "Discover Patterns" button
   * - Word matching/evidence: "Load Examples" button  
   * - GPT processing: "Analyze Rules with GPT" button
   * - G2P code discovery: "Discover G2P Codes" button
   * - GPT evidence processing: "Process GPT Data" button
   * 
   * The load process now ONLY pulls data from the database and displays it.
   */

  async function loadExamplesForRules() {
    try {
      console.log('[PhoneticInspector] loadExamplesForRules: Starting to load examples...');

      if (!wordsData || wordsData.length === 0) {
        console.log('[PhoneticInspector] loadExamplesForRules: No words data available');
        return;
      }

      if (!rulesData || rulesData.length === 0) {
        console.log('[PhoneticInspector] loadExamplesForRules: No rules data available');
        return;
      }

      // Validate rules using Zod schemas
      const validatedRules = rulesData
        .map(rule => safeValidatePhoneticG2PRule(rule))
        .filter((rule): rule is PhoneticG2PRule => rule !== null);
      
      if (validatedRules.length === 0) {
        console.log('[PhoneticInspector] loadExamplesForRules: No valid rules after validation');
        return;
      }

      // Validate words using Zod schemas
      let wordValidationFailures = 0;
      const validatedWords = wordsData
        .map((word, index) => {
          const result = wordThSchema.safeParse(word);
          if (!result.success && index < 5) {
            wordValidationFailures++;
          }
          return result.success ? result.data : null;
        })
        .filter((word): word is NonNullable<typeof word> => word !== null);
      
      console.log(`[PhoneticInspector] loadExamplesForRules: Validated ${validatedWords.length} words (skipped ${wordsData.length - validatedWords.length} invalid)`);
      
      // Process rules in batches to update UI incrementally
      const rulesNeedingEvidence = validatedRules.filter(rule => {
        // Check if rule has evidence
        const hasEvidence = (evidenceData || []).some(e => e.g2p_code === rule.g2p_code);
        return !hasEvidence && rule.thai_vowel && rule.thai_vowel.trim() !== '';
      });

      setEnrichmentProgress({ current: 0, total: rulesNeedingEvidence.length });

      // Process in batches of 5
      const batchSize = 5;
      for (let i = 0; i < rulesNeedingEvidence.length; i += batchSize) {
        const batch = rulesNeedingEvidence.slice(i, i + batchSize);
        
        for (const rule of batch) {
          // Validate rule structure
          const validatedRule = safeValidatePhoneticG2PRule(rule);
          if (!validatedRule || !validatedRule.thai_vowel || !validatedRule.g2p_code) {
            continue; // Skip invalid rules
          }

          // Find matching words using thai_vowel pattern
          const regex = thaiVowelPatternToRegex(validatedRule.thai_vowel);
          const matchingWords = validatedWords.filter(word => {
            // Validate word before using
            const wordResult = wordThSchema.safeParse(word);
            if (!wordResult.success) return false;
            
            return regex.test(wordResult.data.word_th) && wordResult.data.g2p && wordResult.data.g2p.trim() !== '';
          }).slice(0, 10); // Limit to 10 examples per rule

          if (matchingWords.length > 0) {
            // Create evidence entries
            const evidenceEntries = matchingWords.map(word => {
              const wordResult = wordThSchema.safeParse(word);
              if (!wordResult.success) return null;
              
              const w = wordResult.data;
              const parserPhonetic = w.parser_phonetic || '';
              
              return {
                g2p_code: validatedRule.g2p_code,
                word_id: w.id,
                word_th: w.word_th,
                g2p: w.g2p || null,
                parser_phonetic: parserPhonetic || null,
                thai_vowel_label: null,
                gpt_phonetic: null,
              };
            }).filter((e): e is NonNullable<typeof e> => e !== null);

            // Validate evidence entries before saving
            const validatedEvidenceEntries = evidenceEntries
              .map(e => safeValidatePhoneticG2PEvidence(e as any))
              .filter((e): e is PhoneticG2PEvidence => e !== null);

            if (validatedEvidenceEntries.length > 0) {
              // Save evidence via TanStack Query mutation
              try {
                await saveEvidenceBatchMutation.mutateAsync(validatedEvidenceEntries as any);
                
                // Refetch evidence to update UI
                // Note: TanStack Query will auto-refetch on mutation success
              } catch (saveError) {
                console.warn(`[PhoneticInspector] loadExamplesForRules: Error saving evidence for ${validatedRule.g2p_code}:`, saveError);
              }
            }
          }

          // Update progress
          setEnrichmentProgress({ current: i + batch.indexOf(rule) + 1, total: rulesNeedingEvidence.length });
        }

        // Small delay between batches to avoid blocking
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      console.log('[PhoneticInspector] loadExamplesForRules: Complete');
    } catch (err) {
      console.error('[PhoneticInspector] loadExamplesForRules: Error:', err);
    } finally {
      setEnrichmentProgress(null);
    }
  }

  async function initializeAndDiscover() {
    // Prevent multiple calls - if already running, skip
    if (initializeAndDiscoverRef.current) {
      console.log('[PhoneticInspector] initializeAndDiscover: Already running, skipping...');
      return;
    }
    
    initializeAndDiscoverRef.current = true;
    
    try {
      setLoading(true);
      setError(null);

      // PHASE 1: Fast initial load - show table immediately
      console.log('[PhoneticInspector] Phase 1: Fast initial load...');
      
      // Wait for TanStack Query data to be available (CRITICAL - data must be loaded before display)
      let waitCount = 0;
      while ((rulesLoading || evidenceLoading) && waitCount < 100) {
        await new Promise(resolve => setTimeout(resolve, 100));
        waitCount++;
      }
      
      // Ensure we have data before proceeding
      if (!rulesData || rulesData.length === 0) {
        console.warn('[PhoneticInspector] No rules data available after waiting, will retry...');
        // Wait a bit more and check again
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      await loadInitialData();
      
      // Set loading to false immediately - user sees table now
      setLoading(false);
      console.log('[PhoneticInspector] Phase 1 complete - table visible with data from database');
      
      // NO AUTOMATIC PROCESSING - all operations are now button-triggered:
      // - Seeding vowels: handled by buttons if needed
      // - Pattern discovery: "Discover Patterns" button
      // - Word matching/evidence: "Load Examples" button
      // - GPT processing: "Analyze Rules with GPT" button
      // - G2P code discovery: "Discover G2P Codes" button
      // - GPT evidence processing: "Process GPT Data" button
    } catch (err) {
      // Reset ref on error so it can retry
      initializeAndDiscoverRef.current = false;
      console.error('[PhoneticInspector] Error during initialization:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  async function saveFindingsToDatabase(discoveredData: VowelData[]) {
    try {
      // First check if table exists by trying to fetch
      try {
        await fetchPhoneticG2PRules();
        // Table exists, proceed with save
        console.log('[PhoneticInspector] Table exists, saving findings...');
        // Clear error since table exists
        setError(null);
        await updateDatabaseWithData(discoveredData);
      } catch (tableError: any) {
        const errorMessage = tableError instanceof Error ? tableError.message : 'Unknown error';
        console.log('[PhoneticInspector] Table check failed:', errorMessage);
        
        // Table doesn't exist or RLS is blocking - try RPC function
        if (errorMessage.includes('not exist') || errorMessage.includes('schema cache') || errorMessage.includes('table') || errorMessage.includes('RLS') || errorMessage.includes('row-level')) {
          console.log('[PhoneticInspector] Attempting to create table via RPC function...');
          
          try {
            const { data, error: rpcError } = await supabase.rpc('setup_phonetic_g2p_rules_table');
            
            if (rpcError) {
              // RPC function doesn't exist - show setup instructions but keep discovered data visible
              console.log('[PhoneticInspector] RPC function not found');
              setError(`Table setup required: ${errorMessage}. Please run the SQL in Supabase Dashboard to create the table. Your findings (${discoveredData.length} patterns) are displayed below.`);
              return;
            }
            
            if (data?.success) {
              console.log('[PhoneticInspector] Table created successfully, saving findings...');
              // Clear error since table was created successfully
              setError(null);
              // Table was created, now save
              await updateDatabaseWithData(discoveredData);
            } else {
              console.error('[PhoneticInspector] RPC returned error:', data?.error);
              setError(`Table setup failed: ${data?.error || 'Unknown error'}. Your findings (${discoveredData.length} patterns) are displayed below.`);
            }
          } catch (rpcErr) {
            // RPC function doesn't exist - show setup instructions but keep discovered data visible
            console.log('[PhoneticInspector] RPC call failed');
            setError(`Table setup required: ${errorMessage}. Please run the SQL in Supabase Dashboard to create the table. Your findings (${discoveredData.length} patterns) are displayed below.`);
          }
        } else {
          // Other error
          setError(`Database error: ${errorMessage}. Your findings (${discoveredData.length} patterns) are displayed below.`);
        }
      }
    } catch (err) {
      console.error('[PhoneticInspector] Error saving to database:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(`Save error: ${errorMessage}. Your findings are displayed below.`);
    }
  }


  /**
   * Convert thai_vowel pattern with dashes to regex pattern
   * Dashes represent "any character" in the pattern
   * Examples:
   *   "–ะ" -> matches any char followed by "ะ"
   *   "เ–" -> matches "เ" followed by any char
   *   "–า" -> matches any char followed by "า"
   *   "ไ–" -> matches "ไ" followed by any char
   */
  function thaiVowelPatternToRegex(pattern: string): RegExp {
    
    // Escape special regex characters except dashes
    // Replace dashes with . (any character) in regex
    const regexPattern = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
      .replace(/[–\-]/g, '.'); // Replace dashes with . (any character)
    
    const regex = new RegExp(regexPattern);
    
    
    return regex;
  }

  async function discoverPatternsFromWords(): Promise<VowelData[]> {
    
    console.log('[PhoneticInspector] Starting pattern discovery from words_th...');
    
    // First, try to load existing rules from database to merge with discovered patterns
    let existingRules: Array<{
      id: number;
      english_vowel: string | null;
      thai_vowel: string | null;
      g2p_code: string;
      phonetic_output: string | null;
      evidence: string | null;
    }> = [];
    
    try {
      existingRules = await fetchPhoneticG2PRules();
      console.log(`[PhoneticInspector] Loaded ${existingRules.length} existing rules from database`);
    } catch (err) {
      // If table doesn't exist or is empty, that's fine - we'll create new records
      console.log('[PhoneticInspector] No existing rules found in database (table may not exist yet), will create new records');
    }

    // Separate seeded vowels (with SEED_ prefix) from discovered rules
    const seededVowelsMap = new Map<string, typeof existingRules[0]>();
    const existingMap = new Map<string, typeof existingRules[0]>();
    
      existingRules.forEach(rule => {
        // Check if this is a seeded vowel by ID (1-31), not by g2p_code prefix
        if (rule.id >= 1 && rule.id <= 31) {
          // Store by thai_vowel for matching
          if (rule.thai_vowel) {
            seededVowelsMap.set(rule.thai_vowel, rule);
          }
        }
        // Also check by g2p_code prefix for backwards compatibility (in case IDs are wrong)
        if (rule.g2p_code.startsWith('SEED_')) {
          if (rule.thai_vowel && !seededVowelsMap.has(rule.thai_vowel)) {
            seededVowelsMap.set(rule.thai_vowel, rule);
          }
        }
        // Store all rules by g2p_code for lookup
        existingMap.set(rule.g2p_code, rule);
      });
    
    console.log(`[PhoneticInspector] Found ${seededVowelsMap.size} seeded vowels and ${existingMap.size} discovered rules`);

    // Fetch ALL words from words_th (we'll match Thai script against patterns)
    console.log('[PhoneticInspector] Fetching all words from words_th...');
    const { data: allWords, error: fetchError } = await supabase
      .from('words_th')
      .select('word_th, g2p, phonetic_en');

    if (fetchError) {
      console.error('[PhoneticInspector] Error fetching words_th:', fetchError);
      throw new Error(`Failed to fetch words from words_th: ${fetchError.message}`);
    }

    console.log(`[PhoneticInspector] Fetched ${allWords?.length || 0} words from words_th`);

    if (!allWords || allWords.length === 0) {
      console.log('[PhoneticInspector] No words found in words_th');
      // If no words, return existing rules from database
      return existingRules.map((rule) => {
        let examples: VowelExample[] = [];
        try {
          if (rule.evidence) {
            const parsed = JSON.parse(rule.evidence);
            if (Array.isArray(parsed)) {
              examples = parsed;
            }
          }
        } catch {
          // If parsing fails, leave examples empty
        }
        return {
          pattern: rule.g2p_code,
          parserOutput: rule.phonetic_output || '', // EMPTY - user input field, not parser output
          examples,
        };
      });
    }

    // Get all rules with thai_vowel patterns
    const rulesWithThaiVowel = existingRules.filter(rule => rule.thai_vowel && rule.thai_vowel.trim());
    console.log(`[PhoneticInspector] Found ${rulesWithThaiVowel.length} rules with thai_vowel patterns to match`);

    // Map to store pattern -> examples
    const vowelMap = new Map<string, VowelExample[]>();

    // For each rule with a thai_vowel pattern, match words against it
    console.log('[PhoneticInspector] Matching Thai script against thai_vowel patterns...');

    for (const rule of rulesWithThaiVowel) {
      
      if (!rule.thai_vowel) {
        continue;
      }

      // Convert thai_vowel pattern to regex
      const regex = thaiVowelPatternToRegex(rule.thai_vowel);
      
      
      // Find words that match this pattern
      const matchingWords = allWords.filter(word => 
        word.word_th && regex.test(word.word_th)
      );


      if (matchingWords.length > 0) {
        // Initialize pattern if not exists
        if (!vowelMap.has(rule.g2p_code)) {
          vowelMap.set(rule.g2p_code, []);
        }

        const examples = vowelMap.get(rule.g2p_code)!;
        const beforeCount = examples.length;
        
        // Add matching words as examples (only include those with g2p/phonetic_en if available)
        for (const word of matchingWords) {
          // Avoid duplicates
          if (!examples.some(e => e.word_th === word.word_th)) {
            examples.push({
              word_th: word.word_th,
              g2p: word.g2p || '',
              phonetic_en: word.phonetic_en || '',
            });
          }
        }

        const afterCount = examples.length;
        const addedCount = afterCount - beforeCount;


        console.log(`[PhoneticInspector] Pattern "${rule.thai_vowel}" (${rule.g2p_code}) matched ${matchingWords.length} words, added ${addedCount} examples`);
      } else {
      }
    }

    // Also extract G2P patterns from words that have g2p data (fallback for rules without thai_vowel)
    const wordsWithG2P = allWords.filter(w => w.g2p && w.g2p.trim() && w.phonetic_en && w.phonetic_en.trim()) as Array<{ word_th: string; g2p: string; phonetic_en: string }>;
    
    
    let g2pPatternsFound = 0;
    for (const word of wordsWithG2P) {
      const patterns = extractVowelPatterns(word.g2p);
      
      for (const pattern of patterns) {
        if (!vowelMap.has(pattern)) {
          vowelMap.set(pattern, []);
          g2pPatternsFound++;
        }
        
        const examples = vowelMap.get(pattern)!;
        if (!examples.some(e => e.word_th === word.word_th)) {
          examples.push({
            word_th: word.word_th,
            g2p: word.g2p,
            phonetic_en: word.phonetic_en,
          });
        }
      }
    }



    console.log(`[PhoneticInspector] Discovered ${vowelMap.size} unique vowel patterns`);

    // Convert map to array of VowelData
    // Merge with existing database rules (preserve vowel names from database)
    const vowelDataArray: VowelData[] = Array.from(vowelMap.entries())
      .map(([pattern, examples]) => {
        const existing = existingMap.get(pattern);
        return {
          pattern, // g2p_code - the key
          parserOutput: existing?.phonetic_output || '', // EMPTY - user input field, not parser output
          examples,
        };
      })
      // Sort by pattern (g2p_code) for consistent display
      .sort((a, b) => a.pattern.localeCompare(b.pattern));

    return vowelDataArray;
  }

  /**
   * Discover G2P patterns from words_th by matching Thai vowels
   * Uses Thai word text as connective tissue: find words containing seeded Thai vowel characters,
   * then extract G2P patterns from those words and map them to the seeded vowels
   */
  async function discoverAndMapPatterns(): Promise<void> {
    console.log('[PhoneticInspector] Starting pattern discovery using Thai word matching...');
    setDiscoveringPatterns(true);
    try {
      // Fetch seeded vowels by ID (1-31) - CRITICAL: Don't use g2p_code prefix since it can change
      const { data: seededRules, error: rulesError } = await supabase
        .from('phonetic_g2p_rules')
        .select('id, g2p_code, thai_vowel')
        .in('id', Array.from({ length: 31 }, (_, i) => i + 1))
        .order('id');


      if (rulesError) {
        console.warn('[PhoneticInspector] Could not fetch seeded rules:', rulesError.message);
        return;
      }

      if (!seededRules || seededRules.length === 0) {
        console.log('[PhoneticInspector] No seeded vowels found to map');
        return;
      }

      console.log(`[PhoneticInspector] Found ${seededRules.length} seeded vowels to map`);

      // Fetch all words with G2P data
      const { data: words, error: wordsError } = await supabase
        .from('words_th')
        .select('word_th, g2p')
        .not('g2p', 'is', null);


      if (wordsError) {
        console.warn('[PhoneticInspector] Could not fetch words:', wordsError.message);
        return;
      }

      if (!words || words.length === 0) {
        console.log('[PhoneticInspector] No words with G2P data found');
        return;
      }

      console.log(`[PhoneticInspector] Scanning ${words.length} words to match Thai vowels...`);

      // For each seeded vowel, find words containing that Thai vowel character
      const updates: Array<{
        id: number;
        g2p_code: string;
        thai_vowel: string; // PRESERVE thai_vowel from seed
        evidence: string;
        phonetic_output: string; // EMPTY - user input field
      }> = [];

      for (const seededRule of seededRules) {
        
        if (!seededRule.thai_vowel) {
          continue;
        }

        // Extract the actual Thai vowel characters (remove dashes/placeholders for matching)
        // e.g., "–ะ" -> "ะ", "เ–" -> "เ", "ไ–" -> "ไ"
        const thaiVowelChars = seededRule.thai_vowel.replace(/[–\-]/g, '').trim();
        
        
        if (!thaiVowelChars) {
          continue;
        }

        // Find words that contain this Thai vowel character
        
        const matchingWords = words.filter(word => 
          word.word_th && word.word_th.includes(thaiVowelChars)
        );


        if (matchingWords.length === 0) {
          console.log(`[PhoneticInspector] No words found containing Thai vowel "${seededRule.thai_vowel}" (ID ${seededRule.id}) - keeping SEED_ entry`);
          continue;
        }

        console.log(`[PhoneticInspector] Found ${matchingWords.length} words containing "${seededRule.thai_vowel}"`);

        // Extract G2P patterns from matching words
        
        const patternCounts = new Map<string, number>();
        const patternExamples = new Map<string, Array<{ word_th: string; g2p: string }>>();

        for (const word of matchingWords) {
          if (!word.g2p) continue;
          const patterns = extractVowelPatterns(word.g2p);
          
          for (const pattern of patterns) {
            patternCounts.set(pattern, (patternCounts.get(pattern) || 0) + 1);
            
            if (!patternExamples.has(pattern)) {
              patternExamples.set(pattern, []);
            }
            const examples = patternExamples.get(pattern)!;
            if (!examples.some(e => e.word_th === word.word_th)) {
              examples.push({ word_th: word.word_th, g2p: word.g2p });
            }
          }
        }


        // Find the most common pattern (most likely match for this Thai vowel)
        let bestPattern: string | null = null;
        let bestCount = 0;

        for (const [pattern, count] of patternCounts.entries()) {
          // Skip SEED_ patterns
          if (pattern.startsWith('SEED_')) continue;
          
          if (count > bestCount) {
            bestCount = count;
            bestPattern = pattern;
          }
        }


        if (bestPattern) {
          const examples = patternExamples.get(bestPattern) || [];
          // Store evidence: list of example words that contain this Thai vowel and have this G2P pattern
          const evidenceWords = examples.slice(0, 20).map(e => e.word_th); // Get up to 20 examples
          const evidence = JSON.stringify(evidenceWords);

          console.log(`[PhoneticInspector] Mapping "${seededRule.thai_vowel}" (ID ${seededRule.id}) to G2P pattern "${bestPattern}"`);
          console.log(`[PhoneticInspector]   Found in ${bestCount} words, evidence: ${evidenceWords.slice(0, 5).join(', ')}${evidenceWords.length > 5 ? '...' : ''}`);


          updates.push({
            id: seededRule.id,
            g2p_code: bestPattern,
            thai_vowel: seededRule.thai_vowel, // PRESERVE thai_vowel from seed
            evidence,
            phonetic_output: '', // EMPTY - user input field, not parser output
          });
        } else {
          console.log(`[PhoneticInspector] No G2P pattern found for "${seededRule.thai_vowel}" (ID ${seededRule.id}) - keeping SEED_ entry`);
          
          // Even if no pattern found, update evidence with words that contain this Thai vowel
          // This helps with future pattern discovery
          const allMatchingWords = matchingWords.slice(0, 20).map(w => w.word_th);
          if (allMatchingWords.length > 0) {
            const evidence = JSON.stringify(allMatchingWords);
            // Update the SEED_ entry with evidence even if no pattern mapped
            const seededRuleForUpdate = seededRules.find(r => r.id === seededRule.id);
            if (seededRuleForUpdate) {
              
              // CRITICAL: For seeded vowels (IDs 1-31), always preserve hardcoded thai_vowel
              const { THAI_VOWEL_SEEDS } = await import('../data/thaiVowelSeeds');
              const hardcodedThaiVowel = seededRule.id >= 1 && seededRule.id <= 31 
                ? THAI_VOWEL_SEEDS[seededRule.id - 1]?.thai_vowel 
                : seededRule.thai_vowel;
              
              const { error: updateError } = await supabase
                .from('phonetic_g2p_rules')
                .update({
                  thai_vowel: hardcodedThaiVowel || seededRule.thai_vowel, // CRITICAL: Always preserve hardcoded value
                  evidence,
                })
                .eq('id', seededRule.id);
              
              
              if (!updateError) {
                console.log(`[PhoneticInspector] Updated evidence for "${seededRule.thai_vowel}" (ID ${seededRule.id}) with ${allMatchingWords.length} example words`);
              }
            }
          }
        }
      }

      // Update seeded rules with discovered G2P codes
      
      if (updates.length > 0) {
        console.log(`[PhoneticInspector] Updating ${updates.length} seeded vowels with discovered G2P patterns...`);
        
        // Get all existing rules to check for conflicts
        const existingRules = await fetchPhoneticG2PRules();
        
        
        const existingG2pCodes = new Set(existingRules.map(r => r.g2p_code));
        
        // Prepare batch updates: replace SEED_ entries with actual g2p_code, preserving IDs
        const rulesToUpdate: Array<{
          id: number;
          g2p_code: string;
          thai_vowel: string;
          english_vowel: string;
          phonetic_output: string;
          evidence: string;
        }> = [];
        
        // Also track which g2p_codes are being used for seeded vowels
        const seededG2pCodes = new Set<string>();
        
        for (const update of updates) {
          
          const seededRule = seededRules.find(r => r.id === update.id);
          if (!seededRule || !seededRule.thai_vowel) {
            continue;
          }
          
          // Check if this g2p_code is already used by another seeded vowel
          if (seededG2pCodes.has(update.g2p_code)) {
            console.warn(`[PhoneticInspector] G2P code "${update.g2p_code}" already mapped to another seeded vowel, skipping ID ${update.id}`);
            continue;
          }
          
          seededG2pCodes.add(update.g2p_code);
          
          // If g2p_code already exists (from previous discovery), we'll update it with the seeded thai_vowel
          // Otherwise, we'll insert new with the seeded ID
          const existingRule = existingRules.find(r => r.g2p_code === update.g2p_code);
          
          if (existingRule && existingRule.id !== update.id) {
            // Conflict: this g2p_code exists with a different ID
            // Delete the old one and create new with seeded ID
            console.log(`[PhoneticInspector] G2P code "${update.g2p_code}" exists with ID ${existingRule.id}, replacing with seeded ID ${update.id}`);
            await deletePhoneticG2PRule(update.g2p_code);
          }
          
          rulesToUpdate.push({
            id: update.id,
            g2p_code: update.g2p_code,
            thai_vowel: update.thai_vowel || seededRule.thai_vowel, // PRESERVE thai_vowel from seed
            english_vowel: existingRule?.english_vowel || '', // EMPTY - will be filled by GPT based on thai_vowel
            phonetic_output: '', // EMPTY - user input field, not parser output
            evidence: update.evidence || existingRule?.evidence || '',
          });
          
        }
        
        // Batch insert/update with explicit IDs - process in order to preserve IDs 1-31
        if (rulesToUpdate.length > 0) {
          // Sort by ID to process in order (1, 2, 3, ...)
          rulesToUpdate.sort((a, b) => a.id - b.id);
          
          console.log(`[PhoneticInspector] Processing ${rulesToUpdate.length} mappings, IDs: ${rulesToUpdate.map(r => r.id).join(', ')}`);
          
          for (const rule of rulesToUpdate) {
            console.log(`[PhoneticInspector] Processing ID ${rule.id} (${rule.g2p_code})...`);
            
            const seedCode = `SEED_${String(rule.id).padStart(2, '0')}`;
            
            // Check if ID exists first
            
            const { data: existingById } = await supabase
              .from('phonetic_g2p_rules')
              .select('id, g2p_code')
              .eq('id', rule.id)
              .single();
            
            
            if (!existingById) {
              console.error(`[PhoneticInspector] CRITICAL: ID ${rule.id} doesn't exist! Skipping to preserve data integrity.`);
              continue; // Skip - don't try to create it here, let seeding handle it
            }
            
            // Store the original g2p_code before update (for SEED_ deletion check)
            const originalG2pCode = existingById.g2p_code;
            
            // Delete any existing record with this g2p_code (if it has different ID) FIRST
            // Refresh existingRules to get latest state after previous deletions
            const { data: freshRules } = await supabase
              .from('phonetic_g2p_rules')
              .select('id, g2p_code');
            const freshRulesList = freshRules || [];
            const existingWithG2p = freshRulesList.find(r => r.g2p_code === rule.g2p_code && r.id !== rule.id);
            
            if (existingWithG2p) {
              console.log(`[PhoneticInspector] Deleting existing entry with g2p_code "${rule.g2p_code}" (ID ${existingWithG2p.id}) to replace with seeded ID ${rule.id}`);
              await deletePhoneticG2PRule(rule.g2p_code);
            }
            
            // Now update the existing ID (this preserves ID 1-31)
            console.log(`[PhoneticInspector] Updating ID ${rule.id} (current: ${originalG2pCode}) -> ${rule.g2p_code}...`);
            
            // CRITICAL: For seeded vowels (IDs 1-31), always use hardcoded thai_vowel from seed data
            const { THAI_VOWEL_SEEDS } = await import('../data/thaiVowelSeeds');
            const hardcodedThaiVowel = rule.id >= 1 && rule.id <= 31 
              ? THAI_VOWEL_SEEDS[rule.id - 1]?.thai_vowel 
              : rule.thai_vowel;
            
            if (!hardcodedThaiVowel && rule.id >= 1 && rule.id <= 31) {
              console.error(`[PhoneticInspector] CRITICAL: No hardcoded thai_vowel found for ID ${rule.id}`);
            }
            
            // CRITICAL: Preserve existing user data - fetch current rule to preserve phonetic_output and english_vowel
            const { data: currentRule } = await supabase
              .from('phonetic_g2p_rules')
              .select('phonetic_output, english_vowel')
              .eq('id', rule.id)
              .single();
            
            // Preserve existing values - only update if empty
            const existingPhoneticOutput = currentRule?.phonetic_output || '';
            const existingEnglishVowel = currentRule?.english_vowel || '';
            
            
            // CRITICAL: Preserve existing evidence from database, but UPDATE g2p_code if it's a SEED_ code
            const { data: currentRuleForPersistence } = await supabase
              .from('phonetic_g2p_rules')
              .select('g2p_code, evidence')
              .eq('id', rule.id)
              .single();
            
            // Use discovered g2p_code if current is SEED_, otherwise preserve existing (already discovered)
            const existingG2pCode = currentRuleForPersistence?.g2p_code;
            const isSeedCode = existingG2pCode?.startsWith('SEED_');
            const finalG2pCode = isSeedCode ? rule.g2p_code : (existingG2pCode || rule.g2p_code); // UPDATE if SEED_, preserve if already discovered
            
            // Preserve existing evidence if it exists (don't overwrite with empty)
            const existingEvidence = currentRuleForPersistence?.evidence || rule.evidence || null;
            
            
            
            const { error: updateError, data: updateData } = await supabase
              .from('phonetic_g2p_rules')
              .update({
                g2p_code: finalG2pCode, // UPDATE if SEED_, preserve if already discovered
                thai_vowel: hardcodedThaiVowel || rule.thai_vowel, // CRITICAL: Always use hardcoded value for IDs 1-31
                english_vowel: existingEnglishVowel || rule.english_vowel || '', // PRESERVE existing, or use discovered, or empty
                phonetic_output: existingPhoneticOutput, // PRESERVE existing user input
                evidence: existingEvidence, // PRESERVE existing evidence (don't overwrite)
              })
              .eq('id', rule.id)
              .select();
            
            
            if (updateError) {
              console.error(`[PhoneticInspector] CRITICAL: Failed to update ID ${rule.id}: ${updateError.message}`);
              // Don't delete SEED_ if update failed - keep the original entry
              console.log(`[PhoneticInspector] Keeping original entry for ID ${rule.id} due to update failure`);
            } else {
              console.log(`[PhoneticInspector] ✓ Successfully updated ID ${rule.id} with g2p_code ${rule.g2p_code}`);
              // Always try to delete SEED_ entry if the original was a SEED_ code
              // This handles the case where ID 1 had SEED_01 and we updated it to 'aa'
              // The SEED_01 entry should be deleted (though it might already be gone if g2p_code is PK)
              if (originalG2pCode === seedCode || originalG2pCode.startsWith('SEED_')) {
                try {
                  // Try to delete by the original seed code
                  await deletePhoneticG2PRule(seedCode);
                  console.log(`[PhoneticInspector] Deleted ${seedCode} after successful update`);
                } catch (err) {
                  // Ignore - might already be deleted (e.g., if g2p_code is PK and update replaced it)
                  console.log(`[PhoneticInspector] Note: ${seedCode} deletion skipped (likely already replaced by update)`);
                }
              } else {
              }
            }
          }
          
          console.log(`[PhoneticInspector] Successfully mapped ${rulesToUpdate.length} Thai vowels to G2P patterns`);
          
          // CRITICAL: Refetch rules to ensure UI shows saved g2p_code
          console.log('[PhoneticInspector] discoverAndMapPatterns: Refetching rules after save...');
          const beforeRefetch = await fetchPhoneticG2PRules();
          console.log('[PhoneticInspector] discoverAndMapPatterns: BEFORE refetch - sample saved data:', {
            sampleRules: rulesToUpdate.slice(0, 3).map(r => ({
              id: r.id,
              g2p_code: r.g2p_code,
              evidence: r.evidence ? JSON.parse(r.evidence).slice(0, 3) : null,
              evidenceLength: r.evidence?.length || 0
            }))
          });
          await refetchRules();
          const afterRefetch = await fetchPhoneticG2PRules();
          console.log('[PhoneticInspector] discoverAndMapPatterns: AFTER refetch - persistence verification:', {
            beforeCount: beforeRefetch.length,
            afterCount: afterRefetch.length,
            sampleLoaded: afterRefetch.filter(r => rulesToUpdate.some(u => u.id === r.id)).slice(0, 3).map(r => ({
              id: r.id,
              g2p_code: r.g2p_code,
              evidence: r.evidence ? JSON.parse(r.evidence).slice(0, 3) : null,
              evidenceLength: r.evidence?.length || 0
            }))
          });
        }
      } else {
        console.log('[PhoneticInspector] No patterns mapped (no matches found)');
      }
      
      // CRITICAL: Do NOT create additional patterns - only the 31 seeded vowels should exist
      // All discovered patterns should only UPDATE the existing seeded vowels, never create new records
      console.log('[PhoneticInspector] Skipping additional pattern discovery - only 31 seeded vowels allowed');
      
    } catch (err) {
      console.error('[PhoneticInspector] Error in pattern discovery:', err);
      // Don't throw - this is non-critical
    } finally {
      setDiscoveringPatterns(false);
      await refetchRules();
    }
  }

  async function loadVowelData() {
    try {
      setLoading(true);
      setError(null);
      console.log('[PhoneticInspector] Manual discovery triggered...');
      const discoveredData = await discoverPatternsFromWords();
      console.log(`[PhoneticInspector] Discovered ${discoveredData.length} patterns`);
      try {
        setVowelData(discoveredData);
      } catch (err) {
        throw err;
      }
      
      // Also try to save to database
      if (discoveredData.length > 0) {
        await saveFindingsToDatabase(discoveredData);
      }
    } catch (err) {
      console.error('[PhoneticInspector] Error loading vowel data:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function loadFromDatabase() {
    console.log('[PhoneticInspector] loadFromDatabase: Starting...');
    try {
      // Don't set loading state here - caller manages it
      setError(null);

      // Use cached rules from TanStack Query (faster, no redundant fetches)
      console.log('[PhoneticInspector] loadFromDatabase: Using cached rules...');
      
      // Use cached rules if available, otherwise fetch directly (fallback)
      let rules = rulesData || [];
      if (!rulesData || rulesData.length === 0) {
        // Fallback: fetch directly if cache is empty
        rules = await fetchPhoneticG2PRules();
        // Refetch to populate cache
        await refetchRules();
      }
      
      console.log('[PhoneticInspector] loadFromDatabase: Using rules', { 
        ruleCount: rules.length,
        seededCount: rules.filter(r => r.id >= 1 && r.id <= 31).length,
        seededIds: rules.filter(r => r.id >= 1 && r.id <= 31).map(r => `${r.g2p_code}:id=${r.id}`),
        usedCache: !!rulesData
      });
      
      // Store raw rules for direct Supabase table display
      setAllRules(rules);

      if (rules.length === 0) {
        console.log('[PhoneticInspector] loadFromDatabase: No rules found, discovering from words_th...');
        // If no rules, discover from words_th and save
        const discoveredData = await discoverPatternsFromWords();
        console.log('[PhoneticInspector] loadFromDatabase: Discovered patterns', { patternCount: discoveredData.length });
        if (discoveredData.length > 0) {
          await saveFindingsToDatabase(discoveredData);
          // Reload after saving
          return await loadFromDatabase();
        }
        console.log('[PhoneticInspector] loadFromDatabase: No patterns discovered, setting empty data');
        try {
          setVowelData([]);
        } catch (err) {
          throw err;
        }
        return;
      }

      // Load evidence from phonetic_g2p_evidence table
      console.log('[PhoneticInspector] loadFromDatabase: Fetching evidence...');
      let allEvidence: Array<{
        id: number;
        g2p_code: string;
        word_id: string;
        word_th: string;
        g2p: string | null;
        parser_phonetic: string | null;
        thai_vowel_label: string | null;
        gpt_phonetic: string | null;
      }> = [];
      
      try {
        allEvidence = await fetchPhoneticG2PEvidence();
      } catch (evidenceError: any) {
        const errorMessage = evidenceError instanceof Error ? evidenceError.message : String(evidenceError);
        
        // Check if it's a table-not-found error
        if (errorMessage.includes("Could not find the table") || errorMessage.includes("does not exist")) {
          console.log('[PhoneticInspector] Evidence table not found, attempting to create via RPC...');
          
          try {
            const { data: rpcData, error: rpcError } = await supabase.rpc('setup_phonetic_g2p_evidence_table');
            
            if (rpcError || !rpcData?.success) {
              console.warn('[PhoneticInspector] RPC function not found or failed, evidence table will be empty', rpcError || rpcData?.error);
              // Continue with empty evidence - table will be created manually later
              allEvidence = [];
            } else {
              console.log('[PhoneticInspector] Evidence table created successfully, continuing with empty evidence');
              // Table created but still empty, continue with empty array
              allEvidence = [];
            }
          } catch (rpcErr) {
            console.warn('[PhoneticInspector] RPC call failed, continuing with empty evidence', rpcErr);
            allEvidence = [];
          }
        } else {
          // Different error, rethrow
          throw evidenceError;
        }
      }
      
      console.log('[PhoneticInspector] loadFromDatabase: Fetched evidence', { 
        evidenceCount: allEvidence.length,
        withGPT: allEvidence.filter(e => e.thai_vowel_label && e.gpt_phonetic).length,
        withoutGPT: allEvidence.filter(e => !e.thai_vowel_label || !e.gpt_phonetic).length
      });
      
      // Group evidence by g2p_code
      const evidenceByPattern = new Map<string, typeof allEvidence>();
      allEvidence.forEach(e => {
        if (!evidenceByPattern.has(e.g2p_code)) {
          evidenceByPattern.set(e.g2p_code, []);
        }
        evidenceByPattern.get(e.g2p_code)!.push(e);
      });

      console.log('[PhoneticInspector] loadFromDatabase: Grouped evidence by pattern', { 
        patternCount: evidenceByPattern.size,
        patterns: Array.from(evidenceByPattern.keys())
      });

      // Use cached words data from TanStack Query (faster, no redundant fetches)
      
      // Use cached words data if available, otherwise fetch directly (fallback)
      let allWordsShared = wordsData || [];
      if (!wordsData || wordsData.length === 0) {
        // Fallback: fetch directly if cache is empty
        const { data: fetchedWords, error: wordsFetchError } = await supabase
          .from('words_th')
          .select('word_th, g2p, phonetic_en');
        
        if (wordsFetchError) {
          console.error('[PhoneticInspector] Error fetching words for pattern matching:', wordsFetchError);
          allWordsShared = [];
        } else {
          allWordsShared = fetchedWords || [];
        }
      }
      

      // Build VowelData from database - exactly as it appears in Supabase
      // Use Promise.all to handle async word fetching from words_th
      console.log(`[PhoneticInspector] Building VowelData for ${rules.length} rules`);
      const vowelDataArray: VowelData[] = await Promise.all(rules.map(async (rule) => {
        try {
          const evidence = evidenceByPattern.get(rule.g2p_code) || [];
          
          console.log(`[PhoneticInspector] Processing rule ${rule.g2p_code}:`, {
            evidenceFromTable: evidence.length,
            hasEvidenceField: !!rule.evidence,
            evidenceFieldLength: rule.evidence?.length || 0,
            hasThaiVowel: !!rule.thai_vowel,
            thaiVowel: rule.thai_vowel
          });
          
          
          // Convert evidence to VowelExample format
          let examples: VowelExample[] = evidence.map(e => ({
            word_th: e.word_th,
            g2p: e.g2p || '',
            phonetic_en: e.parser_phonetic || '',
            thai_vowel_label: e.thai_vowel_label,
            gpt_phonetic: e.gpt_phonetic,
          }));
          
          const examplesWithNulls = examples.filter(e => !e.g2p || !e.phonetic_en).length;
          const hasNulls = examples.some(e => !e.g2p || !e.phonetic_en);
          const shouldFetch = examples.length === 0 || hasNulls;
          
          console.log(`[PhoneticInspector] AFTER evidence table mapping for ${rule.g2p_code}:`, {
            examplesCount: examples.length,
            examplesWithNulls,
            hasNulls,
            shouldFetch,
            firstExample: examples[0] || null
          });
          
          
          // If no evidence from table OR examples have nulls, try to fetch from words_th
          // First try parsing evidence JSON field, then fall back to using thai_vowel to find words
          if (shouldFetch) {
            console.log(`[PhoneticInspector] CONDITION MET - Will fetch from words_th for ${rule.g2p_code}`);
            console.log(`[PhoneticInspector] NEED to fetch from words_th for ${rule.g2p_code}:`, {
              examplesCount: examples.length,
              hasNulls: examples.some(e => !e.g2p || !e.phonetic_en),
              hasEvidenceField: !!rule.evidence,
              hasThaiVowel: !!rule.thai_vowel
            });
            
            let wordsToFetch: string[] = [];
            
            // Try parsing evidence JSON field first
            if (rule.evidence) {
              try {
                const evidenceWords = JSON.parse(rule.evidence);
                if (Array.isArray(evidenceWords) && evidenceWords.length > 0) {
                  wordsToFetch = evidenceWords.slice(0, 20); // Limit to 20
                }
              } catch (parseError) {
                console.warn(`[PhoneticInspector] Failed to parse evidence JSON for ${rule.g2p_code}:`, parseError);
              }
            }
            
            // If no evidence field or parsing failed, use thai_vowel to find words directly from words_th
            if (wordsToFetch.length === 0 && rule.thai_vowel) {
              console.log(`[PhoneticInspector] NO evidence field - using thai_vowel "${rule.thai_vowel}" to find words for ${rule.g2p_code}`);
              
              // Convert thai_vowel pattern to regex (dashes become "any character")
              const regex = thaiVowelPatternToRegex(rule.thai_vowel);
              
              
              // Use shared words array (already fetched once) and match using regex pattern
              const matchingWords = (allWordsShared || []).filter(word => 
                word.word_th && regex.test(word.word_th)
              ).slice(0, 20); // Limit to 20 matches
              
              
              console.log(`[PhoneticInspector] AFTER thai_vowel regex pattern matching for ${rule.g2p_code}:`, {
                thaiVowel: rule.thai_vowel,
                regexSource: regex.source,
                matchingWordsFound: matchingWords.length,
                totalWordsChecked: allWordsShared?.length || 0,
                hasError: !!wordsFetchError,
                error: wordsFetchError?.message
              });
              
              if (!wordsFetchError && matchingWords && matchingWords.length > 0) {
                console.log(`[PhoneticInspector] Found ${matchingWords.length} matching words for ${rule.g2p_code}, filtering for complete data...`);
                // Include all matching words, with g2p/phonetic_en if available
                const fetchedExamples = matchingWords.map(w => ({
                  word_th: w.word_th,
                  g2p: w.g2p || '',
                  phonetic_en: w.phonetic_en || '',
                  thai_vowel_label: null,
                  gpt_phonetic: null,
                }));
                
                console.log(`[PhoneticInspector] After mapping, have ${fetchedExamples.length} examples for ${rule.g2p_code}`);
                
                if (fetchedExamples.length > 0) {
                  // Replace examples entirely since we fetched fresh data from words_th
                  // (evidence table was empty, so no need to merge)
                  examples = fetchedExamples;
                  
                  console.log(`[PhoneticInspector] BUILT examples from thai_vowel regex pattern matching for ${rule.g2p_code}:`, {
                    examplesCount: examples.length,
                    fetchedCount: fetchedExamples.length,
                    firstExample: examples[0]
                  });
                  
                  
                  // Save evidence to database - update the rule's evidence field with matching words
                  // Only save if evidence has changed
                  try {
                    const evidenceWords = fetchedExamples.map(e => e.word_th);
                    const evidenceJson = JSON.stringify(evidenceWords);
                    
                    // Check if evidence has changed
                    const existingEvidence = rule.evidence ? JSON.parse(rule.evidence) : [];
                    const evidenceChanged = JSON.stringify(existingEvidence.sort()) !== JSON.stringify(evidenceWords.sort());
                    
                    
                    if (evidenceChanged) {
                      // Update only the evidence field (preserves other fields) - using mutation for optimistic update
                      await updateEvidenceMutation.mutateAsync({ g2p_code: rule.g2p_code, evidence: evidenceJson });
                      
                      // Also save individual evidence entries to phonetic_g2p_evidence table
                      const evidenceEntries = fetchedExamples.map(example => ({
                        g2p_code: rule.g2p_code,
                        word_id: example.word_th, // word_th is the primary key in words_th
                        word_th: example.word_th,
                        g2p: example.g2p || null,
                        parser_phonetic: example.phonetic_en || null,
                        thai_vowel_label: null,
                        gpt_phonetic: null,
                      }));
                      
                      if (evidenceEntries.length > 0) {
                        try {
                          await saveEvidenceBatchMutation.mutateAsync(evidenceEntries);
                        } catch (evidenceTableError) {
                          console.warn(`[PhoneticInspector] Failed to save evidence entries for ${rule.g2p_code} (table might not exist):`, evidenceTableError);
                          // Don't throw - evidence table might not exist yet, this is non-critical
                        }
                      }
                      
                      
                      console.log(`[PhoneticInspector] Saved ${evidenceWords.length} evidence words to database for ${rule.g2p_code} (${evidenceEntries.length} evidence entries)`);
                    } else {
                      console.log(`[PhoneticInspector] Skipped saving evidence for ${rule.g2p_code} - evidence unchanged`);
                    }
                  } catch (saveError) {
                    console.error(`[PhoneticInspector] Failed to save evidence for ${rule.g2p_code}:`, saveError);
                    // Don't throw - continue processing other rules
                  }
                } else {
                  console.warn(`[PhoneticInspector] No examples found for ${rule.g2p_code} after mapping`);
                }
              } else {
                console.warn(`[PhoneticInspector] No matching words found for ${rule.g2p_code} (thai_vowel: ${rule.thai_vowel}, regex: ${regex.source})`, {
                  hasError: !!wordsFetchError,
                  error: wordsFetchError?.message,
                  matchingWordsCount: matchingWords?.length || 0,
                  totalWordsChecked: allWordsShared?.length || 0
                });
                
              }
            }
            
            // Now fetch word data from words_th for the words we found (from evidence field)
            if (wordsToFetch.length > 0) {
              
              // Fetch actual word data from words_th for these evidence words
              const { data: wordsData, error: wordsError } = await supabase
                .from('words_th')
                .select('word_th, g2p, phonetic_en')
                .in('word_th', wordsToFetch);
              
              
              if (!wordsError && wordsData && wordsData.length > 0) {
                const fetchedExamples = wordsData
                  .filter(w => w.g2p && w.phonetic_en) // Only include words with complete data
                  .map(w => ({
                    word_th: w.word_th,
                    g2p: w.g2p || '',
                    phonetic_en: w.phonetic_en || '',
                    thai_vowel_label: null,
                    gpt_phonetic: null,
                  }));
                
                // Replace examples if we got better data, or merge if we had some from evidence table
                if (fetchedExamples.length > 0) {
                  // Merge: keep GPT data from evidence table if available, otherwise use fetched data
                  const mergedExamples = fetchedExamples.map(fetched => {
                    const existing = examples.find(e => e.word_th === fetched.word_th);
                    return existing && existing.thai_vowel_label ? existing : fetched;
                  });
                  examples = mergedExamples;
                  
                }
              } else {
              }
            }
          }

          const finalExamplesWithData = examples.filter(e => e.g2p && e.phonetic_en).length;
          console.log(`[PhoneticInspector] FINAL for ${rule.g2p_code}:`, {
            examplesCount: examples.length,
            examplesWithData: finalExamplesWithData,
            firstExample: examples[0] ? {
              word_th: examples[0].word_th,
              g2p: examples[0].g2p,
              phonetic_en: examples[0].phonetic_en,
              hasG2P: !!examples[0].g2p,
              hasPhoneticEn: !!examples[0].phonetic_en
            } : null,
            allExamplesHaveData: examples.length > 0 && finalExamplesWithData === examples.length,
            examplesArray: examples.slice(0, 3).map(e => ({
              word_th: e.word_th,
              g2p: e.g2p || 'NULL',
              phonetic_en: e.phonetic_en || 'NULL'
            }))
          });

          return {
            pattern: rule.g2p_code,
            parserOutput: rule.phonetic_output || '', // EMPTY - user input field, not parser output
            examples,
          };
        } catch (ruleError) {
          console.error(`[PhoneticInspector] ERROR processing rule ${rule.g2p_code}:`, ruleError);
          // Return rule with empty examples on error
          return {
            pattern: rule.g2p_code,
            parserOutput: rule.phonetic_output || '', // EMPTY - user input field, not parser output
            examples: [],
          };
        }
      }));
      
      const totalExamples = vowelDataArray.reduce((sum, v) => sum + v.examples.length, 0);
      const totalExamplesWithData = vowelDataArray.reduce((sum, v) => sum + v.examples.filter(e => e.g2p && e.phonetic_en).length, 0);
      
      console.log(`[PhoneticInspector] Built ${vowelDataArray.length} vowel data entries with ${totalExamples} total examples (${totalExamplesWithData} with data)`);
      console.log('[PhoneticInspector] Sample vowel data:', vowelDataArray.slice(0, 3).map(v => ({
        pattern: v.pattern,
        examplesCount: v.examples.length,
        examplesWithData: v.examples.filter(e => e.g2p && e.phonetic_en).length,
        firstExample: v.examples[0] ? {
          word_th: v.examples[0].word_th,
          hasG2P: !!v.examples[0].g2p,
          hasPhoneticEn: !!v.examples[0].phonetic_en
        } : null
      })));

      console.log('[PhoneticInspector] loadFromDatabase: Built vowel data', { 
        vowelDataCount: vowelDataArray.length,
        totalExamples,
        totalExamplesWithData
      });

      try {
        setVowelData(vowelDataArray);
        setAllEvidence(allEvidence); // Store raw evidence for direct Supabase table display
      } catch (err) {
        throw err;
      }
      console.log('[PhoneticInspector] loadFromDatabase: Complete');
    } catch (err) {
      console.error('[PhoneticInspector] loadFromDatabase: Error', { 
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      });
      setError(err instanceof Error ? err.message : 'Unknown error');
      throw err;
    }
  }

  /**
   * Discover G2P codes from evidence words and map them to seeded rules
   * This analyzes the G2P patterns from evidence words to determine the actual g2p_code
   */
  async function discoverG2PCodesFromEvidence() {
    console.log('[PhoneticInspector] discoverG2PCodesFromEvidence: Starting...');
    
    try {
      // Get all seeded rules by ID (1-31) - CRITICAL: Don't use g2p_code prefix since it can change
      const allRules = await fetchPhoneticG2PRules();
      const seededRules = allRules.filter(r => r.id >= 1 && r.id <= 31);
      
      
      // Fetch all words with G2P data
      const { data: allWords, error: wordsError } = await supabase
        .from('words_th')
        .select('word_th, g2p')
        .not('g2p', 'is', null);
      
      if (wordsError) {
        throw new Error(`Failed to fetch words: ${wordsError.message}`);
      }
      
      
      const wordsWithG2P = allWords || [];
      const g2pCodeMap = new Map<string, Set<string>>(); // g2p_code -> Set of words
      
      // Process each seeded rule
      for (const rule of seededRules) {
        if (!rule.evidence) continue;
        
        try {
          const evidenceWords: string[] = JSON.parse(rule.evidence);
          
          // Find matching words and extract their G2P codes
          const matchingWords = wordsWithG2P.filter(w => 
            evidenceWords.includes(w.word_th) && w.g2p
          );
          
          // Extract vowel patterns from G2P strings
          // G2P format: "k-a0-n^" or "k-aa2-j^" etc.
          // We need to extract the vowel part (e.g., "a", "aa", "aj", "@@", "vva")
          const vowelPatterns = new Map<string, number>(); // pattern -> count
          
          for (const word of matchingWords) {
            if (word.g2p) {
              const g2pStr = word.g2p.trim();
              
              // Parse G2P string to extract vowel patterns
              // Format: "phoneme-tone^|phoneme-tone^|..."
              const syllables = g2pStr.split('|');
              
              for (const syllable of syllables) {
                const phonemes = syllable.split('-');
                
                for (const phoneme of phonemes) {
                  // Remove tone digits and markers
                  const clean = phoneme.replace(/[0-4\^]/g, '').trim();
                  
                  // Look for known vowel patterns
                  // Special patterns: @@, vva, vv, qq, qqj
                  // Regular patterns: a, aa, i, ii, u, uu, e, ee, o, oo
                  // Diphthongs: aj, oj, uj, etc.
                  
                  if (clean === '@@' || clean === 'vva' || clean === 'vv' || clean === 'qq' || clean === 'qqj') {
                    vowelPatterns.set(clean, (vowelPatterns.get(clean) || 0) + 1);
                  } else if (/^[aeiouAEIOU]/.test(clean)) {
                    // Starts with vowel - could be a, aa, i, ii, etc.
                    // Extract vowel pattern (single or double)
                    const vowelMatch = clean.match(/^([aeiouAEIOU]{1,2})/);
                    if (vowelMatch) {
                      const vowel = vowelMatch[1].toLowerCase();
                      vowelPatterns.set(vowel, (vowelPatterns.get(vowel) || 0) + 1);
                    }
                  } else if (/j$/.test(clean)) {
                    // Ends with j - diphthong pattern like aj, oj, uj
                    const diphthongMatch = clean.match(/([aeiouAEIOU]{1,2})j$/);
                    if (diphthongMatch) {
                      const diphthong = diphthongMatch[1].toLowerCase() + 'j';
                      vowelPatterns.set(diphthong, (vowelPatterns.get(diphthong) || 0) + 1);
                    }
                  }
                }
              }
            }
          }
          
          // Find the most common vowel pattern
          let mostCommonPattern: string | null = null;
          let maxCount = 0;
          
          for (const [pattern, count] of vowelPatterns.entries()) {
            if (count > maxCount) {
              maxCount = count;
              mostCommonPattern = pattern;
            }
          }
          
          if (mostCommonPattern) {
            g2pCodeMap.set(rule.g2p_code, new Set([mostCommonPattern]));
            
          }
          
          if (g2pCodes.size > 0) {
            g2pCodeMap.set(rule.g2p_code, g2pCodes);
            
          }
        } catch (parseError) {
          console.warn(`[PhoneticInspector] Failed to parse evidence for ${rule.g2p_code}:`, parseError);
        }
      }
      
      // Update rules with discovered G2P codes
      let updatedCount = 0;
      
      for (const [seedCode, discoveredPatterns] of g2pCodeMap.entries()) {
        const discoveredCode = Array.from(discoveredPatterns)[0]; // Get the most common pattern
        const rule = seededRules.find(r => r.g2p_code === seedCode);
        
        if (!rule || !discoveredCode) continue;
        
        // Skip if the discovered code is the same as current (already mapped)
        if (rule.g2p_code === discoveredCode) {
          continue;
        }
        
        
        // Check if discovered code already exists with different ID
        const { data: existingWithCode } = await supabase
          .from('phonetic_g2p_rules')
          .select('id, g2p_code')
          .eq('g2p_code', discoveredCode)
          .single();
        
        if (existingWithCode && existingWithCode.id !== rule.id) {
          // Delete the conflicting entry
          console.log(`[PhoneticInspector] Deleting conflicting entry with g2p_code "${discoveredCode}" (ID ${existingWithCode.id})`);
          await deletePhoneticG2PRule(discoveredCode);
        }
        
        // Update the rule with discovered G2P code
        const { error: updateError } = await supabase
          .from('phonetic_g2p_rules')
          .update({
            g2p_code: discoveredCode,
            // Preserve other fields
            thai_vowel: rule.thai_vowel,
            english_vowel: rule.english_vowel,
            phonetic_output: rule.phonetic_output,
            evidence: rule.evidence,
          })
          .eq('id', rule.id);
        
        
        if (updateError) {
          console.error(`[PhoneticInspector] Failed to update ID ${rule.id} with discovered code ${discoveredCode}:`, updateError);
        } else {
          console.log(`[PhoneticInspector] ✓ Updated ID ${rule.id} (${seedCode}) -> ${discoveredCode}`);
          updatedCount++;
          
          // Delete the old SEED_XX entry if it still exists
          if (seedCode.startsWith('SEED_')) {
            try {
              await deletePhoneticG2PRule(seedCode);
            } catch (err) {
              // Ignore - might already be deleted
            }
          }
        }
      }
      
      
      console.log(`[PhoneticInspector] Discovered and updated ${updatedCount} G2P codes from evidence`);
      
      // Reload data after updating G2P codes to reflect changes in UI
      if (updatedCount > 0) {
        await loadFromDatabase();
      }
      
    } catch (err) {
      console.error('[PhoneticInspector] Error discovering G2P codes:', err);
    } finally {
      await refetchRules();
    }
  }

  async function processMissingGPTData() {
    console.log('[PhoneticInspector] processMissingGPTData: Starting...');
    try {
      // Get all evidence that needs GPT processing
      console.log('[PhoneticInspector] processMissingGPTData: Fetching evidence...');
      const allEvidence = await fetchPhoneticG2PEvidence();
      console.log('[PhoneticInspector] processMissingGPTData: Fetched evidence', { 
        totalEvidence: allEvidence.length 
      });
      
      const missingGPT = allEvidence.filter(e => !e.thai_vowel_label || !e.gpt_phonetic);
      console.log('[PhoneticInspector] processMissingGPTData: Missing GPT data', { 
        missingCount: missingGPT.length,
        alreadyProcessed: allEvidence.length - missingGPT.length,
        missingWords: missingGPT.map(e => e.word_th).slice(0, 10)
      });

      if (missingGPT.length === 0) {
        console.log('[PhoneticInspector] processMissingGPTData: All evidence already processed with GPT');
        return;
      }

      console.log(`[PhoneticInspector] processMissingGPTData: Processing ${missingGPT.length} evidence words with GPT...`);
      setProcessingGPT(true);
      setGptProgress({ current: 0, total: missingGPT.length, currentWord: '' });

      const evidenceToSave: Array<{
        g2p_code: string;
        word_id: string;
        word_th: string;
        g2p: string | null;
        parser_phonetic: string | null;
        thai_vowel_label: string | null;
        gpt_phonetic: string | null;
      }> = [];

      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < missingGPT.length; i++) {
        const evidence = missingGPT[i];
        
        console.log(`[PhoneticInspector] processMissingGPTData: Processing ${i + 1}/${missingGPT.length}`, { 
          textTh: evidence.word_th,
          g2pCode: evidence.g2p_code 
        });
        
        setGptProgress({
          current: i + 1,
          total: missingGPT.length,
          currentWord: evidence.word_th,
        });

        try {
          // Call GPT API
          console.log(`[PhoneticInspector] processMissingGPTData: Calling GPT for ${evidence.word_th}...`);
          const gptResult = await analyzePhoneticWithGPT(evidence.word_th);
          console.log(`[PhoneticInspector] processMissingGPTData: GPT result for ${evidence.word_th}`, {
            thaiVowelLabel: gptResult.thai_vowel_label,
            gptPhonetic: gptResult.gpt_phonetic
          });
          
          // Update evidence record
          evidenceToSave.push({
            g2p_code: evidence.g2p_code,
            word_id: evidence.word_id,
            word_th: evidence.word_th,
            g2p: evidence.g2p,
            parser_phonetic: evidence.parser_phonetic,
            thai_vowel_label: gptResult.thai_vowel_label,
            gpt_phonetic: gptResult.gpt_phonetic,
          });

          successCount++;
          console.log(`[PhoneticInspector] processMissingGPTData: Success ${successCount}/${missingGPT.length} for ${evidence.word_th}`);

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          errorCount++;
          console.error(`[PhoneticInspector] processMissingGPTData: Error processing ${evidence.word_th}`, {
            error: err instanceof Error ? err.message : String(err),
            errorCount,
            successCount
          });
          // Continue with next word
        }
      }

      console.log('[PhoneticInspector] processMissingGPTData: Processing complete', {
        total: missingGPT.length,
        success: successCount,
        errors: errorCount,
        toSave: evidenceToSave.length
      });

      // Save all evidence in batch
      if (evidenceToSave.length > 0) {
        console.log('[PhoneticInspector] processMissingGPTData: Saving evidence batch...');
        await savePhoneticG2PEvidenceBatch(evidenceToSave);
        console.log(`[PhoneticInspector] processMissingGPTData: Saved ${evidenceToSave.length} GPT evidence records`);
        
        // Reload from database to show updated data
        console.log('[PhoneticInspector] processMissingGPTData: Reloading from database...');
        await loadFromDatabase();
      } else {
        console.log('[PhoneticInspector] processMissingGPTData: No evidence to save');
      }
    } catch (err) {
      console.error('[PhoneticInspector] processMissingGPTData: Error', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      });
      // Don't set error - this is background processing
    } finally {
      console.log('[PhoneticInspector] processMissingGPTData: Complete');
      setProcessingGPT(false);
      setGptProgress(null);
      // Don't set loading to false here - it's background processing, caller manages loading state
    }
  }

  async function processMissingRuleVowels() {
    // CRITICAL: Prevent concurrent execution - if already processing, skip
    if (processingRuleVowels) {
      console.log('[PhoneticInspector] processMissingRuleVowels: Already processing, skipping...');
      return;
    }
    
    console.log('[PhoneticInspector] processMissingRuleVowels: Starting...');
    
    setProcessingRuleVowels(true);
    
    try {
      // CRITICAL: Use rulesData from TanStack Query (fresh from database) instead of allRules state (may be stale)
      // This ensures we check the ACTUAL database state, not stale local state
      const currentRules = rulesData || allRules;
      
      // CRITICAL: Only process rules that:
      // 1. Have thai_vowel (required for GPT)
      // 2. Are missing english_vowel (empty string or null)
      // 3. Do NOT already have english_vowel (skip if already filled)
      const rulesToProcess = currentRules.filter(rule => {
        const hasThaiVowel = rule.thai_vowel && rule.thai_vowel.trim().length > 0;
        const hasEnglishVowel = rule.english_vowel && rule.english_vowel.trim().length > 0;
        const shouldProcess = hasThaiVowel && !hasEnglishVowel;
        
        
        return shouldProcess;
      });
      
      console.log(`[PhoneticInspector] processMissingRuleVowels: Processing ${rulesToProcess.length} rules with GPT (skipped ${currentRules.length - rulesToProcess.length} that already have english_vowel)`);

      if (rulesToProcess.length === 0) {
        console.log('[PhoneticInspector] processMissingRuleVowels: No rules found - all rules already have english_vowel');
        return;
      }

      setProcessingGPT(true);
      setGptProgress({ current: 0, total: rulesToProcess.length, currentWord: '' });

      const rulesToSave: Array<{
        g2p_code: string;
        english_vowel?: string;
        thai_vowel?: string;
        phonetic_output: string;
        evidence: string;
      }> = [];

      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < rulesToProcess.length; i++) {
        const rule = rulesToProcess[i];
        
        console.log(`[PhoneticInspector] processMissingRuleVowels: Processing ${i + 1}/${rulesToProcess.length}`, { 
          g2p_code: rule.g2p_code,
          hasEvidence: !!rule.evidence
        });
        
        setGptProgress({
          current: i + 1,
          total: rulesToProcess.length,
          currentWord: rule.g2p_code,
        });

        try {
          // CRITICAL: Double-check from database (rulesData) that english_vowel is still missing
          // This prevents duplicate GPT calls if data was updated between filter and processing
          const currentRuleFromDB = (rulesData || []).find(r => r.g2p_code === rule.g2p_code) || rule;
          const hasEnglishVowel = currentRuleFromDB.english_vowel && currentRuleFromDB.english_vowel.trim().length > 0;
          
          if (hasEnglishVowel) {
            console.log(`[PhoneticInspector] processMissingRuleVowels: Skipping ${rule.g2p_code} - already has english_vowel in DB: "${currentRuleFromDB.english_vowel}"`);
            continue; // Skip this rule - already has english_vowel in database
          }
          
          // CRITICAL: Only use thai_vowel for GPT call (not evidence or g2p_code)
          // GPT only needs thai_vowel to determine english_vowel
          const thaiVowelForGPT = rule.thai_vowel;
          if (!thaiVowelForGPT || thaiVowelForGPT.trim().length === 0) {
            console.warn(`[PhoneticInspector] processMissingRuleVowels: Skipping ${rule.g2p_code} - missing thai_vowel`);
            errorCount++;
            continue;
          }
          
          console.log(`[PhoneticInspector] processMissingRuleVowels: Calling GPT for ${rule.g2p_code} with thai_vowel only...`, {
            thaiVowel: thaiVowelForGPT,
            g2pCode: rule.g2p_code
          });
          
          
          // CRITICAL: Only pass thai_vowel (empty string for evidence, g2p_code not needed)
          const gptResult = await analyzeRuleVowelsWithGPT('', '', thaiVowelForGPT);
          
          
          console.log(`[PhoneticInspector] processMissingRuleVowels: GPT result for ${rule.g2p_code}`, {
            englishVowel: gptResult.english_vowel,
            thaiVowel: gptResult.thai_vowel,
            existingThaiVowel: rule.thai_vowel
          });
          
          // Use existing thai_vowel if available, otherwise use GPT result
          const finalThaiVowel = rule.thai_vowel || gptResult.thai_vowel;
          const finalEnglishVowel = gptResult.english_vowel;
          
          // Validate GPT result before saving
          if (!finalEnglishVowel || (!finalThaiVowel && !gptResult.thai_vowel)) {
            console.warn(`[PhoneticInspector] processMissingRuleVowels: Skipping save for ${rule.g2p_code} - invalid GPT result`, {
              hasEnglishVowel: !!finalEnglishVowel,
              hasThaiVowel: !!finalThaiVowel
            });
            errorCount++;
            continue;
          }

          // CRITICAL: For seeded vowels (IDs 1-31), always use hardcoded thai_vowel
          const { THAI_VOWEL_SEEDS } = await import('../data/thaiVowelSeeds');
          const hardcodedThaiVowel = rule.id >= 1 && rule.id <= 31 
            ? THAI_VOWEL_SEEDS[rule.id - 1]?.thai_vowel 
            : finalThaiVowel;
          
          // Update rule record - preserve hardcoded thai_vowel for seeded vowels
          // CRITICAL: Preserve existing phonetic_output (don't overwrite user input)
          const existingPhoneticOutput = rule.phonetic_output || '';
          
          rulesToSave.push({
            g2p_code: rule.g2p_code,
            english_vowel: finalEnglishVowel, // Filled by GPT based on thai_vowel
            thai_vowel: hardcodedThaiVowel || finalThaiVowel, // CRITICAL: Always use hardcoded value for IDs 1-31
            phonetic_output: existingPhoneticOutput, // PRESERVE existing value - user input field
            evidence: rule.evidence || '',
          });
          

          successCount++;
          console.log(`[PhoneticInspector] processMissingRuleVowels: Success ${successCount}/${rulesToProcess.length} for ${rule.g2p_code}`);

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          errorCount++;
          console.error(`[PhoneticInspector] processMissingRuleVowels: Error processing ${rule.g2p_code}`, {
            error: err instanceof Error ? err.message : String(err),
            errorCount,
            successCount
          });
          // Continue with next rule
        }
      }

      console.log('[PhoneticInspector] processMissingRuleVowels: Processing complete', {
        total: rulesToProcess.length,
        success: successCount,
        errors: errorCount,
        toSave: rulesToSave.length
      });

      // Save all rules in batch
      if (rulesToSave.length > 0) {
        console.log('[PhoneticInspector] processMissingRuleVowels: Saving rules batch...');
        console.log('[PhoneticInspector] processMissingRuleVowels: Saving batch with data:', {
          count: rulesToSave.length,
          sample: rulesToSave.slice(0, 3).map(r => ({
            g2p_code: r.g2p_code,
            english_vowel: r.english_vowel,
            evidence: r.evidence ? JSON.parse(r.evidence).slice(0, 3) : null,
            evidenceLength: r.evidence?.length || 0
          }))
        });
        await saveRulesBatchMutation.mutateAsync(rulesToSave);
        console.log(`[PhoneticInspector] processMissingRuleVowels: Saved ${rulesToSave.length} GPT rule vowel records`);
        
        // CRITICAL: Refetch rules from TanStack Query to update UI with saved data
        console.log('[PhoneticInspector] processMissingRuleVowels: Refetching rules from database...');
        const beforeRefetch = await fetchPhoneticG2PRules();
        console.log('[PhoneticInspector] processMissingRuleVowels: BEFORE refetch - sample saved data:', {
          sampleRules: rulesToSave.slice(0, 3).map(r => ({
            g2p_code: r.g2p_code,
            english_vowel: r.english_vowel,
            evidence: r.evidence ? JSON.parse(r.evidence).slice(0, 3) : null,
            evidenceLength: r.evidence?.length || 0
          }))
        });
        await refetchRules();
        const afterRefetch = await fetchPhoneticG2PRules();
        console.log('[PhoneticInspector] processMissingRuleVowels: AFTER refetch - persistence verification:', {
          beforeCount: beforeRefetch.length,
          afterCount: afterRefetch.length,
          sampleLoaded: afterRefetch.filter(r => rulesToSave.some(s => s.g2p_code === r.g2p_code)).slice(0, 3).map(r => ({
            g2p_code: r.g2p_code,
            english_vowel: r.english_vowel,
            evidence: r.evidence ? JSON.parse(r.evidence).slice(0, 3) : null,
            evidenceLength: r.evidence?.length || 0
          }))
        });
      } else {
        console.log('[PhoneticInspector] processMissingRuleVowels: No rules to save');
      }
    } catch (err) {
      console.error('[PhoneticInspector] processMissingRuleVowels: Error', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      });
      setError(`Failed to process rule vowels: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      console.log('[PhoneticInspector] processMissingRuleVowels: Complete');
      setProcessingGPT(false);
      setGptProgress(null);
      setProcessingRuleVowels(false);
    }
  }

  /**
   * Map a discovered g2p_code to a seeded Thai vowel using GPT
   * @param g2pCode - Discovered g2p_code pattern
   * @param evidence - Evidence string (example words)
   * @returns Matching thai_vowel pattern from seeds, or null if not found
   */
  async function mapG2pCodeToThaiVowel(g2pCode: string, evidence: string): Promise<string | null> {
    if (!evidence || evidence.trim() === '') {
      console.warn(`[PhoneticInspector] mapG2pCodeToThaiVowel: No evidence for ${g2pCode}`);
      return null;
    }

    try {
      console.log(`[PhoneticInspector] mapG2pCodeToThaiVowel: Mapping ${g2pCode} to Thai vowel...`);
      
      const gptResult = await analyzeRuleVowelsWithGPT(evidence, g2pCode);
      
      
      console.log(`[PhoneticInspector] mapG2pCodeToThaiVowel: GPT identified thai_vowel "${gptResult.thai_vowel}" for ${g2pCode}`);
      
      // Check if this thai_vowel exists in our seeds
      const { THAI_VOWEL_SEEDS } = await import('../data/thaiVowelSeeds');
      const matchingSeed = THAI_VOWEL_SEEDS.find(seed => seed.thai_vowel === gptResult.thai_vowel);
      
      if (matchingSeed) {
        console.log(`[PhoneticInspector] mapG2pCodeToThaiVowel: Found matching seed for ${g2pCode} -> ${gptResult.thai_vowel}`);
        return matchingSeed.thai_vowel;
      } else {
        console.warn(`[PhoneticInspector] mapG2pCodeToThaiVowel: GPT returned "${gptResult.thai_vowel}" but it's not in our seed list`);
        return null;
      }
    } catch (err) {
      console.error(`[PhoneticInspector] mapG2pCodeToThaiVowel: Error mapping ${g2pCode}`, err);
      return null;
    }
  }

  async function updateDatabase() {
    if (vowelData.length === 0) {
      alert('No data to update. Please discover patterns from words first.');
      return;
    }
    await updateDatabaseWithData(vowelData);
  }

  async function updateDatabaseWithData(dataToSave: VowelData[]) {
    if (dataToSave.length === 0) {
      console.warn('[PhoneticInspector] No vowel data to update');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      // First, load existing rules from database to preserve vowel names
      let existingRules: Array<{
        id: number;
        english_vowel: string | null;
        thai_vowel: string | null;
        g2p_code: string;
        phonetic_output: string | null;
        evidence: string | null;
      }> = [];
      
      try {
        existingRules = await fetchPhoneticG2PRules();
      } catch (err) {
        // If table doesn't exist or is empty, that's fine - we'll create new records
        console.log('[PhoneticInspector] No existing rules found or table is empty, will create new records');
      }

      // Separate seeded vowels (IDs 1-31) from discovered rules
      // CRITICAL: Check by ID, not g2p_code prefix, since g2p_code can change
      const seededVowelsMap = new Map<string, typeof existingRules[0]>();
      const seededVowelsByIdMap = new Map<number, typeof existingRules[0]>();
      const existingMap = new Map<string, typeof existingRules[0]>();
      
      existingRules.forEach(rule => {
        // Check if this is a seeded vowel by ID (1-31)
        if (rule.id >= 1 && rule.id <= 31) {
          seededVowelsByIdMap.set(rule.id, rule);
          // Store by thai_vowel for matching
          if (rule.thai_vowel) {
            seededVowelsMap.set(rule.thai_vowel, rule);
          }
        }
        // Also check by g2p_code prefix for backwards compatibility
        if (rule.g2p_code.startsWith('SEED_')) {
          if (rule.thai_vowel && !seededVowelsMap.has(rule.thai_vowel)) {
            seededVowelsMap.set(rule.thai_vowel, rule);
          }
        }
        // Store all rules by g2p_code for lookup
        existingMap.set(rule.g2p_code, rule);
      });

      console.log(`[PhoneticInspector] Found ${seededVowelsMap.size} seeded vowels and ${existingMap.size} discovered rules`);

      // CRITICAL: Only update the 31 seeded vowels - do NOT create new records
      // Filter dataToSave to only include patterns that match existing seeded vowels
      const rulesToSave: Array<{
        g2p_code: string;
        english_vowel?: string;
        thai_vowel?: string;
        phonetic_output: string;
        evidence: string;
      }> = [];
      
      // Get all seeded vowels (IDs 1-31) to match against
      const seededVowelsList = Array.from(seededVowelsByIdMap.values());
      
      for (const vowel of dataToSave) {
        // Try to find a seeded vowel that matches this pattern's g2p_code
        const existingSeeded = seededVowelsList.find(s => s.g2p_code === vowel.pattern);
        
        if (existingSeeded && existingSeeded.id >= 1 && existingSeeded.id <= 31) {
          // This pattern matches a seeded vowel - update it
          const evidenceString = JSON.stringify(
            vowel.examples.map((ex) => ({
              word_th: ex.word_th,
              g2p: ex.g2p,
              phonetic_en: ex.phonetic_en,
            }))
          );
          
          // Get hardcoded thai_vowel for this seeded vowel
          const { THAI_VOWEL_SEEDS } = await import('../data/thaiVowelSeeds');
          const hardcodedThaiVowel = THAI_VOWEL_SEEDS[existingSeeded.id - 1]?.thai_vowel;
          
          rulesToSave.push({
            g2p_code: vowel.pattern,
            english_vowel: existingSeeded.english_vowel || undefined,
            thai_vowel: hardcodedThaiVowel || existingSeeded.thai_vowel || undefined, // CRITICAL: Use hardcoded value
            phonetic_output: '', // EMPTY - user input field
            evidence: evidenceString,
          });
        }
        // If pattern doesn't match a seeded vowel, skip it - don't create new records
      }

      // CRITICAL: Only save rules that match seeded vowels (IDs 1-31)
      // Do NOT create new records - only update existing seeded vowels
      if (rulesToSave.length > 0) {
        console.log(`[PhoneticInspector] Updating ${rulesToSave.length} seeded vowels (IDs 1-31 only)`);
        await saveRulesBatchMutation.mutateAsync(rulesToSave);
      } else {
        console.log('[PhoneticInspector] No seeded vowels to update - skipping save');
      }
      console.log(`[PhoneticInspector] Successfully updated ${rulesToSave.length} phonetic G2P rules in database (g2p_code used as key)`);
      
      // Create evidence records in phonetic_g2p_evidence table for all examples
      const evidenceToSave: Array<{
        g2p_code: string;
        word_id: string;
        word_th: string;
        g2p: string | null;
        parser_phonetic: string | null;
        thai_vowel_label: string | null;
        gpt_phonetic: string | null;
      }> = [];

      for (const vowel of dataToSave) {
        for (const example of vowel.examples) {
          evidenceToSave.push({
            g2p_code: vowel.pattern,
            word_id: example.word_th,
            word_th: example.word_th,
            g2p: example.g2p || null,
            parser_phonetic: example.phonetic_en || null,
            thai_vowel_label: example.thai_vowel_label || null,
            gpt_phonetic: example.gpt_phonetic || null,
          });
        }
      }

      if (evidenceToSave.length > 0) {
        try {
          await savePhoneticG2PEvidenceBatch(evidenceToSave);
          console.log(`[PhoneticInspector] Created/updated ${evidenceToSave.length} evidence records`);
        } catch (err) {
          console.warn('[PhoneticInspector] Could not save evidence records (table might not exist yet):', err);
        }
      }
      
      // Clear error on successful save
      setError(null);
      
      // Reload from database to show updated data
      await loadFromDatabase();
    } catch (err) {
      console.error('[PhoneticInspector] Error updating database:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      
      // Check if it's an RLS/permission error
      if (errorMessage.includes('permission') || errorMessage.includes('RLS') || errorMessage.includes('row-level') || errorMessage.includes('policy')) {
        throw new Error(`RLS Error: ${errorMessage}. Please disable RLS on phonetic_g2p_rules table.`);
      }
      
      throw err;
    } finally {
      setSaving(false);
    }
  }

  function toggleExpand(pattern: string) {
    setExpandedVowels((prev) => {
      const next = new Set(prev);
      if (next.has(pattern)) {
        next.delete(pattern);
      } else {
        next.add(pattern);
      }
      return next;
    });
  }

  if (loading) {
    return (
      <div style={{ padding: '20px' }}>
        <h1>Phonetic Inspector</h1>
        <p>Loading vowel data...</p>
      </div>
    );
  }

  // Background loading indicator (non-blocking)
  const backgroundLoadingIndicator = backgroundLoading ? (
    <>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
      <div style={{ 
        padding: '10px', 
        backgroundColor: '#f0f8ff', 
        border: '1px solid #4a90e2', 
        borderRadius: '4px',
        marginBottom: '20px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
      }}>
        <div style={{ 
          width: '16px', 
          height: '16px', 
          border: '2px solid #4a90e2',
          borderTop: '2px solid transparent',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <span>
          {enrichmentProgress 
            ? `Enriching data: ${enrichmentProgress.current}/${enrichmentProgress.total} rules...`
            : 'Loading examples and discovering patterns...'}
        </span>
      </div>
    </>
  ) : null;

  if (error) {
    const isConstraintError = error.includes('not-null constraint') || error.includes('null value') || error.includes('english_vowel');
    const sqlScript = `-- Fix phonetic_g2p_rules table to allow NULL values
-- Run this in Supabase Dashboard → SQL Editor

CREATE OR REPLACE FUNCTION fix_phonetic_g2p_rules_nullable()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Make english_vowel nullable
  BEGIN
    ALTER TABLE phonetic_g2p_rules 
      ALTER COLUMN english_vowel DROP NOT NULL;
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END;

  -- Make thai_vowel nullable
  BEGIN
    ALTER TABLE phonetic_g2p_rules 
      ALTER COLUMN thai_vowel DROP NOT NULL;
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END;

  -- Make phonetic_output nullable
  BEGIN
    ALTER TABLE phonetic_g2p_rules 
      ALTER COLUMN phonetic_output DROP NOT NULL;
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END;

  -- Make evidence nullable
  BEGIN
    ALTER TABLE phonetic_g2p_rules 
      ALTER COLUMN evidence DROP NOT NULL;
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', true, 'message', 'Columns updated to allow NULL values');
EXCEPTION
  WHEN others THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION fix_phonetic_g2p_rules_nullable() TO anon;`;

    return (
      <div style={{ padding: '20px' }}>
        <h1>Phonetic Inspector</h1>
        <div style={{ color: 'red', marginBottom: '10px' }}>
          <strong>Error:</strong> {error}
        </div>
        {isConstraintError && (
          <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f5f5f5', border: '1px solid #ddd', borderRadius: '4px' }}>
            <h3 style={{ marginTop: '0' }}>⚠️ Database Setup Required</h3>
            <p style={{ marginBottom: '10px' }}>
              The <code>english_vowel</code> column has a NOT NULL constraint that prevents seeding with null values.
              You need to run this SQL script in Supabase Dashboard → SQL Editor:
            </p>
            <details style={{ marginBottom: '15px' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 'bold', marginBottom: '10px' }}>Click to show SQL script</summary>
              <pre style={{ backgroundColor: '#fff', padding: '10px', overflow: 'auto', fontSize: '12px', border: '1px solid #ccc' }}>
                {sqlScript}
              </pre>
            </details>
            <p style={{ marginBottom: '0', fontSize: '14px', color: '#666' }}>
              <strong>Steps:</strong><br />
              1. Go to: <a href="https://supabase.com/dashboard/project/gbsopnbovsxlstnmaaga/sql/new" target="_blank" rel="noopener noreferrer">Supabase SQL Editor</a><br />
              2. Copy the SQL above<br />
              3. Paste and click "Run"<br />
              4. Refresh this page
            </p>
            <p style={{ marginTop: '10px', fontSize: '12px', color: '#999' }}>
              SQL file: <code>scripts/fix-phonetic-g2p-rules-nullable-rpc.sql</code>
            </p>
          </div>
        )}
        <button onClick={() => { setError(null); initializeAndDiscover(); }} style={{ marginTop: '10px' }}>
          Retry
        </button>
      </div>
    );
  }


  return (
    <div style={{ padding: '20px' }}>
      <h1>Phonetic Inspector</h1>
      <p style={{ marginBottom: '20px', color: '#666' }}>
        Reference table showing vowel patterns, parser outputs, and example words from the database.
      </p>
      {backgroundLoadingIndicator}
      {error && (
        <div style={{ 
          padding: '10px', 
          marginBottom: '20px', 
          backgroundColor: '#fee', 
          border: '1px solid #fcc',
          borderRadius: '4px',
          color: '#c00'
        }}>
          <strong>Error:</strong> {error}
          {(error.includes('not exist') || error.includes('schema cache') || error.includes('table') || error.includes('RLS') || error.includes('row-level')) ? (
            <div style={{ marginTop: '10px', fontSize: '14px' }}>
              <strong>Setup Required:</strong> The table needs to be created. Run this SQL in Supabase Dashboard → SQL Editor to enable automatic setup:
              <div style={{ marginTop: '8px', padding: '10px', backgroundColor: '#fff3cd', borderRadius: '4px', border: '1px solid #ffc107' }}>
                <strong>Step 1:</strong> Create the RPC function (run once):
              </div>
              <pre style={{ 
                marginTop: '5px', 
                padding: '10px', 
                backgroundColor: '#f5f5f5', 
                borderRadius: '4px',
                fontSize: '12px',
                overflow: 'auto'
              }}>
-- Create RPC function for automatic table setup
-- File: scripts/create-phonetic-table-rpc.sql
CREATE OR REPLACE FUNCTION setup_phonetic_g2p_rules_table()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  CREATE TABLE IF NOT EXISTS phonetic_g2p_rules (
    id BIGSERIAL,
    vowel TEXT,
    g2p_code TEXT PRIMARY KEY,
    phonetic_output TEXT,
    evidence TEXT
  );
  ALTER TABLE phonetic_g2p_rules DISABLE ROW LEVEL SECURITY;
  GRANT ALL ON phonetic_g2p_rules TO anon;
  GRANT USAGE, SELECT ON SEQUENCE phonetic_g2p_rules_id_seq TO anon;
  RETURN jsonb_build_object('success', true, 'message', 'Table created successfully');
EXCEPTION
  WHEN others THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION setup_phonetic_g2p_rules_table() TO anon;

-- Also create RPC function for evidence table
CREATE OR REPLACE FUNCTION setup_phonetic_g2p_evidence_table()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  CREATE TABLE IF NOT EXISTS phonetic_g2p_evidence (
    id BIGSERIAL PRIMARY KEY,
    g2p_code TEXT NOT NULL,
    word_id TEXT NOT NULL REFERENCES words_th(word_th) ON DELETE CASCADE,
    word_th TEXT NOT NULL,
    g2p TEXT,
    parser_phonetic TEXT,
    thai_vowel_label TEXT,
    gpt_phonetic TEXT,
    UNIQUE(g2p_code, word_id)
  );
  CREATE INDEX IF NOT EXISTS idx_phonetic_g2p_evidence_g2p_code ON phonetic_g2p_evidence(g2p_code);
  CREATE INDEX IF NOT EXISTS idx_phonetic_g2p_evidence_word_id ON phonetic_g2p_evidence(word_id);
  ALTER TABLE phonetic_g2p_evidence DISABLE ROW LEVEL SECURITY;
  GRANT ALL ON phonetic_g2p_evidence TO anon;
  GRANT USAGE, SELECT ON SEQUENCE phonetic_g2p_evidence_id_seq TO anon;
  RETURN jsonb_build_object('success', true, 'message', 'Table created successfully');
EXCEPTION
  WHEN others THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION setup_phonetic_g2p_evidence_table() TO anon;
              </pre>
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
                After running the RPC functions above, refresh this page and it will automatically create the tables.
              </div>
              <pre style={{ 
                marginTop: '5px', 
                padding: '10px', 
                backgroundColor: '#f5f5f5', 
                borderRadius: '4px',
                fontSize: '12px',
                overflow: 'auto'
              }}>
CREATE TABLE IF NOT EXISTS phonetic_g2p_rules (
  id BIGSERIAL,
  vowel TEXT,
  g2p_code TEXT PRIMARY KEY,
  phonetic_output TEXT,
  evidence TEXT
);

ALTER TABLE phonetic_g2p_rules DISABLE ROW LEVEL SECURITY;

GRANT ALL ON phonetic_g2p_rules TO anon;
GRANT USAGE, SELECT ON SEQUENCE phonetic_g2p_rules_id_seq TO anon;
              </pre>
            </div>
          ) : (error.includes('permission') || error.includes('RLS') || error.includes('row-level') || error.includes('policy')) ? (
            <div style={{ marginTop: '10px', fontSize: '14px', backgroundColor: '#fff3cd', padding: '15px', borderRadius: '4px', border: '2px solid #ffc107' }}>
              <strong style={{ fontSize: '16px', color: '#856404' }}>⚠️ RLS MUST BE DISABLED:</strong>
              <p style={{ marginTop: '8px', marginBottom: '8px' }}>
                The table exists but Row Level Security is blocking access. 
                <strong> You MUST run this SQL in Supabase Dashboard → SQL Editor:</strong>
              </p>
              <pre style={{ 
                marginTop: '5px', 
                padding: '10px', 
                backgroundColor: '#fff', 
                borderRadius: '4px',
                fontSize: '12px',
                overflow: 'auto',
                border: '1px solid #ffc107'
              }}>
ALTER TABLE phonetic_g2p_rules DISABLE ROW LEVEL SECURITY;

GRANT ALL ON phonetic_g2p_rules TO anon;
              </pre>
              <p style={{ marginTop: '8px', fontSize: '12px', color: '#856404' }}>
                <strong>Steps:</strong> Go to Supabase Dashboard → SQL Editor → Paste the SQL above → Click "Run" → Refresh this page
              </p>
            </div>
          ) : null}
        </div>
      )}

      <div style={{ marginBottom: '20px' }}>
        {loading && (
          <div style={{ padding: '10px', backgroundColor: '#e7f3ff', borderRadius: '4px', marginBottom: '10px' }}>
            Loading from database...
          </div>
        )}
        {processingGPT && gptProgress && (
          <div style={{ 
            padding: '10px', 
            backgroundColor: '#e7f3ff', 
            border: '1px solid #b3d9ff',
            borderRadius: '4px',
            marginBottom: '10px',
            fontSize: '14px'
          }}>
            Processing GPT: <strong>{gptProgress.currentWord}</strong> ({gptProgress.current} of {gptProgress.total})
          </div>
        )}
        {(() => {
          return error && (error.includes('not exist') || error.includes('schema cache') || error.includes('table') || error.includes('RLS') || error.includes('row-level')) ? (
        <div style={{ 
          padding: '15px', 
          backgroundColor: '#fff3cd', 
          border: '2px solid #ffc107',
          borderRadius: '4px',
          fontSize: '14px',
          color: '#856404'
        }}>
          <strong style={{ fontSize: '16px' }}>⚠️ SETUP REQUIRED:</strong>
          <p style={{ marginTop: '8px', marginBottom: '8px' }}>
            <strong>You MUST run this SQL in Supabase Dashboard → SQL Editor to create the table and disable RLS:</strong>
          </p>
          <pre style={{ 
            marginTop: '5px', 
            padding: '8px', 
            backgroundColor: '#fff', 
            border: '1px solid #ddd',
            borderRadius: '3px',
            fontSize: '11px',
            overflow: 'auto'
          }}>
CREATE TABLE IF NOT EXISTS phonetic_g2p_rules (
  id BIGSERIAL,
  vowel TEXT,
  g2p_code TEXT PRIMARY KEY,
  phonetic_output TEXT,
  evidence TEXT
);

ALTER TABLE phonetic_g2p_rules DISABLE ROW LEVEL SECURITY;

GRANT ALL ON phonetic_g2p_rules TO anon;
GRANT USAGE, SELECT ON SEQUENCE phonetic_g2p_rules_id_seq TO anon;
          </pre>
          <div style={{ marginTop: '10px', fontSize: '13px', fontWeight: 'bold' }}>
            <strong>Steps:</strong>
            <ol style={{ marginTop: '5px', paddingLeft: '20px' }}>
              <li>Go to: <a href="https://supabase.com/dashboard/project/gbsopnbovsxlstnmaaga/sql/new" target="_blank" rel="noopener noreferrer" style={{ color: '#0066cc' }}>Supabase SQL Editor</a></li>
              <li>Copy the SQL above</li>
              <li>Paste and click "Run"</li>
              <li>Refresh this page</li>
            </ol>
            <p style={{ marginTop: '8px', fontSize: '12px' }}>
              SQL file: <code>scripts/create-phonetic-g2p-rules-table.sql</code>
            </p>
          </div>
        </div>
        ) : null;
        })()}
      </div>

      {/* Direct Supabase Rules Table - matches database schema exactly */}
      <div style={{ marginTop: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <div>
            <h2 style={{ marginBottom: '5px' }}>Phonetic G2P Rules Table</h2>
            <p style={{ marginBottom: '0', color: '#666', fontSize: '14px' }}>
              All entries from <code>phonetic_g2p_rules</code> table ({(allRules.length > 0 ? allRules : (rulesData || [])).length} total)
            </p>
          </div>
          <button
            onClick={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              console.log('[PhoneticInspector] Button clicked - GPT');
              try {
                await processMissingRuleVowels();
              } catch (err) {
                console.error('[PhoneticInspector] Button onClick error', err);
              }
            }}
            disabled={processingGPT || saving || processingRuleVowels}
            style={{
              padding: '8px 16px',
              backgroundColor: (processingGPT || saving || processingRuleVowels) ? '#ccc' : '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: (processingGPT || saving || processingRuleVowels) ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
              position: 'relative',
              zIndex: 10,
            }}
          >
            {(processingGPT || processingRuleVowels) ? 'Processing...' : 'GPT'}
          </button>
          <button
            onClick={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              console.log('[PhoneticInspector] Button clicked - Discover Patterns');
              try {
                await discoverAndMapPatterns();
              } catch (err) {
                console.error('[PhoneticInspector] Discover Patterns onClick error', err);
              }
            }}
            disabled={discoveringPatterns || saving}
            style={{
              padding: '8px 16px',
              backgroundColor: (discoveringPatterns || saving) ? '#ccc' : '#ffc107',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: (discoveringPatterns || saving) ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
              position: 'relative',
              zIndex: 10,
              marginLeft: '10px',
            }}
          >
            {discoveringPatterns ? 'Discovering...' : 'Discover Patterns'}
          </button>
        </div>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            marginTop: '10px',
            fontSize: '13px',
          }}
        >
          <thead>
            <tr style={{ backgroundColor: '#f5f5f5' }}>
              <th style={{ padding: '8px', textAlign: 'left', border: '1px solid #ddd', fontWeight: 'bold' }}>id</th>
              <th style={{ padding: '8px', textAlign: 'left', border: '1px solid #ddd', fontWeight: 'bold' }}>g2p_code</th>
              <th style={{ padding: '8px', textAlign: 'left', border: '1px solid #ddd', fontWeight: 'bold' }}>english_vowel</th>
              <th style={{ padding: '8px', textAlign: 'left', border: '1px solid #ddd', fontWeight: 'bold' }}>thai_vowel</th>
              <th style={{ padding: '8px', textAlign: 'left', border: '1px solid #ddd', fontWeight: 'bold' }}>phonetic_output</th>
              <th style={{ padding: '8px', textAlign: 'left', border: '1px solid #ddd', fontWeight: 'bold' }}>evidence</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              return null;
            })()}
            {(() => {
              // Use rulesData directly if allRules is empty (immediate display)
              const rulesToDisplay = allRules.length > 0 ? allRules : (rulesData || []);
              return rulesToDisplay.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '15px', textAlign: 'center', color: '#999', border: '1px solid #ddd' }}>
                    No rules found
                  </td>
                </tr>
              ) : (
                rulesToDisplay
                  .sort((a, b) => {
                    // Sort by ID ascending - IDs 1-31 (seeded) first, then others
                    return a.id - b.id;
                  })
                  .map((rule, index) => {
                  // Use nullish coalescing to preserve empty strings (only convert null/undefined to null)
                  const englishVowelDisplay = rule.english_vowel ?? null;
                  const thaiVowelDisplay = rule.thai_vowel ?? null;
                  const phoneticOutputDisplay = rule.phonetic_output ?? null;
                  return (
                    <tr key={rule.g2p_code}>
                      <td style={{ padding: '8px', border: '1px solid #ddd', fontFamily: 'monospace', fontSize: '12px' }}>
                        {rule.id}
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #ddd', fontFamily: 'monospace' }}>
                        {rule.g2p_code}
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                        {englishVowelDisplay !== null ? englishVowelDisplay : <span style={{ color: '#999' }}>null</span>}
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #ddd', fontFamily: 'monospace', color: '#cc6600' }}>
                        {thaiVowelDisplay !== null ? thaiVowelDisplay : <span style={{ color: '#999' }}>null</span>}
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #ddd', fontFamily: 'monospace', color: '#009900' }}>
                        <input
                          type="text"
                          value={rule.phonetic_output || ''}
                          onChange={(e) => {
                            const newValue = e.target.value;
                            const g2pCode = rule.g2p_code;
                            
                            // Update local state immediately for responsive UI
                            setAllRules(prev => {
                              const updated = prev.map(r => 
                                r.g2p_code === g2pCode 
                                  ? { ...r, phonetic_output: newValue }
                                  : r
                              );
                              return updated;
                            });
                            
                            // Clear existing timeout for this rule
                            (window as any).__phoneticOutputTimeouts = (window as any).__phoneticOutputTimeouts || {};
                            if ((window as any).__phoneticOutputTimeouts[g2pCode]) {
                              clearTimeout((window as any).__phoneticOutputTimeouts[g2pCode]);
                            }
                            
                            // Save to database (debounced: save 1 second after user stops typing)
                            // Capture rule values at time of onChange (other fields don't change during typing)
                            const englishVowel = rule.english_vowel;
                            const thaiVowel = rule.thai_vowel;
                            const evidence = rule.evidence;
                            
                            const timeoutId = setTimeout(async () => {
                              try {
                                await saveRuleMutation.mutateAsync({
                                  g2p_code: g2pCode,
                                  english_vowel: englishVowel || null,
                                  thai_vowel: thaiVowel || null,
                                  phonetic_output: newValue,
                                  evidence: evidence || '',
                                });
                              } catch (err) {
                                console.error(`[PhoneticInspector] Error saving phonetic_output for ${g2pCode}:`, err);
                              }
                            }, 1000);
                            
                            (window as any).__phoneticOutputTimeouts[g2pCode] = timeoutId;
                          }}
                          onBlur={async (e) => {
                            const newValue = e.target.value;
                            const g2pCode = rule.g2p_code;
                            
                            // Clear debounce timeout
                            (window as any).__phoneticOutputTimeouts = (window as any).__phoneticOutputTimeouts || {};
                            if ((window as any).__phoneticOutputTimeouts[g2pCode]) {
                              clearTimeout((window as any).__phoneticOutputTimeouts[g2pCode]);
                              delete (window as any).__phoneticOutputTimeouts[g2pCode];
                            }
                            
                            // Capture rule values at time of blur (other fields don't change during editing)
                            const englishVowel = rule.english_vowel;
                            const thaiVowel = rule.thai_vowel;
                            const evidence = rule.evidence;
                            
                            // Save immediately on blur (user finished editing)
                            try {
                              await saveRuleMutation.mutateAsync({
                                g2p_code: g2pCode,
                                english_vowel: englishVowel || null,
                                thai_vowel: thaiVowel || null,
                                phonetic_output: newValue,
                                evidence: evidence || '',
                              });
                            } catch (err) {
                              console.error(`[PhoneticInspector] Error saving phonetic_output on blur for ${g2pCode}:`, err);
                            }
                          }}
                          placeholder="Enter phonetic output"
                          style={{
                            width: '100%',
                            padding: '4px',
                            border: '1px solid #ccc',
                            borderRadius: '3px',
                            fontFamily: 'monospace',
                            fontSize: '12px',
                            backgroundColor: '#fff',
                          }}
                        />
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #ddd', fontSize: '12px' }}>
                        {rule.evidence ? (
                          <div>
                            {expandedEvidence.has(rule.g2p_code) ? (
                              <div>
                                <button
                                  onClick={() => {
                                    const next = new Set(expandedEvidence);
                                    next.delete(rule.g2p_code);
                                    setExpandedEvidence(next);
                                  }}
                                  style={{
                                    padding: '2px 6px',
                                    marginBottom: '5px',
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                    backgroundColor: '#f0f0f0',
                                    border: '1px solid #ccc',
                                    borderRadius: '3px',
                                  }}
                                >
                                  ▼ Hide
                                </button>
                                <div style={{ 
                                  maxWidth: '400px', 
                                  wordBreak: 'break-word',
                                  whiteSpace: 'pre-wrap',
                                  fontFamily: 'monospace',
                                  fontSize: '11px',
                                  backgroundColor: '#f9f9f9',
                                  padding: '5px',
                                  borderRadius: '3px',
                                }}>
                                  {rule.evidence}
                                </div>
                              </div>
                            ) : (
                              <div>
                                <button
                                  onClick={() => {
                                    const next = new Set(expandedEvidence);
                                    next.add(rule.g2p_code);
                                    setExpandedEvidence(next);
                                  }}
                                  style={{
                                    padding: '2px 6px',
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                    backgroundColor: '#f0f0f0',
                                    border: '1px solid #ccc',
                                    borderRadius: '3px',
                                  }}
                                >
                                  ▶ Show ({rule.evidence.length} chars)
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: '#999' }}>null</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              );
            })()}
          </tbody>
        </table>
      </div>
    </div>
  );
}
