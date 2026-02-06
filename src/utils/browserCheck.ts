/**
 * Browser check utility - logs current state to console for verification
 */

export function checkBrowserState() {
  // Log current DOM state
  if (typeof window !== 'undefined') {
    const root = document.getElementById('root');
    if (root) {
      const episodeCards = root.querySelectorAll('[class*="bg-white"]');
      const subtitleCards = root.querySelectorAll('[class*="border rounded-lg"]');
      const wordTabs = root.querySelectorAll('button[class*="border-b-2"]');
      
      console.log('[BROWSER CHECK] DOM State:', {
        episodeCards: episodeCards.length,
        subtitleCards: subtitleCards.length,
        wordTabs: wordTabs.length,
        rootChildren: root.children.length
      });
      
      // Check for table info display
      const tableInfo = root.querySelector('[class*="Supabase Tables"]');
      console.log('[BROWSER CHECK] Table info display:', !!tableInfo);
      
      // Check for word tabs
      if (wordTabs.length > 0) {
        console.log('[BROWSER CHECK] Word tabs found:', wordTabs.length);
        wordTabs.forEach((tab, idx) => {
          console.log(`  Tab ${idx}:`, tab.textContent?.trim());
        });
      }
    }
  }
}
