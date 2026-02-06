-- Create phonetic_g2p_evidence table
-- Run this in Supabase Dashboard → SQL Editor
-- This table stores GPT analysis per evidence word with unique constraint on (g2p_code, word_id)

CREATE TABLE IF NOT EXISTS phonetic_g2p_evidence (
  id BIGSERIAL PRIMARY KEY,
  g2p_code TEXT NOT NULL,
  word_id TEXT NOT NULL REFERENCES words_th(text_th) ON DELETE CASCADE,
  text_th TEXT NOT NULL,
  g2p TEXT,
  parser_phonetic TEXT,
  thai_vowel_label TEXT,
  gpt_phonetic TEXT,
  UNIQUE(g2p_code, word_id)
);

-- Create index on g2p_code for fast lookups by pattern
CREATE INDEX IF NOT EXISTS idx_phonetic_g2p_evidence_g2p_code ON phonetic_g2p_evidence(g2p_code);

-- Create index on word_id for fast lookups by word
CREATE INDEX IF NOT EXISTS idx_phonetic_g2p_evidence_word_id ON phonetic_g2p_evidence(word_id);

-- Disable RLS to allow unrestricted access
ALTER TABLE phonetic_g2p_evidence DISABLE ROW LEVEL SECURITY;

-- Grant permissions to anon role for read/write access
GRANT ALL ON phonetic_g2p_evidence TO anon;
GRANT USAGE, SELECT ON SEQUENCE phonetic_g2p_evidence_id_seq TO anon;
