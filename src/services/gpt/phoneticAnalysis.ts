/**
 * GPT Phonetic Analysis Service
 * 
 * Uses GPT as an "oracle" to read Thai script and provide:
 * 1. thai_vowel_label: The actual Thai vowel identity in Thai script notation
 * 2. gpt_phonetic: Human-readable phonetic spelling for the whole word
 * 
 * This is NOT for translation or rule guessing - it's for Thai-literate vowel identification.
 */

import { callGPTAPI } from '../../utils/gptConfig';

export interface PhoneticAnalysisResult {
  thai_vowel_label: string; // e.g., "ไ– (mai malai)", "เ–า", "–า"
  gpt_phonetic: string; // e.g., "mai tahw"
}

/**
 * Analyze a Thai word using GPT to identify the vowel and provide phonetic spelling
 * @param textTh - Thai word to analyze
 * @returns GPT analysis result with thai_vowel_label and gpt_phonetic
 */
export async function analyzePhoneticWithGPT(textTh: string): Promise<PhoneticAnalysisResult> {
  console.log('[GPT Phonetic] analyzePhoneticWithGPT called', { textTh });
  
  if (!textTh || !textTh.trim()) {
    console.error('[GPT Phonetic] word_th is required but missing or empty');
    throw new Error('word_th is required');
  }

  const systemPrompt = `You are an expert Thai linguist. Analyze Thai words and identify vowels using Thai script notation (e.g., 'ไ– (mai malai)', 'เ–า', '–า'). Provide human-readable phonetic spelling in simple Latin characters.

Return ONLY valid JSON with these exact fields:
- thai_vowel_label: Thai vowel in script notation (e.g., "ไ– (mai malai)", "เ–า", "–า")
- gpt_phonetic: Human-readable phonetic spelling in simple Latin characters

Do not include explanations or markdown formatting. Return only the JSON object.`;

  const userPrompt = `Analyze this Thai word: ${textTh.trim()}

Return JSON with:
- thai_vowel_label: Thai vowel in script notation (e.g., "ไ– (mai malai)", "เ–า", "–า")
- gpt_phonetic: Human-readable phonetic spelling in simple Latin characters`;

  console.log('[GPT Phonetic] Prompts prepared', { 
    systemPromptLength: systemPrompt.length, 
    userPromptLength: userPrompt.length,
    textTh: textTh.trim()
  });

  try {
    console.log('[GPT Phonetic] Calling GPT API...');
    const response = await callGPTAPI({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3, // Lower temperature for more consistent results
      maxCompletionTokens: 200,
      responseFormat: { type: 'json_object' }
    });

    console.log('[GPT Phonetic] GPT API response received', { 
      hasChoices: !!response.choices,
      choiceCount: response.choices?.length 
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      console.error('[GPT Phonetic] GPT returned empty response', { response });
      throw new Error('GPT returned empty response');
    }

    console.log('[GPT Phonetic] Response content', { 
      contentLength: content.length, 
      contentPreview: content.substring(0, 200) 
    });

    // Parse JSON response
    let parsed: PhoneticAnalysisResult;
    try {
      parsed = JSON.parse(content);
      console.log('[GPT Phonetic] JSON parsed successfully', { 
        hasThaiVowelLabel: !!parsed.thai_vowel_label,
        hasGptPhonetic: !!parsed.gpt_phonetic,
        thaiVowelLabel: parsed.thai_vowel_label,
        gptPhonetic: parsed.gpt_phonetic
      });
    } catch (parseError) {
      console.error('[GPT Phonetic] JSON parse failed', { 
        error: parseError instanceof Error ? parseError.message : String(parseError),
        content 
      });
      throw new Error(`Failed to parse GPT JSON response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    }

    // Validate required fields
    if (!parsed.thai_vowel_label || typeof parsed.thai_vowel_label !== 'string') {
      console.error('[GPT Phonetic] Invalid thai_vowel_label', { 
        value: parsed.thai_vowel_label, 
        type: typeof parsed.thai_vowel_label 
      });
      throw new Error('GPT response missing or invalid thai_vowel_label field');
    }

    if (!parsed.gpt_phonetic || typeof parsed.gpt_phonetic !== 'string') {
      console.error('[GPT Phonetic] Invalid gpt_phonetic', { 
        value: parsed.gpt_phonetic, 
        type: typeof parsed.gpt_phonetic 
      });
      throw new Error('GPT response missing or invalid gpt_phonetic field');
    }

    const result = {
      thai_vowel_label: parsed.thai_vowel_label.trim(),
      gpt_phonetic: parsed.gpt_phonetic.trim()
    };

    console.log('[GPT Phonetic] Analysis complete', { 
      textTh, 
      thaiVowelLabel: result.thai_vowel_label, 
      gptPhonetic: result.gpt_phonetic 
    });

    return result;
  } catch (error) {
    console.error('[GPT Phonetic] Analysis failed', { 
      textTh, 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    if (error instanceof Error && error.message.includes('API key not found')) {
      throw error;
    }
    throw new Error(`GPT phonetic analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface RuleVowelAnalysisResult {
  english_vowel: string; // e.g., "long a", "diphthong", "short o"
  thai_vowel: string; // e.g., "ไ– (mai malai)", "เ–า", "–า"
}

/**
 * Analyze evidence from a phonetic G2P rule to determine both English and Thai vowel labels
 * @param evidence - Evidence string containing example words (optional if thai_vowel is provided)
 * @param g2pCode - The G2P code pattern being analyzed
 * @param existingThaiVowel - Optional existing Thai vowel (if provided, will use this instead of evidence for thai_vowel)
 * @returns GPT analysis result with english_vowel and thai_vowel
 */
export async function analyzeRuleVowelsWithGPT(
  evidence: string, 
  g2pCode: string, 
  existingThaiVowel?: string | null
): Promise<RuleVowelAnalysisResult> {
  console.log('[GPT Rule Vowels] analyzeRuleVowelsWithGPT called', { evidence, g2pCode, existingThaiVowel });
  
  // If we have existing thai_vowel but no evidence, we can still get english_vowel
  const hasEvidence = evidence && evidence.trim().length > 0;
  const hasThaiVowel = existingThaiVowel && existingThaiVowel.trim().length > 0;
  
  if (!hasEvidence && !hasThaiVowel) {
    console.error('[GPT Rule Vowels] Either evidence or thai_vowel is required');
    throw new Error('Either evidence or thai_vowel is required');
  }

  const systemPrompt = hasThaiVowel && !hasEvidence
    ? `You are an expert Thai linguist. Given a Thai vowel pattern, identify its English phonetic equivalent.

CRITICAL RULES FOR english_vowel:
- Must be normal English letters only (no IPA, no special characters, no diacritics)
- Just how an English speaker would spell the sound (e.g., "ai", "ao", "ah", "oe", "ee", "ue", "ia", "ua")

Return ONLY valid JSON with these exact fields:
- thai_vowel: The Thai vowel pattern provided (use exactly as given)
- english_vowel: Normal English phonetic spelling (simple English letters only)

Do not include explanations or markdown formatting. Return only the JSON object.`
    : `You are an expert Thai linguist. Analyze the evidence (example words) for a G2P vowel pattern and identify:
1. The Thai vowel pattern ONLY - just the vowel characters/pattern, NO descriptions, NO parentheses, NO words
2. The English phonetic equivalent - the normal English pronunciation of that Thai vowel (e.g., "ai", "ao", "ah", "oe")

CRITICAL RULES FOR thai_vowel:
- MUST contain ONLY the Thai vowel pattern itself
- Examples: "ไ–", "เ–า", "–า", "เ–", "–ิ", "–ี", "โ–", "–ัว", "–ึ", "–ือ", "เ–ือ"
- FORBIDDEN: Any descriptions in parentheses like "(ไม้มลาย)" or "(สระอา)"
- FORBIDDEN: Any words, explanations, or additional text
- FORBIDDEN: Any English characters (a-z, A-Z)
- FORBIDDEN: Parentheses, spaces around descriptions, or any text after the vowel pattern
- JUST the vowel pattern: Thai characters with dashes/placeholders ONLY

CRITICAL RULES FOR english_vowel:
- Must be normal English letters only (no IPA, no special characters, no diacritics)
- Just how an English speaker would spell the sound (e.g., "ai", "ao", "ah", "oe", "ee", "ue")

Return ONLY valid JSON with these exact fields:
- thai_vowel: Thai vowel pattern ONLY (NO descriptions, NO parentheses, NO words)
- english_vowel: Normal English phonetic spelling (simple English letters only)

Do not include explanations or markdown formatting. Return only the JSON object.`;

  const userPrompt = hasThaiVowel && !hasEvidence
    ? `Given this Thai vowel pattern, provide its English phonetic equivalent:

Thai Vowel Pattern: ${existingThaiVowel}
G2P Code: ${g2pCode}

Return JSON with:
- thai_vowel: "${existingThaiVowel}" (use exactly as provided)
- english_vowel: The normal English phonetic equivalent using simple English letters only (e.g., "ai", "ao", "ah", "oe", "ia", "ua")`
    : `Analyze this G2P pattern and its evidence:

G2P Code: ${g2pCode}
Evidence (example words): ${evidence.trim()}

From the evidence words, identify:
1. thai_vowel: ONLY the Thai vowel pattern itself
   - Examples: "ไ–", "เ–า", "–า", "เ–", "–ิ", "–ี", "โ–", "–ัว", "–ึ", "–ือ", "เ–ือ"
   - FORBIDDEN: Descriptions in parentheses like "(ไม้มลาย)" or "(สระอา)"
   - FORBIDDEN: Any words, explanations, or text after the pattern
   - JUST the vowel pattern: Thai characters with dashes/placeholders ONLY
2. english_vowel: The normal English phonetic equivalent using simple English letters only (e.g., "ai", "ao", "ah", "oe")

Return JSON with:
- thai_vowel: Thai vowel pattern ONLY (NO descriptions, NO parentheses, NO words - just the pattern like "ไ–" or "–า")
- english_vowel: English phonetic equivalent (normal English letters only, no special characters)`;

  console.log('[GPT Rule Vowels] Prompts prepared', { 
    systemPromptLength: systemPrompt.length, 
    userPromptLength: userPrompt.length,
    evidence: evidence.trim(),
    g2pCode
  });

  try {
    console.log('[GPT Rule Vowels] Calling GPT API...');
    const response = await callGPTAPI({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      maxCompletionTokens: 200,
      responseFormat: { type: 'json_object' }
    });

    console.log('[GPT Rule Vowels] GPT API response received', { 
      hasChoices: !!response.choices,
      choiceCount: response.choices?.length 
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      console.error('[GPT Rule Vowels] GPT returned empty response', { response });
      throw new Error('GPT returned empty response');
    }

    console.log('[GPT Rule Vowels] Response content', { 
      contentLength: content.length, 
      contentPreview: content.substring(0, 200) 
    });

    // Parse JSON response
    let parsed: RuleVowelAnalysisResult;
    try {
      parsed = JSON.parse(content);
      console.log('[GPT Rule Vowels] JSON parsed successfully', { 
        hasEnglishVowel: !!parsed.english_vowel,
        hasThaiVowel: !!parsed.thai_vowel,
        englishVowel: parsed.english_vowel,
        thaiVowel: parsed.thai_vowel
      });
    } catch (parseError) {
      console.error('[GPT Rule Vowels] JSON parse failed', { 
        error: parseError instanceof Error ? parseError.message : String(parseError),
        content 
      });
      throw new Error(`Failed to parse GPT JSON response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    }

    // Validate required fields
    if (!parsed.english_vowel || typeof parsed.english_vowel !== 'string') {
      console.error('[GPT Rule Vowels] Invalid english_vowel', { 
        value: parsed.english_vowel, 
        type: typeof parsed.english_vowel 
      });
      throw new Error('GPT response missing or invalid english_vowel field');
    }

    if (!parsed.thai_vowel || typeof parsed.thai_vowel !== 'string') {
      console.error('[GPT Rule Vowels] Invalid thai_vowel', { 
        value: parsed.thai_vowel, 
        type: typeof parsed.thai_vowel 
      });
      throw new Error('GPT response missing or invalid thai_vowel field');
    }

    // STRICT VALIDATION: thai_vowel must NOT contain English letters, parentheses, or descriptions
    const thaiVowelTrimmed = parsed.thai_vowel.trim();
    
    // Reject if contains English letters
    const englishLetterPattern = /[a-zA-Z]/;
    if (englishLetterPattern.test(thaiVowelTrimmed)) {
      console.error('[GPT Rule Vowels] thai_vowel contains English letters - REJECTED', { 
        thaiVowel: thaiVowelTrimmed
      });
      throw new Error(`thai_vowel field contains English letters: "${thaiVowelTrimmed}". thai_vowel must contain ONLY the vowel pattern (e.g., "ไ–", "–า"), NO descriptions, NO parentheses, NO words.`);
    }
    
    // Reject if contains parentheses (indicates description was included)
    if (thaiVowelTrimmed.includes('(') || thaiVowelTrimmed.includes(')')) {
      console.error('[GPT Rule Vowels] thai_vowel contains parentheses - REJECTED', { 
        thaiVowel: thaiVowelTrimmed
      });
      throw new Error(`thai_vowel field contains parentheses: "${thaiVowelTrimmed}". thai_vowel must contain ONLY the vowel pattern (e.g., "ไ–", "–า"), NO descriptions in parentheses, NO words.`);
    }

    const result = {
      english_vowel: parsed.english_vowel.trim(),
      thai_vowel: thaiVowelTrimmed
    };

    console.log('[GPT Rule Vowels] Analysis complete', { 
      evidence, 
      g2pCode,
      englishVowel: result.english_vowel, 
      thaiVowel: result.thai_vowel 
    });

    return result;
  } catch (error) {
    console.error('[GPT Rule Vowels] Analysis failed', { 
      evidence, 
      g2pCode,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw new Error(`GPT rule vowel analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
