/**
 * AI4Thai Tokenizer
 * Tokenize Thai sentences using AI4Thai API
 */

import { getAI4ThaiApiKey, AI4THAI_TOKENIZE_ENDPOINT } from '../../utils/ai4thaiConfig';
import { sanitizeThaiText } from '../../utils/thaiTextSanitizer';

/**
 * Tokenize Thai sentence into array of tokens
 * @param {string} thaiSentence - Thai sentence to tokenize
 * @returns {Promise<string[]>} Array of token strings
 */
export async function tokenizeThaiSentence(thaiSentence: string): Promise<string[]> {
  try {
    const apiKey = getAI4ThaiApiKey();
    if (!apiKey || !apiKey.trim()) {
      throw new Error('[Thai Pipeline] ❌ API key is missing. Set it using: setAI4ThaiApiKey("your-key-here") or VITE_AI4THAI_API_KEY environment variable');
    }
    
    const headers = {
      'Apikey': apiKey.trim(),
      'Content-Type': 'application/x-www-form-urlencoded'
    };
    
    const sanitized = sanitizeThaiText(thaiSentence);
    const cleanText = sanitized.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    
    const formData = new URLSearchParams();
    formData.append('text', cleanText);
    formData.append('sep', '|');
    formData.append('wordseg', 'true');
    formData.append('sentseg', 'false');
    
    
    let response: Response;
    try {
      response = await fetch(AI4THAI_TOKENIZE_ENDPOINT, {
        method: 'POST',
        headers,
        body: formData.toString()
      });
    } catch (fetchError) {
      throw fetchError;
    }
    
    if (!response.ok) {
      let errorText = '';
      try {
        errorText = await response.text();
      } catch (e) {
        errorText = 'Could not read error response body';
      }
      throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText.substring(0, 200)}`);
    }
    
    const data = await response.json();
    
    let tokens: string[] = [];
    
    if (data.result && Array.isArray(data.result)) {
      data.result.forEach((sentenceTokens: string | unknown) => {
        if (typeof sentenceTokens === 'string') {
          const sentenceTokenArray = sentenceTokens.split('|').filter(t => t && t.trim());
          tokens.push(...sentenceTokenArray);
        }
      });
    } else if (data.result && typeof data.result === 'string') {
      tokens = data.result.split('|').filter(t => t && t.trim());
    } else {
    }
    
    // Clean tokens: remove any punctuation that might have been included
    // Remove common punctuation and Unicode punctuation (ellipsis, em dash, etc.)
    const cleanedTokens = tokens
      .map(token => token.replace(/[()\-.,;:!?"'\[\]{}\u2026\u2014\u2013\u201C\u201D\u2018\u2019]/g, '').trim())
      .filter(t => t && t.length > 0);
    
    return cleanedTokens;
  } catch (error) {
    throw error;
  }
}

/**
 * Build tokens_th object from Thai text
 * Converts tokenized text to the format expected by subtitleSchema: { tokens: string[] }
 * @param {string} thaiText - Thai text to tokenize
 * @returns {Promise<{ tokens: string[] }>} Thai tokens object (for tokens_th field)
 */
export async function buildThaiTokensFromText(thaiText: string): Promise<{ tokens: string[] }> {
  try {
    const tokens = await tokenizeThaiSentence(thaiText);
    return { tokens };
  } catch (error) {
    throw error;
  }
}
