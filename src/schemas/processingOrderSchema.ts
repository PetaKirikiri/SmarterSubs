/**
 * Processing Order Schema - Central source of truth for processing order
 * Defines processing steps, their dependencies, and execution order
 * Enforced by Zod to prevent errors like phonetic before G2P
 * 
 * ⚠️ SCHEMA ENFORCEMENT: This schema defines the "laws" for processing order
 * No code can bypass these rules - they are enforced by Zod validation
 */

import { z } from 'zod';
import { bigintCoerce } from './zodHelpers';
import { wordThSchema } from './wordThSchema';
import { meaningThSchema } from './meaningThSchema';
import { subtitleThSchema } from './subtitleThSchema';

/**
 * Processing step definition
 * Each step defines:
 * - name: Unique identifier for the step
 * - functionName: Name of the function to call (must exist in workflowFunctions)
 * - dependsOn: Array of step names that must complete before this step runs
 * - description: Human-readable description
 * - inputSchema: Zod schema that input context must match (enforces step transition compatibility)
 * - outputSchema: Zod schema that output context must match (enforces step output shape)
 */
export const processingStepSchema = z.object({
  name: z.string().min(1, 'Step name is required'),
  functionName: z.string().min(1, 'Function name is required'),
  dependsOn: z.array(z.string()).default([]),
  description: z.string().optional(),
  acceptableFailure: z.boolean().optional().default(false), // Only ORST can fail (word not in dictionary)
  // Input/output schema definitions - enforce step transition compatibility
  inputSchema: z.custom<z.ZodSchema>((val) => val instanceof z.ZodSchema, {
    message: 'inputSchema must be a Zod schema',
  }),
  outputSchema: z.custom<z.ZodSchema>((val) => val instanceof z.ZodSchema, {
    message: 'outputSchema must be a Zod schema',
  }),
});

export type ProcessingStep = z.infer<typeof processingStepSchema>;

/**
 * Processing order definition schema
 * Defines the complete processing order with ordered steps
 */
export const processingOrderSchema = z.object({
  name: z.string().min(1, 'Processing order name is required'),
  steps: z.array(processingStepSchema).min(1, 'At least one step is required'),
}).refine(
  (data) => {
    // Validate that all dependencies reference existing steps
    const stepNames = new Set(data.steps.map(s => s.name));
    for (const step of data.steps) {
      for (const dep of step.dependsOn) {
        if (!stepNames.has(dep)) {
          return false; // Dependency doesn't exist
        }
      }
    }
    return true;
  },
  {
    message: 'All dependencies must reference existing step names',
    path: ['steps'],
  }
).refine(
  (data) => {
    // Validate no circular dependencies using topological sort
    const stepMap = new Map(data.steps.map(s => [s.name, s]));
    const visited = new Set<string>();
    const recStack = new Set<string>();

    function hasCycle(stepName: string): boolean {
      if (recStack.has(stepName)) {
        return true; // Circular dependency detected
      }
      if (visited.has(stepName)) {
        return false; // Already processed
      }

      visited.add(stepName);
      recStack.add(stepName);

      const step = stepMap.get(stepName);
      if (step) {
        for (const dep of step.dependsOn) {
          if (hasCycle(dep)) {
            return true;
          }
        }
      }

      recStack.delete(stepName);
      return false;
    }

    for (const step of data.steps) {
      if (hasCycle(step.name)) {
        return false;
      }
    }
    return true;
  },
  {
    message: 'Circular dependencies detected in processing order steps',
    path: ['steps'],
  }
);

export type ProcessingOrder = z.infer<typeof processingOrderSchema>;

/**
 * Pipeline Context Schema - Defines the shape of data passed between processing steps
 * This schema is the ONLY source of truth for context shape - no custom interfaces allowed
 * All field names must match Zod schemas (word_th, word_th_id, definition_th)
 */
export const pipelineContextSchema = z.object({
  // Subtitle-level data (from subtitleThSchema)
  thaiText: z.string().optional(), // From subtitle.thai
  tokens_th: z.object({ 
    tokens: z.array(z.object({ 
      t: z.string(), 
      meaning_id: bigintCoerce.optional() 
    })) 
  }).optional(), // From subtitle.tokens_th
  
  // Word-level data (from wordThSchema)
  word_th: z.string().optional(), // NOT textTh - matches wordThSchema.word_th
  g2p: z.string().optional(),
  phonetic_en: z.string().optional(),
  
  // Meanings (from meaningThSchema)
  orstSenses: z.array(meaningThSchema).optional(), // Uses MeaningTh[] from schema
  normalizedSenses: z.array(meaningThSchema).optional(), // Uses MeaningTh[]
  gptMeanings: z.array(meaningThSchema).optional(), // Uses MeaningTh[]
  
  // Additional context for GPT (optional metadata)
  fullThaiText: z.string().optional(),
  allTokens: z.array(z.string()).optional(),
  wordPosition: z.number().optional(),
  showName: z.string().optional(),
  episode: z.number().optional(),
  season: z.number().optional(),
}).strict(); // Reject unknown fields - all fields must be defined in schema

export type PipelineContext = z.infer<typeof pipelineContextSchema>;

/**
 * Branded Types - Can only be created by sealed constructors
 * These types prevent unauthorized object creation - must go through validation gates
 */

// Branded type - can only be created by makeSeededInput()
export type SeededInput = PipelineContext & { __brand: 'SeededInput' };

