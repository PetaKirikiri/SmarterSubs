-- Create RPC function to fix phonetic_g2p_rules table to allow NULL values
-- This allows seeding with null values before GPT analysis populates them
-- Run this once in Supabase Dashboard → SQL Editor

CREATE OR REPLACE FUNCTION fix_phonetic_g2p_rules_nullable()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Make english_vowel nullable (remove NOT NULL constraint if it exists)
  BEGIN
    ALTER TABLE phonetic_g2p_rules 
      ALTER COLUMN english_vowel DROP NOT NULL;
  EXCEPTION
    WHEN OTHERS THEN
      -- Column might already be nullable, ignore error
      NULL;
  END;

  -- Make thai_vowel nullable (remove NOT NULL constraint if it exists)
  BEGIN
    ALTER TABLE phonetic_g2p_rules 
      ALTER COLUMN thai_vowel DROP NOT NULL;
  EXCEPTION
    WHEN OTHERS THEN
      -- Column might already be nullable, ignore error
      NULL;
  END;

  -- Make phonetic_output nullable (remove NOT NULL constraint if it exists)
  BEGIN
    ALTER TABLE phonetic_g2p_rules 
      ALTER COLUMN phonetic_output DROP NOT NULL;
  EXCEPTION
    WHEN OTHERS THEN
      -- Column might already be nullable, ignore error
      NULL;
  END;

  -- Make evidence nullable (remove NOT NULL constraint if it exists)
  BEGIN
    ALTER TABLE phonetic_g2p_rules 
      ALTER COLUMN evidence DROP NOT NULL;
  EXCEPTION
    WHEN OTHERS THEN
      -- Column might already be nullable, ignore error
      NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Columns updated to allow NULL values'
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
GRANT EXECUTE ON FUNCTION fix_phonetic_g2p_rules_nullable() TO anon;
