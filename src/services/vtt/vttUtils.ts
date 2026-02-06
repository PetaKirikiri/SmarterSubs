/**
 * VTT Utilities
 * Timestamp parsing and HTML cleaning utilities for VTT files
 */

/**
 * Parse timestamp string from VTT content
 * Converts "HH:MM:SS.mmm" format to seconds
 * @param {string} timestamp - Timestamp string (e.g., "00:00:01.234")
 * @returns {number | null} Seconds as float, or null if invalid
 */
export function parseVTTTimestamp(timestamp: string): number | null {
  const parts = timestamp.trim().split(':');
  if (parts.length !== 3) return null;
  
  const hours = parseInt(parts[0]) || 0;
  const minutes = parseInt(parts[1]) || 0;
  const secondsParts = parts[2].split('.');
  const seconds = parseInt(secondsParts[0]) || 0;
  const milliseconds = parseInt(secondsParts[1]) || 0;
  
  return hours * 3600 + minutes * 60 + seconds + (milliseconds / 1000);
}

/**
 * Text cleaning utility (used by both THAI and ENGLISH parsers)
 * Removes HTML tags and entities from subtitle text
 * @param {string} text - Text with potential HTML tags
 * @returns {string} Cleaned text
 */
export function stripHTMLTags(text: string): string {
  if (!text) return '';
  let cleaned = text.replace(/<[^>]+>/g, '');
  cleaned = cleaned.replace(/&[a-z]+;/gi, '');
  return cleaned.trim();
}
