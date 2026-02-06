/**
 * VTT Parser
 * Parse VTT (WebVTT) subtitle files into structured subtitle data
 * Uses Zod schema field names directly, no intermediate formats
 * Strict validation - throws errors immediately if data is invalid
 */

import { parseVTTTimestamp, stripHTMLTags } from './vttUtils';
import { subtitleThSchema, type SubtitleTh } from '../../schemas/subtitleThSchema';

/**
 * Parse Thai VTT file into SubtitleTh array
 * All fields must be present - throws errors if any required data is missing
 * @param {string} thaiContent - Thai VTT file content (required)
 * @param {string} mediaId - Media ID for generating subtitle IDs (required)
 * @returns {Promise<SubtitleTh[]>} Array of subtitles matching subtitleThSchema
 * @throws {Error} If VTT content is invalid, malformed, or missing required fields
 */
export async function parseVTTFile(
  thaiContent: string,
  mediaId: string
): Promise<SubtitleTh[]> {
  if (!thaiContent || !thaiContent.trim()) {
    throw new Error('Thai VTT content is required');
  }
  if (!mediaId || !mediaId.trim()) {
    throw new Error('Media ID is required');
  }

  const thaiBlocks = thaiContent.trim().split(/\n\s*\n/).filter(block => block.trim());

  if (thaiBlocks.length === 0) {
    throw new Error('Thai VTT content contains no subtitle blocks');
  }

  // Parse Thai blocks into map by index
  const thaiMap = new Map<number, { thai: string; startSecThai: number; endSecThai: number }>();

  // Parse Thai blocks - use Zod field names from the start
  for (let i = 0; i < thaiBlocks.length; i++) {
    const block = thaiBlocks[i].trim();
    const lines = block.split('\n').filter(line => line.trim());
    
    // Skip WEBVTT header block
    if (lines.length > 0 && lines[0].trim().toUpperCase() === 'WEBVTT') {
      continue;
    }
    
    // Skip NOTE blocks (metadata)
    if (lines.length > 0 && lines[0].trim().toUpperCase().startsWith('NOTE')) {
      continue;
    }
    
    if (lines.length < 2) {
      throw new Error(`Thai VTT block ${i + 1} is malformed: must have at least 2 lines (index and timestamp). Block content: "${block.substring(0, 100)}"`);
    }
    
    const indexStr = lines[0].trim();
    const index = parseInt(indexStr, 10);
    if (isNaN(index)) {
      throw new Error(`Thai VTT block ${i + 1} has invalid index: "${indexStr}". Block content: "${block.substring(0, 100)}"`);
    }
    
    const timeLine = lines[1].trim();
    const arrowIndex = timeLine.indexOf('-->');
    if (arrowIndex === -1) {
      throw new Error(`Thai VTT block ${i + 1} is missing timestamp arrow (-->): "${timeLine}"`);
    }
    
    const startTimestamp = timeLine.substring(0, arrowIndex).trim();
    const afterArrow = timeLine.substring(arrowIndex + 3).trim();
    const endTimestampMatch = afterArrow.match(/^(\d{2}:\d{2}:\d{2}\.\d{3})/);
    if (!endTimestampMatch) {
      throw new Error(`Thai VTT block ${i + 1} has invalid end timestamp format: "${afterArrow}"`);
    }
    
    const startSecThai = parseVTTTimestamp(startTimestamp);
    const endSecThai = parseVTTTimestamp(endTimestampMatch[1]);
    if (startSecThai === null) {
      throw new Error(`Thai VTT block ${i + 1} has invalid start timestamp: "${startTimestamp}"`);
    }
    if (endSecThai === null) {
      throw new Error(`Thai VTT block ${i + 1} has invalid end timestamp: "${endTimestampMatch[1]}"`);
    }
    
    const textLines = lines.slice(2);
    const thai = textLines.map(line => stripHTMLTags(line)).filter(line => line.trim()).join('\n').trim();
    if (!thai) {
      throw new Error(`Thai VTT block ${i + 1} has empty text content`);
    }
    
    if (thaiMap.has(index)) {
      throw new Error(`Thai VTT has duplicate index: ${index}`);
    }
    
    thaiMap.set(index, { thai, startSecThai, endSecThai });
  }

  // Create SubtitleTh array from Thai map
  const subtitles: SubtitleTh[] = [];
  const thaiIndices = Array.from(thaiMap.keys()).sort((a, b) => a - b);
  
  for (const index of thaiIndices) {
    const thaiData = thaiMap.get(index);
    if (!thaiData) {
      throw new Error(`Thai subtitle data missing for index ${index}`);
    }
    
    // Create SubtitleTh with Zod schema field names directly - no conversions
    const subtitle: SubtitleTh = {
      id: `${mediaId}_${index}`,
      thai: thaiData.thai,
      start_sec_th: thaiData.startSecThai,
      end_sec_th: thaiData.endSecThai,
    };
    
    // Validate immediately - throws if invalid
    // This validates shape, data quality (empty strings, ranges), and business rules
    const validated = subtitleThSchema.parse(subtitle);
    
    // Additional parsing success validation: ensure Thai text is meaningful
    if (!validated.thai || validated.thai.trim().length === 0) {
      throw new Error(`VTT parsing failed: Subtitle ${index} has empty Thai text. VTT file may be malformed.`);
    }
    
    subtitles.push(validated);
  }
  
  if (subtitles.length === 0) {
    throw new Error('No valid subtitles parsed from VTT file');
  }
  
  return subtitles;
}
