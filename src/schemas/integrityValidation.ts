import { z } from 'zod';
import { subtitleThSchema, type SubtitleTh } from './subtitleThSchema';
import { wordThSchema, type WordTh } from './wordThSchema';
import { episodeSchema, type Episode } from './episodeSchema';
import { meaningThSchema } from './meaningThSchema';
import { interpretZodError, type ErrorResponse } from '../services/errorResponse';
// ⚠️ SCHEMA ENFORCEMENT: Import completeness validation schemas and types from centralized location
import {
  completeWordThSchema,
  normalizedMeaningThSchema,
  completeTokenThSchema,
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
 * Validate normalized meanings Thai completeness
 * 
 * ⚠️ CONVENIENCE WRAPPER: This is a wrapper around Zod's normalizedMeaningThSchema.safeParse()
 * Formats Zod errors into UI-friendly CompletenessValidationResult format
 * 
 * You can use Zod directly: `normalizedMeaningThSchema.safeParse(meaning)`
 * 
 * Returns validation result with errors if any meanings are not normalized
 */
export function validateNormalizedSenses(senses: unknown[]): CompletenessValidationResult {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateNormalizedSenses',message:'COMPLETENESS VALIDATION START - validateNormalizedSenses',data:{senseCount:senses?.length || 0,hasSenses:!!senses && senses.length > 0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
  // #endregion

  // ⚠️ CRITICAL: Validate each sense with base schema first - senses must be unknown until validated
  const validatedSenses: z.infer<typeof meaningThSchema>[] = [];
  for (const sense of senses) {
    const senseValidation = meaningThSchema.strict().safeParse(sense);
    if (!senseValidation.success) {
      const errors = analyzeValidationErrors(sense, senseValidation, 'sense');
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateNormalizedSenses',message:'COMPLETENESS VIOLATION - Sense fails base meaningThSchema',data:{errorCount:errors.length,errors:errors.map(e=>({field:e.field,message:e.message}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
      // #endregion
      return {
        passed: false,
        errors,
      };
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

    // ⚠️ SCHEMA ENFORCEMENT: Use completeness validation schema
    // Base schema (meaningThSchema) is validated first, then completeness rules are applied
    const validation = normalizedMeaningThSchema.safeParse(sense);
    if (!validation.success) {
      const senseErrors = analyzeValidationErrors(sense, validation, `senses[${idx}]`);
      errors.push(...senseErrors);
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateNormalizedSenses',message:'COMPLETENESS VIOLATION - Sense not normalized',data:{senseIndex:idx,senseSource:sense.source,errorCount:senseErrors.length,errors:senseErrors.map(e=>({field:e.field,message:e.message}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
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
    const sensesValidation = validateNormalizedSenses(senses);
    if (!sensesValidation.passed) {
      errors.push(...sensesValidation.errors);
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateCompleteToken',message:'COMPLETENESS VIOLATION - Senses validation failed',data:{token,senseErrorCount:sensesValidation.errors.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
      // #endregion
    }
  }

  // Validate complete token completeness validation
  const tokenData = {
    token,
    word,
    senses: senses || [],
  };
  const tokenValidation = completeTokenThSchema.safeParse(tokenData);
  if (!tokenValidation.success) {
    const tokenErrors = analyzeValidationErrors(tokenData, tokenValidation, 'token');
    errors.push(...tokenErrors);
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'schemas/integrityValidation.ts:validateCompleteToken',message:'COMPLETENESS VIOLATION - Token completeness validation failed',data:{token,tokenErrorCount:tokenErrors.length,errors:tokenErrors.map(e=>({field:e.field,message:e.message}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'COMPLETENESS'})}).catch(()=>{});
    // #endregion
  }

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
    subtitle.tokens_th.tokens.forEach((wordRef: string) => {
      const textTh = wordRef.trim();
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
