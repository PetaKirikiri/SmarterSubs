import { z } from 'zod';
import { subtitleThSchema, type SubtitleTh } from './subtitleThSchema';
import { wordThSchema, type WordTh } from './wordThSchema';
import { episodeSchema, type Episode } from './episodeSchema';
import { meaningThSchema } from './meaningThSchema';
import { meaningThSchemaV2, detectMeaningSchemaVersion } from './meaningThSchemaV2';
import { meaningThSchemaV3, detectMeaningSchemaVersion as detectMeaningSchemaVersionV3 } from './meaningThSchemaV3';
import { interpretZodError, type ErrorResponse } from '../services/errorResponse';
// ⚠️ SCHEMA ENFORCEMENT: Import completeness validation schemas and types from centralized location
import {
  completeWordThSchema,
  normalizedMeaningThSchema,
  completeTokenThSchema,
  completeMeaningThSchemaV2,
  completeTokenThSchemaV2,
  completeMeaningThSchemaV3,
  completeTokenThSchemaV3,
  type IntegrityError,
  type CompletenessValidationResult,
  // Legacy exports for backward compatibility
  completeWordContract,
  normalizedSenseContract,
  completeTokenContract,
  ContractValidationResult,
} from './completenessSchemas';
import { enforceContract } from './validationEnforcement';

export interface SubtitleIntegrityResult {
  subtitleId: string;
  passed: boolean;
  errors: IntegrityError[];
  wordErrors: WordIntegrityResult[];
}

export interface WordIntegrityResult {
  wordId: string;
  passed: boolean;
  errors: IntegrityError[];
  senseCount: number;
}

export interface EpisodeIntegrityResult {
  episodeId: string;
  passed: boolean;
  subtitleCount: number;
  passedSubtitles: number;
  failedSubtitles: number;
  subtitleResults: SubtitleIntegrityResult[];
}

// REMOVED: parseWordReference - tokens_th.tokens are plain strings, no parsing needed

// ⚠️ UI CONVENIENCE WRAPPERS: These functions are convenience wrappers around Zod for UI error formatting
// 
// Purpose: Format Zod validation errors into UI-friendly format (CompletenessValidationResult)
// 
// You can use Zod directly if you don't need formatted errors:
// ```typescript
// // Direct Zod usage (no wrapper)
// const result = completeWordThSchema.safeParse(word);
// if (!result.success) {
//   // Handle Zod error directly
//   console.error('Validation failed:', result.error);
// }
// 
// // Or use wrapper for UI error formatting
// const validation = validateCompleteWord(word);
// if (!validation.passed) {
//   // Display formatted errors in UI
//   validation.errors.forEach(err => console.error(`${err.field}: ${err.message}`));
// }
// ```

/**
 * Validate complete word Thai completeness
 * 
 * ⚠️ CONVENIENCE WRAPPER: This is a wrapper around Zod's completeWordThSchema.safeParse()
 * Formats Zod errors into UI-friendly CompletenessValidationResult format
 * 
 * You can use Zod directly: `completeWordThSchema.safeParse(word)`
 * 
 * Returns validation result with errors if completeness validation is violated
 */
