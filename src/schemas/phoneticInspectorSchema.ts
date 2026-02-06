import { z } from 'zod';

/**
 * Phonetic Inspector Schema
 * 
 * Validates data structures used by PhoneticInspector component
 * Matches Drizzle schema definitions in src/supabase/schema.ts
 * 
 * ⚠️ USE ZOD DIRECTLY: This schema validates DATA STRUCTURE (fields, types, required/optional)
 * 
 * Usage:
 * - Before save: `phoneticInspectorSchema.parse(data)` - throws if structure invalid
 * - On data pull: `phoneticInspectorSchema.safeParse(dbData)` - returns success/error
 * - Early exit: Validate structure immediately and exit if invalid
 * 
 * Example:
 * ```typescript
 * // Validate structure before processing
 * const result = vowelExampleSchema.safeParse(example);
 * if (!result.success) {
 *   console.warn('Invalid example structure:', result.error);
 *   return; // Exit early
 * }
 * ```
 */

/**
 * Vowel Example Schema
 * Represents a single example word for a vowel pattern
 * Matches VowelExample interface in PhoneticInspector.tsx
 */
export const vowelExampleSchema = z.object({
  word_th: z.string()
    .min(1, 'word_th is required')
    .refine(val => val.trim().length > 0, 'word_th cannot be empty or only whitespace'),
  g2p: z.string()
    .min(1, 'g2p is required')
    .refine(val => val.trim().length > 0, 'g2p cannot be empty or only whitespace'),
  phonetic_en: z.string()
    .min(1, 'phonetic_en is required')
    .refine(val => val.trim().length > 0, 'phonetic_en cannot be empty or only whitespace'),
  // GPT fields are optional/nullable until processed
  thai_vowel_label: z.union([
    z.string().min(1).refine(val => val.trim().length > 0, 'thai_vowel_label cannot be empty string'),
    z.null(),
    z.undefined()
  ]).optional(),
  gpt_phonetic: z.union([
    z.string().min(1).refine(val => val.trim().length > 0, 'gpt_phonetic cannot be empty string'),
    z.null(),
    z.undefined()
  ]).optional(),
});

export type VowelExample = z.infer<typeof vowelExampleSchema>;

/**
 * Vowel Data Schema
 * Represents a vowel pattern with its examples
 * Matches VowelData interface in PhoneticInspector.tsx
 */
export const vowelDataSchema = z.object({
  pattern: z.string()
    .min(1, 'pattern is required')
    .refine(val => val.trim().length > 0, 'pattern cannot be empty or only whitespace'),
  parserOutput: z.string()
    .refine(val => val !== undefined, 'parserOutput is required'), // Can be empty string (user input field)
  examples: z.array(vowelExampleSchema)
    .min(0, 'examples must be an array'), // Can be empty array
});

export type VowelData = z.infer<typeof vowelDataSchema>;

/**
 * Phonetic G2P Rule Schema
 * Matches phonetic_g2p_rules table structure from Drizzle schema
 * Used for validating rules fetched from database
 */
export const phoneticG2PRuleSchema = z.object({
  id: z.number()
    .int('id must be an integer')
    .min(1, 'id must be >= 1'),
  g2p_code: z.string()
    .min(1, 'g2p_code is required')
    .refine(val => val.trim().length > 0, 'g2p_code cannot be empty or only whitespace'),
  english_vowel: z.union([
    z.string().min(1).refine(val => val.trim().length > 0, 'english_vowel cannot be empty string'),
    z.null(),
    z.undefined(),
    z.literal('') // Allow empty string for seeded vowels (will be filled by GPT)
  ]).optional(),
  thai_vowel: z.union([
    z.string().min(1).refine(val => val.trim().length > 0, 'thai_vowel cannot be empty string'),
    z.null(),
    z.undefined()
  ]).optional(),
  phonetic_output: z.union([
    z.string().refine(val => val !== undefined, 'phonetic_output must be defined'), // Can be empty string
    z.null(),
    z.undefined()
  ]).optional(),
  evidence: z.union([
    z.string().min(1).refine(val => val.trim().length > 0, 'evidence cannot be empty string'),
    z.null(),
    z.undefined(),
    z.literal('') // Allow empty string for seeded vowels (will be populated later)
  ]).optional(),
});

export type PhoneticG2PRule = z.infer<typeof phoneticG2PRuleSchema>;

/**
 * Phonetic G2P Evidence Schema
 * Matches phonetic_g2p_evidence table structure from Drizzle schema
 * Used for validating evidence fetched from database
 */
