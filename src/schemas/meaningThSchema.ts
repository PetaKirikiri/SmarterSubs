import { z } from 'zod';
import { bigintCoerce, uuidCoerce } from './zodHelpers';

/**
 * Meaning Thai Schema - matches ACTUAL database column names
 * Database table: meanings_th
 * Actual columns: id (bigint), definition_th (text), word_th_id (text), source (text), created_at (timestamp)
 * 
 * ⚠️ USE ZOD DIRECTLY: This schema validates DATA STRUCTURE (fields, types, required/optional)
 * 
 * Usage:
 * - Before save: `meaningThSchema.parse(data)` - throws if structure invalid
 * - On data pull: `meaningThSchema.safeParse(dbData)` - returns success/error
 * - On processing: `meaningThSchema.safeParse(data).success` - check if structure valid
 * 
 * Example:
 * ```typescript
 * // Validate structure before save
 * const validated = meaningThSchema.parse(meaningData); // throws if invalid
 * await supabase.from('meanings_th').insert(validated);
 * 
 * // Validate structure after fetch
 * const result = meaningThSchema.safeParse(dbData);
 * if (!result.success) {
 *   console.error('Invalid structure:', result.error);
 * }
 * ```
 * 
 * ⚠️ SCHEMA ENFORCEMENT: Uses .strict() to reject unknown fields
 * All fields must be explicitly defined - no passthrough allowed
 */
export const meaningThSchema = z.object({
  id: bigintCoerce,
  definition_th: z.string().min(1, 'definition_th is required'), // NOT description_thai
  word_th_id: z.string().optional(), // References words_th.word_th (Thai word string)
  source: z.string().optional(), // nullable
  created_at: z.string().datetime().optional(), // nullable timestamp
}).strict(); // Reject unknown fields - all fields must be validated

export type MeaningTh = z.infer<typeof meaningThSchema>;

// Legacy export for backward compatibility during migration
export const senseSchema = meaningThSchema;
export type Sense = MeaningTh;