export function validateCompleteWord(word: unknown): CompletenessValidationResult {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateCompleteWord',message:'COMPLETENESS VALIDATION START - validateCompleteWord',data:{hasWord:!!word},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
  // #endregion

  // ⚠️ CRITICAL: Validate with base schema first - word must be unknown until validated
  const baseValidation = wordThSchema.strict().safeParse(word);
  if (!baseValidation.success) {
    const errors = analyzeValidationErrors(word, baseValidation, 'word');
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateCompleteWord',message:'COMPLETENESS VIOLATION - Word fails base wordThSchema',data:{errorCount:errors.length,errors:errors.map(e=>({field:e.field,message:e.message}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
    // #endregion
    return {
      passed: false,
      errors,
    };
  }

  const validatedWord = baseValidation.data;

  if (!validatedWord) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateCompleteWord',message:'COMPLETENESS VIOLATION - Word is null/undefined',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
    // #endregion
    return {
      passed: false,
      errors: [{
        field: 'word',
        message: 'Word is null or undefined',
        present: false,
        expected: 'Word object with word_th and (g2p OR phonetic_en)',
      }],
    };
  }

  // ⚠️ SCHEMA ENFORCEMENT: Use completeness validation schema
  // Base schema (wordThSchema) is validated first, then completeness rules are applied
  // This ensures base rules cannot be bypassed
  const validation = completeWordThSchema.safeParse(validatedWord);
  if (!validation.success) {
    const errors = analyzeValidationErrors(validatedWord, validation, 'word');
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateCompleteWord',message:'COMPLETENESS VIOLATION - Word fails completeWordThSchema',data:{textTh:validatedWord.word_th,hasG2P:!!validatedWord.g2p,hasPhonetic:!!validatedWord.phonetic_en,errorCount:errors.length,errors:errors.map(e=>({field:e.field,message:e.message}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
    // #endregion
    return {
      passed: false,
      errors,
    };
  }

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateCompleteWord',message:'COMPLETENESS PASSED - Word matches completeWordThSchema',data:{textTh:validatedWord.word_th,hasG2P:!!validatedWord.g2p,hasPhonetic:!!validatedWord.phonetic_en},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
  // #endregion
  return {
    passed: true,
    errors: [],
  };
}

/**
 * Strip V2 fields from a sense object for V1 validation
 * This allows V1 validation to work even when V2 columns exist in the database
 */
function stripV2Fields(sense: unknown): unknown {
  if (!sense || typeof sense !== 'object') {
    return sense;
  }
  const { pos_th, pos_eng, definition_eng, ...v1Sense } = sense as Record<string, unknown>;
  return v1Sense;
}

/**
 * Strip V3 fields from a sense object for V2 validation
 * This allows V2 validation to work even when V3 columns exist in the database
 */
function stripV3Fields(sense: unknown): unknown {
  if (!sense || typeof sense !== 'object') {
    return sense;
  }
  const { label_eng, ...v2Sense } = sense as Record<string, unknown>;
  return v2Sense;
}

/**
 * Validate normalized meanings Thai completeness
 * 
 * ⚠️ CONVENIENCE WRAPPER: This is a wrapper around Zod's normalizedMeaningThSchema.safeParse()
 * Formats Zod errors into UI-friendly CompletenessValidationResult format
 * 
 * You can use Zod directly: `normalizedMeaningThSchema.safeParse(meaning)`
 * 
 * Returns validation result with errors if any meanings are not normalized
 * 
 * ⚠️ V1/V2 COMPATIBILITY: Strips V2 fields before V1 validation to allow V1 completeness check
 * even when V2 columns exist in the database. This enables the workflow: "V1 is good, upgrade to V2"
 */
