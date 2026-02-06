/**
 * Extension Popup UI
 */

const statusEl = document.getElementById('status');

if (statusEl) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs[0];
    if (currentTab?.url?.includes('netflix.com/watch')) {
      statusEl.textContent = 'On Netflix watch page';
      statusEl.className = 'status success';
    } else {
      statusEl.textContent = 'Navigate to a Netflix watch page';
      statusEl.className = 'status info';
    }
  });
}
