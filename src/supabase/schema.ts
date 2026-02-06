import { pgTable, text, integer, jsonb, timestamp, primaryKey, numeric, bigint, unique } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * Episode Lookup Table
 * Maps mediaId to show/episode information
 */
export const episodeLookup = pgTable('episode_lookup', {
  id: text('id').primaryKey(), // mediaId
  mediaId: text('media_id').notNull(),
  showName: text('show_name').notNull(),
  season: integer('season'),
  episode: integer('episode'),
  episodeTitle: text('episode_title'),
});

/**
 * Shows Table
 * Main show information
 */
export const shows = pgTable('shows', {
  id: text('id').primaryKey(), // showName
  name: text('name').notNull(),
  updatedAt: timestamp('updated_at'),
});

/**
 * Episodes Table
 * 
 * 📋 SOURCE OF TRUTH: src/schemas/episodeSchema.ts
 * 
 * Maps to Zod schema (episodeSchema.ts) - column names match exactly:
 * - id → episodeSchema.id (string, required)
 * - media_id → episodeSchema.media_id (string, required)
 * - show_name → episodeSchema.show_name (string, required)
 * - season → episodeSchema.season (number, optional)
 * - episode → episodeSchema.episode (number, optional)
 * - episode_title → episodeSchema.episode_title (string, optional)
 */
export const episodes = pgTable('episodes', {
  id: text('id').primaryKey(), // Maps to episodeSchema.id (required)
  show_name: text('show_name').notNull(), // Maps to episodeSchema.show_name (required)
  media_id: text('media_id').notNull(), // Maps to episodeSchema.media_id (required)
  season: integer('season'), // Maps to episodeSchema.season (optional)
  episode: integer('episode'), // Maps to episodeSchema.episode (optional)
  episode_title: text('episode_title'), // Maps to episodeSchema.episode_title (optional)
});

/**
 * Subtitle Thai Table
 * 
 * 📋 SOURCE OF TRUTH: src/schemas/subtitleThSchema.ts
 * 
 * Maps to Zod schema (subtitleThSchema.ts) - column names match exactly:
 * - id → subtitleThSchema.id (string, required)
 * - thai → subtitleThSchema.thai (string, required)
 * - start_sec_th → subtitleThSchema.start_sec_th (number, required)
 * - end_sec_th → subtitleThSchema.end_sec_th (number, required, must be > start_sec_th)
 * - tokens_th → subtitleThSchema.tokens_th (jsonb, optional)
 */
export const subtitleTh = pgTable('subtitles_th', {
  id: text('id').primaryKey(), // Maps to subtitleThSchema.id (required)
  thai: text('thai').notNull(), // Maps to subtitleThSchema.thai (required)
  start_sec_th: numeric('start_sec_th').notNull(), // Maps to subtitleThSchema.start_sec_th (required)
  end_sec_th: numeric('end_sec_th').notNull(), // Maps to subtitleThSchema.end_sec_th (required, validated > start_sec_th)
  tokens_th: jsonb('tokens_th'), // Maps to subtitleThSchema.tokens_th (optional)
});

/**
 * Words Table
 * 
 * 📋 SOURCE OF TRUTH: src/schemas/wordSchema.ts
 * 
 * Maps to Zod schema (wordSchema.ts) - column names match exactly:
 * - id → wordSchema.id (string, required, primary key)
 * - word_id → wordSchema.word_id (string, optional)
 * - thai_script → wordSchema.thai_script (string, required)
 * - sense_count → wordSchema.sense_count (number, int, min 1, required)
 * - g2p → wordSchema.g2p (string, optional)
 * - english_phonetic → wordSchema.english_phonetic (string, optional)
 * - metadata → wordSchema.metadata (record, optional)
 * - senses → wordSchema.senses (array of senseSchema, min 1, required) - stored in meanings_th table
 * 
 * Note: senses array is stored in separate meanings_th table (see senses relation)
 * The sense_count must match the number of valid senses (enforced by Zod transform)
 */
export const words = pgTable('words_th', {
  word_th: text('word_th').primaryKey(), // Primary key - Thai word string
  g2p: text('g2p'), // Maps to wordSchema.g2p (optional)
  phonetic_en: text('phonetic_en'), // Maps to wordSchema.phonetic_en (optional)
});

/**
 * Failed Words Table
 * 
 * 📋 SOURCE OF TRUTH: src/schemas/wordSchema.ts (same structure as words_th)
 * 
 * Same structure as words_th but for words that failed ORST lookup.
 * Maps to wordSchema with additional orstFailed flag.
 */
export const failedWords = pgTable('failed_words', {
  id: text('id').primaryKey(), // Maps to wordSchema.thaiScript
  wordId: text('word_id'), // Maps to wordSchema.wordId (optional)
  thaiScript: text('thai_script').notNull(), // Maps to wordSchema.thaiScript (required)
  senseCount: integer('sense_count').notNull().default(0), // Maps to wordSchema.senseCount (required, min 1)
  g2p: text('g2p'), // Maps to wordSchema.g2p (optional)
  englishPhonetic: text('english_phonetic'), // Maps to wordSchema.englishPhonetic (optional)
  orstFailed: integer('orst_failed').default(1), // Boolean as integer (not in Zod schema, database flag)
  metadata: jsonb('metadata').$type<Record<string, any>>(), // Additional fields (passthrough)
});