export function validateNormalizedSenses(senses: unknown[]): CompletenessValidationResult {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateNormalizedSenses',message:'COMPLETENESS VALIDATION START - validateNormalizedSenses',data:{senseCount:senses?.length || 0,hasSenses:!!senses && senses.length > 0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
  // #endregion

  // ⚠️ CRITICAL: Validate each sense with schema first - senses must be unknown until validated
  // ⚠️ V1/V2/V3 COMPATIBILITY: Check V3 first, then V2, then V1 to support all schema versions
  const validatedSenses: Array<z.infer<typeof meaningThSchema> | z.infer<typeof meaningThSchemaV2> | z.infer<typeof meaningThSchemaV3>> = [];
  for (const sense of senses) {
    // Try V3 first (most complete)
    let senseValidation = meaningThSchemaV3.safeParse(sense);
    if (!senseValidation.success) {
      // Try V2
      senseValidation = meaningThSchemaV2.safeParse(sense);
      if (!senseValidation.success) {
        // Try V1 (strip V2/V3 fields first)
        const v1Sense = stripV2Fields(stripV3Fields(sense));
        senseValidation = meaningThSchema.strict().safeParse(v1Sense);
        if (!senseValidation.success) {
          const errors = analyzeValidationErrors(sense, senseValidation, 'sense');
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateNormalizedSenses',message:'COMPLETENESS VIOLATION - Sense fails base meaningThSchema (V1/V2/V3)',data:{errorCount:errors.length,errors:errors.map(e=>({field:e.field,message:e.message}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
          // #endregion
          return {
            passed: false,
            errors,
          };
        }
      }
    }
    validatedSenses.push(senseValidation.data);
  }

  if (!validatedSenses || validatedSenses.length === 0) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateNormalizedSenses',message:'COMPLETENESS PASSED - No senses (optional)',data:{senseCount:0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
    // #endregion
    return {
      passed: true, // No senses is valid (senses are optional)
      errors: [],
    };
  }

  const errors: IntegrityError[] = [];
  const senseSources = validatedSenses.map((s) => s?.source || 'undefined');
  
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateNormalizedSenses',message:'COMPLETENESS CHECK - Validating senses for normalization',data:{senseCount:validatedSenses.length,senseSources},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
  // #endregion
  
  validatedSenses.forEach((sense, idx: number) => {
    if (!sense) {
      errors.push({
        field: `senses[${idx}]`,
        message: `Sense at index ${idx} is null or undefined`,
        present: false,
        expected: 'Normalized sense object with source !== "orst"',
      });
      return;
    }

    // ⚠️ NORMALIZATION CHECK: Verify source is normalized (not 'orst' or 'ORST')
    // This check applies regardless of schema version (V1/V2/V3)
    const source = (sense as any)?.source;
    if (!source || source.trim().length === 0) {
      errors.push({
        field: `senses[${idx}].source`,
        message: `Sense at index ${idx} is missing source (must be normalized)`,
        present: false,
        expected: 'Normalized source (not "orst" or "ORST")',
      });
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateNormalizedSenses',message:'COMPLETENESS VIOLATION - Sense missing source',data:{senseIndex:idx},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
      // #endregion
      return;
    }
    
    if (source === 'orst' || source === 'ORST') {
      errors.push({
        field: `senses[${idx}].source`,
        message: `Sense at index ${idx} is not normalized (source is "${source}")`,
        present: true,
        expected: 'Normalized source (not "orst" or "ORST")',
      });
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateNormalizedSenses',message:'COMPLETENESS VIOLATION - Sense not normalized',data:{senseIndex:idx,senseSource:source},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
      // #endregion
    }
  });

  const result = {
    passed: errors.length === 0,
    errors,
  };

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateNormalizedSenses',message:result.passed ? 'COMPLETENESS PASSED - All senses normalized' : 'COMPLETENESS VIOLATION - Some senses not normalized',data:{senseCount:senses.length,passed:result.passed,errorCount:errors.length,errors:errors.map(e=>({field:e.field,message:e.message}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
  // #endregion

  return result;
}

/**
 * Validate V2 complete meanings Thai completeness
 * 
 * ⚠️ CONVENIENCE WRAPPER: This is a wrapper around Zod's completeMeaningThSchemaV2.safeParse()
 * Formats Zod errors into UI-friendly CompletenessValidationResult format
 * 
 * Returns validation result with errors if any meanings are not V2 complete
 */
export function validateV2CompleteSenses(senses: unknown[]): CompletenessValidationResult {
  if (!senses || senses.length === 0) {
    return {
      passed: true, // No senses is valid (senses are optional)
      errors: [],
    };
  }

  // ⚠️ CRITICAL: Validate each sense with V2 schema first (strip V3 fields since V2 schema is strict)
  const validatedSenses: z.infer<typeof meaningThSchemaV2>[] = [];
  for (const sense of senses) {
    // Strip V3 fields before V2 validation
    const v2Sense = stripV3Fields(sense);
    const senseValidation = meaningThSchemaV2.strict().safeParse(v2Sense);
    if (!senseValidation.success) {
      const errors = analyzeValidationErrors(v2Sense, senseValidation, 'sense');
      return {
        passed: false,
        errors,
      };
    }
    validatedSenses.push(senseValidation.data);
  }

  const errors: IntegrityError[] = [];
  
  validatedSenses.forEach((sense, idx: number) => {
    if (!sense) {
      errors.push({
        field: `senses[${idx}]`,
        message: `Sense at index ${idx} is null or undefined`,
        present: false,
        expected: 'V2 complete sense object with pos_th, pos_eng, definition_eng',
      });
      return;
    }

    // ⚠️ SCHEMA ENFORCEMENT: Use V2 completeness validation schema
    const validation = completeMeaningThSchemaV2.safeParse(sense);
    if (!validation.success) {
      const senseErrors = analyzeValidationErrors(sense, validation, `senses[${idx}]`);
      errors.push(...senseErrors);
    }
  });

  return {
    passed: errors.length === 0,
    errors,
  };
}

