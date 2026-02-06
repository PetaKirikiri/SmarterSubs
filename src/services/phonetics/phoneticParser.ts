/**
 * Phonetic Parser Utilities
 * Converts AI4Thai G2P phonetic format to a simple, readable Latin spelling.
 *
 * AI4Thai format examples:
 *   "w-a0-n^|phr-u2-ng^|n-ii3"
 *   "*n-a4-j^|*"            (may include leading/trailing '*' tokens)
 *   "h-@@4|r-@@0|z-@@0"     (special vowel tokens like @@)
 *   "m-vva1-n^|k-a0-n^|*"   (special token vva)
 *
 * Notes:
 * - Syllables are separated by "|"
 * - Within a syllable, phonemes are separated by "-"
 * - Tone digits (0-4) appear inside phoneme tokens and should be removed for display
 * - "^" marks syllable boundary in-token and should be removed for display
 * - "*" tokens are markers and should be ignored
 * - AI4Thai often uses a leading "z" to represent a silent carrier / glottal onset for Thai vowel-leading words.
 *   For readable English spelling we usually drop a leading "z".
 */

/**
 * Parse AI4Thai G2P phonetic string into readable Latin spelling.
 *
 * @param {string} phonetic - G2P phonetic string
 * @returns {Promise<string | null>} Readable English phonetic representation or null on error
 */
export async function parsePhoneticToEnglish(phonetic: string): Promise<string | null> {
  if (!phonetic || !phonetic.trim()) return null;

  try {
    const rawSyllables = phonetic.trim().split('|');
    const englishParts: string[] = [];

    for (const raw of rawSyllables) {
      const s = (raw || '').trim();
      if (!s) continue;

      // Split into phoneme tokens
      const tokens = s.split('-').map(t => (t || '').trim()).filter(Boolean);

      // Build the syllable "code" string (still containing special sequences like @@, vva, vv, x)
      let code = '';
      for (let tok of tokens) {
        if (!tok) continue;
        if (tok === '*') continue;

        // Remove tone digits and caret markers
        tok = tok.replace(/[0-4]/g, '').replace(/\^/g, '');

        // Keep only characters that are meaningful in AI4Thai codes
        // (letters plus special sequences like '@')
        tok = tok.replace(/[^a-zA-Z@]/g, '');

        if (!tok) continue;
        code += tok;
      }

      if (!code) continue;

      const english = convertPhonemesToEnglish(code);
      if (english) englishParts.push(english);
    }

    const result = englishParts.join(' ').trim();
    return result || null;
  } catch {
    return null;
  }
}

/**
 * Convert beginning 'j' to 'y' sound.
 * In Thai phonetics, 'j' at the beginning of a syllable represents 'y' sound.
 *
 * @param {string} phonemes - Phoneme string
 * @returns {string} Converted phoneme string
 */
function convertBeginningJ(phonemes: string): string {
  // Convert beginning j to y
  return phonemes.replace(/^j/, 'y');
}

/**
 * Convert end-of-syllable 'j' to vowel sound based on preceding vowel.
 * In Thai phonetics, 'j' at the end of a syllable represents vowel sounds (-ai or -oi).
 * This function is called AFTER vowel tweaks (aa->ah, uu->oo), so we check for converted forms.
 *
 * @param {string} phonemes - Phoneme string
 * @returns {string} Converted phoneme string
 */
function convertEndOfSyllableJ(phonemes: string): string {
  // Check if ends with 'j'
  if (!phonemes.endsWith('j')) return phonemes;
  
  // Handle different preceding vowel patterns
  // Order matters - check longer patterns first
  
  // After ooa (from uua after uu->oo conversion)
  // Example: ch-uua2-j^ -> chuuaaj -> chooaaj -> chuai
  if (phonemes.match(/ooaj$/)) {
    return phonemes.replace(/ooaj$/, 'uai');
  }
  
  // After oe (from @@ or qq conversion)
  // Example: d-@@2-j^ -> d@@j -> doej -> doi
  // Example: ch-qq4-j^ -> chqqj -> choej -> choi
  if (phonemes.match(/oej$/)) {
    return phonemes.replace(/oej$/, 'oi');
  }
  
  // After ah (from aa conversion)
  // Example: d-aa2-j^ -> daaj -> dahj -> dai
  // Example: k-aa0-j^ -> kaaj -> kahj -> kai
  if (phonemes.match(/ahj$/)) {
    return phonemes.replace(/ahj$/, 'ai');
  }
  
  // After a (single)
  // Example: c-a0-j^ -> caj -> caj -> cai (but c might need special handling)
  // Example: ch-a2-j^ -> chaj -> chai
  // Example: p-a0-j^ -> paj -> pai
  if (phonemes.match(/aj$/)) {
    return phonemes.replace(/aj$/, 'ai');
  }
  
  // After oo (from uu conversion, but not ooa which is handled above)
  // This handles cases where uu->oo but not followed by a
  if (phonemes.match(/ooj$/)) {
    return phonemes.replace(/ooj$/, 'oi');
  }
  
  // After u (single)
  // Example: k-u3-j^ -> kuj -> kui
  if (phonemes.match(/uj$/)) {
    return phonemes.replace(/uj$/, 'ui');
  }
  
  return phonemes;
}

