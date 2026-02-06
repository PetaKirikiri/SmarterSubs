-- Create RPC function for automatic phonetic_g2p_evidence table setup
-- Run this in Supabase Dashboard → SQL Editor
-- This allows the PhoneticInspector component to automatically create the table if it doesn't exist

CREATE OR REPLACE FUNCTION setup_phonetic_g2p_evidence_table()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
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
  CREATE INDEX IF NOT EXISTS idx_phonetic_g2p_evidence_g2p_code ON phonetic_g2p_evidence(g2p_code);
  CREATE INDEX IF NOT EXISTS idx_phonetic_g2p_evidence_word_id ON phonetic_g2p_evidence(word_id);
  ALTER TABLE phonetic_g2p_evidence DISABLE ROW LEVEL SECURITY;
  GRANT ALL ON phonetic_g2p_evidence TO anon;
  GRANT USAGE, SELECT ON SEQUENCE phonetic_g2p_evidence_id_seq TO anon;
  RETURN jsonb_build_object('success', true, 'message', 'Table created successfully');
EXCEPTION
  WHEN others THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION setup_phonetic_g2p_evidence_table() TO anon;
