/**
 * GPT Sense Normalization - Clean and normalize ORST senses
 * Converts inconsistent user-contributed ORST data into standardized format
 * Normalizes only Thai text in definition_th field - no English translations
 * 
 * ⚠️ SCHEMA ENFORCEMENT: Only modifies fields allowed by meaningThSchema:
 * - id (bigint)
 * - definition_th (string) - Thai text only, normalized
 * - word_th_id (string, optional)
 * - source (string, optional)
 * - created_at (string datetime, optional)
 * 
 * Uses strict() validation to reject any non-schema fields
 */

import { getOpenAIApiKey } from '../../utils/gptConfig';
import { meaningThSchema, type MeaningTh } from '../../schemas/meaningThSchema';

/**
 * Generate a deterministic numeric ID from a word and index
 * Uses the same hash function as fetchSenses to ensure consistency
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
 * Normalize senses using GPT - cleans and makes definition_th more concise and nicely worded
 * 
 * Works with senses from either ORST (source: "orst") or GPT-meaning (source: "gpt")
 * All three functions (ORST, GPT-meaning, GPT-normalize) produce the same shape: meaningThSchema
 * 
 * ⚠️ SCHEMA COMPLIANCE: Only modifies definition_th field (makes it concise and nicely worded)
 * All other fields are preserved from original sense or set to defaults
 * Uses strict() validation to ensure only schema-allowed fields are present
 * 
 * @param senses - Array of sense objects matching meaningThSchema (from ORST or GPT-meaning)
 * @param context - Context for better normalization
 * @param context.textTh - The Thai word these senses belong to
 * @param context.fullThaiText - Full subtitle sentence for context (optional)
 * @param context.showName - Show name for context (optional)
 * @param context.episode - Episode number (optional)
 * @param context.season - Season number (optional)
 * @returns Array of normalized sense objects matching meaningThSchema (same shape, cleaner definition_th)
 */
