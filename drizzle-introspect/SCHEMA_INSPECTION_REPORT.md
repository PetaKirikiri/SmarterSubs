# Supabase Database Schema Inspection Report

**Date**: 2026-01-30  
**Status**: ⚠️ **Incomplete - Credentials Required**

## Summary

Attempted to inspect the Supabase database schema but **could not connect** due to missing credentials.

## Issues Encountered

### 1. Missing Environment Variables

- ❌ **`.env` file does not exist** in project root
- ❌ **`DATABASE_URL`** not set (required for Drizzle Kit introspection)
- ❌ **`VITE_SUPABASE_ANON_KEY`** is placeholder `[YOUR-ANON-KEY]` (required for Supabase client queries)

### 2. Connection Attempts

#### Attempt A: Drizzle Kit Introspection
```bash
npx drizzle-kit introspect
```
**Result**: Failed with `ENOTFOUND` - Cannot resolve database hostname because `DATABASE_URL` contains placeholder password `[YOUR-PASSWORD]`.

#### Attempt B: Supabase Client Query
Created `scripts/inspect-schema.ts` to query tables via Supabase client.
**Result**: Failed with "Invalid API key" - `VITE_SUPABASE_ANON_KEY` is still a placeholder.

## Expected Schema (from Code)

Based on `src/supabase/schema.ts`, the following tables are expected:

### Current Schema Definition

1. **`episode_lookup`** (to be removed per user feedback)
2. **`shows`** (to be removed per user feedback)
3. **`episodes`**
   - `id` (text, PK)
   - `show_id` (text, FK → shows.id) - **to be changed to `show_name`**
   - `media_id` (text)
   - `episode_title` (text)
   - `season` (integer)
   - `episode` (integer)
   - `created_at` (timestamp)
   - `updated_at` (timestamp)

4. **`subtitles`**
   - `id` (text, PK)
   - `episode_id` (text, FK → episodes.id)
   - `start_sec_thai` (integer)
   - `original_thai` (text)
   - `original_eng` (text) - **should be NOT NULL per user feedback**
   - `word_reference_ids_thai` (jsonb) - **to be renamed to `thai_tokens` (junction table)**

5. **`words`**
   - `id` (text, PK)
   - `word_id` (text)
   - `thai_script` (text)
   - `sense_count` (integer)
   - `g2p` (text, optional)
   - `english_phonetic` (text, optional)
   - `metadata` (jsonb, optional)

6. **`failed_words`**
   - Same structure as `words`

7. **`senses`** (to be renamed to `meanings` per user feedback)
   - `id` (text, PK) - format: `{wordId}-{index}`
   - `word_id` (text, FK → words.id)
   - `thai_word` (text)
   - `pos` (text)
   - `description_thai` (text)
   - `metadata` (jsonb, optional)

8. **`failed_word_senses`** (to be renamed to `failed_word_meanings` per user feedback)
   - Same structure as `senses`

9. **`thai_tokens`** (new junction table, replacing `word_reference_ids_thai` JSONB)
   - `subtitle_id` (text, FK → subtitles.id)
   - `word_id` (text, FK → words.id)
   - Composite primary key

## Required Actions

### To Complete Schema Inspection

1. **Set up `.env` file** with:
   ```env
   VITE_SUPABASE_URL=https://gbsopnbovsxlstnmaaga.supabase.co
   VITE_SUPABASE_ANON_KEY=your-actual-anon-key-here
   DATABASE_URL=postgresql://postgres:your-actual-password@db.gbsopnbovsxlstnmaaga.supabase.co:5432/postgres
   ```

2. **Get credentials from Supabase Dashboard**:
   - **Anon Key**: Settings → API → `anon` / `public` key
   - **Database Password**: Settings → Database → Connection string (extract password)

3. **Re-run inspection**:
   ```bash
   # Option A: Drizzle Kit (requires DATABASE_URL)
   npx drizzle-kit introspect --out ./drizzle-introspect
   
   # Option B: Custom script (requires VITE_SUPABASE_ANON_KEY)
   npx tsx scripts/inspect-schema.ts
   ```

## Next Steps

Once credentials are set:

1. ✅ Run introspection to get actual database structure
2. ✅ Compare with `src/supabase/schema.ts`
3. ✅ Document differences:
   - Tables that exist vs expected
   - Column name mismatches
   - Type differences (text vs varchar, integer vs bigint, etc.)
   - Missing columns
   - Extra columns
   - Nullability differences
4. ✅ Update schema code to match reality OR create migration plan

## Notes

- The code expects certain tables that may not exist yet in the database
- Schema changes discussed (renaming `senses` → `meanings`, removing `episode_lookup`/`shows`, etc.) need to be reflected in actual database
- Junction table `thai_tokens` is planned but may not exist yet