/**
 * Detect if meanings need V2 enrichment
 * Returns true if meanings are normalized (V1) but missing V2 fields
 */
export function needsV2Enrichment(senses: unknown[]): boolean {
  if (!senses || senses.length === 0) {
    return false;
  }

  // Check if all senses are normalized (V1 complete) but not V2 complete
  for (const sense of senses) {
    // Strip V3 fields before V2 check
    const v2Sense = stripV3Fields(sense);
    const version = detectMeaningSchemaVersion(v2Sense);
    if (version === 'v1') {
      // V1 normalized - needs enrichment
      return true;
    } else if (version === 'unknown') {
      // Invalid schema - skip
      return false;
    }
    // v2 - check if complete
    const v2Validation = completeMeaningThSchemaV2.safeParse(v2Sense);
    if (!v2Validation.success) {
      // V2 but incomplete - needs enrichment
      return true;
    }
  }

  return false;
}

/**
 * Validate V3 complete meanings Thai completeness
 * 
 * ⚠️ CONVENIENCE WRAPPER: This is a wrapper around Zod's completeMeaningThSchemaV3.safeParse()
 * Formats Zod errors into UI-friendly CompletenessValidationResult format
 * 
 * Returns validation result with errors if any meanings are not V3 complete
 */
export function validateV3CompleteSenses(senses: unknown[]): CompletenessValidationResult {
  if (!senses || senses.length === 0) {
    return {
      passed: true, // No senses is valid (senses are optional)
      errors: [],
    };
  }

  // ⚠️ CRITICAL: Validate each sense with V3 schema first
  const validatedSenses: z.infer<typeof meaningThSchemaV3>[] = [];
  for (const sense of senses) {
    const senseValidation = meaningThSchemaV3.strict().safeParse(sense);
    if (!senseValidation.success) {
      const errors = analyzeValidationErrors(sense, senseValidation, 'sense');
      return {
        passed: false,
        errors,
      };
    }
    validatedSenses.push(senseValidation.data);
  }

  const errors: IntegrityError[] = [];
  
  validatedSenses.forEach((sense, idx: number) => {
    if (!sense) {
      errors.push({
        field: `senses[${idx}]`,
        message: `Sense at index ${idx} is null or undefined`,
        present: false,
        expected: 'V3 complete sense object with label_eng (and V2 fields)',
      });
      return;
    }

    // ⚠️ SCHEMA ENFORCEMENT: Use V3 completeness validation schema
    const validation = completeMeaningThSchemaV3.safeParse(sense);
    if (!validation.success) {
      const senseErrors = analyzeValidationErrors(sense, validation, `senses[${idx}]`);
      errors.push(...senseErrors);
    }
  });

  return {
    passed: errors.length === 0,
    errors,
  };
}

/**
 * Detect if meanings need V3 enrichment
 * Returns true if meanings are V2-complete but missing V3 fields
 */
