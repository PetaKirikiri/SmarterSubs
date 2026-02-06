import { z } from 'zod';
import { numberCoerce, bigintCoerce } from './zodHelpers';

/**
 * Episode Schema - matches ACTUAL database column names
 * Database table: episodes
 * Actual columns: id (bigint), media_id (text), show_title (text), season_number (numeric), episode_number (numeric), episode_title (text)
 */
export const episodeSchema = z.object({
  id: bigintCoerce,
  media_id: z.string()
    .min(1, 'media_id is required')
    .refine(val => val.trim().length > 0, 'media_id cannot be only whitespace'),
  show_title: z.union([
    z.string().min(1).refine(val => val.trim().length > 0, 'show_title cannot be only whitespace'),
    z.undefined()
  ]).optional(),
  season_number: z.union([
    numberCoerce.refine(val => val > 0 && val <= 100, 'season_number must be between 1 and 100'),
    z.undefined()
  ]).optional(),
  episode_number: z.union([
    numberCoerce.refine(val => val > 0 && val <= 10000, 'episode_number must be between 1 and 10000'),
    z.undefined()
  ]).optional(),
  episode_title: z.union([
    z.string().min(1).refine(val => val.trim().length > 0, 'episode_title cannot be only whitespace'),
    z.undefined()
  ]).optional(),
});

export type Episode = z.infer<typeof episodeSchema>;
