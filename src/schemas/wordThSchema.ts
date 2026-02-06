import { z } from 'zod';

/**
 * Word Thai Schema - matches ACTUAL database column names
 * Database table: words_th
 * Primary key: word_th (prevents duplicate words)
 * Columns: word_th (text, PK), g2p (text, optional), phonetic_en (text, optional)
 * 
 * ⚠️ USE ZOD DIRECTLY: This schema validates DATA STRUCTURE (fields, types, required/optional)
 * 
 * Usage:
 * - Before save: `wordThSchema.parse(data)` - throws if structure invalid
 * - On data pull: `wordThSchema.safeParse(dbData)` - returns success/error
 * - On processing: `wordThSchema.safeParse(data).success` - check if structure valid
 * 
 * Example:
 * ```typescript
 * // Validate structure before save
 * const validated = wordThSchema.parse(wordData); // throws if invalid
 * await supabase.from('words_th').insert(validated);
 * 
 * // Validate structure after fetch
 * const result = wordThSchema.safeParse(dbData);
 * if (!result.success) {
 *   console.error('Invalid structure:', result.error);
 * }
 * ```
 */
export const wordThSchema = z.object({
  word_th: z.string()
    .min(1, 'word_th is required')
    .refine(val => val.trim().length > 0, 'word_th cannot be empty or only whitespace'),
  g2p: z.union([
    z.string().min(1).refine(val => val.trim().length > 0, 'g2p cannot be empty string or only whitespace'),
    z.undefined()
  ]).optional(),
  phonetic_en: z.union([
    z.string().min(1).refine(val => val.trim().length > 0, 'phonetic_en cannot be empty string or only whitespace'),
    z.undefined()
  ]).optional(),
}).strict(); // Reject unknown fields - all fields must be defined in schema

export type WordTh = z.infer<typeof wordThSchema>;

// Legacy export for backward compatibility during migration
export const wordSchema = wordThSchema;
export type Word = WordTh;
