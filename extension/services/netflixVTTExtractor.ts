/**
 * Netflix VTT Extractor
 * Simplified approach based on SmartSubs - intercepts JSON.parse to capture subtitle URLs
 */


/**
 * Netflix API access code - embedded as string to inject into page context
 * 
 * Netflix API Usage: This code runs in the page's main world where window.netflix is available
 * Content scripts cannot access Netflix API directly (isolated world)
 * Background script injects this code via chrome.scripting.executeScript
 * 
 * Subtitle Flow: Intercepts JSON.parse to capture Netflix API responses containing subtitle URLs
 * Listens for SMARTSUBS_GET_SUBTITLES_PAGE messages → accesses window.netflix player API
 * Gets subtitle tracks and returns them via postMessage
 */
const NETFLIX_SUBTITLE_INJECT_CODE = `
(function() {
  'use strict';

  // Intercept JSON.parse to capture Netflix API responses containing subtitle URLs
  // This is the key mechanism: Netflix sends subtitle URLs in API responses, not in track objects
  // CRITICAL: This must be set up EARLY (on script injection) to catch API responses when video loads
  if (!window.__SMARTSUBS_JSON_PARSE_INTERCEPTED) {
    window.__SMARTSUBS_JSON_PARSE_INTERCEPTED = true;
    window.__SMARTSUBS_CAPTURED_URLS = window.__SMARTSUBS_CAPTURED_URLS || {};
    
    const originalJSONParse = JSON.parse;
    JSON.parse = function(...args) {
      const value = originalJSONParse.apply(this, args);
      
      // Check if this is a Netflix API response with timedtexttracks
      if (value && value.result && value.result.timedtexttracks && Array.isArray(value.result.timedtexttracks)) {
        console.log('[INJECTED] JSON.parse intercepted timedtexttracks:', value.result.timedtexttracks.length);
        
        // Extract VTT URLs from each track
        for (const track of value.result.timedtexttracks) {
          // Skip forced narrative and none tracks
          if (track.isForcedNarrative || track.isNoneTrack) {
            continue;
          }
          
          // Check for webvtt downloadables
          if (track.ttDownloadables && track.ttDownloadables['webvtt-lssdh-ios8']) {
            const webvttDL = track.ttDownloadables['webvtt-lssdh-ios8'];
            if (webvttDL && webvttDL.urls) {
              const allUrls = Object.values(webvttDL.urls);
              const urlObj = allUrls[0];
              
              if (urlObj && urlObj.url) {
                const url = urlObj.url;
                const langCode = track.language || track.bcp47 || null;
                
                console.log('[INJECTED] Found VTT URL:', { langCode, url: url.substring(0, 100) });
                
                // Store URL by language code
                if (langCode) {
                  const langCodeLower = langCode.toLowerCase();
                  let targetLang = null;
                  if (langCodeLower.includes('th') || langCodeLower.includes('thai')) {
                    targetLang = 'th';
                  } else if (langCodeLower.includes('en') || langCodeLower.includes('english')) {
                    targetLang = 'en';
                  }
                  
                  if (targetLang) {
                    if (!window.__SMARTSUBS_CAPTURED_URLS[targetLang]) {
                      window.__SMARTSUBS_CAPTURED_URLS[targetLang] = [];
                    }
                    // Avoid duplicates
                    if (!window.__SMARTSUBS_CAPTURED_URLS[targetLang].includes(url)) {
                      window.__SMARTSUBS_CAPTURED_URLS[targetLang].push(url);
                      console.log('[INJECTED] Stored URL for', targetLang + ':', window.__SMARTSUBS_CAPTURED_URLS[targetLang].length);
                    }
                  }
                }
              }
            }
          }
        }
      }
      
      return value;
    };
    
    // Optional: Modify JSON.stringify to request webvtt-lssdh-ios8 profile
    // This ensures Netflix includes VTT URLs in API responses
    const originalJSONStringify = JSON.stringify;
    JSON.stringify = function(value) {
      const orig = originalJSONStringify.apply(this, arguments);
      if (value === undefined) return orig;
      
      try {
        const data = originalJSONParse(orig);
        if (data && data.params && data.params.profiles && Array.isArray(data.params.profiles)) {
          // Add webvtt-lssdh-ios8 to profiles if not already present
          if (!data.params.profiles.includes('webvtt-lssdh-ios8')) {
            data.params.profiles.unshift('webvtt-lssdh-ios8');
            return originalJSONStringify(data);
          }
        }
      } catch (e) {
        // If parsing fails, return original
      }
      
      return orig;
    };
  }

  // Listen for subtitle requests from content script
  window.addEventListener('message', async function(event) {
    console.log('[INJECTED] Message received:', event.data?.type, event.data?.langCode);
    
    // Only process messages from our extension
    if (!event.data || event.data.type !== 'SMARTSUBS_GET_SUBTITLES_PAGE' || !event.data.langCode) {
      return;
    }

    const langCode = event.data.langCode;
    const excludeCC = event.data.excludeCC !== false;
    const requestId = event.data.requestId;
    console.log('[INJECTED] Processing subtitle request:', { langCode, excludeCC, requestId });
    
    // Ensure video is loaded
    const videoElement = document.querySelector('video');
    if (!videoElement) {
      console.error('[INJECTED] Video element not found');
      window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: 'Video element not found - ensure video is loaded', requestId }, '*');
      return;
    }
    console.log('[INJECTED] Video element found, readyState:', videoElement.readyState);
    
    // Check if video has loaded metadata (readyState >= 2)
    if (videoElement.readyState < 2) {
      console.log('[INJECTED] Waiting for video metadata...');
      await new Promise((resolve) => {
        const checkReady = () => {
          if (videoElement.readyState >= 2) {
            console.log('[INJECTED] Video metadata loaded, readyState:', videoElement.readyState);
            videoElement.removeEventListener('loadedmetadata', checkReady);
            resolve();
          }
        };
        videoElement.addEventListener('loadedmetadata', checkReady);
        setTimeout(() => {
          videoElement.removeEventListener('loadedmetadata', checkReady);
          resolve();
        }, 5000);
      });
      
      if (videoElement.readyState < 2) {
        console.error('[INJECTED] Video metadata not loaded after wait');
        window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: 'Video not loaded - please ensure video is playing', requestId }, '*');
        return;
      }
    }
    
    // Wait briefly for JSON.parse interception to capture URLs
    console.log('[INJECTED] Waiting 1s for JSON.parse interception...');
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      console.log('[INJECTED] Checking Netflix API...');
      // Check window.netflix
      if (!window.netflix || !window.netflix.appContext || !window.netflix.appContext.state) {
        console.error('[INJECTED] Netflix API not available');
        window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: 'Netflix API not available', requestId }, '*');
        return;
      }
      console.log('[INJECTED] Netflix API found');

      const appContext = window.netflix.appContext;
      const state = appContext.state;
      const playerApp = state.playerApp;
      
      if (!playerApp) {
        console.error('[INJECTED] playerApp not available');
        window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: 'Netflix playerApp not available', requestId }, '*');
        return;
      }
      console.log('[INJECTED] playerApp found');

      // Get videoPlayerAPI
      const getAPI = playerApp.getAPI;
      if (!getAPI || typeof getAPI !== 'function') {
        console.error('[INJECTED] getAPI not available');
        window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: 'Netflix getAPI not available', requestId }, '*');
        return;
      }

      const api = getAPI();
      const videoPlayerAPI = api.videoPlayer;
      if (!videoPlayerAPI) {
        console.error('[INJECTED] videoPlayerAPI not available');
        window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: 'Netflix videoPlayerAPI not available', requestId }, '*');
        return;
      }
      console.log('[INJECTED] videoPlayerAPI found');

      // Get session IDs
      const getAllPlayerSessionIds = videoPlayerAPI.getAllPlayerSessionIds;
      if (!getAllPlayerSessionIds || typeof getAllPlayerSessionIds !== 'function') {
        console.error('[INJECTED] getAllPlayerSessionIds not available');
        window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: 'Netflix getAllPlayerSessionIds not available', requestId }, '*');
        return;
      }

      const sessionIds = getAllPlayerSessionIds();
      if (!sessionIds || !Array.isArray(sessionIds) || sessionIds.length === 0) {
        console.error('[INJECTED] No session IDs');
        window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: 'No player session IDs', requestId }, '*');
        return;
      }
      console.log('[INJECTED] Session IDs:', sessionIds.length);

      // Get player
      const player = videoPlayerAPI.getVideoPlayerBySessionId(sessionIds[0]);
      if (!player) {
        console.error('[INJECTED] Player not available');
        window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: 'Netflix player not available', requestId }, '*');
        return;
      }
      console.log('[INJECTED] Player found');

      // Get subtitle tracks
      let tracks = null;
      if (typeof player.getTimedTextTrackList === 'function' && typeof player.getTimedTextTrack === 'function') {
        const trackList = player.getTimedTextTrackList();
        console.log('[INJECTED] Track list retrieved:', trackList?.length || 0);
        
        if (Array.isArray(trackList) && trackList.length > 0) {
          // Check if first item is an object (already track objects) or a primitive (indices)
          if (typeof trackList[0] === 'object' && trackList[0] !== null && trackList[0].bcp47) {
            // Already track objects - use directly
            tracks = trackList;
            console.log('[INJECTED] Tracks are objects, using directly');
          } else {
            // These are indices - call getTimedTextTrack for each
            tracks = trackList.map(index => {
              try {
                return player.getTimedTextTrack(index);
              } catch (e) {
                return null;
              }
            }).filter(t => t !== null);
            console.log('[INJECTED] Tracks are indices, converted to objects:', tracks.length);
          }
        }
      }

      if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
        console.error('[INJECTED] No tracks found');
        window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: 'Could not get subtitle tracks from player', requestId }, '*');
        return;
      }
      console.log('[INJECTED] Total tracks found:', tracks.length, tracks.map(t => ({ bcp47: t.bcp47, language: t.language, isCC: t.isCC })));

      // Filter tracks by language and CC status
      const filteredTracks = tracks.filter(track => {
        const trackLang = (track.bcp47 || track.language || track.langCode || track.lang || '').toLowerCase();
        const langCodeLower = langCode.toLowerCase();
        
        const isMatchingLang = trackLang === langCodeLower || 
                               trackLang.startsWith(langCodeLower) ||
                               trackLang.includes(langCodeLower);
        
        if (!isMatchingLang) {
          return false;
        }

        // Exclude closed captions if requested
        if (excludeCC) {
          const isCC = (track.isCC === true) ||
                       (track.closedCaptions === true) ||
                       (track.displayName && track.displayName.toLowerCase().includes('closed caption')) ||
                       (track.displayName && track.displayName.toLowerCase().includes('cc')) ||
                       (track.rawTrackType && track.rawTrackType.toUpperCase() === 'CLOSED_CAPTIONS');
          return !isCC;
        }

        return true;
      });

      // Initialize URL storage if needed
      if (!window.__SMARTSUBS_CAPTURED_URLS) {
        window.__SMARTSUBS_CAPTURED_URLS = {};
      }
      if (!window.__SMARTSUBS_CAPTURED_URLS[langCode]) {
        window.__SMARTSUBS_CAPTURED_URLS[langCode] = [];
      }
      
      // Activate tracks to trigger Netflix to fetch VTT files
      const activationPromises = filteredTracks.map(async (track) => {
        try {
          const trackIndex = tracks.findIndex(t => 
            t.trackId === track.trackId || 
            (t.bcp47 === track.bcp47 && t.displayName === track.displayName)
          );
          
          if (trackIndex >= 0 && typeof player.setTimedTextTrack === 'function') {
            let trackToActivate = track;
            
            if (typeof player.getTimedTextTrack === 'function') {
              try {
                const fullTrack = player.getTimedTextTrack(trackIndex);
                if (fullTrack) {
                  trackToActivate = fullTrack;
                }
              } catch (e) {
                // Use original track
              }
            }
            
            try {
              // Activate the track
              player.setTimedTextTrack(trackToActivate);
              
              // Make subtitles visible
              if (typeof player.setTimedTextVisibility === 'function') {
                try {
                  player.setTimedTextVisibility(true);
                } catch (e) {
                  // Ignore visibility errors
                }
              }
              
              // Wait for JSON.parse interception to capture URLs
              await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (e) {
              // Ignore activation errors
            }
          }
        } catch (e) {
          // Ignore errors
        }
      });
      
      // Wait for all track activations to complete
      await Promise.all(activationPromises);
      
      // Retrieve captured URLs
      const capturedUrls = window.__SMARTSUBS_CAPTURED_URLS[langCode] || [];
      console.log('[INJECTED] Captured URLs for', langCode + ':', capturedUrls.length, capturedUrls);
      console.log('[INJECTED] All captured URLs:', Object.keys(window.__SMARTSUBS_CAPTURED_URLS || {}));
      
      // Format tracks - Use captured URLs from JSON.parse interception
      const formattedTracks = filteredTracks.map((track) => {
        const url = capturedUrls.length > 0 ? capturedUrls[0] : null;
        
        return {
          langCode: track.bcp47 || track.language || track.langCode || track.lang || '',
          lang: track.displayName || track.languageName || track.langName || track.language || '',
          url: url,
          isCC: track.isCC || track.closedCaptions || false,
          track: track
        };
      });

      console.log('[INJECTED] Formatted tracks:', formattedTracks.length, formattedTracks.map(t => ({ langCode: t.langCode, hasUrl: !!t.url, isCC: t.isCC })));
      window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: formattedTracks, requestId }, '*');
      console.log('[INJECTED] Response sent');
      
    } catch (error) {
      console.error('[INJECTED] Error:', error);
      window.postMessage({ type: 'SMARTSUBS_SUBTITLES_RESPONSE', tracks: [], error: error.message, requestId }, '*');
    }
  });
})();
`;

