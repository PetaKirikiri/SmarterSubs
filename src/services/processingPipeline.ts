/**
 * Processing Pipeline
 * Defines shape and functions to execute using Zod schemas
 * Executes steps directly from Zod schema - no workflow coordinator needed
 */

import { fetchSubtitles, saveSubtitlesBatch, saveWordData } from '../supabase/index';
import { subtitleThSchema } from '../schemas/subtitleThSchema';
import { meaningThSchema } from '../schemas/meaningThSchema';
import { getValidatedProcessingOrder, type ProcessingOrder, type ProcessingStep, type PipelineContext, pipelineContextSchema } from '../schemas/processingOrderSchema';
import { buildThaiTokensFromText } from './tokenization/ai4thaiTokenizer';
import { getG2P } from './phonetics/ai4thaiG2P';
import { parsePhoneticToEnglish } from './phonetics/phoneticParser';
import { fetchOrstMeanings } from './meanings/fetchOrstMeanings';
import { normalizeSensesWithGPT } from './meanings/gptNormalizeSenses';
import { createMeaningsWithGPT } from './meanings/gptMeaning';

/**
 * Step execution result
 */
export interface StepResult {
  stepName: string;
  success: boolean;
  output?: unknown; // Must be validated with Zod before use - no any types allowed
  error?: Error;
}

/**
 * Topologically sort workflow steps based on dependencies
 * Returns steps in execution order (dependencies first)
 */
function topologicalSortSteps(steps: ProcessingStep[]): ProcessingStep[] {
  const stepMap = new Map(steps.map(s => [s.name, s]));
  const visited = new Set<string>();
  const result: ProcessingStep[] = [];

  function visit(stepName: string) {
    if (visited.has(stepName)) {
      return;
    }

    const step = stepMap.get(stepName);
    if (!step) {
      throw new Error(`Step "${stepName}" not found in workflow`);
    }

    // Visit dependencies first
    for (const dep of step.dependsOn) {
      visit(dep);
    }

    visited.add(stepName);
    result.push(step);
  }

  // Visit all steps
  for (const step of steps) {
    visit(step.name);
  }

  return result;
}

/**
 * Execute workflow steps directly from Zod schema
 * Reads schema, sorts steps, executes functions, validates context with Zod
 */