export function needsV3Enrichment(senses: unknown[]): boolean {
  // #region agent log - V3 NEEDS ENRICHMENT CHECK START
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:needsV3Enrichment',message:'V3 NEEDS ENRICHMENT CHECK START',data:{sensesCount:senses?.length || 0,hasSenses:!!(senses && senses.length > 0)},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
  // #endregion
  
  if (!senses || senses.length === 0) {
    // #region agent log - V3 NEEDS ENRICHMENT NO SENSES
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:needsV3Enrichment',message:'V3 NEEDS ENRICHMENT NO SENSES',data:{},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
    // #endregion
    return false;
  }

  // Check if all senses are V2-complete but not V3-complete
  let needsEnrichment = false;
  for (let idx = 0; idx < senses.length; idx++) {
    const sense = senses[idx];
    
    // First check if V2-complete (strip V3 fields first since V2 schema is strict)
    const v2Sense = stripV3Fields(sense);
    const v2Validation = completeMeaningThSchemaV2.safeParse(v2Sense);
    if (!v2Validation.success) {
      // Not V2-complete - cannot enrich V3
      // #region agent log - V3 NEEDS ENRICHMENT NOT V2 COMPLETE
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:needsV3Enrichment',message:'V3 NEEDS ENRICHMENT NOT V2 COMPLETE',data:{senseIndex:idx,v2ValidationErrors:v2Validation.error?.errors?.map((e:any)=>({path:e.path,message:e.message}))},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
      // #endregion
      return false;
    }

    // V2-complete - check if V3-complete
    const v3Validation = completeMeaningThSchemaV3.safeParse(sense);
    if (!v3Validation.success) {
      // V2-complete but V3 incomplete - needs enrichment
      // #region agent log - V3 NEEDS ENRICHMENT V2 COMPLETE BUT V3 INCOMPLETE
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:needsV3Enrichment',message:'V3 NEEDS ENRICHMENT V2 COMPLETE BUT V3 INCOMPLETE',data:{senseIndex:idx,v3ValidationErrors:v3Validation.error?.errors?.map((e:any)=>({path:e.path,message:e.message})),senseData:(sense as any)?.label_eng ? 'has_label_eng' : 'no_label_eng'},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
      // #endregion
      needsEnrichment = true;
    } else {
      // #region agent log - V3 NEEDS ENRICHMENT V3 COMPLETE
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:needsV3Enrichment',message:'V3 NEEDS ENRICHMENT V3 COMPLETE',data:{senseIndex:idx,hasLabelEng:!!(sense as any)?.label_eng},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
      // #endregion
    }
  }

  // #region agent log - V3 NEEDS ENRICHMENT CHECK RESULT
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:needsV3Enrichment',message:'V3 NEEDS ENRICHMENT CHECK RESULT',data:{sensesCount:senses.length,needsEnrichment},timestamp:Date.now(),runId:'run1',hypothesisId:'V3_ENRICH'})}).catch(()=>{});
  // #endregion

  return needsEnrichment;
}

/**
 * Validate complete token Thai completeness
 * 
 * ⚠️ CONVENIENCE WRAPPER: This is a wrapper around Zod's completeTokenThSchema.safeParse()
 * Formats Zod errors into UI-friendly CompletenessValidationResult format
 * 
 * You can use Zod directly: `completeTokenThSchema.safeParse({ token, word, senses })`
 * 
 * Returns validation result with errors if token doesn't match complete completeness validation
 */