/**
 * Inject Netflix subtitle script into page context
 * 
 * Injection Mechanism: Content script requests injection via chrome.runtime.sendMessage
 * Background script handles injection via chrome.scripting.executeScript (has tabs API access)
 * This ensures the script runs in the page's main world where window.netflix is available
 * 
 * Note: This function manages its own state (scriptInjected, scriptInjectionPromise) via closure
 * @returns {Promise<void>}
 */
let subtitleScriptInjected = false;
let subtitleScriptInjectionPromise: Promise<void> | null = null;

export async function injectNetflixSubtitleScript(): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:injectNetflixSubtitleScript',message:'Function entry',data:{alreadyInjected:subtitleScriptInjected},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
  // #endregion
  
  if (subtitleScriptInjected) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:injectNetflixSubtitleScript',message:'Already injected, returning',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    return;
  }

  // If injection is already in progress, wait for it
  if (subtitleScriptInjectionPromise) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:injectNetflixSubtitleScript',message:'Injection in progress, waiting',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    return subtitleScriptInjectionPromise;
  }

  subtitleScriptInjectionPromise = (async () => {
    try {
      // Check if Chrome extension APIs are available
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:injectNetflixSubtitleScript',message:'Chrome runtime not available',data:{hasChrome:typeof chrome!=='undefined'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
        // #endregion
        throw new Error('Chrome extension runtime is not available. Make sure the extension is loaded and background script is running.');
      }
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:injectNetflixSubtitleScript',message:'Sending injection message to background',data:{codeLength:NETFLIX_SUBTITLE_INJECT_CODE.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
      
      // Content scripts can't access chrome.tabs directly
      // Ask background script to handle injection (it has chrome.tabs access)
      const response = await chrome.runtime.sendMessage({
        type: 'INJECT_NETFLIX_SUBTITLE_SCRIPT',
        code: NETFLIX_SUBTITLE_INJECT_CODE
      });
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:injectNetflixSubtitleScript',message:'Received response from background',data:{success:response?.success,error:response?.error},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion

      if (response && response.success) {
        subtitleScriptInjected = true;
        subtitleScriptInjectionPromise = null;
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:injectNetflixSubtitleScript',message:'Injection successful',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
        // #endregion
      } else {
        const errorMsg = response?.error || 'Unknown error';
        subtitleScriptInjected = false;
        subtitleScriptInjectionPromise = null;
        console.error('[injectNetflixSubtitleScript] Script injection failed:', errorMsg);
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:injectNetflixSubtitleScript',message:'Injection failed',data:{error:errorMsg},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
        // #endregion
        throw new Error(`Failed to inject Netflix subtitle script: ${errorMsg}`);
      }
    } catch (error) {
      subtitleScriptInjected = false;
      subtitleScriptInjectionPromise = null;
      console.error('[injectNetflixSubtitleScript] Script injection error:', error);
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:injectNetflixSubtitleScript',message:'Injection error caught',data:{error:error instanceof Error?error.message:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
      throw error;
    }
  })();

  return subtitleScriptInjectionPromise;
}

