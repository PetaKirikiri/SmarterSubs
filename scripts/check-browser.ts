/**
 * Browser check script - actually opens browser and verifies UI state
 */
import puppeteer from 'puppeteer';

async function checkBrowser() {
  console.log('[BROWSER CHECK] Starting browser check...');
  
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  
  // Navigate to app
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
  
  // Wait for React to render
  await page.waitForTimeout(2000);
  
  // Get console logs
  const logs: string[] = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);
    if (text.includes('[BROWSER CHECK]') || text.includes('[DEBUG]')) {
      console.log('[PAGE LOG]', text);
    }
  });
  
  // Check DOM state
  const domState = await page.evaluate(() => {
    const root = document.getElementById('root');
    if (!root) return { error: 'No root element' };
    
    const episodeCards = root.querySelectorAll('[class*="bg-white rounded-lg"]');
    const subtitleSections = root.querySelectorAll('[class*="border rounded-lg"]');
    const wordTabs = root.querySelectorAll('button');
    const tableInfo = root.querySelector('[class*="Supabase Tables"]');
    
    // Get text content samples
    const episodeTexts = Array.from(episodeCards).slice(0, 2).map(el => el.textContent?.substring(0, 100));
    const subtitleTexts = Array.from(subtitleSections).slice(0, 2).map(el => el.textContent?.substring(0, 100));
    
    return {
      episodeCards: episodeCards.length,
      subtitleSections: subtitleSections.length,
      wordTabs: wordTabs.length,
      hasTableInfo: !!tableInfo,
      episodeTexts,
      subtitleTexts,
      rootHTML: root.innerHTML.substring(0, 500)
    };
  });
  
  console.log('[BROWSER CHECK] DOM State:', JSON.stringify(domState, null, 2));
  
  // Check for errors
  const errors = logs.filter(log => log.includes('ERROR') || log.includes('error'));
  if (errors.length > 0) {
    console.log('[BROWSER CHECK] Errors found:', errors);
  }
  
  // Check data loading
  const dataLogs = logs.filter(log => 
    log.includes('episodeLookups') || 
    log.includes('fullEpisodeData') || 
    log.includes('subtitles')
  );
  console.log('[BROWSER CHECK] Data loading logs:', dataLogs.slice(0, 10));
  
  await browser.close();
  
  return {
    domState,
    errors: errors.length,
    dataLogs: dataLogs.length
  };
}

checkBrowser().then(result => {
  console.log('[BROWSER CHECK] Complete:', result);
  process.exit(0);
}).catch(err => {
  console.error('[BROWSER CHECK] Failed:', err);
  process.exit(1);
});
