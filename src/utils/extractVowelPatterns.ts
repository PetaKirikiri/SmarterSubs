/**
 * Extract vowel patterns from G2P strings
 * Used to identify which vowels appear in phonetic data
 */

/**
 * Normalize G2P string for pattern matching
 * Removes tone digits (0-4), caret markers (^), separators (|, -), and asterisks (*)
 * @param g2p - G2P phonetic string
 * @returns Normalized string with only meaningful characters
 */
export function normalizeG2PForPatternMatching(g2p: string): string {
  if (!g2p) return '';
  
  // Remove tone digits, caret markers, separators, and asterisks
  return g2p
    .replace(/[0-4]/g, '') // Remove tone digits
    .replace(/\^/g, '') // Remove caret markers
    .replace(/\|/g, '') // Remove syllable separators
    .replace(/-/g, '') // Remove phoneme separators
    .replace(/\*/g, '') // Remove asterisks
    .toLowerCase();
}

/**
 * Check if G2P contains a specific vowel pattern
 * Handles special cases where longer patterns must be checked first
 * @param g2p - G2P phonetic string
 * @param targetVowel - Vowel pattern to search for (e.g., "aa", "@@", "vva")
 * @returns true if pattern is found in G2P
 */
export function findVowelPatternsInG2P(g2p: string, targetVowel: string): boolean {
  if (!g2p || !targetVowel) return false;
  
  const normalized = normalizeG2PForPatternMatching(g2p);
  
  // Special handling for patterns that might overlap
  // Check longer patterns first to avoid false matches
  const specialPatterns = ['ooaj', 'qqj', 'ooj', 'oej', 'ahj', 'vva', '@@', 'qq', 'vv', 'uj', 'aj'];
  
  // If target is a special pattern, check it directly
  if (specialPatterns.includes(targetVowel)) {
    return normalized.includes(targetVowel);
  }
  
  // For single character vowels, check they're not part of a longer pattern
  if (targetVowel.length === 1) {
    // For 'q', make sure it's not part of 'qq' or 'qqj'
    if (targetVowel === 'q') {
      // Check for standalone 'q' (not followed by another 'q' or 'j')
      const qIndex = normalized.indexOf('q');
      if (qIndex === -1) return false;
      const nextChar = normalized[qIndex + 1];
      return nextChar !== 'q' && nextChar !== 'j';
    }
    
    // For 'v', make sure it's not part of 'vv' or 'vva'
    if (targetVowel === 'v') {
      const vIndex = normalized.indexOf('v');
      if (vIndex === -1) return false;
      const nextChar = normalized[vIndex + 1];
      return nextChar !== 'v' && nextChar !== 'a';
    }
    
    // For other single chars, simple check
    return normalized.includes(targetVowel);
  }
  
  // For double character vowels (aa, ee, ii, oo, uu), check they're not part of longer patterns
  if (targetVowel.length === 2) {
    // For 'aa', make sure it's not part of 'ahj' (but 'ahj' is already handled above)
    // For 'oo', make sure it's not part of 'ooj' or 'ooaj'
    if (targetVowel === 'oo') {
      const ooIndex = normalized.indexOf('oo');
      if (ooIndex === -1) return false;
      const afterOo = normalized.substring(ooIndex + 2);
      // Check if followed by 'j' or 'aj' (but those are separate patterns)
      // For now, just check if 'oo' exists
      return normalized.includes('oo');
    }
    
    // For other double chars, simple check
    return normalized.includes(targetVowel);
  }
  
  // Default: simple substring check
  return normalized.includes(targetVowel);
}

/**
 * Extract all vowel patterns from a G2P string
 * Returns array of unique vowel patterns found
 * Uses findVowelPatternsInG2P which handles the logic of avoiding false matches
 * @param g2p - G2P phonetic string
 * @returns Array of unique vowel patterns found in the G2P string
 */
export function extractVowelPatterns(g2p: string): string[] {
  if (!g2p) return [];
  
  const foundPatterns: string[] = [];
  
  // Define all vowel patterns in order of length (longest first)
  // This order is critical - longer patterns must be checked first
  const allPatterns = [
    'ooaj', 'qqj', 'vva', 'ooj', 'oej', 'ahj', 'qq', '@@', 'vv', 'xx', 'uj', 'aj',
    'aa', 'ee', 'ii', 'oo', 'uu',
    'a', 'e', 'i', 'o', 'u', 'q', 'v', 'x', '@'
  ];
  
  // Check each pattern - findVowelPatternsInG2P handles the logic
  // of avoiding false matches (e.g., not finding 'a' inside 'aa')
  for (const pattern of allPatterns) {
    if (findVowelPatternsInG2P(g2p, pattern)) {
      foundPatterns.push(pattern);
    }
  }
  
  return foundPatterns;
}

/** Known G2P vowel patterns (longest first for correct extraction) */
const G2P_VOWEL_PATTERNS = [
  'ooaj',
  'qqj',
  'vva',
  'ooj',
  'oej',
  'ahj',
  'qq',
  '@@',
  'vv',
  'xx', // AI4Thai: แ (แส), แะ - e.g. s-xx4, h-x3
  'uj',
  'aj',
  'aa',
  'ee',
  'ii',
  'oo',
  'uu',
  'a',
  'e',
  'i',
  'o',
  'u',
  'q',
  'v',
  'x', // AI4Thai: short ae - e.g. h-x3 (แฮะ)
  '@', // AI4Thai: เ–าะ - e.g. k-@1 (เกาะ)
];

/**
 * Extract the vowel pattern from a single G2P syllable.
 * Structure: consonant-vowel-ending. Consonant is consistent; vowel is one of the known inline constants.
 * G2P syllable format: "k-aa0-n^" or "d-@@2-j^" - phonemes separated by "-".
 * Returns the vowel pattern (e.g. "aa", "@@") or null if none found.
 */
export function extractVowelPatternFromG2PSyllable(g2pSyllable: string): string | null {
  if (!g2pSyllable?.trim()) return null;
  const tokens = g2pSyllable.trim().split('-').map((t) => (t || '').trim()).filter(Boolean);
  if (tokens.length < 2) return null;

  // Token 0 = initial consonant (consistent). Vowel region = tokens 1..n.
  const vowelTokens = tokens.slice(1);
  const vowelRegion = vowelTokens.join('');

  // Normalize (remove tone 0-4, ^) and match known patterns
  const normalized = normalizeG2PForPatternMatching(vowelRegion);
  for (const pattern of G2P_VOWEL_PATTERNS) {
    if (findVowelPatternsInG2P(normalized, pattern)) return pattern;
  }

  // Fallback: whole syllable (in case structure differs, e.g. no clear consonant)
  const fullNormalized = normalizeG2PForPatternMatching(g2pSyllable);
  for (const pattern of G2P_VOWEL_PATTERNS) {
    if (findVowelPatternsInG2P(fullNormalized, pattern)) return pattern;
  }
  return null;
}

/**
 * Map Thai character index to G2P syllable index.
 * Uses position heuristic: syllableIndex = floor(charIndex * syllableCount / wordLength).
 */
export function thaiCharIndexToSyllableIndex(
  charIndex: number,
  wordLength: number,
  syllableCount: number
): number {
  if (syllableCount <= 0 || wordLength <= 0) return 0;
  const idx = Math.floor((charIndex * syllableCount) / wordLength);
  return Math.min(idx, syllableCount - 1);
}
