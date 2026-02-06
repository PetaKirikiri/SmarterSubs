/**
 * Background Service Worker
 * Handles extension lifecycle and coordination
 * Handles script injection for VTT extraction (has access to chrome.tabs)
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[SmarterSubs Extension] Installed');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT_COMPLETE') {
    console.log('[SmarterSubs Extension] Extraction complete:', message.data);
    return true;
  }
  
  if (message.type === 'INJECT_NETFLIX_SUBTITLE_SCRIPT') {
    // Background script has access to chrome.tabs API
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0 || !tabs[0].id) {
        sendResponse({ success: false, error: 'Could not get current tab ID' });
        return;
      }
      
      const tabId = tabs[0].id;
      
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: 'MAIN',
        func: (codeString) => {
          // Use Function constructor instead of eval to avoid bundler warnings
          const func = new Function(codeString);
          func();
        },
        args: [message.code]
      })
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    });
    
    return true; // Indicates we will send a response asynchronously
  }
  
  return false;
});
