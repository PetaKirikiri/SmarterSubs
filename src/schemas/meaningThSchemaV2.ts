import { z } from 'zod';
import { bigintCoerce, uuidCoerce } from './zodHelpers';

/**
 * Meaning Thai Schema V2 - Enhanced with POS and English definition
 * Database table: meanings_th
 * 
 * V2 adds:
 * - pos_th (Thai part of speech)
 * - pos_eng (English part of speech)
 * - definition_eng (English definition)
 * 
 * ⚠️ BACKWARD COMPATIBLE: V1 fields are still required
 * V2 fields are optional to allow gradual migration
 * 
 * ⚠️ USE ZOD DIRECTLY: This schema validates DATA STRUCTURE (fields, types, required/optional)
 * 
 * Usage:
 * - Before save: `meaningThSchemaV2.parse(data)` - throws if structure invalid
 * - On data pull: `meaningThSchemaV2.safeParse(dbData)` - returns success/error
 * - On processing: `meaningThSchemaV2.safeParse(data).success` - check if structure valid
 * 
 * ⚠️ SCHEMA ENFORCEMENT: Uses .strict() to reject unknown fields
 * All fields must be explicitly defined - no passthrough allowed
 */
export const meaningThSchemaV2 = z.object({
  // V1 fields (required)
  id: bigintCoerce,
  definition_th: z.string().min(1, 'definition_th is required'),
  word_th_id: z.string().optional(),
  source: z.string().optional(),
  created_at: z.string().datetime().optional(),
  
  // V2 fields (optional for backward compatibility)
  pos_th: z.string().optional(), // Thai part of speech (e.g., "คำนาม", "คำกริยา")
  pos_eng: z.string().optional(), // English part of speech (e.g., "noun", "verb")
  definition_eng: z.string().optional(), // English definition
}).strict(); // Reject unknown fields - all fields must be validated

export type MeaningThV2 = z.infer<typeof meaningThSchemaV2>;

/**
 * Check if a meaning object matches V2 schema (has V2 fields)
 */
export function isMeaningV2(meaning: unknown): meaning is MeaningThV2 {
  const result = meaningThSchemaV2.safeParse(meaning);
  return result.success;
}

/**
 * Check if a meaning has all V2 fields populated (complete V2)
 */
export function isCompleteV2(meaning: unknown): boolean {
  const result = meaningThSchemaV2.safeParse(meaning);
  if (!result.success) return false;
  
  const data = result.data;
  return !!(
    data.pos_th &&
    data.pos_eng &&
    data.definition_eng &&
    data.definition_th // V1 field still required
  );
}

/**
 * Detect schema version of a meaning
 * Returns 'v1', 'v2', or 'unknown'
 */
export function detectMeaningSchemaVersion(meaning: unknown): 'v1' | 'v2' | 'unknown' {
  const v2Result = meaningThSchemaV2.safeParse(meaning);
  if (v2Result.success) {
    // Check if it has V2 fields
    const hasV2Fields = !!(v2Result.data.pos_th || v2Result.data.pos_eng || v2Result.data.definition_eng);
    return hasV2Fields ? 'v2' : 'v1';
  }
  return 'unknown';
}
