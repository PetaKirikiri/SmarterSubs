# Schema Comparison: Code vs Database

## Status: ⚠️ Database Inspection Incomplete

**Reason**: Missing credentials (`.env` file with `DATABASE_URL` and `VITE_SUPABASE_ANON_KEY`)

## Expected Schema (from `src/supabase/schema.ts`)

### Tables Defined in Code

| Table Name | Status | Notes |
|------------|--------|-------|
| `episode_lookup` | ⚠️ To be removed | Per user feedback - not needed |
| `shows` | ⚠️ To be removed | Per user feedback - `show_name` goes directly in `episodes` |
| `episodes` | ✅ Expected | Needs update: remove `show_id` FK, add `show_name` |
| `subtitles` | ✅ Expected | Needs update: remove `episode_id` FK, rename `word_reference_ids_thai` → `thai_tokens` (junction table) |
| `words` | ✅ Expected | Structure looks correct |
| `failed_words` | ✅ Expected | Structure looks correct |
| `senses` | ⚠️ To be renamed | Per user feedback - rename to `meanings` |
| `failed_word_senses` | ⚠️ To be renamed | Per user feedback - rename to `failed_word_meanings` |
| `thai_tokens` | ⚠️ New table | Junction table to replace JSONB array in `subtitles` |

## Detailed Table Structures

### 1. `episodes` (needs updates)

**Current Code**:
```typescript
episodes: {
  id: text('id').primaryKey(), // mediaId
  showId: text('show_id').notNull().references(() => shows.id), // ❌ Remove FK
  mediaId: text('media_id').notNull(),
  episodeNumber: integer('episode_number'),
  season: integer('season'),
  episodeTitle: text('episode_title'),
}
```

**Expected After Updates**:
```typescript
episodes: {
  id: text('id').primaryKey(), // mediaId
  showName: text('show_name').notNull(), // ✅ Add this
  mediaId: text('media_id').notNull(),
  episodeNumber: integer('episode_number'),
  season: integer('season'),
  episodeTitle: text('episode_title'),
  // Remove: showId FK
}
```

### 2. `subtitles` (needs updates)

**Current Code**:
```typescript
subtitles: {
  id: text('id').primaryKey(),
  episodeId: text('episode_id').notNull().references(() => episodes.id), // ❌ Remove FK
  startSecThai: integer('start_sec_thai').notNull(),
  endSecThai: integer('end_sec_thai').notNull(),
  startSecEng: integer('start_sec_eng'),
  endSecEng: integer('end_sec_eng'),
  originalThai: text('original_thai').notNull(),
  originalEng: text('original_eng'), // ⚠️ Should be NOT NULL
  wordReferenceIdsThai: jsonb('word_reference_ids_thai').$type<string[]>().default([]), // ❌ Replace with junction table
}
```

**Expected After Updates**:
```typescript
subtitles: {
  id: text('id').primaryKey(),
  episodeId: text('episode_id').notNull(), // ✅ Keep but remove FK constraint
  startSecThai: integer('start_sec_thai').notNull(),
  endSecThai: integer('end_sec_thai').notNull(),
  startSecEng: integer('start_sec_eng'),
  endSecEng: integer('end_sec_eng'),
  originalThai: text('original_thai').notNull(),
  originalEng: text('original_eng').notNull(), // ✅ Make NOT NULL
  // Remove: wordReferenceIdsThai JSONB
}
```

### 3. `thai_tokens` (new junction table)

**Expected Structure**:
```typescript
thaiTokens: pgTable('thai_tokens', {
  subtitleId: text('subtitle_id').notNull().references(() => subtitles.id),
  wordId: text('word_id').notNull().references(() => words.id),
}, (table) => ({
  pk: primaryKey({ columns: [table.subtitleId, table.wordId] }),
}));
```

### 4. `senses` → `meanings` (rename)

**Current Name**: `senses`  
**New Name**: `meanings`

**Structure** (no changes needed):
```typescript
meanings: {
  id: text('id').primaryKey(), // Format: {wordId}-{index}
  wordId: text('word_id').notNull().references(() => words.id),
  thaiWord: text('thai_word').notNull(),
  pos: text('pos').notNull(),
  descriptionThai: text('description_thai').notNull(),
  metadata: jsonb('metadata'),
}
```

### 5. `failed_word_senses` → `failed_word_meanings` (rename)

**Current Name**: `failed_word_senses`  
**New Name**: `failed_word_meanings`

**Structure** (no changes needed):
```typescript
failedWordMeanings: {
  id: text('id').primaryKey(), // Format: {wordId}-{index}
  wordId: text('word_id').notNull().references(() => failedWords.id),
  thaiWord: text('thai_word').notNull(),
  pos: text('pos').notNull(),
  descriptionThai: text('description_thai').notNull(),
  metadata: jsonb('metadata'),
}
```

## Action Items

### To Complete Inspection

1. **Set up `.env` file**:
   ```env
   VITE_SUPABASE_URL=https://gbsopnbovsxlstnmaaga.supabase.co
   VITE_SUPABASE_ANON_KEY=your-actual-anon-key
   DATABASE_URL=postgresql://postgres:your-password@db.gbsopnbovsxlstnmaaga.supabase.co:5432/postgres
   ```

2. **Run introspection**:
   ```bash
   npx drizzle-kit introspect --out ./drizzle-introspect
   ```

3. **Compare results**:
   - Check which tables actually exist
   - Verify column names and types
   - Identify missing/extra columns
   - Check nullability constraints

### Schema Updates Needed (based on user feedback)

1. ✅ Remove `episode_lookup` table
2. ✅ Remove `shows` table
3. ✅ Update `episodes`: remove `show_id` FK, add `show_name`
4. ✅ Update `subtitles`: remove `episode_id` FK constraint, make `original_eng` NOT NULL
5. ✅ Create `thai_tokens` junction table
6. ✅ Rename `senses` → `meanings`
7. ✅ Rename `failed_word_senses` → `failed_word_meanings`
8. ✅ Update all relations to reflect new names

## Notes

- The code schema (`src/supabase/schema.ts`) still reflects the old structure
- These changes need to be applied to both:
  - The Drizzle schema definition
  - The actual database (via migrations)
- Once credentials are available, we can verify what actually exists vs what's expected
