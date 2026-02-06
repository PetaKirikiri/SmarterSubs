/**
 * Metadata Extraction
 * Extract episode metadata using Zod schema field names directly
 */

import { episodeSchema, type Episode } from '../../schemas/episodeSchema';

/**
 * Get media ID from Netflix URL pattern
 * @param {string} url - URL string
 * @returns {string | null} Media ID from URL or null
 */
export function getMediaIdFromUrl(url: string): string | null {
  const urlMatch = url.match(/\/watch\/(\d+)/);
  return urlMatch && urlMatch[1] ? urlMatch[1] : null;
}

/**
 * Generate episode ID from media_id
 */
function generateEpisodeId(media_id: string): bigint {
  try {
    const mediaIdNum = parseInt(media_id, 10);
    if (!isNaN(mediaIdNum)) {
      return BigInt(mediaIdNum);
    } else {
      let hash = 0;
      for (let i = 0; i < media_id.length; i++) {
        const char = media_id.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return BigInt(Math.abs(hash));
    }
  } catch {
    return BigInt(Date.now());
  }
}

/**
 * Extract episode metadata using Zod schema field names as individual parameters
 * @param {string} media_id - Media ID (Zod schema field name)
 * @param {string} show_title - Show title (Zod schema field name, optional)
 * @param {number} episode_number - Episode number (Zod schema field name, optional)
 * @param {number} season_number - Season number (Zod schema field name, optional)
 * @param {string} episode_title - Episode title (Zod schema field name, optional)
 * @returns {Episode} Episode object validated with episodeSchema
 */
export function extractEpisodeMetadata(
  media_id: string,
  show_title?: string,
  episode_number?: number,
  season_number?: number,
  episode_title?: string
): Episode {
  // Create Episode object with Zod field names, validate immediately
  const episode = {
    id: generateEpisodeId(media_id),
    media_id,
    show_title,
    episode_number,
    season_number,
    episode_title,
  };
  
  return episodeSchema.parse(episode);
}
