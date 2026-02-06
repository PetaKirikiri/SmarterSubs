import { z } from 'zod';
import { numberCoerce } from './zodHelpers';

/**
 * Subtitle Thai Schema - matches ACTUAL database column names (snake_case)
 * Database table: subtitles_th
 * Actual columns: id (text), thai (text), start_sec_th (numeric), end_sec_th (numeric), tokens_th (jsonb)
 */
export const subtitleThSchema = z.object({
  id: z.string()
    .min(1, 'Subtitle id is required')
    .refine(val => val.trim().length > 0, 'Subtitle id cannot be only whitespace'),
  thai: z.string()
    .min(1, 'thai is required')
    .refine(val => val.trim().length > 0, 'thai cannot be empty or only whitespace'),
  start_sec_th: numberCoerce
    .refine(val => val >= 0, 'start_sec_th cannot be negative')
    .refine(val => val < 86400, 'start_sec_th seems unreasonably large (over 24 hours)'),
  end_sec_th: numberCoerce
    .refine(val => val >= 0, 'end_sec_th cannot be negative')
    .refine(val => val < 86400, 'end_sec_th seems unreasonably large (over 24 hours)'),
  tokens_th: z.object({ tokens: z.array(z.string()) }).optional(), // Optional - Thai tokens (strict shape)
}).strict() // Reject unknown fields - must be called BEFORE .refine()
.refine(
  (data) => {
    return data.end_sec_th > data.start_sec_th;
  },
  {
    message: 'end_sec_th must be greater than start_sec_th',
    path: ['end_sec_th'],
  }
);

export type SubtitleTh = z.infer<typeof subtitleThSchema>;
