# Chrome Extension + Local App Setup Guide

## Overview

The app now works in two modes:
1. **Chrome Extension**: Extracts VTT files and metadata from Netflix pages → saves to Supabase
2. **Local App**: Processes data (tokenization, G2P, phonetic parsing, ORST) → saves to Supabase

## Chrome Extension Setup

### 1. Build the Extension

```bash
npm run build:extension
```

This creates the extension in `extension/dist/` folder.

### 2. Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension/dist/` folder

### 3. Configure Supabase (Optional)

The extension uses environment variables from `.env`:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Or configure via Chrome storage (extension popup will handle this).

### 4. Use the Extension

1. Navigate to a Netflix watch page (e.g., `https://www.netflix.com/watch/12345678`)
2. The extension automatically detects the page and extracts:
   - VTT files (Thai and English subtitles)
   - Episode metadata (show name, episode number, etc.)
3. Data is saved directly to Supabase:
   - `episodes` table
   - `subtitles` table

## Local App Setup

### 1. Start the Local App

```bash
npm run dev
```

### 2. Process Episodes

1. Open the app in your browser (usually `http://localhost:3000`)
2. Click "Process Episode" button
3. The app will:
   - Tokenize subtitles → update `thaiTokens` field
   - Extract unique tokens
   - Process each token: G2P → phonetic → ORST → save to `words_th` and `meanings_th`

## Development

### Extension Development (Watch Mode)

```bash
npm run dev:extension
```

This rebuilds the extension automatically when files change.

### Local App Development

```bash
npm run dev
```

## Architecture

```
Netflix Page (Chrome Extension)
  ↓
Extract VTT + Metadata
  ↓
Save to Supabase (episodes, subtitles)
  ↓
Local App reads from Supabase
  ↓
Process: Tokenization → G2P → Phonetic → ORST
  ↓
Save to Supabase (words_th, meanings_th)
```

## Files Created

### Extension Files
- `extension/manifest.json` - Chrome extension manifest
- `extension/content.ts` - Content script for Netflix pages
- `extension/background.ts` - Background service worker
- `extension/popup.html` / `popup.ts` - Extension popup UI
- `extension/services/netflixVTTExtractor.ts` - VTT extraction
- `extension/services/netflixMetadataExtractor.ts` - Metadata extraction
- `extension/services/supabaseClient.ts` - Supabase client
- `extension/vite.config.ts` - Extension build config
- `extension/README.md` - Extension documentation

### Local App Updates
- `src/services/processingPipeline.ts` - Processing pipeline
- `src/supabase/index.ts` - Added `saveSubtitlesBatch()` function
- `src/components/SupabaseInspector.tsx` - Added "Process Episode" button

## Troubleshooting

### Extension Not Extracting Data

- Check browser console for errors
- Verify you're on a Netflix watch page (`/watch/` URL)
- Check Supabase credentials are configured
- Verify extension has necessary permissions

### Processing Pipeline Errors

- Check browser console for detailed error messages
- Verify AI4Thai API key is configured (for tokenization/G2P)
- Check network connectivity for ORST fetching
- Verify Supabase connection is working
