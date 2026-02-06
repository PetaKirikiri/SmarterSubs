/**
 * Netflix Metadata Extractor
 * Extracts episode metadata from Netflix DOM and URL
 * Returns Episode with Zod schema field names directly
 */

import { episodeSchema, type Episode } from '@/schemas/episodeSchema';

/**
 * Get media ID from Netflix URL pattern
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
 * Extract episode from Netflix DOM
 * Returns Episode with Zod schema field names directly
 * Simple approach: get what we can, default season to 1
 */
export function extractEpisodeFromNetflixPage(): Episode | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const url = window.location.href;
  const media_id = getMediaIdFromUrl(url);
  if (!media_id) {
    return null;
  }

  // Simple extraction - get what's available
  let show_title: string | undefined;
  let episode_number: number | undefined;
  let episode_title: string | undefined;
  const season_number = 1; // Default to 1 as we can't reliably get it

  // Get show title from video-title element and parse it
  const showNameElement = document.querySelector('[data-uia="video-title"]');
  if (showNameElement) {
    const rawTitle = showNameElement.textContent?.trim() || '';
    
    // Normalize empty strings to undefined for optional fields
    if (rawTitle === '') {
      show_title = undefined;
    } else {
      // Parse pattern: "ShowTitleE1EpisodeTitle" or "ShowTitle Episode 1 EpisodeTitle"
      const episodePattern = /([Ee](\d+)|[Ee]pisode\s+(\d+))/;
      const episodeMatch = rawTitle.match(episodePattern);
      
      if (episodeMatch && episodeMatch.index !== undefined) {
        // Extract show title (before episode marker)
        const extractedShowTitle = rawTitle.substring(0, episodeMatch.index).trim();
        show_title = extractedShowTitle || undefined; // Normalize empty string to undefined
        
        // Extract episode number
        episode_number = parseInt(episodeMatch[2] || episodeMatch[3], 10);
        
        // Extract episode title (after episode marker)
        const afterEpisode = rawTitle.substring(episodeMatch.index + episodeMatch[0].length).trim();
        episode_title = afterEpisode || undefined; // Normalize empty string to undefined
      } else {
        // No episode pattern found, use whole thing as show title
        show_title = rawTitle || undefined; // Normalize empty string to undefined
      }
    }
  }

  // Also check video-title-secondary for episode info if we didn't get it from title
  if (!episode_number || !episode_title) {
    const episodeInfoElement = document.querySelector('[data-uia="video-title-secondary"]');
    if (episodeInfoElement) {
      const episodeText = episodeInfoElement.textContent?.trim() || '';
      
      if (!episode_title && episodeText) {
        episode_title = episodeText || undefined; // Normalize empty string to undefined
      }
      
      if (!episode_number) {
        const episodeMatch = episodeText.match(/[Ee]pisode\s+(\d+)|[Ee](\d+)/);
        if (episodeMatch) {
          episode_number = parseInt(episodeMatch[1] || episodeMatch[2], 10);
        }
      }
    }
  }

  // Create Episode object with Zod field names, validate immediately
  const episode = {
    id: generateEpisodeId(media_id),
    media_id,
    show_title,
    episode_number,
    season_number,
    episode_title,
  };

  // Validate shape and data quality
  const validated = episodeSchema.parse(episode);

  // Extraction success validation: For Netflix extraction, show_title should always be present
  // If it's missing or empty, Netflix DOM structure may have changed
  if (!validated.show_title || validated.show_title.trim() === '') {
    throw new Error(
      'Netflix extraction failed: show_title is missing or empty. ' +
      'Netflix DOM structure may have changed. ' +
      `Expected selector: [data-uia="video-title"]. ` +
      `Current URL: ${url}`
    );
  }

  return validated;
}
