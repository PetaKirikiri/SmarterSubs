/**
 * GPT Meaning - Thai Word Sense Creation using GPT
 * Fallback for words that cannot be found in ORST dictionary
 * Generates dictionary sense definitions using GPT with full subtitle context
 * 
 * ⚠️ SCHEMA ENFORCEMENT: Only modifies fields allowed by meaningThSchema:
 * - id (bigint)
 * - definition_th (string) - Thai text only, no English
 * - word_th_id (string, optional)
 * - source (string, optional)
 * - created_at (string datetime, optional)
 * 
 * Uses strict() validation to reject any non-schema fields
 */

import { getOpenAIApiKey } from '../../utils/gptConfig';
import { meaningThSchema, type MeaningTh } from '../../schemas/meaningThSchema';
import { generateSenseId } from './fetchOrstMeanings';

export interface GPTMeaningContext {
  fullThaiText?: string;
  allTokens?: string[];
  wordPosition?: number;
  showName?: string;
  episode?: number;
  season?: number;
  g2p?: string;
  phonetic_en?: string;
}

/**
 * Create sense object(s) for a Thai word using GPT with context
 * @param wordTh - Thai word to create sense for
 * @param context - Context object with subtitle text, tokens, show metadata, etc.
 * @returns Array of MeaningTh objects matching meaningThSchema, or empty array on error
 */
