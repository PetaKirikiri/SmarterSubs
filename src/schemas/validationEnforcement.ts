import { z } from 'zod';

/**
 * Validation Enforcement Helpers
 * 
 * ⚠️ SCHEMA ENFORCEMENT: These functions ensure validation ALWAYS happens
 * No code can bypass Zod validation - these are the enforcement layer
 * All data must pass through these functions before being used
 */

/**
 * Enforce schema validation - ALWAYS validates, never bypasses
 * 
 * Throws if validation fails - no silent failures
 * Use this for all schema validation to ensure rules are enforced
 * 
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @param context - Optional context string for error messages
 * @returns Validated data matching schema type
 * @throws Error if validation fails
 */
export function enforceSchema<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context?: string
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errorMessage = result.error.errors
      .map(err => `${err.path.join('.')}: ${err.message}`)
      .join('; ');
    throw new Error(
      `[SCHEMA ENFORCEMENT VIOLATION] ${context || 'Schema validation failed'}: ${errorMessage}`
    );
  }
  return result.data;
}

/**
 * Enforce completeness validation - validates base schema FIRST, then completeness validation
 * 
 * Base schema rules CANNOT be bypassed - they are validated first
 * Completeness validation schema adds additional rules on top of base schema
 * 
 * This ensures that:
 * 1. Base schema validation always runs (required fields, types, etc.)
 * 2. Completeness validation adds rules but never removes base rules
 * 3. Both validations must pass for data to be considered valid
 * 
 * @param baseSchema - Base Zod schema (e.g., wordThSchema, meaningThSchema)
 * @param completenessSchema - Completeness validation schema that extends base (e.g., completeWordThSchema)
 * @param data - Data to validate
 * @param context - Optional context string for error messages
 * @returns Validated data matching completeness validation schema type
 * @throws Error if base or completeness validation fails
 */
export function enforceContract<T>(
  baseSchema: z.ZodSchema<T>,
  completenessSchema: z.ZodSchema<T>,
  data: unknown,
  context?: string
): T {
  // Step 1: Validate base schema (required fields, types, etc.)
  // Base schema rules CANNOT be bypassed - they run first
  const baseResult = baseSchema.safeParse(data);
  if (!baseResult.success) {
    const baseErrorMessage = baseResult.error.errors
      .map(err => `${err.path.join('.')}: ${err.message}`)
      .join('; ');
    throw new Error(
      `[COMPLETENESS ENFORCEMENT VIOLATION] Base schema validation failed ${context || ''}: ${baseErrorMessage}`
    );
  }
  
  // Step 2: Validate completeness (additional rules)
  // Completeness validation adds rules but base rules are already enforced
  const completenessResult = completenessSchema.safeParse(baseResult.data);
  if (!completenessResult.success) {
    const completenessErrorMessage = completenessResult.error.errors
      .map(err => `${err.path.join('.')}: ${err.message}`)
      .join('; ');
    throw new Error(
      `[COMPLETENESS ENFORCEMENT VIOLATION] Completeness validation failed ${context || ''}: ${completenessErrorMessage}`
    );
  }
  
  return completenessResult.data;
}
