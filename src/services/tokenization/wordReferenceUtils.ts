/**
 * Word Reference Utilities
 * Parse and format word reference strings (format: "wordId:senseIndex")
 */

/**
 * Parse word reference string (format: "wordId:senseIndex")
 * @param {string} wordRef - Word reference string
 * @returns {{ thaiScript: string | null, senseIndex: number | null }} Parsed word reference
 */
export function parseWordReference(wordRef: string): {
  thaiScript: string | null;
  senseIndex: number | null;
} {
  if (!wordRef || typeof wordRef !== 'string') {
    return { thaiScript: null, senseIndex: null };
  }

  const parts = wordRef.split(':');
  const thaiScript = parts[0] && parts[0].trim() !== '' ? parts[0].trim() : null;
  const senseIndex = parts.length > 1 && parts[1] !== '' ? parseInt(parts[1], 10) : null;

  return { thaiScript, senseIndex };
}

/**
 * Format word reference string (format: "wordId:senseIndex")
 * @param {string} thaiScript - Thai script word ID
 * @param {number | null} senseIndex - Sense index (optional)
 * @returns {string} Formatted word reference
 */
export function formatWordReference(thaiScript: string, senseIndex?: number | null): string {
  if (!thaiScript) return '';
  if (senseIndex === null || senseIndex === undefined) {
    return String(thaiScript);
  }
  return `${thaiScript}:${senseIndex}`;
}
