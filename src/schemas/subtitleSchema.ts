import { z } from 'zod';
import { numberCoerce } from './zodHelpers';

/**
 * @deprecated This schema includes English fields that are no longer used.
 * Use subtitleThSchema instead for Thai-only subtitles.
 * 
 * Subtitle Schema - matches ACTUAL database column names (snake_case)
 * Database table: subtitles (deprecated - use subtitles_th)
 * Actual columns: id (text), thai (text), english (text), start_sec_th (numeric), end_sec_th (numeric), tokens_th (jsonb), start_sec_eng (numeric), end_sec_eng (numeric), tokens_eng (jsonb)
 */
export const subtitleSchema = z.object({
  id: z.string().min(1, 'Subtitle id is required'),
  thai: z.string().min(1, 'thai is required'),
  english: z.string().min(1, 'english is required'), // Required - VTT extraction must provide English
  start_sec_th: numberCoerce, // Required - Thai VTT timestamps
  end_sec_th: numberCoerce, // Required - Thai VTT timestamps
  tokens_th: z.record(z.any()).optional(), // Optional - Thai tokens
  start_sec_eng: numberCoerce.optional(), // Optional - English VTT timestamps
  end_sec_eng: numberCoerce.optional(), // Optional - English VTT timestamps
  tokens_eng: z.record(z.any()).optional(), // Optional - English tokens
}).refine(
  (data) => {
    return data.end_sec_th > data.start_sec_th;
  },
  {
    message: 'end_sec_th must be greater than start_sec_th',
    path: ['end_sec_th'],
  }
).refine(
  (data) => {
    // If both English timestamps are present, validate end > start
    if (data.start_sec_eng !== undefined && data.end_sec_eng !== undefined) {
      return data.end_sec_eng > data.start_sec_eng;
    }
    return true;
  },
  {
    message: 'end_sec_eng must be greater than start_sec_eng',
    path: ['end_sec_eng'],
  }
);

export type Subtitle = z.infer<typeof subtitleSchema>;