export function validateCompleteToken(token: string, word: unknown, senses?: unknown[]): CompletenessValidationResult {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateCompleteToken',message:'COMPLETENESS VALIDATION START - validateCompleteToken',data:{token,hasWord:!!word,hasSenses:!!senses,senseCount:senses?.length || 0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
  // #endregion

  const errors: IntegrityError[] = [];

  // Validate word (word is unknown - must be validated)
  const wordValidation = validateCompleteWord(word);
  if (!wordValidation.passed) {
    errors.push(...wordValidation.errors);
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateCompleteToken',message:'COMPLETENESS VIOLATION - Word validation failed',data:{token,wordErrorCount:wordValidation.errors.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
    // #endregion
  }

  // Validate senses if they exist (senses is unknown[] - must be validated)
  if (senses && senses.length > 0) {
    // ⚠️ CRITICAL: Check V3 completeness first, then V2 (V2 is required before V3)
    const v3SensesValidation = validateV3CompleteSenses(senses);
    if (!v3SensesValidation.passed) {
      // V3 incomplete - check V2 completeness (V2 is REQUIRED)
      const v2SensesValidation = validateV2CompleteSenses(senses);
      if (!v2SensesValidation.passed) {
        // V2 incomplete - this is an error (V2 must be complete before V3)
        errors.push(...v2SensesValidation.errors);
        // #region agent log - V2 COMPLETENESS VIOLATION
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateCompleteToken',message:'V2 COMPLETENESS VIOLATION - Senses not V2 complete (V2 required before V3)',data:{token,senseErrorCount:v2SensesValidation.errors.length,errors:v2SensesValidation.errors.map(e=>({field:e.field,message:e.message}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'V2_ENRICH'})}).catch(()=>{});
        // #endregion
      } else {
        // V2 complete but V3 incomplete - acceptable (V3 is optional)
        // Still check normalization
        const sensesValidation = validateNormalizedSenses(senses);
        if (!sensesValidation.passed) {
          errors.push(...sensesValidation.errors);
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateCompleteToken',message:'COMPLETENESS VIOLATION - Senses validation failed',data:{token,senseErrorCount:sensesValidation.errors.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
          // #endregion
        }
      }
    } else {
      // V3 complete - also check normalization (should already be normalized if V3 complete)
      const sensesValidation = validateNormalizedSenses(senses);
      if (!sensesValidation.passed) {
        errors.push(...sensesValidation.errors);
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateCompleteToken',message:'COMPLETENESS VIOLATION - Senses validation failed',data:{token,senseErrorCount:sensesValidation.errors.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
        // #endregion
      }
    }
  }

  // Validate complete token completeness validation - check V3 first, then V2
  const tokenData = {
    token,
    word,
    senses: senses || [],
  };
  // ⚠️ CRITICAL: Check V3 schema first, then V2 (V2 is required before V3)
  const v3TokenValidation = completeTokenThSchemaV3.safeParse(tokenData);
  if (!v3TokenValidation.success) {
    // V3 validation failed - try V2 (strip V3 fields from senses first)
    const v2TokenData = {
      token,
      word,
      senses: (senses || []).map(sense => stripV3Fields(sense)),
    };
    const v2TokenValidation = completeTokenThSchemaV2.safeParse(v2TokenData);
    if (!v2TokenValidation.success) {
      // V2 validation failed - this is an error (V2 is REQUIRED)
      const tokenErrors = analyzeValidationErrors(v2TokenData, v2TokenValidation, 'token');
      errors.push(...tokenErrors);
      // #region agent log - V2 COMPLETENESS VIOLATION
      const hasV2Errors = tokenErrors.some(e => e.message.includes('V2') || e.field.includes('pos_th') || e.field.includes('pos_eng') || e.field.includes('definition_eng'));
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateCompleteToken',message:hasV2Errors ? 'V2 COMPLETENESS VIOLATION - Token V2 completeness validation failed (V2 required before V3)' : 'COMPLETENESS VIOLATION - Token completeness validation failed',data:{token,tokenErrorCount:tokenErrors.length,errors:tokenErrors.map(e=>({field:e.field,message:e.message})),hasV2Errors},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:hasV2Errors ? 'V2_ENRICH' : 'COMPLETENESS'})}).catch(()=>{});
      // #endregion
    }
    // If V2 validation passed, token is V2-complete (V3 is optional)
  }
  // If V3 validation passed, token is V3-complete

  const result = {
    passed: errors.length === 0,
    errors,
  };

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateCompleteToken',message:result.passed ? 'COMPLETENESS PASSED - Token matches complete completeness validation' : 'COMPLETENESS VIOLATION - Token does not match complete completeness validation',data:{token,passed:result.passed,errorCount:errors.length,errors:errors.map(e=>({field:e.field,message:e.message}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
  // #endregion

  return result;
}

/**
 * Check for missing required fields by validating and analyzing errors
 * Uses centralized errorResponse service for consistent error interpretation
 */
