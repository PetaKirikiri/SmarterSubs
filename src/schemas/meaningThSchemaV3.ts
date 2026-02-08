import { z } from 'zod';
import { bigintCoerce, uuidCoerce } from './zodHelpers';
import { meaningThSchemaV2, type MeaningThV2 } from './meaningThSchemaV2';

/**
 * Meaning Thai Schema V3 - Enhanced with singular English word label
 * Database table: meanings_th
 * 
 * V3 adds:
 * - label_eng (singular English word translation)
 * 
 * ⚠️ BACKWARD COMPATIBLE: V1 and V2 fields are still required
 * V3 fields are optional to allow gradual migration
 * 
 * ⚠️ USE ZOD DIRECTLY: This schema validates DATA STRUCTURE (fields, types, required/optional)
 * 
 * Usage:
 * - Before save: `meaningThSchemaV3.parse(data)` - throws if structure invalid
 * - On data pull: `meaningThSchemaV3.safeParse(dbData)` - returns success/error
 * - On processing: `meaningThSchemaV3.safeParse(data).success` - check if structure valid
 * 
 * ⚠️ SCHEMA ENFORCEMENT: Uses .strict() to reject unknown fields
 * All fields must be explicitly defined - no passthrough allowed
 */
export const meaningThSchemaV3 = meaningThSchemaV2.extend({
  // V3 fields (optional for backward compatibility)
  label_eng: z.string().optional(), // Singular English word translation
}).strict(); // Reject unknown fields - all fields must be validated

export type MeaningThV3 = z.infer<typeof meaningThSchemaV3>;

/**
 * Check if a meaning object matches V3 schema (has V3 fields)
 */
export function isMeaningV3(meaning: unknown): meaning is MeaningThV3 {
  const result = meaningThSchemaV3.safeParse(meaning);
  return result.success;
}

/**
 * Check if a meaning has all V3 fields populated (complete V3)
 */
export function isCompleteV3(meaning: unknown): boolean {
  const result = meaningThSchemaV3.safeParse(meaning);
  if (!result.success) return false;
  
  const data = result.data;
  return !!(
    data.label_eng &&
    data.label_eng.trim().length > 0 &&
    // V2 fields still required for V3 completeness
    data.pos_th &&
    data.pos_eng &&
    data.definition_eng &&
    // V1 field still required
    data.definition_th
  );
}

/**
 * Detect schema version of a meaning
 * Returns 'v1', 'v2', 'v3', or 'unknown'
 */
export function detectMeaningSchemaVersion(meaning: unknown): 'v1' | 'v2' | 'v3' | 'unknown' {
  const v3Result = meaningThSchemaV3.safeParse(meaning);
  if (v3Result.success) {
    // Check if it has V3 fields
    const hasV3Fields = !!(v3Result.data.label_eng && v3Result.data.label_eng.trim().length > 0);
    if (hasV3Fields) return 'v3';
    
    // Check if it has V2 fields
    const hasV2Fields = !!(v3Result.data.pos_th || v3Result.data.pos_eng || v3Result.data.definition_eng);
    return hasV2Fields ? 'v2' : 'v1';
  }
  
  // Try V2 schema
  const v2Result = meaningThSchemaV2.safeParse(meaning);
  if (v2Result.success) {
    const hasV2Fields = !!(v2Result.data.pos_th || v2Result.data.pos_eng || v2Result.data.definition_eng);
    return hasV2Fields ? 'v2' : 'v1';
  }
  
  return 'unknown';
}