/**
 * THAI: Fetch Thai VTT from Netflix
 * Only fetches Thai subtitles (no fallback)
 * @param {string} mediaId - Media ID
 * @returns {Promise<string|null>} VTT content string or null if Thai not available
 */
export async function fetchThaiVTTContent(mediaId: string): Promise<string | null> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:fetchThaiVTTContent',message:'Function entry',data:{mediaId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2,H3,H4,H5'})}).catch(()=>{});
  // #endregion
  
  if (!mediaId) {
    throw new Error('Could not identify video - mediaId required');
  }
  
  // Ensure subtitle script is injected
  await injectNetflixSubtitleScript();
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:fetchThaiVTTContent',message:'Script injected, setting up message handler',data:{mediaId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
  // #endregion
  
  // Set up promise to receive subtitle tracks
  return new Promise((resolve) => {
    const requestId = `thai-${Date.now()}-${Math.random()}`;
    const timeout = setTimeout(() => {
      console.warn('[fetchThaiVTTContent] Timeout waiting for subtitle tracks response (10s)');
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:fetchThaiVTTContent',message:'Timeout waiting for response',data:{mediaId,requestId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2,H3'})}).catch(()=>{});
      // #endregion
      window.removeEventListener('message', messageHandler);
      resolve(null);
    }, 10000);
    
    const messageHandler = (event: MessageEvent) => {
      if (!event.data || event.data.type !== 'SMARTSUBS_SUBTITLES_RESPONSE' || event.data.requestId !== requestId) {
        return;
      }
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:fetchThaiVTTContent',message:'Received SMARTSUBS_SUBTITLES_RESPONSE',data:{hasError:!!event.data.error,tracksLength:event.data.tracks?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2,H3,H4,H5'})}).catch(()=>{});
      // #endregion
      
      clearTimeout(timeout);
      window.removeEventListener('message', messageHandler);
      
      const tracks = event.data.tracks || [];
      
      if (event.data.error) {
        console.error('[fetchThaiVTTContent] Error from injected script:', event.data.error);
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:fetchThaiVTTContent',message:'Error from injected script',data:{error:event.data.error},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
        // #endregion
      }
      
      // Log all tracks for debugging
      if (tracks.length > 0) {
        console.log('[fetchThaiVTTContent] All tracks returned:', tracks.map((t: any) => ({
          langCode: t.langCode,
          lang: t.lang,
          isCC: t.isCC,
          hasUrl: !!t.url
        })));
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:fetchThaiVTTContent',message:'All tracks returned',data:{tracks:tracks.map((t:any)=>({langCode:t.langCode,lang:t.lang,isCC:t.isCC,hasUrl:!!t.url}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4,H5'})}).catch(()=>{});
        // #endregion
      } else {
        console.warn('[fetchThaiVTTContent] No tracks returned from injected script');
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:fetchThaiVTTContent',message:'No tracks returned',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3,H4'})}).catch(()=>{});
        // #endregion
      }
      
      // Filter for Thai ('th') language, exclude CC
      const thaiTrack = tracks.find((track: any) => {
        const langLower = (track.langCode || '').toLowerCase();
        return langLower.includes('th') && !track.isCC;
      });
      
      if (!thaiTrack) {
        const thaiTracksWithCC = tracks.filter((t: any) => {
          const langLower = (t.langCode || '').toLowerCase();
          return langLower.includes('th');
        });
        console.warn('[fetchThaiVTTContent] No Thai track found (excluding CC). Found Thai tracks with CC:', thaiTracksWithCC.length);
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:fetchThaiVTTContent',message:'No Thai track found (excluding CC)',data:{totalTracks:tracks.length,thaiTracksWithCC:thaiTracksWithCC.length,allTracks:tracks.map((t:any)=>({langCode:t.langCode,isCC:t.isCC}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H5'})}).catch(()=>{});
        // #endregion
        resolve(null);
        return;
      }
      
      if (!thaiTrack.url) {
        console.warn('[fetchThaiVTTContent] Thai track found but has no URL. Track details:', {
          langCode: thaiTrack.langCode,
          lang: thaiTrack.lang,
          isCC: thaiTrack.isCC
        });
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:fetchThaiVTTContent',message:'Thai track found but no URL',data:{langCode:thaiTrack.langCode,lang:thaiTrack.lang,isCC:thaiTrack.isCC},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
        // #endregion
        resolve(null);
        return;
      }
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:fetchThaiVTTContent',message:'Thai track found with URL, fetching',data:{url:thaiTrack.url.substring(0,100)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
      // #endregion
      
      // Fetch VTT content from URL
      fetch(thaiTrack.url)
        .then(response => {
          if (!response.ok) {
            console.warn('[fetchThaiVTTContent] VTT fetch failed:', response.status, response.statusText);
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:fetchThaiVTTContent',message:'VTT fetch failed',data:{status:response.status,statusText:response.statusText},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
            // #endregion
            resolve(null);
            return;
          }
          return response.text();
        })
        .then(content => {
          if (content) {
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:fetchThaiVTTContent',message:'VTT content fetched successfully',data:{contentLength:content.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
            // #endregion
            resolve(content);
          } else {
            console.warn('[fetchThaiVTTContent] VTT fetch returned empty content');
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:fetchThaiVTTContent',message:'VTT fetch returned empty',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
            // #endregion
            resolve(null);
          }
        })
        .catch((error) => {
          console.error('[fetchThaiVTTContent] VTT fetch error:', error);
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:fetchThaiVTTContent',message:'VTT fetch error',data:{error:error instanceof Error?error.message:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
          // #endregion
          resolve(null);
        });
    };
    
    window.addEventListener('message', messageHandler);
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:fetchThaiVTTContent',message:'Message handler added, sending postMessage',data:{mediaId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
    // #endregion
    
    // Request subtitle tracks from injected script
    window.postMessage({
      type: 'SMARTSUBS_GET_SUBTITLES_PAGE',
      langCode: 'th',
      excludeCC: true,
      requestId: requestId
    }, '*');
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ff5c1228-ebe7-472a-94e0-c5e01b8b7ee3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'netflixVTTExtractor.ts:fetchThaiVTTContent',message:'postMessage sent',data:{langCode:'th',excludeCC:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
    // #endregion
  });
}