function analyzeValidationErrors(data: unknown, validationResult: z.SafeParseReturnType<unknown, unknown>, prefix = ''): IntegrityError[] {
  const errors: IntegrityError[] = [];
  
  if (!validationResult.success) {
    // Use centralized error response service
    const context = prefix ? { field: prefix } : undefined;
    const errorResponses = interpretZodError(validationResult.error, context);
    
    // Convert ErrorResponse to IntegrityError format (for backward compatibility)
    errorResponses.forEach((errResp) => {
      // Format field path: convert to bracket notation for consistency
      const formatPathSegment = (segments: (string | number)[]): string => {
        if (segments.length === 0) return '';
        let result = '';
        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          if (typeof segment === 'number') {
            result += `[${segment}]`;
          } else {
            if (i > 0) {
              result += '.';
            }
            result += segment;
          }
        }
        return result;
      };
      
      const errorPath = errResp.path ? formatPathSegment(errResp.path) : '';
      const fieldPath = prefix 
        ? (prefix.endsWith(']') ? `${prefix}.${errorPath}` : `${prefix}.${errorPath}`)
        : (errorPath || 'root');
      
      errors.push({
        field: fieldPath,
        message: errResp.message,
        path: errResp.path || [],
        present: errResp.present !== undefined ? errResp.present : false,
        expected: errResp.expected || 'Valid value',
        actual: errResp.actual,
      });
    });
  }
  
  return errors;
}

/**
 * Check integrity of a single subtitle and its referenced words
 */
export function checkSubtitleIntegrity(
  subtitle: unknown
): SubtitleIntegrityResult {
  const errors: IntegrityError[] = [];
  const wordErrors: WordIntegrityResult[] = [];
  
  // ⚠️ CRITICAL: Validate subtitle with Zod schema first - subtitle is unknown until validated
  // Note: subtitleThSchema already has .strict() applied, so we don't need to call it again
  const subtitleResult = subtitleThSchema.safeParse(subtitle);
  if (!subtitleResult.success) {
    // Return early if subtitle structure is invalid
    return {
      subtitleId: 'unknown',
      passed: false,
      errors: subtitleResult.error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
        present: false,
        expected: 'Valid subtitle structure',
      })),
      wordErrors: [],
    };
  }
  
  const validatedSubtitle = subtitleResult.data;
  const validationErrors = analyzeValidationErrors(subtitle, subtitleResult);
  errors.push(...validationErrors);
  
  // Get words from subtitle's thaiWords array
  const words = subtitle.thaiWords || [];
  
  // Create word lookup map
  const wordMap = new Map<string, WordTh>();
  words.forEach((word: unknown) => {
    // Use Zod schema field names: id (bigint) or word_th (string)
    const key = word.id?.toString() || word.word_th;
    if (key) {
      wordMap.set(key, word);
    }
  });
  
  // Validate each referenced word from tokens_th
  if (subtitle.tokens_th && typeof subtitle.tokens_th === 'object' && subtitle.tokens_th.tokens && Array.isArray(subtitle.tokens_th.tokens)) {
    const uniqueWordIds = new Set<string>();
    subtitle.tokens_th.tokens.forEach((wordRef: unknown) => {
      // Handle both string format (legacy) and object format {t: string, meaning_id?: bigint}
      let textTh: string | null = null;
      if (typeof wordRef === 'string') {
        textTh = wordRef.trim();
      } else if (wordRef && typeof wordRef === 'object' && 't' in wordRef) {
        const t = (wordRef as any).t;
        textTh = typeof t === 'string' ? t.trim() : null;
      }
      if (textTh) {
        uniqueWordIds.add(textTh);
      }
    });
    
    uniqueWordIds.forEach((wordId) => {
      const word = wordMap.get(wordId);
      const wordResult = checkWordIntegrity(wordId, word);
      wordErrors.push(wordResult);
    });
  }
  
  const passed = errors.length === 0 && wordErrors.every((w) => w.passed);
  
  return {
    subtitleId: subtitle.id || 'unknown',
    passed,
    errors,
    wordErrors,
  };
}

/**
 * Check integrity of a single word
 * Note: word parameter includes computed fields (senses, senseCount) not in Zod schema
 */
