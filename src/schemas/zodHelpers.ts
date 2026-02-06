import { z } from 'zod';

/**
 * Shared Zod coercion helpers
 * These utilities ensure consistent type coercion across all schemas
 * Used by all schema files to eliminate duplication
 */

/**
 * Coerce string or number to number
 * Accepts: number (finite) or string that can be parsed as number
 * Throws: If string cannot be parsed as valid number
 */
export const numberCoerce = z.union([
  z.number().finite(),
  z.string().transform((val) => {
    const num = parseFloat(val);
    if (isNaN(num)) throw new Error('Must be a valid number');
    return num;
  })
]);

/**
 * Coerce string or number to bigint
 * Accepts: bigint, number (integer), or string that can be parsed as integer
 * Throws: If string cannot be parsed as valid integer
 */
export const bigintCoerce = z.union([
  z.bigint(),
  z.number().int().transform((val) => BigInt(val)),
  z.string().transform((val) => {
    const num = parseInt(val, 10);
    if (isNaN(num)) throw new Error('Must be a valid integer');
    return BigInt(num);
  })
]);

/**
 * Coerce string to UUID format
 * Accepts: Valid UUID string (with or without dashes)
 * Throws: If string is not a valid UUID format
 */
export const uuidCoerce = z.union([
  z.string().uuid(),
  z.string().transform((val) => {
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(val)) throw new Error('Must be a valid UUID');
    return val;
  })
]);
