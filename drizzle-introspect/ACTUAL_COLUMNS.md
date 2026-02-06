# Actual Database Schema Columns
**Generated**: 2026-01-31T03:32:18.985Z
**Method**: Supabase RPC Function (get_schema_info)

Found 4 tables:

## episodes

| Column Name | Type | Nullable | Default |
|-------------|------|----------|---------|
| `id` | bigint | NO | - |
| `media_id` | text | NO | - |
| `show_title` | text | YES | - |
| `season_number` | numeric | YES | - |
| `episode_number` | numeric | YES | - |
| `episode_title` | text | YES | - |

## meanings_th

| Column Name | Type | Nullable | Default |
|-------------|------|----------|---------|
| `id` | bigint | NO | - |
| `definition_th` | text | NO | - |
| `word_id_th` | uuid | YES | gen_random_uuid() |
| `source` | text | YES | - |
| `created_at` | timestamp without time zone | YES | - |

## subtitles

| Column Name | Type | Nullable | Default |
|-------------|------|----------|---------|
| `id` | text | NO | - |
| `thai` | text | NO | - |
| `english` | text | YES | - |
| `startSecThai` | numeric | YES | - |
| `endSecThai` | numeric | YES | - |
| `thaiTokens` | jsonb | YES | - |

## words_th

| Column Name | Type | Nullable | Default |
|-------------|------|----------|---------|
| `id` | bigint | NO | - |
| `text_th` | text | NO | - |
| `g2p` | text | YES | - |
| `phonetic_en` | text | YES | - |

