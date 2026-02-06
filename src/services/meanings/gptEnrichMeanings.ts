/**
 * GPT Meaning Enrichment - Add POS and English definition to existing meanings
 * 
 * This function enriches existing normalized meanings (V1) with V2 fields:
 * - pos_th (Thai part of speech)
 * - pos_eng (English part of speech)
 * - definition_eng (English definition)
 * 
 * ⚠️ SCHEMA ENFORCEMENT: Only adds V2 fields, preserves all V1 fields
 * Uses meaningThSchemaV2.strict() validation to ensure schema compliance
 * 
 * This is called when meanings are already normalized but missing V2 fields
 * It does NOT re-normalize or re-fetch from ORST - it only adds the new fields
 */

import { getOpenAIApiKey } from '../../utils/gptConfig';
import { meaningThSchemaV2, type MeaningThV2 } from '../../schemas/meaningThSchemaV2';
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
 * Enrich meanings with POS and English definition using GPT
 * 
 * Takes existing normalized meanings (V1) and adds V2 fields:
 * - pos_th, pos_eng, definition_eng
 * 
 * Preserves all existing fields (id, definition_th, word_th_id, source, created_at)
 * 
 * @param senses - Array of existing normalized sense objects (V1)
 * @param context - Context for better enrichment
 * @param context.textTh - The Thai word these senses belong to
 * @param context.fullThaiText - Full subtitle sentence for context (optional)
 * @param context.g2p - G2P transcription (optional)
 * @param context.phonetic_en - English phonetic (optional)
 * @returns Array of enriched sense objects matching meaningThSchemaV2
 */
export async function enrichMeaningsWithGPT(
  senses: MeaningTh[],
  context: {
    textTh: string;
    fullThaiText?: string;
    g2p?: string;
    phonetic_en?: string;
  }
): Promise<MeaningThV2[]> {
  if (!senses || senses.length === 0) {
    return [];
  }

  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
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

  // Build prompt
  const sensesList = senses.map((sense, idx) => 
    `${idx + 1}. ${sense.definition_th}`
  ).join('\n');

  const prompt = `You are a Thai-English dictionary expert. For each Thai word meaning below, provide:
1. pos_th: Thai part of speech (e.g., "คำนาม", "คำกริยา", "คำคุณศัพท์", "คำวิเศษณ์", "คำบุพบท", "คำสันธาน", "คำอุทาน")
2. pos_eng: English part of speech (e.g., "noun", "verb", "adjective", "adverb", "preposition", "conjunction", "interjection")
3. definition_eng: Concise English definition (1-2 sentences max)

Thai word: ${context.textTh}${contextString}

Meanings:
${sensesList}

Return JSON object with "meanings" array containing objects with this exact structure:
{
  "meanings": [
    {
      "pos_th": "คำนาม",
      "pos_eng": "noun",
      "definition_eng": "A concise English definition"
    },
    ...
  ]
}

Ensure:
- pos_th is in Thai
- pos_eng is standard English POS abbreviation
- definition_eng is concise and accurate
- Array length matches input meanings (${senses.length} meanings)`;

  try {
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
            content: 'You are a Thai-English dictionary expert. Return only valid JSON.',
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

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content in GPT response');
    }

    // Parse JSON response
    let enrichedData: Array<{ pos_th: string; pos_eng: string; definition_eng: string }>;
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

    if (enrichedData.length !== senses.length) {
      throw new Error(`GPT returned ${enrichedData.length} meanings, expected ${senses.length}`);
    }

    // Merge enriched data with existing senses
    const enrichedSenses: MeaningThV2[] = senses.map((sense, idx) => {
      const enriched = enrichedData[idx];
      if (!enriched) {
        throw new Error(`Missing enriched data for sense ${idx}`);
      }

      // Build V2 sense: preserve all V1 fields, add V2 fields
      // ⚠️ CRITICAL: Must preserve the original `id` to ensure upsert updates existing entries
      const v2Sense: MeaningThV2 = {
        ...sense, // Preserve all V1 fields (id, definition_th, word_th_id, source, created_at)
        id: sense.id, // Explicitly preserve id to ensure upsert works correctly
        pos_th: enriched.pos_th?.trim() || undefined,
        pos_eng: enriched.pos_eng?.trim() || undefined,
        definition_eng: enriched.definition_eng?.trim() || undefined,
      };
      
      // #region agent log - V2 ENRICHMENT ID PRESERVATION
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/meanings/gptEnrichMeanings.ts:enrichMeaningsWithGPT',message:'V2 ENRICHMENT ID PRESERVED',data:{senseIndex:idx,originalId:sense.id?.toString(),originalIdType:typeof sense.id,enrichedId:v2Sense.id?.toString(),enrichedIdType:typeof v2Sense.id,idsMatch:sense.id?.toString() === v2Sense.id?.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'V2_ENRICH'})}).catch(()=>{});
      // #endregion

      // Validate with V2 schema (strict)
      const validated = meaningThSchemaV2.strict().safeParse(v2Sense);
      if (!validated.success) {
        throw new Error(`Enriched sense ${idx} fails V2 schema validation: ${validated.error.message}`);
      }

      return validated.data;
    });

    return enrichedSenses;
  } catch (error) {
    console.error('[GPT Enrich] Error enriching meanings:', error);
    throw error;
  }
}