/**
 * Meanings Table
 * 
 * 📋 SOURCE OF TRUTH: src/schemas/meaningThSchema.ts
 * 
 * Maps to Zod schema (meaningThSchema.ts) - column names match exactly:
 * - id → meaningThSchema.id (bigint, required, primary key)
 * - definition_th → meaningThSchema.definition_th (text, required)
 * - word_th_id → meaningThSchema.word_th_id (text, optional, FK to words_th.word_th)
 * - source → meaningThSchema.source (text, optional)
 * - created_at → meaningThSchema.created_at (timestamp, optional)
 * 
 * Note: word_th_id references words_th.word_th (Thai word string)
 */
export const senses = pgTable('meanings_th', {
  id: bigint('id', { mode: 'number' }).primaryKey(), // Maps to meaningThSchema.id (bigint)
  definition_th: text('definition_th').notNull(), // Maps to meaningThSchema.definition_th (required)
  word_th_id: text('word_th_id').references(() => words.word_th, { onDelete: 'cascade' }), // Maps to meaningThSchema.word_th_id (text, FK to words_th.word_th)
  source: text('source'), // Maps to meaningThSchema.source (optional)
  created_at: timestamp('created_at'), // Maps to meaningThSchema.created_at (optional)
});

/**
 * Failed Word Meanings Table (formerly Failed Word Senses)
 * 
 * 📋 SOURCE OF TRUTH: src/schemas/senseSchema.ts (same structure as meanings_th)
 * 
 * Same structure as meanings_th but for failed words.
 * Maps to senseSchema with same field mappings.
 */
export const failedWordSenses = pgTable('failed_word_senses', {
  id: text('id').primaryKey(), // Maps to senseSchema.senseId (required, format: {thaiScript}-{index})
  wordId: text('word_id').notNull().references(() => failedWords.id, { onDelete: 'cascade' }), // FK to failed_words.id
  thaiWord: text('thai_word').notNull(), // Maps to senseSchema.thaiWord (required)
  pos: text('pos').notNull(), // Maps to senseSchema.pos (required)
  descriptionThai: text('description_thai').notNull(), // Maps to senseSchema.descriptionThai (required)
  metadata: jsonb('metadata').$type<Record<string, any>>(), // Additional fields (passthrough)
});

// Relations
// Note: Relations are database-level, not defined in Zod schemas
// Subtitles are linked to episodes via subtitle ID format (includes mediaId), not via foreign key
// No explicit episodeId field exists in subtitles table per Zod schema

export const wordsRelations = relations(words, ({ many }) => ({
  senses: many(senses),
}));

export const sensesRelations = relations(senses, ({ one }) => ({
  word: one(words, {
    fields: [senses.word_th_id],
    references: [words.word_th],
  }),
}));

export const failedWordsRelations = relations(failedWords, ({ many }) => ({
  senses: many(failedWordSenses),
}));

export const failedWordSensesRelations = relations(failedWordSenses, ({ one }) => ({
  word: one(failedWords, {
    fields: [failedWordSenses.wordId],
    references: [failedWords.id],
  }),
}));

/**
 * Phonetic G2P Rules Table
 * 
 * Stores discovered vowel patterns from G2P data with their parser outputs and evidence
 * - g2p_code is the primary key (unique vowel pattern)
 * - vowel is the vowel category/name
 * - phonetic_output is what the parser converts the pattern to
 * - evidence is example words showing the pattern in use
 */
export const phoneticG2PRules = pgTable('phonetic_g2p_rules', {
  id: bigint('id', { mode: 'number' }), // int8 - auto-incrementing ID
  english_vowel: text('english_vowel'), // English vowel category/name (e.g., "long a", "diphthong")
  thai_vowel: text('thai_vowel'), // Thai vowel in script notation (e.g., "ไ– (mai malai)", "เ–า", "–า")
  g2p_code: text('g2p_code').primaryKey(), // Primary key - unique vowel pattern (e.g., "aa", "@@", "vva")
  phonetic_output: text('phonetic_output'), // What the parser converts the pattern to (e.g., "ah", "oe", "uea")
  evidence: text('evidence'), // Example words as evidence (JSON string or comma-separated)
});

/**
 * Phonetic G2P Evidence Table
 * 
 * Stores GPT analysis per evidence word with unique constraint on (g2p_code, word_id)
 * Minimal structure - only essential fields
 * - g2p_code: The normalized vowel-bearing pattern being investigated
 * - word_id: References words_th.word_th (primary key)
 * - text_th, g2p, parser_phonetic: Denormalized snapshots for UI access
 * - thai_vowel_label, gpt_phonetic: GPT outputs (nullable until processed)
 */
export const phoneticG2PEvidence = pgTable('phonetic_g2p_evidence', {
  id: bigint('id', { mode: 'number' }).primaryKey(), // int8 - auto-incrementing ID
  g2p_code: text('g2p_code').notNull(), // The normalized vowel-bearing pattern being investigated
  word_id: text('word_id').notNull().references(() => words.word_th, { onDelete: 'cascade' }), // References words_th.word_th (primary key)
  text_th: text('text_th').notNull(), // Denormalized for UI access
  g2p: text('g2p'), // Denormalized snapshot from words_th
  parser_phonetic: text('parser_phonetic'), // Denormalized phonetic_en from words_th (your parser output)
  thai_vowel_label: text('thai_vowel_label'), // GPT output: Thai vowel identity (e.g., "ไ– (mai malai)", "เ–า", "–า")
  gpt_phonetic: text('gpt_phonetic'), // GPT output: Human-readable phonetic spelling
}, (table) => ({
  uniqueG2pCodeWordId: unique().on(table.g2p_code, table.word_id),
}));
