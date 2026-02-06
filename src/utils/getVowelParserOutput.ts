/**
 * Get what the phonetic parser converts each vowel pattern to
 * Uses the same logic as convertPhonemesToEnglish but for individual patterns
 */

/**
 * Get parser output for a vowel pattern
 * Returns what the phonetic parser converts this vowel pattern to
 * @param vowelPattern - Vowel pattern (e.g., "aa", "@@", "vva")
 * @returns Parser output (e.g., "ah", "oe", "uea")
 */
export function getVowelParserOutput(vowelPattern: string): string {
  if (!vowelPattern) return '';
  
  // Map vowel patterns to their parser outputs
  // Based on convertPhonemesToEnglish logic from phoneticParser.ts
  const vowelMap: Record<string, string> = {
    // Regular vowels (some are converted)
    'a': 'a',
    'aa': 'ah',  // aa -> ah
    'e': 'e',
    'ee': 'ee',
    'i': 'i',
    'ii': 'ee',  // ii -> ee
    'o': 'o',
    'oo': 'oo',
    'u': 'u',
    'uu': 'oo',  // uu -> oo
    
    // Special tokens
    '@@': 'oe',  // @@ -> oe
    'vv': 'ue',  // vv -> ue
    'vva': 'uea', // vva -> uea
    'q': 'o',    // q -> o
    'qq': 'er',  // qq -> er
    
    // Combinations (end-of-syllable 'j' conversions)
    'aj': 'ai',   // aj -> ai
    'ooj': 'oi',  // ooj -> oi
    'ooaj': 'uai', // ooaj -> uai (after uu->oo conversion)
    'oej': 'oi',  // oej -> oi (after @@->oe or qq->er conversion)
    'ahj': 'ai',  // ahj -> ai (after aa->ah conversion)
    'uj': 'ui',   // uj -> ui
    'qqj': 'oi',  // qqj -> oi (before qq->er conversion)
  };
  
  return vowelMap[vowelPattern] || vowelPattern;
}
