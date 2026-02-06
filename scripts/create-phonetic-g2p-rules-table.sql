-- Create phonetic_g2p_rules table
-- Run this in Supabase Dashboard → SQL Editor
-- This table stores discovered vowel patterns from G2P data
-- g2p_code is the primary key (unique vowel pattern)

CREATE TABLE IF NOT EXISTS phonetic_g2p_rules (
  id BIGSERIAL,
  vowel TEXT,
  g2p_code TEXT PRIMARY KEY,
  phonetic_output TEXT,
  evidence TEXT
);

-- Disable RLS to allow unrestricted access
ALTER TABLE phonetic_g2p_rules DISABLE ROW LEVEL SECURITY;

-- Grant permissions to anon role for read/write access
GRANT ALL ON phonetic_g2p_rules TO anon;
GRANT USAGE, SELECT ON SEQUENCE phonetic_g2p_rules_id_seq TO anon;