// Branded type - can only be created by makeProcessedContext()
export type ProcessedContext = PipelineContext & { __brand: 'ProcessedContext' };

/**
 * Sealed Constructors - ONLY way to create branded types
 * All external data (DB, API, files) must pass through these gates
 */

/**
 * Create SeededInput from unknown data - validates with Zod schema
 * This is the ONLY way to create SeededInput - prevents forging
 */
export function makeSeededInput(data: unknown): SeededInput {
  const validated = pipelineContextSchema.strict().parse(data);
  return validated as SeededInput;
}

/**
 * Create ProcessedContext from unknown data - validates with Zod schema
 * This is the ONLY way to create ProcessedContext - prevents forging
 */
export function makeProcessedContext(data: unknown): ProcessedContext {
  const validated = pipelineContextSchema.strict().parse(data);
  return validated as ProcessedContext;
}

/**
 * Default processing order definition for episode processing
 * This is the central source of truth for processing order
 */
export const defaultProcessingOrder: ProcessingOrder = {
  name: 'episode_processing',
  steps: [
    {
      name: 'tokenize',
      functionName: 'buildThaiTokensFromText',
      dependsOn: [],
      description: 'Tokenize Thai subtitle text into word tokens',
      inputSchema: z.object({ thaiText: z.string() }).strict(),
      outputSchema: z.object({ 
        tokens_th: z.object({ 
          tokens: z.array(z.object({ 
            t: z.string(), 
            meaning_id: bigintCoerce.optional() 
          })) 
        }) 
      }).strict(),
    },
    {
      name: 'g2p',
      functionName: 'getG2P',
      dependsOn: [],
      description: 'Convert Thai text to G2P phonetic representation',
      inputSchema: z.object({ word_th: z.string() }).strict(),
      outputSchema: z.object({ word_th: z.string(), g2p: z.string() }).strict(),
    },
    {
      name: 'phonetic',
      functionName: 'parsePhoneticToEnglish',
      dependsOn: ['g2p'], // Must have G2P before phonetic
      description: 'Parse G2P phonetic to readable English spelling',
      inputSchema: z.object({ word_th: z.string(), g2p: z.string() }).strict(),
      outputSchema: z.object({ word_th: z.string(), g2p: z.string(), phonetic_en: z.string() }).strict(),
    },
    {
      name: 'orst',
      functionName: 'fetchOrstMeanings',
      dependsOn: [],
      description: 'Fetch word meanings from ORST dictionary',
      // ⚠️ LOW TOLERANCE: ORST is the ONLY acceptable failure point (word may not be in dictionary)
      // All other steps (tokenize, g2p, phonetic) must succeed
      acceptableFailure: true,
      inputSchema: z.object({ word_th: z.string() }).strict(),
      outputSchema: z.object({ 
        word_th: z.string(), 
        orstSenses: z.array(meaningThSchema).optional() 
      }).passthrough(), // Allow additional fields from previous steps (e.g., g2p, phonetic_en)
    },
    {
      name: 'gpt-meaning',
      functionName: 'createMeaningsWithGPT',
      dependsOn: ['orst'], // Runs after ORST
      description: 'Generate meanings using GPT when ORST returns empty',
      acceptableFailure: true, // Similar to ORST (word may not be processable)
      inputSchema: z.object({ 
        word_th: z.string(), 
        orstSenses: z.array(meaningThSchema).optional(),
        fullThaiText: z.string().optional(),
        allTokens: z.array(z.string()).optional(),
        wordPosition: z.number().optional(),
        g2p: z.string().optional(),
        phonetic_en: z.string().optional(),
      }).strict(),
      outputSchema: z.object({ 
        word_th: z.string(), 
        gptMeanings: z.array(meaningThSchema).optional() 
      }).passthrough(), // Allow additional fields from previous steps (e.g., g2p, phonetic_en, orstSenses)
    },
    {
      name: 'gpt_normalize',
      functionName: 'normalizeSensesWithGPT',
      dependsOn: ['orst', 'gpt-meaning'], // Can normalize either ORST senses OR GPT-meaning senses
      description: 'Normalize and enhance senses with GPT (works with ORST or GPT-meaning output)',
      inputSchema: z.object({ 
        word_th: z.string(), 
        orstSenses: z.array(meaningThSchema).optional(),
        gptMeanings: z.array(meaningThSchema).optional(),
      }).strict(),
      outputSchema: z.object({ 
        word_th: z.string(), 
        normalizedSenses: z.array(meaningThSchema).optional() 
      }).passthrough(), // Allow additional fields from previous steps (e.g., g2p, phonetic_en, orstSenses)
    },
  ],
};

/**
 * Validate and return the default processing order
 * Throws if processing order is invalid (e.g., circular dependencies)
 */
export function getValidatedProcessingOrder(): ProcessingOrder {
  console.log('[Processing Order Schema] Validating processing order with Zod schema...');
  
  try {
    const validated = processingOrderSchema.parse(defaultProcessingOrder);
    console.log('[Processing Order Schema] ✓ Processing order schema validation passed');
    return validated;
  } catch (error) {
    console.error('[Processing Order Schema] ✗ Processing order schema validation failed:', error);
    throw error;
  }
}

// Legacy exports for backward compatibility during migration
export const workflowSchema = processingOrderSchema;
export type Workflow = ProcessingOrder;
export const defaultWorkflow = defaultProcessingOrder;
export const getValidatedWorkflow = getValidatedProcessingOrder;
