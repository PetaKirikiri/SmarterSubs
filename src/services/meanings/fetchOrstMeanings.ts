/**
 * Fetch meanings from ORST dictionary and transform to Zod schema format
 * 
 * Merged from orst.ts and fetchOrstMeanings.ts
 * 
 * @param word - Thai word to look up
 * @returns Array of meanings matching meaningThSchema (Zod schema)
 */

import { meaningThSchema } from '../../schemas/meaningThSchema';

/**
 * Generate a deterministic numeric ID from a word and index
 * Uses the same hash function as fetchSenses to ensure consistency
 * 📋 SOURCE OF TRUTH: Returns bigint to match meaningThSchema.id (bigintCoerce)
 * Exported for reuse in GPT-meaning service
 */
export function generateSenseId(wordTh: string, index: number): bigint {
  const idPattern = `${wordTh}-${index}`;
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
 * Scrape ORST dictionary for a Thai word
 * Internal function - used by fetchOrstMeanings
 */
async function scrapeOrstDictionary(word: string): Promise<any[]> {
  if (!word || !word.trim()) {
    return [];
  }

  const trimmedWord = word.trim();

  try {
    // Use Vite proxy to bypass CORS (same approach as SmartSubs Chrome extension background script)
    const searchUrl = '/api/orst';
    const formData = new URLSearchParams();
    formData.append('word', trimmedWord);
    formData.append('funcName', 'lookupWord');
    formData.append('status', 'lookup');
    
    
    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString()
    });

    if (!response.ok) {
      throw new Error(`ORST scrape failed: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    if (html.length === 0) {
      return [];
    }

    const results = parseOrstHtml(html, trimmedWord);
    return results;
  } catch (error) {
    console.error('ORST scrape error:', error);
    // Re-throw to let caller handle it
    throw error;
  }
}

/**
 * Parse a single sense text to extract all fields
 */
function parseSenseText(text: string): {
  pos: string;
  descriptionThai: string;
  alternativeForms?: string[];
  regionalMarker?: string;
  etymology?: string;
} {
  let workingText = text.trim();
  const result: {
    pos: string;
    descriptionThai: string;
    alternativeForms?: string[];
    regionalMarker?: string;
    etymology?: string;
  } = {
    pos: '',
    descriptionThai: workingText
  };

  // 1. Extract alternative forms from brackets at the start: [โดย, โดยะ]
  const alternativeFormsMatch = workingText.match(/^\[([^\]]+)\]\s*/);
  if (alternativeFormsMatch) {
    const formsString = alternativeFormsMatch[1];
    result.alternativeForms = formsString.split(',').map(f => f.trim()).filter(f => f);
    workingText = workingText.substring(alternativeFormsMatch[0].length).trim();
  }

  // 2. Extract regional marker before POS: (ถิ่น)
  const regionalMarkerMatch = workingText.match(/^\(([^)]+)\)\s*/);
  if (regionalMarkerMatch) {
    const marker = regionalMarkerMatch[1].trim();
    // Check if it's a regional marker (common ones: ถิ่น, ภาค, etc.)
    if (marker.length <= 10 && /^[ก-๙]+$/.test(marker)) {
      result.regionalMarker = marker;
      workingText = workingText.substring(regionalMarkerMatch[0].length).trim();
    }
  }

  // 3. Extract etymology at the end: (ป. โตย), (ข. โฎย)
  // Etymology patterns: (ป. ...) for Pali, (ข. ...) for Khmer
  const etymologyMatch = workingText.match(/\(([ปข]\.\s*[^)]+)\)\.?\s*$/);
  if (etymologyMatch) {
    result.etymology = etymologyMatch[1].trim();
    workingText = workingText.substring(0, etymologyMatch.index).trim();
  }

  // 4. Extract POS and description
  // Pattern: (optional regional marker already removed) POS. description or POS description
  // POS tags: น., บ., ว., ก., ผ., ส., etc. (1-3 Thai chars, may have dot)
  // Common POS abbreviations in Thai dictionaries are typically 1-2 characters
  
  // Normalize whitespace first
  workingText = workingText.replace(/\s+/g, ' ').trim();
  
  // More flexible POS extraction - try multiple patterns in order of likelihood
  // Pattern 1: POS. description (with dot and space) - most common: "น. นํ้า", "บ. ด้วย"
  let posMatch = workingText.match(/^([ก-๙]{1,3})\.\s+(.+)$/);
  if (posMatch && posMatch[1] && posMatch[2]) {
    const potentialPos = posMatch[1];
    const rest = posMatch[2].trim();
    // Validate it's a reasonable POS tag (1-3 chars, all Thai) and rest is substantial
    if (potentialPos.length >= 1 && potentialPos.length <= 3 && /^[ก-๙]+$/.test(potentialPos) && rest.length > 0) {
      result.pos = potentialPos;
      result.descriptionThai = rest;
      return result;
    }
  }
  
  // Pattern 2: POS. description (with dot, no space): "น.นํ้า"
  posMatch = workingText.match(/^([ก-๙]{1,3})\.([ก-๙].+)$/);
  if (posMatch && posMatch[1] && posMatch[2]) {
    const potentialPos = posMatch[1];
    const rest = posMatch[2].trim();
    if (potentialPos.length >= 1 && potentialPos.length <= 3 && /^[ก-๙]+$/.test(potentialPos) && rest.length > 0) {
      result.pos = potentialPos;
      result.descriptionThai = rest;
      return result;
    }
  }
  
  // Pattern 3: POS description (without dot, with space): "น นํ้า"
  posMatch = workingText.match(/^([ก-๙]{1,3})\s+(.+)$/);
  if (posMatch && posMatch[1] && posMatch[2]) {
    const potentialPos = posMatch[1];
    const rest = posMatch[2].trim();
    // More strict validation - POS should be 1-2 chars typically, and rest should be substantial
    if (potentialPos.length >= 1 && potentialPos.length <= 3 && /^[ก-๙]+$/.test(potentialPos) && rest.length > 0) {
      result.pos = potentialPos;
      result.descriptionThai = rest;
      return result;
    }
  }
  
  // Pattern 4: Check if text starts with a known POS tag followed by description
  // This handles cases where there might be extra whitespace or formatting
  const knownPosTags = ['น', 'บ', 'ว', 'ก', 'ผ', 'ส', 'อ', 'จ', 'ด', 'ม', 'ร', 'ล', 'ย', 'ห', 'ท', 'ค', 'ต', 'ป'];
  for (const posTag of knownPosTags) {
    // Try with dot and space: "บ. ด้วย"
    const tagPattern = new RegExp(`^${posTag}\\.\\s+(.+)$`);
    const match = workingText.match(tagPattern);
    if (match && match[1] && match[1].trim().length > 0) {
      result.pos = posTag;
      result.descriptionThai = match[1].trim();
      return result;
    }
    // Try with dot, no space: "บ.ด้วย"
    const tagPatternNoSpace = new RegExp(`^${posTag}\\.([ก-๙].+)$`);
    const matchNoSpace = workingText.match(tagPatternNoSpace);
    if (matchNoSpace && matchNoSpace[1] && matchNoSpace[1].trim().length > 0) {
      result.pos = posTag;
      result.descriptionThai = matchNoSpace[1].trim();
      return result;
    }
    // Try without dot: "บ ด้วย"
    const tagPatternNoDot = new RegExp(`^${posTag}\\s+(.+)$`);
    const matchNoDot = workingText.match(tagPatternNoDot);
    if (matchNoDot && matchNoDot[1] && matchNoDot[1].trim().length > 0) {
      result.pos = posTag;
      result.descriptionThai = matchNoDot[1].trim();
      return result;
    }
  }
  
  // No POS found, use entire text as description
  result.descriptionThai = workingText;

  return result;
}

/**
 * Parse ORST HTML results
 */
function parseOrstHtml(html: string, word: string): any[] {
  const entries: any[] = [];
  
  
  if (!html || !word) {
    return entries;
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    const bodyText = doc.body?.textContent || '';
    
    const notFoundIndicators = ['ไม่พบคำ', 'ไม่พบ', 'suggest', 'แนะนำ', 'word not found', 'no results'];
    const hasNotFoundIndicator = notFoundIndicators.some(indicator => 
      bodyText.includes(indicator)
    );
    
    if (hasNotFoundIndicator) {
      return [];
    }
    
    const panels = doc.querySelectorAll('.panel.panel-info');
    
    panels.forEach((panel, panelIdx) => {
      try {
        const thaiWord = word;
        
        // Extract panel sense number from heading (like SmartSubs does)
        let panelSenseNumber: string | null = null;
        const titleElement = panel.querySelector('.panel-heading .panel-title b');
        const headingText = titleElement?.textContent?.trim() || '';
        const headingSenseMatch = headingText.match(/([๑๒๓๔๕๖๗๘๙\d]+)$/);
        if (headingSenseMatch) {
          panelSenseNumber = headingSenseMatch[1];
        }
        
        const bodyElement = panel.querySelector('.panel-body');
        if (!bodyElement) {
          return;
        }
        
        let bodyHtml = bodyElement.innerHTML;
        const lukKhamIndex = bodyHtml.indexOf('ลูกคำของ');
        if (lukKhamIndex !== -1) {
          bodyHtml = bodyHtml.substring(0, lukKhamIndex);
        }
        
        const tempDiv = doc.createElement('div');
        tempDiv.innerHTML = bodyHtml;
        const bodyText = tempDiv.textContent?.trim() || '';
        
        if (!bodyText || bodyText.length < 5) {
          return;
        }
        
        const numberedSensePattern = /\(([๑๒๓๔๕๖๗๘๙\d]+)\)/g;
        const numberedMatches = Array.from(bodyText.matchAll(numberedSensePattern));
        
        if (numberedMatches.length > 0) {
          // Multiple numbered senses in this panel
          numberedMatches.forEach((match, idx) => {
            const senseStart = match.index!;
            const senseEnd = idx < numberedMatches.length - 1 
              ? numberedMatches[idx + 1].index! 
              : bodyText.length;
            
            const senseText = bodyText.substring(senseStart, senseEnd).trim();
            const senseNumber = match[1];
            const textWithoutNumber = senseText.replace(/^\([๑๒๓๔๕๖๗๘๙\d]+\)\s*/, '').trim();
            
            // Parse this sense text
            const parsedSense = parseSenseText(textWithoutNumber);
            
            if (parsedSense.descriptionThai && parsedSense.descriptionThai.trim()) {
              entries.push({
                thaiWord: thaiWord,
                pos: parsedSense.pos || '',
                descriptionThai: parsedSense.descriptionThai.trim(),
                senseNumber: senseNumber,
                ...(parsedSense.alternativeForms && { alternativeForms: parsedSense.alternativeForms }),
                ...(parsedSense.regionalMarker && { regionalMarker: parsedSense.regionalMarker }),
                ...(parsedSense.etymology && { etymology: parsedSense.etymology }),
              });
            }
          });
        } else {
          // Single sense in panel (no numbered senses)
          let normalizedBody = bodyText.trim();
          
          // Remove the word itself if it appears at the start
          if (normalizedBody.startsWith(thaiWord + ' ')) {
            normalizedBody = normalizedBody.substring(thaiWord.length).trim();
          }
          
          // Normalize whitespace (convert newlines and multiple spaces to single space)
          normalizedBody = normalizedBody.replace(/\s+/g, ' ').trim();
          
          // Parse this sense text - let parseSenseText handle POS extraction
          const parsedSense = parseSenseText(normalizedBody);
          
          if (parsedSense.descriptionThai && parsedSense.descriptionThai.trim()) {
            entries.push({
              thaiWord: thaiWord,
              pos: parsedSense.pos || '',
              descriptionThai: parsedSense.descriptionThai.trim(),
              ...(panelSenseNumber && { senseNumber: panelSenseNumber }),
              ...(parsedSense.alternativeForms && { alternativeForms: parsedSense.alternativeForms }),
              ...(parsedSense.regionalMarker && { regionalMarker: parsedSense.regionalMarker }),
              ...(parsedSense.etymology && { etymology: parsedSense.etymology }),
            });
          }
        }
      } catch (err) {
        // Skip invalid panels
      }
    });
    
    const deduped = normalizeMeanings(entries);
    
    return deduped;
  } catch (error) {
    console.error('ORST parse error:', error);
    return [];
  }
}

/**
 * Deduplicate and normalize meanings array
 * Preserves all fields "as is" - doesn't strip out additional fields
 */
function normalizeMeanings(entries: any[]): any[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    return entries;
  }
  
  const seen = new Set<string>();
  const deduped: any[] = [];

  for (const entry of entries) {
    // Create unique key from the 3 required fields for deduplication
    const key = [
      entry.thaiWord || '',
      entry.pos || '',
      entry.descriptionThai || ''
    ].join('|');
    
    if (!seen.has(key)) {
      seen.add(key);
      // Preserve all fields "as is" - don't strip out additional fields
      if (entry.thaiWord && entry.descriptionThai) {
        deduped.push({
          ...entry, // Include all fields from entry
          thaiWord: entry.thaiWord,
          pos: entry.pos || '',
          descriptionThai: entry.descriptionThai,
        });
      }
    }
  }
  
  return deduped;
}

export async function fetchOrstMeanings(word: string): Promise<Array<{
  id: bigint;
  definition_th: string;
  source?: string;
  created_at?: string;
}>> {
  if (!word || !word.trim()) {
    return [];
  }

  const trimmedWord = word.trim();

  // Fetch fresh data from ORST dictionary
  const orstSenses = await scrapeOrstDictionary(trimmedWord);

  if (!orstSenses || orstSenses.length === 0) {
    return [];
  }

  // Transform ORST format to Zod schema format (Supabase-compatible)
  // ORST returns: { descriptionThai, source, ... }
  // Zod schema expects: { id (bigint), definition_th (string), source (string), created_at (string) }
  const validatedMeanings = [];

  for (let index = 0; index < orstSenses.length; index++) {
    const orstSense = orstSenses[index];

    // Map ORST descriptionThai to Zod definition_th
    const definition_th = orstSense.descriptionThai || orstSense.definition_th || '';
    if (!definition_th) continue; // Skip empty definitions

    // Generate deterministic numeric ID using shared function
    const senseId = generateSenseId(trimmedWord, index);

    // Create sense data matching Zod schema (meaningThSchema.ts) - same shape as GPT-meaning and GPT-normalize
    const senseData = {
      id: senseId, // Zod: id (bigint)
      definition_th: definition_th, // Zod: definition_th (string)
      source: orstSense.source || 'orst', // Zod: source (string)
      created_at: orstSense.created_at || new Date().toISOString(), // Zod: created_at (string)
      word_th_id: trimmedWord, // CRITICAL: Link to word - always set word_th_id
    };
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fetchOrstMeanings.ts:fetchOrstMeanings',message:'Creating ORST sense with schema shape',data:{index,hasId:!!senseData.id,hasDefinition:!!senseData.definition_th,source:senseData.source,hasWordThId:!!senseData.word_th_id,schemaKeys:Object.keys(senseData)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'SCHEMA_SHAPE'})}).catch(()=>{});
    // #endregion

    // Validate with Zod schema - strict mode ensures only schema fields (same shape as GPT-meaning and GPT-normalize)
    const validationResult = meaningThSchema.strict().safeParse(senseData);
    if (validationResult.success) {
      // Additional extraction success validation: ensure definition is meaningful
      if (!validationResult.data.definition_th || validationResult.data.definition_th.trim().length === 0) {
        console.warn(`[WARN] ORST sense ${index} for "${trimmedWord}" has empty definition_th - skipping`);
      } else {
        validatedMeanings.push(validationResult.data);
      }
    } else {
      console.warn('[WARN] Sense validation failed:', validationResult.error);
    }
  }

  // Extraction success validation: If we got ORST senses but none validated, something went wrong
  if (orstSenses.length > 0 && validatedMeanings.length === 0) {
    console.warn(`[WARN] ORST returned ${orstSenses.length} senses for "${trimmedWord}" but none passed validation. ORST response structure may have changed.`);
  }

  return validatedMeanings;
}
