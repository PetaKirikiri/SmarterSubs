/**
 * GPT Meaning Enrichment V3 - Add singular English word label to existing meanings
 * 
 * This function enriches existing V2-complete meanings with V3 fields:
 * - label_eng (singular English word translation)
 * 
 * ⚠️ SCHEMA ENFORCEMENT: Only adds V3 fields, preserves all V1 and V2 fields
 * Uses meaningThSchemaV3.strict() validation to ensure schema compliance
 * 
 * This is called when meanings are already V2-complete but missing V3 fields
 * It does NOT re-enrich V2 fields - it only adds the label_eng field
 * 
 * ⚠️ STRICT VALIDATION: label_eng must be a SINGLE English word only
 * - No Thai characters
 * - No explanations or descriptions
 * - No punctuation or special characters
 * - Only English letters (a-z, A-Z)
 */

import { getOpenAIApiKey } from '../../utils/gptConfig';
import { meaningThSchemaV3, type MeaningThV3 } from '../../schemas/meaningThSchemaV3';
import { meaningThSchemaV2, type MeaningThV2 } from '../../schemas/meaningThSchemaV2';

/**
 * Validate and sanitize label_eng to ensure it's a single English word
 * 
 * @param label - The label string from GPT
 * @returns Sanitized single English word, or throws error if invalid
 */
function validateAndSanitizeLabel(label: string): string {
  if (!label || typeof label !== 'string') {
    throw new Error('label_eng must be a non-empty string');
  }

  // Trim whitespace
  let sanitized = label.trim();

  // Extract only first word if multiple words
  const firstWord = sanitized.split(/\s+/)[0];
  sanitized = firstWord;

  // Remove any non-English letters (keep only a-z, A-Z)
  sanitized = sanitized.replace(/[^a-zA-Z]/g, '');

  // Check for Thai characters (Unicode range for Thai)
  const thaiRegex = /[\u0E00-\u0E7F]/;
  if (thaiRegex.test(sanitized)) {
    throw new Error('label_eng contains Thai characters - not allowed');
  }

  // Validate: must be single word (no spaces), only English letters, non-empty
  if (sanitized.length === 0) {
    throw new Error('label_eng is empty after sanitization');
  }

  if (sanitized.includes(' ')) {
    throw new Error('label_eng contains spaces - must be single word');
  }

  if (!/^[a-zA-Z]+$/.test(sanitized)) {
    throw new Error('label_eng contains non-English characters');
  }

  return sanitized;
}

/**
 * Enrich meanings with singular English word label using GPT
 * 
 * Takes existing V2-complete meanings and adds V3 field:
 * - label_eng (singular English word)
 * 
 * Preserves all existing fields (id, definition_th, word_th_id, source, created_at, pos_th, pos_eng, definition_eng)
 * 
 * @param senses - Array of existing V2-complete sense objects
 * @param context - Context for better enrichment
 * @param context.textTh - The Thai word these senses belong to
 * @param context.fullThaiText - Full subtitle sentence for context (optional)
 * @param context.g2p - G2P transcription (optional)
 * @param context.phonetic_en - English phonetic (optional)
 * @returns Array of enriched sense objects matching meaningThSchemaV3
 */