function checkWordIntegrity(wordId: string, word: unknown): WordIntegrityResult {
  const errors: IntegrityError[] = [];
  
  if (!word) {
    errors.push({
      field: 'word',
      message: `Word "${wordId}" not found in words_th or failed_words table`,
      present: false,
      expected: 'Word row with word_th and senses',
    });
    return {
      wordId,
      passed: false,
      errors,
      senseCount: 0,
    };
  }
  
  // Check if senses array exists and has at least one sense (computed field)
  // Validate word structure first
  const wordValidation = wordThSchema.strict().safeParse(word);
  if (!wordValidation.success) {
    return {
      exists: false,
      hasSenses: false,
      senseCount: 0,
      errors: ['Word structure invalid'],
    };
  }
  const validatedWord = wordValidation.data;
  
  // Note: senses are not part of wordThSchema - they come from separate query
  const senses: unknown[] = [];
  if (senses.length === 0) {
    errors.push({
      field: 'word.senses',
      message: 'Word must have at least one sense',
      present: false,
      expected: 'Array with at least one sense object',
    });
  }
  
  // Validate word schema - wordValidation already done above
  const wordResult = wordValidation;
  if (!wordResult.success) {
    // Extract word-level validation errors
    const allWordErrors = analyzeValidationErrors(wordDataForValidation, wordResult, 'word');
    errors.push(...allWordErrors);
  }
  
  // Validate each sense using Zod schema (centralized error reporting)
  // This is the ONLY place individual sense field errors should come from
  senses.forEach((sense: unknown, idx: number) => {
    if (!sense) {
      errors.push({
        field: `word.senses[${idx}]`,
        message: `Sense at index ${idx} is null or undefined`,
        present: false,
        expected: 'Sense object with thaiWord, descriptionThai, and pos',
      });
      return;
    }
    
    // Validate sense schema - Zod will report all missing/invalid fields
    const senseResult = meaningThSchema.safeParse(sense);
    if (!senseResult.success) {
      const senseValidationErrors = analyzeValidationErrors(sense, senseResult, `word.senses[${idx}]`);
      errors.push(...senseValidationErrors);
    }
  });
  
  const senseCount = senses.length;
  
  return {
    wordId,
    passed: errors.length === 0,
    errors,
    senseCount,
  };
}

/**
 * Check integrity of an episode with all its subtitles
 */
export function checkEpisodeIntegrity(
  episodeData: any
): EpisodeIntegrityResult {
  const errors: IntegrityError[] = [];
  
  // Validate episode lookup data - use Zod schema field names: media_id, show_title, season_number, episode_number, episode_title
  const episodeResult = episodeSchema.safeParse({
    id: episodeData.episode?.id || episodeData.id,
    media_id: episodeData.episode?.media_id || episodeData.mediaId,
    show_title: episodeData.episode?.show_title || episodeData.showName,
    season_number: episodeData.episode?.season_number || episodeData.season,
    episode_number: episodeData.episode?.episode_number || episodeData.episode,
    episode_title: episodeData.episode?.episode_title || episodeData.episodeTitle,
  });
  
  if (!episodeResult.success) {
    episodeResult.error.errors.forEach((err) => {
      errors.push({
        field: `episode.${err.path.join('.')}`,
        message: err.message,
        path: ['episode', ...err.path],
        present: false,
        expected: 'Valid episode data matching episodeSchema',
      });
    });
  }
  
  // Show info is in episodes table, not a separate shows table
  
  // Validate all subtitles
  const subtitleResults: SubtitleIntegrityResult[] = [];
  const subtitles = episodeData.subtitles || [];
  
  subtitles.forEach((subtitle: unknown) => {
    const result = checkSubtitleIntegrity(subtitle);
    subtitleResults.push(result);
  });
  
  const passedSubtitles = subtitleResults.filter((r) => r.passed).length;
  const failedSubtitles = subtitleResults.filter((r) => !r.passed).length;
  const passed = errors.length === 0 && failedSubtitles === 0;
  
  return {
    episodeId: episodeData.episode?.media_id || episodeData.mediaId || episodeData.id || 'unknown',
    passed,
    subtitleCount: subtitles.length,
    passedSubtitles,
    failedSubtitles,
    subtitleResults,
  };
}
