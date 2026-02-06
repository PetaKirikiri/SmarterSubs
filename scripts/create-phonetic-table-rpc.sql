-- Create RPC function to set up phonetic_g2p_rules table
-- This function creates the table and disables RLS automatically
-- Run this once in Supabase Dashboard → SQL Editor

CREATE OR REPLACE FUNCTION setup_phonetic_g2p_rules_table()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Create table if it doesn't exist
  CREATE TABLE IF NOT EXISTS phonetic_g2p_rules (
    id BIGSERIAL,
    vowel TEXT,
    g2p_code TEXT PRIMARY KEY,
    phonetic_output TEXT,
    evidence TEXT
  );

  -- Disable RLS
  ALTER TABLE phonetic_g2p_rules DISABLE ROW LEVEL SECURITY;

  -- Grant permissions
  GRANT ALL ON phonetic_g2p_rules TO anon;
  GRANT USAGE, SELECT ON SEQUENCE phonetic_g2p_rules_id_seq TO anon;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Table created and RLS disabled successfully'
  );
EXCEPTION
  WHEN others THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- Grant execute permission to anon role
GRANT EXECUTE ON FUNCTION setup_phonetic_g2p_rules_table() TO anon;
