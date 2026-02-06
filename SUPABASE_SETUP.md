# Supabase Migration Complete

## What Was Changed

✅ **Created Drizzle Schema** (`src/db/schema.ts`)
- Defined all tables: `episode_lookup`, `shows`, `episodes`, `subtitles`, `words`, `failed_words`, `senses`, `failed_word_senses`
- Includes relations and proper field mappings

✅ **Created Supabase Client Config** (`src/config/supabase.ts`)
- Uses Supabase JavaScript client (works in browser)

✅ **Created Query Service** (`src/services/dbQueries.ts`)
- Replaces Firebase `getDocFromServer` / `getDocsFromServer` calls
- Functions: `fetchEpisodeLookups`, `fetchShow`, `fetchEpisode`, `fetchSubtitles`, `fetchWord`, `fetchSenses`, etc.

✅ **Created Write Service** (`src/services/dbWrites.ts`)
- Replaces Firebase batch writes
- `saveWordData` function handles word and sense saves

✅ **Updated App.tsx**
- Removed all Firebase imports
- Updated all queries to use Supabase
- Field mapping: `thaiScript` → `thai_script`, `senseCount` → `sense_count`, etc.

## Next Steps

### 1. Set Up Environment Variables

Create `.env` file:
```env
VITE_SUPABASE_URL=https://gbsopnbovsxlstnmaaga.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Get these from: Supabase Dashboard → Settings → API

### 2. Create Database Tables

You have two options:

**Option A: Use Drizzle Kit (Recommended)**
```bash
# Generate migration SQL
npx drizzle-kit generate

# Push schema to database
npx drizzle-kit push
```

**Option B: Run SQL Manually**
Copy the SQL from `drizzle/` folder (after running `generate`) and run it in Supabase SQL Editor.

### 3. Update Connection String

In `src/config/db.ts`, replace `[YOUR-PASSWORD]` with your actual Supabase database password:
- Found in: Supabase Dashboard → Settings → Database → Connection string

### 4. Test the Migration

1. Start dev server: `npm run dev`
2. Check browser console for any errors
3. Verify data loads correctly

## Field Name Mappings

| Firebase Field | Supabase Column |
|---------------|----------------|
| `thaiScript` | `thai_script` |
| `senseCount` | `sense_count` |
| `wordId` | `word_id` |
| `descriptionThai` | `description_thai` |
| `thaiWord` | `thai_word` |
| `englishPhonetic` | `english_phonetic` |

## Notes

- All queries now use Supabase client (works client-side)
- Drizzle schema is defined but we're using Supabase client directly for queries
- Metadata fields are stored as JSONB for flexibility
- The code maintains the same structure, just different data source
