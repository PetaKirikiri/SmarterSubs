/**
 * Phonetic Comparison Utilities
 * 
 * Compare GPT phonetic vs parser phonetic and aggregate statistics by g2p_code
 */

export interface PhoneticEvidence {
  g2p_code: string;
  word_id: string;
  word_th: string;
  parser_phonetic: string | null;
  thai_vowel_label: string | null;
  gpt_phonetic: string | null;
}

export interface PatternStatistics {
  g2p_code: string;
  most_common_vowel: string | null;
  vowel_counts: Record<string, number>;
  total_words: number;
  processed_words: number;
  match_count: number;
  mismatch_count: number;
  match_rate: number;
}

/**
 * Compare two phonetic strings (fuzzy matching)
 * Returns true if they match closely enough
 * @param phonetic1 - First phonetic string
 * @param phonetic2 - Second phonetic string
 * @returns true if match, false otherwise
 */
export function comparePhonetics(phonetic1: string | null, phonetic2: string | null): boolean {
  if (!phonetic1 || !phonetic2) return false;

  // Normalize: lowercase, remove extra spaces
  const norm1 = phonetic1.toLowerCase().trim().replace(/\s+/g, ' ');
  const norm2 = phonetic2.toLowerCase().trim().replace(/\s+/g, ' ');

  // Exact match
  if (norm1 === norm2) return true;

  // Check if one is contained in the other (for partial matches)
  if (norm1.includes(norm2) || norm2.includes(norm1)) {
    // Only consider it a match if the shorter one is at least 70% of the longer one
    const shorter = norm1.length < norm2.length ? norm1 : norm2;
    const longer = norm1.length >= norm2.length ? norm1 : norm2;
    return shorter.length / longer.length >= 0.7;
  }

  // Calculate simple similarity (Levenshtein-like, simplified)
  const similarity = calculateSimilarity(norm1, norm2);
  return similarity >= 0.8; // 80% similarity threshold
}

/**
 * Calculate simple similarity between two strings
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Similarity score between 0 and 1
 */
function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length <= str2.length ? str1 : str2;

  if (longer.length === 0) return 1.0;

  // Simple character-based similarity
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) {
      matches++;
    }
  }

  return matches / longer.length;
}

/**
 * Group evidence by g2p_code and calculate statistics
 * @param evidence - Array of evidence records
 * @returns Map of g2p_code to PatternStatistics
 */
export function aggregatePatternStatistics(evidence: PhoneticEvidence[]): Map<string, PatternStatistics> {
  const patternMap = new Map<string, PatternStatistics>();

  for (const record of evidence) {
    const { g2p_code, parser_phonetic, thai_vowel_label, gpt_phonetic } = record;

    if (!patternMap.has(g2p_code)) {
      patternMap.set(g2p_code, {
        g2p_code,
        most_common_vowel: null,
        vowel_counts: {},
        total_words: 0,
        processed_words: 0,
        match_count: 0,
        mismatch_count: 0,
        match_rate: 0,
      });
    }

    const stats = patternMap.get(g2p_code)!;
    stats.total_words++;

    // Count vowel labels
    if (thai_vowel_label) {
      stats.processed_words++;
      if (!stats.vowel_counts[thai_vowel_label]) {
        stats.vowel_counts[thai_vowel_label] = 0;
      }
      stats.vowel_counts[thai_vowel_label]++;
    }

    // Compare parser vs GPT phonetic
    if (parser_phonetic && gpt_phonetic) {
      if (comparePhonetics(parser_phonetic, gpt_phonetic)) {
        stats.match_count++;
      } else {
        stats.mismatch_count++;
      }
    }
  }

  // Calculate most common vowel and match rate for each pattern
  for (const [g2p_code, stats] of patternMap.entries()) {
    // Find most common vowel
    let maxCount = 0;
    let mostCommon = null;
    for (const [vowel, count] of Object.entries(stats.vowel_counts)) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = vowel;
      }
    }
    stats.most_common_vowel = mostCommon;

    // Calculate match rate
    const totalComparisons = stats.match_count + stats.mismatch_count;
    stats.match_rate = totalComparisons > 0 ? stats.match_count / totalComparisons : 0;
  }

  return patternMap;
}

/**
 * Get statistics for a specific g2p_code pattern
 * @param evidence - Array of evidence records
 * @param g2pCode - Pattern to get statistics for
 * @returns PatternStatistics or null if no data
 */
export function getPatternStatistics(evidence: PhoneticEvidence[], g2pCode: string): PatternStatistics | null {
  const statsMap = aggregatePatternStatistics(evidence);
  return statsMap.get(g2pCode) || null;
}
