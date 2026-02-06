# Actual Database Schema Findings

**Date**: 2026-01-30  
**Method**: Supabase Client Query (using anon key)

## Summary

Successfully connected to Supabase database and queried tables. Found **2 tables exist**, but they are **empty** (no data), so column structure cannot be inferred from sample data.

## Tables Found

### ✅ Tables That Exist

1. **`episodes`**
   - Status: ✅ Exists
   - Row count: 0 (empty)
   - Columns: Cannot determine (table is empty, no sample data)

2. **`subtitles`**
   - Status: ✅ Exists
   - Row count: 0 (empty)
   - Columns: Cannot determine (table is empty, no sample data)

3. **`words_th`** ⚠️
   - Status: ✅ Exists
   - Row count: 0 (empty)
   - Columns: Cannot determine (table is empty, no sample data)
   - **Note**: Code expects `words`, but database has `words_th`

4. **`meanings_th`** ⚠️
   - Status: ✅ Exists
   - Row count: 0 (empty)
   - Columns: Cannot determine (table is empty, no sample data)
   - **Note**: Code expects `senses`, but database has `meanings_th`

### ❌ Tables That Don't Exist

1. **`episode_lookup`** - Not found (expected - to be removed)
2. **`shows`** - Not found (expected - to be removed)
3. **`words`** - Not found (database has `words_th` instead)
4. **`failed_words`** - Not found
5. **`senses`** - Not found (database has `meanings_th` instead)
6. **`failed_word_senses`** - Not found
7. **`failed_word_meanings`** - Not found
8. **`thai_tokens`** - Not found

## Limitations

- **Empty tables**: `episodes` and `subtitles` exist but have no data, so we cannot infer column structure from sample rows
- **RLS policies**: Using anon key respects Row Level Security - some tables might exist but be inaccessible
- **No direct schema access**: Cannot query `information_schema` via Supabase REST API

## Next Steps

### Option 1: Use Drizzle Kit Introspection (Recommended)

For exact column types and structure, use Drizzle Kit with database password:

1. Get database password from: **Supabase Dashboard → Settings → Database**
2. Update `DATABASE_URL` in `.env`:
   ```env
   DATABASE_URL=postgresql://postgres:your-password@db.gbsopnbovsxlstnmaaga.supabase.co:5432/postgres
   ```
3. Run:
   ```bash
   npx drizzle-kit introspect --out ./drizzle-introspect
   ```

This will:
- ✅ Show exact column types (text, integer, jsonb, etc.)
- ✅ Show nullability constraints
- ✅ Show default values
- ✅ Show foreign keys and indexes
- ✅ Work even with empty tables

### Option 2: Insert Sample Data

Insert a test row into `episodes` and `subtitles` tables, then re-run the inspection script to infer column structure.

### Option 3: Check Supabase Dashboard

Manually check table structure in:
- **Supabase Dashboard → Table Editor**
- Or **Supabase Dashboard → SQL Editor** → Run: `SELECT * FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position;`

## Comparison with Code Schema

Based on `src/supabase/schema.ts`, we expect:

| Table | Expected in Code | Actual in Database | Status |
|-------|------------------|-------------------|--------|
| `episode_lookup` | ✅ Defined | ❌ Not found | ⚠️ To be removed per user |
| `shows` | ✅ Defined | ❌ Not found | ⚠️ To be removed per user |
| `episodes` | ✅ Defined | ✅ Exists (empty) | ✅ Matches |
| `subtitles` | ✅ Defined | ✅ Exists (empty) | ✅ Matches |
| `words` | ✅ Defined | ❌ Not found | ⚠️ **Name mismatch** |
| `words_th` | ❌ Not in code | ✅ Exists (empty) | ⚠️ **Actual table name** |
| `failed_words` | ✅ Defined | ❌ Not found | ⚠️ Not created yet |
| `senses` | ✅ Defined | ❌ Not found | ⚠️ **Name mismatch** |
| `meanings_th` | ❌ Not in code | ✅ Exists (empty) | ⚠️ **Actual table name** |
| `failed_word_senses` | ✅ Defined | ❌ Not found | ⚠️ Not created yet |
| `thai_tokens` | ⚠️ Planned | ❌ Not found | ⚠️ Not created yet |

### ⚠️ Critical Finding: Table Name Mismatches

The database uses different table names than what's defined in code:

- **Code expects**: `words` → **Database has**: `words_th`
- **Code expects**: `senses` → **Database has**: `meanings_th`

**Action Required**: Update `src/supabase/schema.ts` to match actual table names, OR update database table names to match code.

## Recommendations

1. **Run Drizzle Kit introspection** to get exact schema for `episodes` and `subtitles`
2. **Create missing tables** (`words`, `failed_words`, `senses`, `failed_word_senses`, `thai_tokens`) using migrations
3. **Remove deprecated tables** (`episode_lookup`, `shows`) if they exist elsewhere