export async function enrichMeaningsWithGPTV3(
  senses: MeaningThV2[],
  context: {
    textTh: string;
    fullThaiText?: string;
    g2p?: string;
    phonetic_en?: string;
  }
): Promise<MeaningThV3[]> {
  // #region agent log - V3 GPT ENRICHMENT FUNCTION ENTRY
  const sensesSample = senses.slice(0, 2).map((s: any) => ({
    id: s.id?.toString(),
    definitionTh: s.definition_th?.substring(0, 30),
    hasLabelEng: !!s.label_eng,
    hasV2Fields: !!(s.pos_th || s.pos_eng || s.definition_eng)
  }));
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/meanings/gptEnrichMeaningsV3.ts:enrichMeaningsWithGPTV3',message:'V3 GPT ENRICHMENT FUNCTION ENTRY',data:{textTh:context.textTh,sensesCount:senses?.length || 0,hasFullThaiText:!!context.fullThaiText,hasG2P:!!context.g2p,hasPhonetic:!!context.phonetic_en,sensesSample},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
  // #endregion
  
  if (!senses || senses.length === 0) {
    // #region agent log - V3 GPT ENRICHMENT NO SENSES
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/meanings/gptEnrichMeaningsV3.ts:enrichMeaningsWithGPTV3',message:'V3 GPT ENRICHMENT NO SENSES',data:{textTh:context.textTh},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
    // #endregion
    return [];
  }

  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    // #region agent log - V3 GPT ENRICHMENT NO API KEY
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/meanings/gptEnrichMeaningsV3.ts:enrichMeaningsWithGPTV3',message:'V3 GPT ENRICHMENT NO API KEY',data:{textTh:context.textTh},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
    // #endregion
    throw new Error('OpenAI API key not configured');
  }

  // Build context for GPT
  const contextParts: string[] = [];
  if (context.fullThaiText) {
    contextParts.push(`Sentence: ${context.fullThaiText}`);
  }
  if (context.g2p) {
    contextParts.push(`G2P: ${context.g2p}`);
  }
  if (context.phonetic_en) {
    contextParts.push(`Phonetic: ${context.phonetic_en}`);
  }
  const contextString = contextParts.length > 0 ? `\n\nContext:\n${contextParts.join('\n')}` : '';

  // Build prompt with full meaning context for each sense
  const sensesList = senses.map((sense, idx) => {
    const meaningContext = [
      `Meaning ${idx + 1}:`,
      `- Thai definition: ${sense.definition_th || 'N/A'}`,
      `- Part of speech (Thai): ${sense.pos_th || 'N/A'}`,
      `- Part of speech (English): ${sense.pos_eng || 'N/A'}`,
      `- English definition: ${sense.definition_eng || 'N/A'}`,
    ].join('\n');
    return meaningContext;
  }).join('\n\n');

  const prompt = `You are a Thai-English dictionary expert. For each meaning below, provide a SINGLE English word that best translates the Thai word in that specific meaning context.

Thai word: ${context.textTh}${contextString}

Meanings:
${sensesList}

CRITICAL REQUIREMENTS:
- Return ONLY one English word per meaning (no phrases, no multiple words)
- No Thai characters whatsoever
- No explanations, no descriptions, no additional text
- No punctuation marks, no special characters, no numbers
- Only English letters (a-z, A-Z)
- This should be the most common, simple English translation for this specific meaning

Return JSON object with "meanings" array containing objects with this exact structure:
{
  "meanings": [
    {
      "label_eng": "word"
    },
    ...
  ]
}

Ensure:
- Each label_eng is a single English word only
- Array length matches input meanings (${senses.length} meanings)
- No Thai text, no explanations, no punctuation`;

  try {
    // #region agent log - V3 GPT ENRICHMENT API CALL START
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/meanings/gptEnrichMeaningsV3.ts:enrichMeaningsWithGPTV3',message:'V3 GPT ENRICHMENT API CALL START',data:{textTh:context.textTh,sensesCount:senses.length,promptLength:prompt.length},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
    // #endregion
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a Thai-English dictionary expert. Return only valid JSON with single English words. No Thai characters, no explanations, no punctuation.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    // #region agent log - V3 GPT ENRICHMENT API RESPONSE RECEIVED
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/meanings/gptEnrichMeaningsV3.ts:enrichMeaningsWithGPTV3',message:'V3 GPT ENRICHMENT API RESPONSE RECEIVED',data:{textTh:context.textTh,responseOk:response.ok,responseStatus:response.status},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
    // #endregion

    if (!response.ok) {
      const errorText = await response.text();
      // #region agent log - V3 GPT ENRICHMENT API ERROR
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/meanings/gptEnrichMeaningsV3.ts:enrichMeaningsWithGPTV3',message:'V3 GPT ENRICHMENT API ERROR',data:{textTh:context.textTh,responseStatus:response.status,errorText:errorText.substring(0,200)},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
      // #endregion
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    if (!content) {
      // #region agent log - V3 GPT ENRICHMENT NO CONTENT
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/meanings/gptEnrichMeaningsV3.ts:enrichMeaningsWithGPTV3',message:'V3 GPT ENRICHMENT NO CONTENT',data:{textTh:context.textTh,dataKeys:Object.keys(data)},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
      // #endregion
      throw new Error('No content in GPT response');
    }
    
    // #region agent log - V3 GPT ENRICHMENT CONTENT RECEIVED
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/meanings/gptEnrichMeaningsV3.ts:enrichMeaningsWithGPTV3',message:'V3 GPT ENRICHMENT CONTENT RECEIVED',data:{textTh:context.textTh,contentLength:content.length,contentPreview:content.substring(0,200)},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
    // #endregion

    // Parse JSON response
    let enrichedData: Array<{ label_eng: string }>;
    try {
      const parsed = JSON.parse(content);
      // Handle both { meanings: [...] } and direct array, or wrapped in object
      if (Array.isArray(parsed)) {
        enrichedData = parsed;
      } else if (parsed.meanings && Array.isArray(parsed.meanings)) {
        enrichedData = parsed.meanings;
      } else if (parsed.data && Array.isArray(parsed.data)) {
        enrichedData = parsed.data;
      } else {
        // Try to extract array from any key
        const keys = Object.keys(parsed);
        const arrayKey = keys.find(k => Array.isArray(parsed[k]));
        if (arrayKey) {
          enrichedData = parsed[arrayKey];
        } else {
          throw new Error('No array found in GPT response');
        }
      }
    } catch (parseError) {
      throw new Error(`Failed to parse GPT response as JSON: ${parseError}`);
    }

    // #region agent log - V3 GPT ENRICHMENT PARSED DATA
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/meanings/gptEnrichMeaningsV3.ts:enrichMeaningsWithGPTV3',message:'V3 GPT ENRICHMENT PARSED DATA',data:{textTh:context.textTh,enrichedDataCount:enrichedData.length,expectedCount:senses.length,enrichedDataSample:enrichedData.slice(0,2).map((e:any)=>({hasLabelEng:!!e.label_eng,labelEng:e.label_eng}))},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
    // #endregion

    if (enrichedData.length !== senses.length) {
      // #region agent log - V3 GPT ENRICHMENT COUNT MISMATCH
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/meanings/gptEnrichMeaningsV3.ts:enrichMeaningsWithGPTV3',message:'V3 GPT ENRICHMENT COUNT MISMATCH',data:{textTh:context.textTh,enrichedDataCount:enrichedData.length,expectedCount:senses.length},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
      // #endregion
      throw new Error(`GPT returned ${enrichedData.length} meanings, expected ${senses.length}`);
    }

    // Merge enriched data with existing senses
    const enrichedSenses: MeaningThV3[] = senses.map((sense, idx) => {
      const enriched = enrichedData[idx];
      if (!enriched) {
        // #region agent log - V3 GPT ENRICHMENT MISSING DATA
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/meanings/gptEnrichMeaningsV3.ts:enrichMeaningsWithGPTV3',message:'V3 GPT ENRICHMENT MISSING DATA',data:{textTh:context.textTh,senseIndex:idx,enrichedDataLength:enrichedData.length},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
        // #endregion
        throw new Error(`Missing enriched data for sense ${idx}`);
      }

      // Validate and sanitize label_eng
      let labelEng: string | undefined;
      if (enriched.label_eng) {
        try {
          // #region agent log - V3 GPT ENRICHMENT VALIDATING LABEL
          fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/meanings/gptEnrichMeaningsV3.ts:enrichMeaningsWithGPTV3',message:'V3 GPT ENRICHMENT VALIDATING LABEL',data:{textTh:context.textTh,senseIndex:idx,rawLabelEng:enriched.label_eng},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
          // #endregion
          labelEng = validateAndSanitizeLabel(enriched.label_eng);
          // #region agent log - V3 GPT ENRICHMENT LABEL VALIDATED
          fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/meanings/gptEnrichMeaningsV3.ts:enrichMeaningsWithGPTV3',message:'V3 GPT ENRICHMENT LABEL VALIDATED',data:{textTh:context.textTh,senseIndex:idx,sanitizedLabelEng:labelEng},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
          // #endregion
        } catch (validationError) {
          // #region agent log - V3 GPT ENRICHMENT LABEL VALIDATION ERROR
          fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/meanings/gptEnrichMeaningsV3.ts:enrichMeaningsWithGPTV3',message:'V3 GPT ENRICHMENT LABEL VALIDATION ERROR',data:{textTh:context.textTh,senseIndex:idx,rawLabelEng:enriched.label_eng,errorMessage:validationError instanceof Error ? validationError.message : String(validationError)},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
          // #endregion
          throw new Error(`Invalid label_eng for sense ${idx}: ${validationError instanceof Error ? validationError.message : String(validationError)}`);
        }
      }

      // Build V3 sense: preserve all V1 and V2 fields, add V3 field
      // ⚠️ CRITICAL: Must preserve the original `id` to ensure upsert updates existing entries
      const v3Sense: MeaningThV3 = {
        ...sense, // Preserve all V1 and V2 fields (id, definition_th, word_th_id, source, created_at, pos_th, pos_eng, definition_eng)
        id: sense.id, // Explicitly preserve id to ensure upsert works correctly
        label_eng: labelEng || undefined,
      };
      
      // #region agent log - V3 ENRICHMENT ID PRESERVATION
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/meanings/gptEnrichMeaningsV3.ts:enrichMeaningsWithGPTV3',message:'V3 ENRICHMENT ID PRESERVED',data:{senseIndex:idx,originalId:sense.id?.toString(),originalIdType:typeof sense.id,enrichedId:v3Sense.id?.toString(),enrichedIdType:typeof v3Sense.id,idsMatch:sense.id?.toString() === v3Sense.id?.toString(),labelEng},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
      // #endregion

      // Validate with V3 schema (strict)
      const validated = meaningThSchemaV3.strict().safeParse(v3Sense);
      if (!validated.success) {
        throw new Error(`Enriched sense ${idx} fails V3 schema validation: ${validated.error.message}`);
      }

      return validated.data;
    });

    // #region agent log - V3 GPT ENRICHMENT FUNCTION EXIT SUCCESS
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/meanings/gptEnrichMeaningsV3.ts:enrichMeaningsWithGPTV3',message:'V3 GPT ENRICHMENT FUNCTION EXIT SUCCESS',data:{textTh:context.textTh,enrichedSensesCount:enrichedSenses.length,sensesWithLabelEng:enrichedSenses.filter(s=>!!s.label_eng).length,enrichedSensesSample:enrichedSenses.slice(0,2).map((s:any)=>({id:s.id?.toString(),labelEng:s.label_eng,hasLabelEng:!!s.label_eng}))},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
    // #endregion

    return enrichedSenses;
  } catch (error) {
    // #region agent log - V3 GPT ENRICHMENT FUNCTION EXIT ERROR
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/meanings/gptEnrichMeaningsV3.ts:enrichMeaningsWithGPTV3',message:'V3 GPT ENRICHMENT FUNCTION EXIT ERROR',data:{textTh:context.textTh,errorMessage:error instanceof Error ? error.message : String(error),errorStack:error instanceof Error ? error.stack?.substring(0,300) : undefined},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
    // #endregion
    console.error('[GPT Enrich V3] Error enriching meanings:', error);
    throw error;
  }
}
