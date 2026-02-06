/**
 * Sealed Constructors - Hard enforcement of Zod schemas
 * 
 * ⚠️ CRITICAL: These functions are the ONLY way to create branded types
 * All external data (DB, API, files, AI responses) must pass through these gates
 * No code can bypass Zod validation - these are the enforcement layer
 * 
 * Pattern:
 * - All external data starts as `unknown` (toxic)
 * - Must pass through sealed constructor (validation gate)
 * - Returns branded type that can't be forged without validation
 */

import { wordThSchema, type WordTh } from './wordThSchema';
import { meaningThSchema, type MeaningTh } from './meaningThSchema';
import { subtitleThSchema, type SubtitleTh } from './subtitleThSchema';

/**
 * Branded Types - Can only be created by sealed constructors
 */
export type SealedWordTh = WordTh & { __brand: 'SealedWordTh' };
export type SealedMeaningTh = MeaningTh & { __brand: 'SealedMeaningTh' };
export type SealedSubtitleTh = SubtitleTh & { __brand: 'SealedSubtitleTh' };

/**
 * Create SealedWordTh from unknown data - validates with Zod schema
 * This is the ONLY way to create SealedWordTh - prevents forging
 * 
 * @param data - Unknown data from external source (DB, API, file, etc.)
 * @returns SealedWordTh - Branded type that can only be created through validation
 * @throws Error if validation fails
 */
export function makeSealedWordTh(data: unknown): SealedWordTh {
  return wordThSchema.strict().parse(data) as SealedWordTh;
}

/**
 * Create SealedMeaningTh from unknown data - validates with Zod schema
 * This is the ONLY way to create SealedMeaningTh - prevents forging
 * 
 * @param data - Unknown data from external source (DB, API, file, etc.)
 * @returns SealedMeaningTh - Branded type that can only be created through validation
 * @throws Error if validation fails
 */
export function makeSealedMeaningTh(data: unknown): SealedMeaningTh {
  return meaningThSchema.strict().parse(data) as SealedMeaningTh;
}

/**
 * Create SealedSubtitleTh from unknown data - validates with Zod schema
 * This is the ONLY way to create SealedSubtitleTh - prevents forging
 * 
 * @param data - Unknown data from external source (DB, API, file, etc.)
 * @returns SealedSubtitleTh - Branded type that can only be created through validation
 * @throws Error if validation fails
 */
export function makeSealedSubtitleTh(data: unknown): SealedSubtitleTh {
  // Note: subtitleThSchema already has .strict() applied
  return subtitleThSchema.parse(data) as SealedSubtitleTh;
}