/**
 * Convert a normalized AI4Thai syllable code (no tone digits, no '^') into readable Latin spelling.
 *
 * IMPORTANT: ordering matters. We apply longer/special patterns first.
 *
 * @param {string} phonemes - Normalized phoneme string
 * @returns {string} Readable English phonetic representation
 */
export function convertPhonemesToEnglish(phonemes: string): string {
  if (!phonemes) return '';

  let result = phonemes.toLowerCase();

  // 1) Handle AI4Thai carrier "z".
  //    Thai has no "z" phoneme in native words; AI4Thai uses "z" as a silent onset.
  //    Drop a leading z (and only the leading one).
  result = result.replace(/^z+/, '');

  // 2) Remove known filler / junk tokens that sometimes appear.
  //    "xx" appears in some outputs; treat as no-sound marker.
  result = result.replace(/xx/g, '');

  // 3) Convert beginning 'j' to 'y' sound (before special vowels).
  //    In Thai, 'j' at the beginning represents 'y' sound.
  result = convertBeginningJ(result);

  // 4) Handle 'qqj' pattern first (before 'qq' conversion).
  //    'qqj' should become 'oi' (similar to '@@j' -> 'oi').
  //    Must be done before 'qq' -> 'er' conversion to avoid conflicts.
  result = result.replace(/qqj/g, 'oi');

  // 5) Handle single 'q' token.
  //    Single 'q' represents a short vowel sound, convert to 'o'.
  //    Use negative lookahead to avoid matching 'q' that's part of 'qq'.
  result = result.replace(/q(?!q)/g, 'o');

  // 6) Vowel special tokens.
  //    vva / vv / @@ are AI4Thai-specific.
  //    - vva ~ /ɯa/ (เ-ือ) -> "uea" is a decent readability approximation
  //    - vv  ~ /ɯ/  (เ-อ/ึ) -> "ue" approximation
  //    - @@  ~ /ɤ/  (เ-อะ/เ-อ) -> "oe" approximation
  result = result.replace(/vva/g, 'uea');
  result = result.replace(/vv/g, 'ue');
  result = result.replace(/@@/g, 'oe');

  // 6.5) Convert remaining single 'v' to 'u' sound.
  //      Single 'v' represents /ɯ/ or /u/ sound, convert to 'u' for readability.
  //      Must be done after 'vv' and 'vva' conversions to avoid conflicts.
  result = result.replace(/v/g, 'u');

  // 7) Handle remaining 'qq' token (after 'qqj' is already converted).
  //    'qq' represents a vowel sound similar to 'er' for better readability.
  result = result.replace(/qq/g, 'er');

  // 8) Common consonant clusters and Thai romanization-ish normalizations.
  //    IMPORTANT: Preserve b, p, and bp distinctions:
  //    - 'b' (บ - bo bai mai) is preserved as 'b' - no conversion
  //    - 'p' (ป - po puen) is preserved as 'p' - no conversion
  //    - 'bp' (bp - bo bpla) sequences are preserved as 'bp' - no conversion
  //      (bp sequences come from 'b-xx-p' patterns after removing 'xx' filler)
  //    - Only 'ph' (ผ/พ - aspirated) is converted to 'p'
  //    Keep these BEFORE single-letter normalizations.
  result = result
    .replace(/phr/g, 'pr')
    .replace(/phl/g, 'pl')
    .replace(/khr/g, 'kr')
    .replace(/thr/g, 'tr')
    .replace(/chh/g, 'ch')
    .replace(/kh/g, 'k')
    .replace(/th/g, 't')
    .replace(/ph/g, 'p');

  // 9) Long/short vowels and readability tweaks.
  //    Keep ii->ee, uu->oo, aa->ah.
  result = result
    .replace(/ii/g, 'ee')
    .replace(/uu/g, 'oo')
    .replace(/aa/g, 'ah');

  // 10) Convert end-of-syllable 'j' to vowel sound (after vowel tweaks, before final cleaning).
  //     In Thai phonetics, 'j' at the end represents vowel sounds (-ai or -oi).
  result = convertEndOfSyllableJ(result);

  // 11) Handle AI4Thai "x" used in some vowel contexts.
  //     Your logs show things like: "l-x1" becoming "lx" which looks wrong.
  //     Treat a remaining 'x' as "ae" (very rough but far more readable than leaving 'x').
  result = result.replace(/x/g, 'ae');

  // 12) Clean remaining characters.
  //     Keep only letters; by now special tokens should be expanded.
  result = result.replace(/[^a-z]/g, '');

  // 13) Final polish: collapse very rare empties.
  return result.trim();
}