export async function executeStepsFromSchema(
  workflow: ProcessingOrder,
  context: PipelineContext, // TODO: Change to SeededInput branded type
  stepFilter?: string[]
): Promise<{
  results: StepResult[];
  finalContext: PipelineContext; // TODO: Change to ProcessedContext branded type
}> {
  // Safety check: ensure workflow has required properties
  if (!workflow || !workflow.name || !Array.isArray(workflow.steps)) {
    throw new Error(`Invalid workflow: expected ProcessingOrder with name and steps, got ${JSON.stringify(workflow)}`);
  }

  // Safety check: ensure context is an object before calling Object.keys
  if (!context || typeof context !== 'object') {
    throw new Error(`Invalid context: expected object, got ${typeof context}`);
  }

  // ⚠️ CRITICAL: Validate initial context with strict schema - context is unknown until validated
  const validatedContext = pipelineContextSchema.strict().safeParse(context);
  if (!validatedContext.success) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'processingPipeline.ts:executeStepsFromSchema',message:'EJECT - Initial context validation failed, stopping pipeline',data:{workflowName:workflow.name,validationErrors:validatedContext.error.errors,contextKeys:context && typeof context === 'object' ? Object.keys(context) : 'invalid'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'EJECT'})}).catch(()=>{});
    // #endregion
    console.error(`[Processing Pipeline] ✗ Invalid pipeline context:`, validatedContext.error.errors);
    throw new Error(`Invalid pipeline context: ${validatedContext.error.message}`);
  }

  // Get steps in execution order (topological sort)
  const orderedSteps = topologicalSortSteps(workflow.steps);

  // Filter steps if stepFilter is provided
  const stepsToExecute = stepFilter
    ? orderedSteps.filter(s => stepFilter.includes(s.name))
    : orderedSteps;


  const results: StepResult[] = [];
  let executionContext: PipelineContext = { ...validatedContext.data };
  let previousStepContext: PipelineContext = { ...validatedContext.data }; // Track previous step context for comparison

  // Execute steps in order
  for (let i = 0; i < stepsToExecute.length; i++) {
    const step = stepsToExecute[i];
    if (!step) {
      throw new Error(`Step at index ${i} is undefined`);
    }
    // Safety check: ensure executionContext is an object
    if (!executionContext || typeof executionContext !== 'object') {
      throw new Error(`Invalid executionContext at step "${step.name}": expected object, got ${typeof executionContext}`);
    }

    try {
      let output: unknown; // Must be validated with Zod before assigning to context

      // Execute step based on function name
      switch (step.functionName) {
        case 'buildThaiTokensFromText':
          if (!executionContext.thaiText) {
            throw new Error('thaiText is required for tokenization');
          }
          output = await buildThaiTokensFromText(executionContext.thaiText);
          // Validate output matches expected schema: { tokens: string[] }
          if (output && typeof output === 'object' && 'tokens' in output && Array.isArray((output as { tokens: unknown }).tokens)) {
            executionContext.tokens_th = output as { tokens: string[] };
          } else {
            throw new Error(`Invalid tokenization output: expected { tokens: string[] }, got ${typeof output}`);
          }
          break;

        case 'getG2P':
          if (!executionContext.word_th) {
            throw new Error('word_th is required for G2P');
          }
          output = await getG2P(executionContext.word_th);
          // Validate output: G2P is required (not an acceptable failure)
          // If getG2P returns null, throw error - G2P must succeed
          if (typeof output === 'string' && output.trim().length > 0) {
            executionContext.g2p = output;
          } else {
            throw new Error(`G2P failed for "${executionContext.word_th}": API returned null or empty string. G2P is required and cannot be skipped.`);
          }
          break;

        case 'parsePhoneticToEnglish':
          if (!executionContext.g2p) {
            throw new Error('g2p is required for phonetic parsing (dependency not satisfied)');
          }
          output = await parsePhoneticToEnglish(executionContext.g2p);
          // Validate output: string | null -> string | undefined
          if (typeof output === 'string') {
            executionContext.phonetic_en = output;
          } else if (output === null) {
            executionContext.phonetic_en = undefined;
          } else {
            throw new Error(`Invalid phonetic output: expected string | null, got ${typeof output}`);
          }
          break;

        case 'fetchOrstMeanings':
          if (!executionContext.word_th) {
            throw new Error('word_th is required for ORST lookup');
          }
          output = await fetchOrstMeanings(executionContext.word_th);
          // Validate output: MeaningTh[] - validate each element
          if (Array.isArray(output)) {
            const validatedMeanings = [];
            for (let idx = 0; idx < output.length; idx++) {
              const meaning = output[idx];
              const validation = meaningThSchema.strict().safeParse(meaning);
              if (validation.success) {
                validatedMeanings.push(validation.data);
              } else {
                console.warn(`[Processing Pipeline] Skipping invalid meaning: ${validation.error.message}`);
              }
            }
            executionContext.orstSenses = validatedMeanings;
          } else {
            throw new Error(`Invalid ORST output: expected array, got ${typeof output}`);
          }
          break;

        case 'normalizeSensesWithGPT':
          // Normalize either ORST senses OR GPT-meaning senses (priority: ORST first, then GPT-meaning)
          const sensesToNormalize = executionContext.orstSenses && executionContext.orstSenses.length > 0
            ? executionContext.orstSenses
            : (executionContext.gptMeanings && executionContext.gptMeanings.length > 0
              ? executionContext.gptMeanings
              : null);
          
          // #region agent log
          const senseSourcesForPipeline = sensesToNormalize?.map(s => s.source || 'undefined') || [];
          // Skip logging - routine operation
          // #endregion
          
          if (!sensesToNormalize || sensesToNormalize.length === 0) {
            // #region agent log
            // Skip logging - routine skip operation
            // #endregion
            executionContext.normalizedSenses = [];
            break;
          }
          if (!executionContext.word_th) {
            throw new Error('word_th is required for GPT normalization');
          }
          const normalizeContext: {
            textTh: string;
            fullThaiText?: string;
            showName?: string;
            episode?: number;
            season?: number;
          } = {
            textTh: executionContext.word_th,
          };
          if (executionContext.fullThaiText !== undefined) {
            normalizeContext.fullThaiText = executionContext.fullThaiText;
          }
          if (executionContext.showName !== undefined) {
            normalizeContext.showName = executionContext.showName;
          }
          if (executionContext.episode !== undefined) {
            normalizeContext.episode = executionContext.episode;
          }
          if (executionContext.season !== undefined) {
            normalizeContext.season = executionContext.season;
          }
          output = await normalizeSensesWithGPT(sensesToNormalize, normalizeContext);
          // Validate output: MeaningTh[] - validate each element
          if (Array.isArray(output)) {
            const validatedMeanings = [];
            for (let idx = 0; idx < output.length; idx++) {
              const meaning = output[idx];
              const validation = meaningThSchema.strict().safeParse(meaning);
              if (validation.success) {
                validatedMeanings.push(validation.data);
              } else {
                console.warn(`[Processing Pipeline] Skipping invalid normalized meaning: ${validation.error.message}`);
              }
            }
            executionContext.normalizedSenses = validatedMeanings;
          } else {
            throw new Error(`Invalid normalized senses output: expected array, got ${typeof output}`);
          }
          break;

        case 'createMeaningsWithGPT':
          if (!executionContext.word_th) {
            throw new Error('word_th is required for GPT-meaning');
          }
          // Skip gracefully if ORST returned senses (don't need GPT-meaning)
          if (executionContext.orstSenses && executionContext.orstSenses.length > 0) {
            executionContext.gptMeanings = [];
            break;
          }
          const gptMeaningContext: {
            fullThaiText?: string;
            allTokens?: string[];
            wordPosition?: number;
            showName?: string;
            episode?: number;
            season?: number;
            g2p?: string;
            phonetic_en?: string;
          } = {};
          if (executionContext.fullThaiText !== undefined) {
            gptMeaningContext.fullThaiText = executionContext.fullThaiText;
          }
          if (executionContext.allTokens !== undefined) {
            gptMeaningContext.allTokens = executionContext.allTokens;
          }
          if (executionContext.wordPosition !== undefined) {
            gptMeaningContext.wordPosition = executionContext.wordPosition;
          }
          if (executionContext.showName !== undefined) {
            gptMeaningContext.showName = executionContext.showName;
          }
          if (executionContext.episode !== undefined) {
            gptMeaningContext.episode = executionContext.episode;
          }
          if (executionContext.season !== undefined) {
            gptMeaningContext.season = executionContext.season;
          }
          if (executionContext.g2p !== undefined) {
            gptMeaningContext.g2p = executionContext.g2p;
          }
          if (executionContext.phonetic_en !== undefined) {
            gptMeaningContext.phonetic_en = executionContext.phonetic_en;
          }
          output = await createMeaningsWithGPT(executionContext.word_th, gptMeaningContext);
          // Validate output: MeaningTh[] - validate each element
          if (Array.isArray(output)) {
            const validatedMeanings = [];
            for (let idx = 0; idx < output.length; idx++) {
              const meaning = output[idx];
              const validation = meaningThSchema.strict().safeParse(meaning);
              if (validation.success) {
                validatedMeanings.push(validation.data);
              } else {
                console.warn(`[Processing Pipeline] Skipping invalid GPT meaning: ${validation.error.message}`);
              }
            }
            executionContext.gptMeanings = validatedMeanings;
          } else {
            throw new Error(`Invalid GPT-meaning output: expected array, got ${typeof output}`);
          }
          break;

        default:
          throw new Error(`Unknown function: ${step.functionName}`);
      }

      // ⚠️ CRITICAL: Validate context after step execution with strict schema
      // Also validate step output matches outputSchema
      // Safety check: ensure executionContext is still an object
      if (!executionContext || typeof executionContext !== 'object') {
        throw new Error(`Invalid executionContext after step "${step.name}": expected object, got ${typeof executionContext}`);
      }
      const stepValidatedContext = pipelineContextSchema.strict().safeParse(executionContext);
      if (!stepValidatedContext.success) {
        console.error(`[Processing Pipeline] ✗ Step "${step.name}" produced invalid context:`, stepValidatedContext.error.errors);
        throw new Error(`Step "${step.name}" produced invalid context: ${stepValidatedContext.error.message}`);
      }
      
      // Validate step output matches outputSchema (if defined)
      if (step.outputSchema) {
        const outputValidation = step.outputSchema.safeParse(executionContext);
        if (!outputValidation.success) {
          console.error(`[Processing Pipeline] ✗ Step "${step.name}" output validation failed:`, outputValidation.error.errors);
          throw new Error(`Step "${step.name}" output validation failed: ${outputValidation.error.message}`);
        }
      }
      
      executionContext = stepValidatedContext.data;
      previousStepContext = { ...stepValidatedContext.data }; // Update previous step context for next iteration

      results.push({
        stepName: step.name,
        success: true,
        output,
      });

    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'processingPipeline.ts:executeStepsFromSchema',message:'STEP ERROR - Step execution failed',data:{stepName:step.name,workflowName:workflow.name,errorMessage:error instanceof Error ? error.message : String(error),errorStack:error instanceof Error ? error.stack : undefined},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'EJECT'})}).catch(()=>{});
      // #endregion
      console.error(`[Processing Pipeline] ✗ Step "${step.name}" failed:`, error);

      // Check if failure is acceptable
      const stepDef = workflow.steps.find(s => s.name === step.name);
      if (stepDef?.acceptableFailure) {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'processingPipeline.ts:executeStepsFromSchema',message:'ACCEPTABLE FAILURE - Continuing despite step error',data:{stepName:step.name,workflowName:workflow.name,errorMessage:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'EJECT'})}).catch(()=>{});
        // #endregion
        results.push({
          stepName: step.name,
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        // Continue execution even if step failed (acceptable failure)
        continue;
      } else {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'processingPipeline.ts:executeStepsFromSchema',message:'EJECT - Unacceptable failure, stopping pipeline',data:{stepName:step.name,workflowName:workflow.name,errorMessage:error instanceof Error ? error.message : String(error),completedSteps:results.filter(r=>r.success).map(r=>r.stepName),failedSteps:results.filter(r=>!r.success).map(r=>r.stepName)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'EJECT'})}).catch(()=>{});
        // #endregion
        // Unacceptable failure - stop execution
        results.push({
          stepName: step.name,
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        throw error;
      }
    }
  }

  // ⚠️ CRITICAL: Validate final context with strict schema
  // Safety check: ensure executionContext is still an object
  if (!executionContext || typeof executionContext !== 'object') {
    throw new Error(`Invalid final executionContext: expected object, got ${typeof executionContext}`);
  }
  
  const finalValidatedContext = pipelineContextSchema.strict().safeParse(executionContext);
  if (!finalValidatedContext.success) {
    // #region agent log
    const finalContextKeys = Object.keys(executionContext);
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'processingPipeline.ts:executeStepsFromSchema',message:'EJECT - Final context validation failed, stopping pipeline',data:{workflowName:workflow.name,validationErrors:finalValidatedContext.error.errors,finalContextKeys:finalContextKeys,completedSteps:results.filter(r=>r.success).map(r=>r.stepName),failedSteps:results.filter(r=>!r.success).map(r=>r.stepName)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'EJECT'})}).catch(()=>{});
    // #endregion
    console.error(`[Processing Pipeline] ✗ Workflow produced invalid final context:`, finalValidatedContext.error.errors);
    throw new Error(`Workflow produced invalid final context: ${finalValidatedContext.error.message}`);
  }

  return {
    results,
    finalContext: finalValidatedContext.data,
  };
}

