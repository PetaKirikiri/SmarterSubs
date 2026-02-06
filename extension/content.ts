/**
 * Content Script for Netflix Pages
 * Extracts VTT files and metadata, saves to Supabase
 * Uses Zod schema field names directly throughout
 */

import { fetchThaiVTTContent, injectNetflixSubtitleScript } from './services/netflixVTTExtractor';
import { extractEpisodeFromNetflixPage } from './services/netflixMetadataExtractor';
import { saveEpisode, saveSubtitlesBatch } from './services/supabaseClient';
import { parseVTTFile } from '@/services/vtt/vttParser';

let isExtracting = false;

/**
 * Initialize extension - inject subtitle script early so JSON.parse interception is active
 * before Netflix makes API calls. This matches SmartSubs approach.
 */
async function initialize() {
  if (window.location.hostname.includes('netflix.com')) {
    try {
      await injectNetflixSubtitleScript();
      console.log('[SmarterSubs] Subtitle script injected early');
    } catch (error) {
      console.warn('[SmarterSubs] Failed to inject subtitle script early:', error);
    }
  }
}

/**
 * Wait for video to be ready before extraction
 * Ensures video element exists, has loaded metadata, and Netflix API is available
 * @returns {Promise<void>} Resolves when video is ready, rejects on timeout
 */
async function waitForVideoReady(): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:waitForVideoReady',message:'Function entry',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
  // #endregion
  
  const maxWaitTime = 30000; // 30 seconds max wait
  const startTime = Date.now();
  
  // Wait for video element to exist
  while (!document.querySelector('video')) {
    if (Date.now() - startTime > maxWaitTime) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:waitForVideoReady',message:'Video element timeout',data:{elapsed:Date.now()-startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
      // #endregion
      throw new Error('Video element not found after 30 seconds');
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  const video = document.querySelector('video') as HTMLVideoElement;
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:waitForVideoReady',message:'Video element found',data:{readyState:video.readyState,paused:video.paused},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
  // #endregion
  
  // Wait for video readyState >= 2 (loadedmetadata)
  if (video.readyState < 2) {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        video.removeEventListener('loadedmetadata', checkReady);
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:waitForVideoReady',message:'Metadata load timeout',data:{readyState:video.readyState},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
        // #endregion
        if (video.readyState < 2) {
          reject(new Error('Video metadata not loaded after 10 seconds'));
        } else {
          resolve();
        }
      }, 10000);
      
      const checkReady = () => {
        if (video.readyState >= 2) {
          clearTimeout(timeout);
          video.removeEventListener('loadedmetadata', checkReady);
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:waitForVideoReady',message:'Metadata loaded',data:{readyState:video.readyState},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
          // #endregion
          resolve();
        }
      };
      
      video.addEventListener('loadedmetadata', checkReady);
    });
  }
  
  // Wait for Netflix API to be available (check in page context via injection)
  // We'll check this when we inject the script, but also wait a bit for Netflix to initialize
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log('[SmarterSubs] Video ready - readyState:', video.readyState);
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:waitForVideoReady',message:'Function exit - video ready',data:{readyState:video.readyState},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H6'})}).catch(()=>{});
  // #endregion
}

async function extractAndSave() {
  if (isExtracting) {
    console.log('[SmarterSubs] Extraction already in progress');
    return;
  }

  isExtracting = true;
  console.log('[SmarterSubs] Starting extraction...');

  try {
    // Extract episode metadata (returns Episode with Zod field names directly)
    const episode = extractEpisodeFromNetflixPage();
    if (!episode) {
      console.error('[SmarterSubs] Could not extract episode metadata');
      isExtracting = false;
      return;
    }

    console.log('[SmarterSubs] Extracted episode:', episode);
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:extractAndSave',message:'Episode extracted, about to wait for video',data:{mediaId:episode.media_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3,H6'})}).catch(()=>{});
    // #endregion

    // Wait for video to be ready before attempting VTT extraction
    await waitForVideoReady();
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:extractAndSave',message:'Video ready, about to fetch VTT',data:{mediaId:episode.media_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion

    // Extract Thai VTT file
    const thaiVTT = await fetchThaiVTTContent(episode.media_id);
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:extractAndSave',message:'VTT fetch completed',data:{hasThai:!!thaiVTT,thaiLength:thaiVTT?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1,H2,H3,H4,H5'})}).catch(()=>{});
    // #endregion
    
    if (!thaiVTT) {
      throw new Error('Could not extract Thai VTT files - extraction failed');
    }

    console.log('[SmarterSubs] Extracted Thai VTT file');

    // Parse Thai VTT file (returns SubtitleTh[] with Zod field names directly)
    const subtitles = await parseVTTFile(
      thaiVTT,
      episode.media_id
    );

    console.log('[SmarterSubs] Parsed subtitles:', subtitles.length);

    // Save episode (already validated with episodeSchema)
    await saveEpisode(episode);
    console.log('[SmarterSubs] Saved episode');

    // Save subtitles in batch (preserve existing tokens)
    await saveSubtitlesBatch(subtitles, true);
    console.log('[SmarterSubs] Saved subtitles:', subtitles.length);

    // Notify background script
    chrome.runtime.sendMessage({
      type: 'EXTRACT_COMPLETE',
      data: {
        mediaId: episode.media_id,
        episodeCount: 1,
        subtitleCount: subtitles.length,
      },
    }).catch(() => {});

    console.log('[SmarterSubs] Extraction complete!');
  } catch (error) {
    console.error('[SmarterSubs] Extraction error:', error);
  } finally {
    isExtracting = false;
  }
}

// Wait for page to be ready
function waitForPageReady() {
  if (document.readyState === 'complete') {
    // Check if we're on a watch page
    if (window.location.href.includes('/watch/')) {
      // Start extraction (will wait for video readiness inside)
      extractAndSave().catch(error => {
        console.error('[SmarterSubs] Extraction failed:', error);
      });
    }
  } else {
    window.addEventListener('load', () => {
      if (window.location.href.includes('/watch/')) {
        // Start extraction (will wait for video readiness inside)
        extractAndSave().catch(error => {
          console.error('[SmarterSubs] Extraction failed:', error);
        });
      }
    });
  }
}

// Listen for navigation changes (Netflix is a SPA)
let lastUrl = window.location.href;
const observer = new MutationObserver(() => {
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl && currentUrl.includes('/watch/')) {
    lastUrl = currentUrl;
    // Start extraction (will wait for video readiness inside)
    extractAndSave().catch(error => {
      console.error('[SmarterSubs] Extraction failed:', error);
    });
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// Initialize early (inject script before Netflix API calls)
initialize();

// Initial extraction
waitForPageReady();

// Listen for manual trigger from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT_NOW') {
    extractAndSave().then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
});
