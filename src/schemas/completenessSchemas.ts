import { z } from 'zod';
import { wordThSchema } from './wordThSchema';
import { meaningThSchema } from './meaningThSchema';

/**
 * Completeness Validation Schemas
 * 
 * ⚠️ PROCESSING STATE VALIDATION: These schemas add BUSINESS RULES for processing completeness
 * 
 * Purpose: Validate PROCESSING STATE (is data "complete" for processing?)
 * - Base schemas validate STRUCTURE (fields, types)
 * - Completeness schemas validate BUSINESS RULES (processing state)
 * 
 * Usage: Use Zod `.safeParse()` to check if processing can skip
 * 
 * Example:
 * ```typescript
 * // Check if word is "complete" (has processing data)
 * const isComplete = completeWordThSchema.safeParse(word).success;
 * if (isComplete) {
 *   // Skip processing - already has g2p OR phonetic_en
 * } else {
 *   // Need to process - call G2P API
 *   const g2p = await getG2P(word.word_th);
 * }
 * ```
 * 
 * ⚠️ SCHEMA ENFORCEMENT: These schemas EXTEND base schemas using .refine()
 * Base schema validation ALWAYS runs first - base rules CANNOT be bypassed
 * Completeness validation schemas ADD additional rules, they never remove base schema rules
 */

/**
 * Integrity Error Interface
 * Used for completeness validation error reporting
 */
export interface IntegrityError {
  field: string;
  message: string;
  path?: (string | number)[];
  present: boolean; // Whether the field exists in the data
  expected: string; // What was expected
  actual?: any; // What was actually found (if present but invalid)
}

/**
 * Completeness Validation Result Interface
 * Used by completeness validation functions
 */
export interface CompletenessValidationResult {
  passed: boolean;
  errors: IntegrityError[];
}

/**
 * Complete Word Thai Schema
 * 
 * Extends wordThSchema to require g2p OR phonetic_en
 * Base schema rules (word_th required, no empty strings) are enforced first
 * This completeness validation adds the requirement that word must have processing data
 */
export const completeWordThSchema = wordThSchema.refine(
  (data) => !!(data.g2p || data.phonetic_en),
  { 
    message: "Word must have g2p OR phonetic_en",
    path: ['g2p', 'phonetic_en']
  }
);

/**
 * Normalized Meaning Thai Schema
 * 
 * Extends meaningThSchema to require normalized source (not "orst" or "ORST")
 * Base schema rules (id, definition_th required) are enforced first
 * This completeness validation adds the requirement that meaning must be normalized
 */
export const normalizedMeaningThSchema = meaningThSchema.refine(
  (data) => {
    // Source must exist and be normalized
    if (!data.source || data.source.trim().length === 0) {
      return false; // Missing source
    }
    return data.source !== 'orst' && data.source !== 'ORST';
  },
  { 
    message: "Meaning must be normalized (source is required and cannot be 'orst' or 'ORST')",
    path: ['source']
  }
);

/**
 * Complete Token Thai Schema
 * 
 * Combines completeWordThSchema and normalizedMeaningThSchema
 * Token must have complete word data AND all meanings normalized (if meanings exist)
 * Base schema validation runs for both word and meanings before completeness checks
 */
export const completeTokenThSchema = z.object({
  token: z.string().min(1),
  word: completeWordThSchema, // Base wordThSchema validated first, then completeness validation
  senses: z.array(normalizedMeaningThSchema).optional(), // Base meaningThSchema validated first, then completeness validation
}).refine(
  (data) => {
    // If senses exist, all must be normalized
    // This is redundant with normalizedMeaningThSchema but provides additional safety
    if (data.senses && data.senses.length > 0) {
      return data.senses.every(s => {
        if (!s.source) return false;
        return s.source !== 'orst' && s.source !== 'ORST';
      });
    }
    return true;
  },
  { message: "All meanings must be normalized if they exist" }
);

// Legacy exports for backward compatibility during migration
export const completeWordContract = completeWordThSchema;
export const normalizedSenseContract = normalizedMeaningThSchema;
export const completeTokenContract = completeTokenThSchema;
export type ContractValidationResult = CompletenessValidationResult;
