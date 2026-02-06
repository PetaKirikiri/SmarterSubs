/**
 * Thai Text Sanitizer
 * Removes non-standard Thai characters (punctuation, etc.) before sending to tokenizers
 */

/**
 * Sanitize Thai text by removing non-standard characters
 * Preserves: Thai Unicode characters (U+0E00–U+0E7F), spaces, numbers
 * Removes: Punctuation like (), -, ., ,, ;, :, !, ?, ", ', [, ], {, }
 * 
 * @param {string | null | undefined} text - Thai text to sanitize
 * @returns {string} Sanitized Thai text
 */
export function sanitizeThaiText(text: string | null | undefined): string {
  // Handle null/undefined/empty inputs
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  // Remove common punctuation characters that shouldn't be in Thai words
  // Preserve: Thai characters (U+0E00–U+0E7F), spaces, numbers (0-9)
  // Remove: Common punctuation and Unicode punctuation (ellipsis, em dash, etc.)
  const sanitized = text.replace(/[()\-.,;:!?"'\[\]{}\u2026\u2014\u2013\u201C\u201D\u2018\u2019]/g, '');
  
  // Trim whitespace
  return sanitized.trim();
}