export const phoneticG2PEvidenceSchema = z.object({
  id: z.number()
    .int('id must be an integer')
    .min(1, 'id must be >= 1'),
  g2p_code: z.string()
    .min(1, 'g2p_code is required')
    .refine(val => val.trim().length > 0, 'g2p_code cannot be empty or only whitespace'),
  word_id: z.string()
    .min(1, 'word_id is required')
    .refine(val => val.trim().length > 0, 'word_id cannot be empty or only whitespace'),
  word_th: z.string()
    .min(1, 'word_th is required')
    .refine(val => val.trim().length > 0, 'word_th cannot be empty or only whitespace'),
  g2p: z.union([
    z.string().min(1).refine(val => val.trim().length > 0, 'g2p cannot be empty string'),
    z.null(),
    z.undefined()
  ]).optional(),
  parser_phonetic: z.union([
    z.string().min(1).refine(val => val.trim().length > 0, 'parser_phonetic cannot be empty string'),
    z.null(),
    z.undefined()
  ]).optional(),
  thai_vowel_label: z.union([
    z.string().min(1).refine(val => val.trim().length > 0, 'thai_vowel_label cannot be empty string'),
    z.null(),
    z.undefined()
  ]).optional(),
  gpt_phonetic: z.union([
    z.string().min(1).refine(val => val.trim().length > 0, 'gpt_phonetic cannot be empty string'),
    z.null(),
    z.undefined()
  ]).optional(),
});

export type PhoneticG2PEvidence = z.infer<typeof phoneticG2PEvidenceSchema>;

/**
 * Seeded Vowel Rule Schema
 * Validates that a rule is a seeded vowel (ID 1-31)
 * Used for early validation/exit if structure doesn't match expectations
 */
export const seededVowelRuleSchema = phoneticG2PRuleSchema.extend({
  id: z.number()
    .int('id must be an integer')
    .min(1, 'id must be >= 1')
    .max(31, 'id must be <= 31 for seeded vowels'),
  thai_vowel: z.string()
    .min(1, 'thai_vowel is required for seeded vowels')
    .refine(val => val.trim().length > 0, 'thai_vowel cannot be empty or only whitespace'),
});

export type SeededVowelRule = z.infer<typeof seededVowelRuleSchema>;

/**
 * Array schemas for batch validation
 */
export const vowelDataArraySchema = z.array(vowelDataSchema);
export const phoneticG2PRuleArraySchema = z.array(phoneticG2PRuleSchema);
export const phoneticG2PEvidenceArraySchema = z.array(phoneticG2PEvidenceSchema);
export const seededVowelRuleArraySchema = z.array(seededVowelRuleSchema);

/**
 * Validation helpers for early exit
 */
export function validateVowelData(data: unknown): VowelData {
  return vowelDataSchema.parse(data);
}

export function validateVowelDataArray(data: unknown): VowelData[] {
  return vowelDataArraySchema.parse(data);
}

export function validatePhoneticG2PRule(data: unknown): PhoneticG2PRule {
  return phoneticG2PRuleSchema.parse(data);
}

export function validatePhoneticG2PRuleArray(data: unknown): PhoneticG2PRule[] {
  return phoneticG2PRuleArraySchema.parse(data);
}

export function validatePhoneticG2PEvidence(data: unknown): PhoneticG2PEvidence {
  return phoneticG2PEvidenceSchema.parse(data);
}

export function validatePhoneticG2PEvidenceArray(data: unknown): PhoneticG2PEvidence[] {
  return phoneticG2PEvidenceArraySchema.parse(data);
}

/**
 * Early exit validation - returns null if invalid instead of throwing
 * Use for non-critical validation where we want to skip invalid items
 */
export function safeValidateVowelData(data: unknown): VowelData | null {
  const result = vowelDataSchema.safeParse(data);
  return result.success ? result.data : null;
}

export function safeValidatePhoneticG2PRule(data: unknown): PhoneticG2PRule | null {
  const result = phoneticG2PRuleSchema.safeParse(data);
  return result.success ? result.data : null;
}

export function safeValidatePhoneticG2PEvidence(data: unknown): PhoneticG2PEvidence | null {
  const result = phoneticG2PEvidenceSchema.safeParse(data);
  return result.success ? result.data : null;
}

/**
 * Validate seeded vowel count - early exit if count doesn't match expectations
 * Returns true if valid, false if invalid (for early exit)
 */
export function validateSeededVowelCount(rules: PhoneticG2PRule[], expectedCount: number = 31): boolean {
  const seededRules = rules.filter(rule => rule.id >= 1 && rule.id <= 31);
  return seededRules.length === expectedCount;
}

/**
 * Validate rule structure matches expectations - early exit helper
 * Returns true if structure is valid, false if invalid (for early exit)
 */
export function validateRuleStructure(rule: unknown): rule is PhoneticG2PRule {
  return phoneticG2PRuleSchema.safeParse(rule).success;
}
