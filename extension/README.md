# SmarterSubs Chrome Extension

Chrome extension for extracting VTT files and metadata from Netflix pages.

## Setup

1. Build the extension:
```bash
npm run build:extension
```

2. Load the extension in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `extension/dist/` folder

3. Configure Supabase credentials:
   - Open the extension popup
   - The extension will use environment variables if available
   - Or configure via `chrome.storage.local`:
     - `supabaseUrl`: Your Supabase project URL
     - `supabaseKey`: Your Supabase anon key

## Usage

1. Navigate to a Netflix watch page (e.g., `https://www.netflix.com/watch/12345678`)
2. The extension will automatically detect the page and extract:
   - VTT files (Thai and English subtitles)
   - Episode metadata (show name, episode number, etc.)
3. Data is saved directly to Supabase:
   - `episodes` table
   - `subtitles` table

## Development

Watch mode for development:
```bash
npm run dev:extension
```

This will rebuild the extension automatically when files change.

## Files

- `manifest.json` - Chrome extension manifest
- `content.ts` - Content script injected into Netflix pages
- `background.ts` - Background service worker
- `popup.html` / `popup.ts` - Extension popup UI
- `services/netflixVTTExtractor.ts` - VTT extraction logic
- `services/netflixMetadataExtractor.ts` - Metadata extraction logic
- `services/supabaseClient.ts` - Supabase client for extension
