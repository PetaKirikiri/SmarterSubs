/**
 * Seed data for Thai vowel patterns
 * 31 canonical Thai vowel patterns that will be seeded into phonetic_g2p_rules table
 */

export const THAI_VOWEL_SEEDS = [
  { thai_vowel: '–ะ' },
  { thai_vowel: '–า' },
  { thai_vowel: '–ิ' },
  { thai_vowel: '–ี' },
  { thai_vowel: '–ึ' },
  { thai_vowel: '–ื' },
  { thai_vowel: '–ุ' },
  { thai_vowel: '–ู' },
  { thai_vowel: 'เ–ะ' },
  { thai_vowel: 'เ–' },
  { thai_vowel: 'แ–ะ' },
  { thai_vowel: 'แ–' },
  { thai_vowel: 'โ–ะ' },
  { thai_vowel: 'โ–' },
  { thai_vowel: 'เ–าะ' },
  { thai_vowel: '–อ' },
  { thai_vowel: 'เ–อะ' },
  { thai_vowel: 'เ–อ' },
  { thai_vowel: 'เ–ียะ' },
  { thai_vowel: 'เ–ีย' },
  { thai_vowel: 'เ–ือะ' },
  { thai_vowel: 'เ–ือ' },
  { thai_vowel: '–ัวะ' },
  { thai_vowel: '–ัว' },
  { thai_vowel: 'ไ–' },
  { thai_vowel: 'ใ–' },
  { thai_vowel: 'เ–า' },
  { thai_vowel: 'ฤ' },
  { thai_vowel: 'ฤๅ' },
  { thai_vowel: 'ฦ' },
  { thai_vowel: 'ฦๅ' },
] as const;

export const SEEDED_VOWEL_COUNT = THAI_VOWEL_SEEDS.length;