export async function createMeaningsWithGPT(
  wordTh: string,
  context: GPTMeaningContext
): Promise<MeaningTh[]> {
  if (!wordTh || !wordTh.trim()) {
    return [];
  }

  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    console.warn('[GPT Meaning] No API key found, skipping GPT-meaning generation');
    return [];
  }

  const trimmedWord = wordTh.trim();

  // Build system prompt - Thai-only dictionary entries
  let systemPrompt = 'You are a Thai language expert helping to create dictionary sense entries for words that cannot be found in standard dictionaries and cannot be decomposed into dictionary sub-words.\n\nThe word might be:\n- A proper noun (person name, place name, brand name)\n- A compound word not decomposable into dictionary parts\n- A slang or colloquial term\n- A technical term\n- A word from a specific dialect\n- A newly coined word\n\nUse the provided context (show name, episode, season, subtitle text, surrounding words) to infer the most likely meaning(s).\n\nIMPORTANT: Return ONLY Thai text in definition_th field. Do NOT add English translations.';

  if (context.g2p || context.phonetic_en) {
    systemPrompt += '\n\nUse the provided phonetic data (G2P and/or English phonetic) to inform your understanding of pronunciation.';
  }

  systemPrompt += '\n\nReturn ONLY valid JSON matching the exact structure provided. Do not include explanations or markdown formatting.';

  const userPrompt = JSON.stringify({
    word: trimmedWord,
    context: {
      showName: context.showName || '',
      episode: context.episode || null,
      season: context.season || null,
      fullThaiText: context.fullThaiText || '',
      allTokens: context.allTokens || [],
      wordPosition: context.wordPosition || null,
      g2p: context.g2p || null,
      phonetic_en: context.phonetic_en || null,
    },
    requiredStructure: {
      senses: [
        {
          definition_th: 'string (Thai definition only - no English translations)'
        }
      ]
    },
    instructions: [
      'Return a JSON object with a "senses" array',
      'Each sense should have ONLY the definition_th field matching the Zod schema',
      'definition_th should be in Thai only, explaining what the word means',
      'Do NOT add English translations or mixed-language content',
      'If multiple meanings exist, return multiple senses',
      'If unsure, return at least one sense with your best guess based on context',
      'Return ONLY schema-allowed fields: definition_th (required)'
    ]
  });

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_completion_tokens: 500,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[GPT Meaning] API error:', response.status, errorText);
      return [];
    }

    const data = await response.json();
    const resultText = data.choices?.[0]?.message?.content?.trim() || '';

    if (!resultText) {
      console.warn('[GPT Meaning] Empty response from GPT');
      return [];
    }

    // Parse JSON response - treat as unknown until validated
    let parsedData: unknown;
    try {
      parsedData = JSON.parse(resultText);
    } catch (parseError) {
      console.error('[GPT Meaning] Failed to parse JSON response:', parseError);
      return [];
    }

    // Extract senses array (support both single sense object and senses array)
    // Validate structure before processing
    let sensesArray: unknown[] = [];
    if (parsedData && typeof parsedData === 'object' && 'senses' in parsedData) {
      const sensesValue = (parsedData as { senses?: unknown }).senses;
      if (Array.isArray(sensesValue)) {
        sensesArray = sensesValue;
      }
    } else if (parsedData && typeof parsedData === 'object' && ('definition_th' in parsedData || 'definition' in parsedData)) {
      // Single sense object (backward compatibility)
      sensesArray = [parsedData];
    }

    if (sensesArray.length === 0) {
      console.warn('[GPT Meaning] No valid senses found in GPT response');
      return [];
    }

    // Transform GPT response to MeaningTh[] format matching meaningThSchema - only schema fields
    const meanings: MeaningTh[] = [];

    for (let index = 0; index < sensesArray.length; index++) {
      const senseItem = sensesArray[index];

      // Extract definition_th field - validate it matches schema structure
      let definition_th: string = '';
      if (senseItem && typeof senseItem === 'object') {
        // First try to validate entire sense with strict schema (rejects extra fields)
        const schemaValidation = meaningThSchema.strict().safeParse(senseItem);
        if (schemaValidation.success) {
          // Use validated definition_th if schema validation passes
          definition_th = schemaValidation.data.definition_th || '';
        } else if ('definition_th' in senseItem) {
          // If schema validation fails but definition_th exists, extract it (GPT may have added extra fields)
          const definitionValue = (senseItem as { definition_th?: unknown }).definition_th;
          if (typeof definitionValue === 'string' && definitionValue.trim()) {
            definition_th = definitionValue.trim();
          }
        } else if ('definition' in senseItem) {
          // Fallback for old format (backward compatibility)
          const definitionValue = (senseItem as { definition?: unknown }).definition;
          if (typeof definitionValue === 'string' && definitionValue.trim()) {
            definition_th = definitionValue.trim();
          }
        }
      }

      // Skip if no definition_th found
      if (!definition_th || !definition_th.trim()) {
        console.warn(`[GPT Meaning] Skipping sense ${index}: missing or empty definition_th`);
        continue;
      }

      // Generate deterministic ID using same function as fetchOrstMeanings
      const senseId = generateSenseId(trimmedWord, index);

      // Create sense data matching meaningThSchema - ONLY schema-allowed fields (same shape as ORST and GPT-normalize)
      const meaningData: MeaningTh = {
        id: senseId, // bigint
        definition_th: definition_th.trim(), // string (required) - Thai text only
        source: 'gpt', // string (optional)
        created_at: new Date().toISOString(), // string (optional)
        word_th_id: trimmedWord, // string (optional) - link to word
      };
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'gptMeaning.ts:createMeaningsWithGPT',message:'Creating GPT-meaning sense with schema shape',data:{index,hasId:!!meaningData.id,hasDefinition:!!meaningData.definition_th,source:meaningData.source,hasWordThId:!!meaningData.word_th_id,schemaKeys:Object.keys(meaningData)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SCHEMA_SHAPE'})}).catch(()=>{});
      // #endregion

      // Validate with Zod schema - strict mode ensures only schema fields
      try {
        const validated = meaningThSchema.strict().parse(meaningData);
        meanings.push(validated);
      } catch (error) {
        console.error(`[GPT Meaning] Sense ${index} failed Zod validation:`, error);
        // Continue with other senses even if one fails
      }
    }

    console.log(`[GPT Meaning] Generated ${meanings.length} meaning(s) for "${trimmedWord}"`);
    return meanings;
  } catch (error) {
    console.error('[GPT Meaning] Error calling GPT API:', error);
    return [];
  }
}
