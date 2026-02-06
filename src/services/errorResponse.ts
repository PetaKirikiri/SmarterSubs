/**
 * Centralized Error Response Service
 * 
 * HARD RULE: All error responses must come from this service, never constructed in orchestrators.
 * This prevents "sprayed and prayed" error handling scattered across the codebase.
 */

import { z } from 'zod';

export interface ErrorResponse {
  type: 'validation' | 'business_rule' | 'data_integrity';
  field: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  actionable: boolean; // Can user fix this?
  suggestedAction?: string;
  path?: (string | number)[];
  present?: boolean; // Whether the field exists in the data
  expected?: string; // What was expected
  actual?: any; // What was actually found (if present but invalid)
}

/**
 * Interpret Zod validation errors into consistent error responses
 */
export function interpretZodError(
  zodError: z.ZodError,
  context?: { wordId?: string; field?: string; entityType?: string }
): ErrorResponse[] {
  const responses: ErrorResponse[] = [];
  
  zodError.errors.forEach((err) => {
    const fieldPath = err.path.join('.');
    const fullField = context?.field ? `${context.field}.${fieldPath}` : fieldPath;
    
    // Determine error type based on Zod error code
    let type: ErrorResponse['type'] = 'validation';
    let severity: ErrorResponse['severity'] = 'error';
    let actionable = true;
    let suggestedAction: string | undefined;
    
    switch (err.code) {
      case 'invalid_type':
        if (err.received === 'undefined' || err.received === 'null') {
          type = 'data_integrity';
          suggestedAction = 'Ensure this field is provided';
        }
        break;
      case 'custom':
        // Custom errors from refine() are business rules
        type = 'business_rule';
        break;
      case 'too_small':
        if (err.minimum === 1 && err.type === 'array') {
          type = 'data_integrity';
          suggestedAction = 'Ensure at least one item is provided';
        }
        break;
      case 'too_big':
        type = 'business_rule';
        break;
    }
    
    // Special handling for sense ID format violations
    if (fullField.includes('senseId') || fullField.includes('senses')) {
      if (err.message.includes('senseCount') || err.message.includes('match')) {
        type = 'business_rule';
        severity = 'warning';
        suggestedAction = 'Fetch fresh data to update senses with correct naming convention';
      }
    }
    
    // Special handling for senseCount mismatches
    if (fullField.includes('senseCount')) {
      type = 'business_rule';
      severity = 'warning';
      suggestedAction = 'Sense count does not match actual senses. Fetch fresh data to fix.';
    }
    
    responses.push({
      type,
      field: fullField,
      message: err.message,
      severity,
      actionable,
      suggestedAction,
      path: err.path,
      present: err.received !== 'undefined' && err.received !== 'null',
      expected: err.expected || 'Valid value',
      actual: err.received !== 'undefined' ? err.received : undefined,
    });
  });
  
  return responses;
}

/**
 * Format error response for UI display
 */
export function formatErrorForDisplay(error: ErrorResponse): string {
  let display = `${error.field}: ${error.message}`;
  
  if (error.present === false) {
    display += ' (Missing)';
  } else if (error.actual !== undefined) {
    display += ` (Found: ${typeof error.actual === 'object' ? JSON.stringify(error.actual) : String(error.actual)})`;
  }
  
  if (error.suggestedAction) {
    display += ` - ${error.suggestedAction}`;
  }
  
  return display;
}

/**
 * Interpret and format errors for user alerts/notifications
 * Returns user-friendly messages for display in alerts or console
 */
export function interpretErrorForUser(
  error: Error | z.ZodError | string,
  context?: { wordId?: string; operation?: string }
): { message: string; severity: 'error' | 'warning' | 'info' } {
  if (typeof error === 'string') {
    return { message: error, severity: 'error' };
  }
  
  if (error instanceof z.ZodError) {
    const errorResponses = interpretZodError(error, context);
    if (errorResponses.length > 0) {
      const primaryError = errorResponses[0];
      return {
        message: formatErrorForDisplay(primaryError),
        severity: primaryError.severity,
      };
    }
    return { message: 'Validation failed', severity: 'error' };
  }
  
  if (error instanceof Error) {
    const errorMessage = error.message;
    
    // Handle specific error types
    if (errorMessage.includes('CORS') || errorMessage.includes('Failed to fetch')) {
      return {
        message: `Cannot fetch from ORST dictionary${context?.wordId ? ` for "${context.wordId}"` : ''} due to CORS restrictions.\n\nTo fix this, you need a backend proxy server. The frontend cannot directly access the ORST dictionary API due to browser security restrictions.`,
        severity: 'error',
      };
    }
    
    if (errorMessage.includes('Unsupported field value: undefined')) {
      return {
        message: `Failed to save data${context?.wordId ? ` for "${context.wordId}"` : ''}: Invalid data format. Some fields contain undefined values which the database does not allow.`,
        severity: 'error',
      };
    }
    
    return {
      message: `Failed to ${context?.operation || 'complete operation'}${context?.wordId ? ` for "${context.wordId}"` : ''}: ${errorMessage}`,
      severity: 'error',
    };
  }
  
  return { message: 'An unknown error occurred', severity: 'error' };
}