// Removed generateWordId - word_th is the primary key, not id

/**
 * Process subtitles for an episode
 * 1. Fetch subtitles without tokens_th
 * 2. Tokenize each subtitle → update tokens_th
 * 3. Extract unique tokens
 * 4. Process each token: G2P → phonetic → ORST → save
 */
export async function processSubtitlesForEpisode(mediaId: string): Promise<void> {
  console.log('[Processing Pipeline] Starting processing for mediaId:', mediaId);

  // 1. Fetch subtitles
  const subtitles = await fetchSubtitles(mediaId);
  if (subtitles.length === 0) {
    console.warn('[Processing Pipeline] No subtitles found for mediaId:', mediaId);
    return;
  }

  console.log('[Processing Pipeline] Found', subtitles.length, 'subtitles');

  // 2. Process subtitles: tokenize and update tokens_th using workflow coordinator
  const workflow = getValidatedProcessingOrder();
  const processedSubtitles = [];
  
  for (const subtitle of subtitles) {
    // Check if already has tokens_th
    const hasValidThaiTokens = subtitle.tokens_th && subtitle.tokens_th.tokens && subtitle.tokens_th.tokens.length > 0;
    
    if (hasValidThaiTokens) {
      processedSubtitles.push(subtitle);
      continue;
    }

    // Execute tokenization directly from schema
    try {
      const context: PipelineContext = {
        thaiText: subtitle.thai,
      };

      // ⚠️ CRITICAL: Validate context before execution with strict schema
      const validatedContext = pipelineContextSchema.strict().safeParse(context);
      if (!validatedContext.success) {
        throw new Error(`Invalid context for subtitle ${subtitle.id}: ${validatedContext.error.message}`);
      }

      // Execute only tokenize step
      const { results, finalContext } = await executeStepsFromSchema(workflow, validatedContext.data, ['tokenize']);
      
      const tokenizeResult = results.find(r => r.stepName === 'tokenize');
      if (!tokenizeResult || !tokenizeResult.success) {
        throw new Error(`Tokenization failed: ${tokenizeResult?.error?.message || 'Unknown error'}`);
      }

      const updatedSubtitle = {
        ...subtitle,
        tokens_th: finalContext.tokens_th,
      };
      
      // Validate before pushing to array
      const validationResult = subtitleThSchema.safeParse(updatedSubtitle);
      if (validationResult.success) {
        processedSubtitles.push(validationResult.data);
      } else {
        console.error('[Processing Pipeline] Subtitle validation failed for', subtitle.id, ':', validationResult.error.errors);
        // Skip invalid subtitle - don't push unvalidated data
      }
    } catch (error) {
      console.error('[Processing Pipeline] Tokenization error for subtitle', subtitle.id, ':', error);
      // Validate original subtitle before using as fallback
      const validationResult = subtitleThSchema.safeParse(subtitle);
      if (validationResult.success) {
        processedSubtitles.push(validationResult.data);
      } else {
        console.error('[Processing Pipeline] Original subtitle also invalid, skipping:', subtitle.id);
        // Skip invalid subtitle entirely
      }
    }
  }

  // Save updated subtitles with tokens_th
  await saveSubtitlesBatch(processedSubtitles);
  console.log('[Processing Pipeline] Updated subtitles with tokens_th');

  // 3. Extract unique tokens from all subtitles
  const uniqueTokens = new Set<string>();
  for (const subtitle of processedSubtitles) {
    if (subtitle.tokens_th?.tokens) {
      for (const token of subtitle.tokens_th.tokens) {
        if (token && token.trim()) {
          uniqueTokens.add(token.trim());
        }
      }
    }
  }

  console.log('[Processing Pipeline] Found', uniqueTokens.size, 'unique tokens');

  // 4. Process each unique token using Zod schema execution
  // Schema enforces order: g2p → phonetic, orst → gpt-meaning → gpt_normalize
  for (const token of uniqueTokens) {
    try {
      const context: PipelineContext = {
        word_th: token, // NOT textTh - matches wordThSchema.word_th
      };

      // ⚠️ CRITICAL: Validate context before execution with strict schema
      const validatedContext = pipelineContextSchema.strict().safeParse(context);
      if (!validatedContext.success) {
        throw new Error(`Invalid context for token "${token}": ${validatedContext.error.message}`);
      }

      // Execute word processing workflow: g2p, phonetic, orst, gpt-meaning, gpt_normalize
      // Flow: ORST runs first. If ORST fails (empty), GPT-meaning runs. GPT-normalize runs after both and can normalize either ORST or GPT-meaning senses.
      // The schema enforces that phonetic runs after g2p, gpt-meaning runs after orst, gpt_normalize runs after both orst and gpt-meaning
      const { results, finalContext } = await executeStepsFromSchema(workflow, validatedContext.data, [
        'g2p',
        'phonetic',
        'orst',
        'gpt-meaning',
        'gpt_normalize',
      ]);

      // ⚠️ CRITICAL: Validate final context with strict schema
      const validatedFinalContext = pipelineContextSchema.strict().safeParse(finalContext);
      if (!validatedFinalContext.success) {
        throw new Error(`Workflow produced invalid final context for "${token}": ${validatedFinalContext.error.message}`);
      }

      // Check for failures
      const failedSteps = results.filter(r => !r.success);
      if (failedSteps.length > 0) {
        console.warn(`[Processing Pipeline] Some steps failed for token "${token}":`, 
          failedSteps.map(s => `${s.stepName}: ${s.error?.message}`).join(', '));
      }

      // Use normalized senses, GPT-meaning, or ORST senses (in priority order)
      const meanings = validatedFinalContext.data.normalizedSenses || validatedFinalContext.data.gptMeanings || validatedFinalContext.data.orstSenses || [];

      if (meanings.length === 0) {
        console.warn('[Processing Pipeline] No meanings found for token:', token);
        continue;
      }

      // Validate word data - ensure optional fields are properly typed for exactOptionalPropertyTypes
      // Note: word_th is the primary key (not id) - matches WordDataToSave interface
      const wordData: {
        word_th: string;
        g2p?: string;
        phonetic_en?: string;
        senses: Array<{
          id: bigint;
          definition_th: string;
          source?: string;
          created_at?: string;
          word_th_id?: string;
        }>;
      } = {
        word_th: token,
        senses: meanings.map(meaning => {
          const sense: {
            id: bigint;
            definition_th: string;
            source?: string;
            created_at?: string;
            word_th_id?: string;
          } = {
            id: meaning.id,
            definition_th: meaning.definition_th,
          };
          if (meaning.source !== undefined) {
            sense.source = meaning.source;
          }
          if (meaning.created_at !== undefined) {
            sense.created_at = meaning.created_at;
          }
          if (meaning.word_th_id !== undefined) {
            sense.word_th_id = meaning.word_th_id;
          }
          return sense;
        }),
      };
      if (validatedFinalContext.data.g2p !== undefined) {
        wordData.g2p = validatedFinalContext.data.g2p;
      }
      if (validatedFinalContext.data.phonetic_en !== undefined) {
        wordData.phonetic_en = validatedFinalContext.data.phonetic_en;
      }

      // Validate with wordSchema (indirectly via saveWordData)
      await saveWordData(wordData);
      console.log('[Processing Pipeline] Saved word:', token);
    } catch (error) {
      console.error('[Processing Pipeline] Error processing token', token, ':', error);
    }
  }

  console.log('[Processing Pipeline] Processing complete for mediaId:', mediaId);
}
