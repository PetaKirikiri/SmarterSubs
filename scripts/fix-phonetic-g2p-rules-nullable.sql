-- Fix phonetic_g2p_rules table to allow NULL values for english_vowel and thai_vowel
-- This allows seeding with null values before GPT analysis populates them
-- Run this in Supabase Dashboard → SQL Editor

-- Make english_vowel nullable (remove NOT NULL constraint if it exists)
ALTER TABLE phonetic_g2p_rules 
  ALTER COLUMN english_vowel DROP NOT NULL;

-- Make thai_vowel nullable (remove NOT NULL constraint if it exists)
ALTER TABLE phonetic_g2p_rules 
  ALTER COLUMN thai_vowel DROP NOT NULL;

-- Make phonetic_output nullable (remove NOT NULL constraint if it exists)
ALTER TABLE phonetic_g2p_rules 
  ALTER COLUMN phonetic_output DROP NOT NULL;

-- Make evidence nullable (remove NOT NULL constraint if it exists)
ALTER TABLE phonetic_g2p_rules 
  ALTER COLUMN evidence DROP NOT NULL;

-- Verify the changes
SELECT 
  column_name, 
  is_nullable, 
  data_type 
FROM information_schema.columns 
WHERE table_name = 'phonetic_g2p_rules' 
ORDER BY ordinal_position;
