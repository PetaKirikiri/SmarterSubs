/**
 * AI4Thai G2P (Grapheme-to-Phoneme) Service
 * Convert Thai text to G2P phonetic representation using AI4Thai API
 */

import { getAI4ThaiApiKey, AI4THAI_G2P_ENDPOINT } from '../../utils/ai4thaiConfig';
import { sanitizeThaiText } from '../../utils/thaiTextSanitizer';

/**
 * Get G2P (Grapheme-to-Phoneme) phonetic representation for Thai text
 * @param {string} textTh - Thai text to convert
 * @returns {Promise<string | null>} G2P phonetic string or null on error
 */
export async function getG2P(textTh: string): Promise<string | null> {
  try {
    if (!textTh || !textTh.trim()) {
      return null;
    }
    
    const sanitized = sanitizeThaiText(textTh);
    const cleanToken = sanitized.trim();
    
    if (!cleanToken) {
      return null;
    }
    
    const apiKey = getAI4ThaiApiKey();
    if (!apiKey || !apiKey.trim()) {
      console.warn('[G2P] API key is missing. Set it using: setAI4ThaiApiKey("your-key-here") or VITE_AI4THAI_API_KEY environment variable');
      return null;
    }
    
    const headers = {
      'Apikey': apiKey.trim(),
      'Content-Type': 'application/json'
    };
    
    const requestBody = JSON.stringify({
      text: cleanToken,
      output_type: 'phoneme'
    });
    
    const response = await fetch(AI4THAI_G2P_ENDPOINT, {
      method: 'POST',
      headers,
      body: requestBody
    });
    
    if (!response.ok) {
      let errorText = '';
      try {
        errorText = await response.text();
      } catch (e) {
        errorText = 'Could not read error response body';
      }
      console.error(`[G2P] API error: ${response.status} ${response.statusText} - ${errorText.substring(0, 200)}`);
      return null;
    }
    
    const data = await response.json();
    
    let phoneme = '';
    
    if (data.phoneme && typeof data.phoneme === 'string') {
      phoneme = data.phoneme;
    } else if (data.result && typeof data.result === 'string') {
      phoneme = data.result;
    } else if (data.result && Array.isArray(data.result)) {
      phoneme = data.result.join('|');
    }
    
    return phoneme.trim() || null;
  } catch (error) {
    console.error('[G2P] Error:', error);
    return null;
  }
}