export async function normalizeSensesWithGPT(
  senses: MeaningTh[],
  context: {
    textTh: string; // TODO: Change to word_th to match schema
    fullThaiText?: string;
    showName?: string;
    episode?: number;
    season?: number;
  }
): Promise<MeaningTh[]> {
  // #region agent log
  const senseSources = senses.map(s => s.source || 'undefined');
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'gptNormalizeSenses.ts:normalizeSensesWithGPT',message:'GPT_NORMALIZE CALLED - Function entry',data:{textTh:context.textTh,senseCount:senses.length,senseSources,hasOrstSenses:senseSources.some(s=>s==='orst'||s==='ORST'),timestamp:Date.now()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'NORMALIZE_CALLED'})}).catch(()=>{});
  // #endregion
  
  // ⚠️ CRITICAL: Validate all senses with Zod schema before processing
  const validatedSenses: MeaningTh[] = [];
  for (const sense of senses) {
    const validation = meaningThSchema.strict().safeParse(sense);
    if (!validation.success) {
      throw new Error(`Invalid sense structure: ${validation.error.message}`);
    }
    validatedSenses.push(validation.data);
  }
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'gptNormalizeSenses.ts:normalizeSensesWithGPT',message:'NORMALIZE FUNCTION ENTRY',data:{textTh:context.textTh,senseCount:validatedSenses?.length || 0,hasSenses:!!validatedSenses && validatedSenses.length > 0,senseSources:validatedSenses?.map(s=>s.source) || []},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'NORMALIZE'})}).catch(()=>{});
  // #endregion

  // Clean textTh: split on comma and take first word (defensive fix for comma-separated values)
  const rawTextTh = context.textTh || '';
  const primaryTextTh = rawTextTh?.split(',')[0]?.trim() || rawTextTh || '';

  if (!senses || !Array.isArray(senses) || senses.length === 0) {
    return senses;
  }

  const apiKey = getOpenAIApiKey();

  if (!apiKey) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'gptNormalizeSenses.ts:normalizeSensesWithGPT',message:'NORMALIZE FAILED - No API key found',data:{textTh:context.textTh,senseCount:senses.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'NORMALIZE'})}).catch(()=>{});
    // #endregion
    // ⚠️ CRITICAL: Normalization is NOT an acceptable failure - throw error instead of silently returning original senses
    throw new Error(`[PROCESSING CONTRACT VIOLATION] GPT normalization failed: OpenAI API key not found. Set VITE_OPENAI_API_KEY in .env or localStorage.smartSubs_openaiApiKey. Processing stopped.`);
  }

  // System prompt - Thai dictionary editor (Thai-only normalization)
  const systemPrompt = 'You are an expert Thai dictionary editor specializing in normalizing Thai dictionary entries. Your task is to clean and normalize Thai text only - do NOT add English translations. Return ONLY valid JSON matching the exact structure provided. Do not include explanations or markdown formatting.';

  // Build context info for GPT
  const contextInfo = {
    thaiWord: primaryTextTh,
    fullThaiText: context.fullThaiText || '',
    showName: context.showName || null,
    episode: context.episode || null,
    season: context.season || null,
    rawSenses: senses.map((sense, index) => ({
      index: index,
      thaiWord: primaryTextTh || '',
      definition: sense.definition_th || '',
      source: sense.source || 'ORST'
    }))
  };

  // User prompt - request normalized structure matching Zod schema fields only
  const userPrompt = JSON.stringify({
    task: 'Normalize and clean ORST dictionary senses - Thai text only',
    context: contextInfo,
    requiredStructure: {
      senses: [
        {
          definition_th: 'string (Thai definition only - cleaned and normalized, no English)'
        }
      ]
    },
    instructions: [
      'Clean and normalize the Thai definition text from the original sense.',
      'Remove any English translations or mixed-language content.',
      'Keep only Thai text in definition_th field.',
      'Standardize formatting and remove inconsistencies.',
      'Preserve the core meaning but make it cleaner and more consistent.',
      'Do NOT add English translations - only normalize Thai content.',
      'Return ONLY the definition_th field matching the Zod schema.'
    ]
  });

  try {
    const requestBody = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn('[WARN] GPT normalization API error:', response.status, errorText);
      return senses; // Return original senses on error
    }

    const data = await response.json();
    const resultText = data.choices?.[0]?.message?.content?.trim() || '';

    if (!resultText) {
      return senses; // Return original senses
    }

    // Parse JSON response
    let normalizedData: unknown;
    try {
      normalizedData = JSON.parse(resultText);
    } catch (parseError) {
      console.warn('[WARN] Failed to parse GPT response:', parseError);
      return senses; // Return original senses
    }

    // Extract normalized senses array - validate structure first
    // normalizedData is unknown - must validate before accessing properties
    let normalizedSenses: unknown[] = [];
    if (normalizedData && typeof normalizedData === 'object' && 'senses' in normalizedData) {
      const sensesValue = (normalizedData as { senses?: unknown }).senses;
      if (Array.isArray(sensesValue)) {
        normalizedSenses = sensesValue;
      }
    }

    if (!Array.isArray(normalizedSenses) || normalizedSenses.length === 0) {
      return validatedSenses; // Return original validated senses
    }

    // Map GPT response to Zod schema format - only schema-allowed fields
    const enhancedSenses: MeaningTh[] = [];

    for (let index = 0; index < senses.length; index++) {
      const originalSense = senses[index];
      if (!originalSense) {
        continue; // Skip if sense is undefined
      }
      
      // Get normalized sense by index - validate it matches schema structure
      const normalizedSense = normalizedSenses[index];
      
      // Extract only definition_th field (the only field we normalize)
      // Validate that normalizedSense has the correct structure and only schema fields
      let definition_th: string;
      if (normalizedSense && typeof normalizedSense === 'object') {
        // First validate the entire normalized sense matches schema (strict mode rejects extra fields)
        const schemaValidation = meaningThSchema.strict().safeParse(normalizedSense);
        if (schemaValidation.success) {
          // Use normalized definition_th if validation passes
          definition_th = schemaValidation.data.definition_th || '';
        } else if ('definition_th' in normalizedSense) {
          // If schema validation fails but definition_th exists, extract it (GPT may have added extra fields)
          const normalizedValue = (normalizedSense as { definition_th?: unknown }).definition_th;
          if (typeof normalizedValue === 'string' && normalizedValue.trim()) {
            definition_th = normalizedValue.trim();
          } else {
            // Fallback to original if normalized value is invalid
            definition_th = originalSense.definition_th || '';
          }
        } else {
          // Fallback to original if no definition_th found
          definition_th = originalSense.definition_th || '';
        }
      } else {
        // Fallback to original if no normalized sense found
        definition_th = originalSense.definition_th || '';
      }

      // Skip if no definition_th
      if (!definition_th || !definition_th.trim()) {
        continue;
      }

      // Generate ID using same function as fetchOrstMeanings
      const senseId = originalSense.id || generateSenseId(primaryTextTh, index);

      // Create sense data matching Zod schema - ONLY schema-allowed fields (same shape as ORST and GPT-meaning)
      // GPT-normalize only cleans up definition_th text (makes it concise and nicely worded)
      const senseData: MeaningTh = {
        id: senseId,
        definition_th: definition_th.trim(), // Only normalized field - cleaned up text (concise and nicely worded)
        source: 'gpt-normalized', // Always mark as normalized (was originally from ORST or GPT-meaning)
        created_at: originalSense.created_at || new Date().toISOString(),
        word_th_id: originalSense.word_th_id || context.textTh, // Preserve original or use context
      };
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'gptNormalizeSenses.ts:normalizeSensesWithGPT',message:'Creating normalized sense with schema shape',data:{index,originalSource:originalSense.source,newSource:senseData.source,hasDefinition:!!senseData.definition_th,hasId:!!senseData.id,hasWordThId:!!senseData.word_th_id,schemaKeys:Object.keys(senseData)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SCHEMA_SHAPE'})}).catch(()=>{});
      // #endregion

      // Validate with Zod schema - strict mode ensures only schema fields
      const validationResult = meaningThSchema.strict().safeParse(senseData);
      if (validationResult.success) {
        enhancedSenses.push(validationResult.data);
      } else {
        console.warn('[WARN] Normalized sense validation failed:', validationResult.error);
        // Validate originalSense before using as fallback - strict mode
        const originalValidationResult = meaningThSchema.strict().safeParse(originalSense);
        if (originalValidationResult.success) {
          enhancedSenses.push(originalValidationResult.data);
        } else {
          console.error('[ERROR] Original sense also failed validation - skipping sense:', originalValidationResult.error);
          // Skip invalid sense entirely - don't use invalid data
        }
      }
    }

    // Return enhanced senses if we have any, otherwise return original
    const finalResult = enhancedSenses.length > 0 ? enhancedSenses : senses;
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'gptNormalizeSenses.ts:normalizeSensesWithGPT',message:'GPT normalization function returning',data:{textTh:context.textTh,enhancedCount:enhancedSenses.length,originalCount:senses.length,returningEnhanced:enhancedSenses.length > 0,returnSources:finalResult.map((s:any)=>s.source),allSourcesNormalized:finalResult.every((s:any)=>s.source === 'gpt-normalized')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'NORMALIZE_SOURCE'})}).catch(()=>{});
    // #endregion
    return finalResult;
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'gptNormalizeSenses.ts:normalizeSensesWithGPT',message:'GPT normalization EXCEPTION - Returning original senses',data:{textTh:context.textTh,senseCount:senses.length,errorMessage:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'NORMALIZE'})}).catch(()=>{});
    // #endregion
    console.error('[ERROR] GPT normalization failed:', error);
    return senses; // Return original senses on error
  }
}
