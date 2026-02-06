-- Migration: Add V2 fields to meanings_th table
-- Adds pos_th, pos_eng, and definition_eng columns for V2 schema support

-- Add V2 fields as nullable columns (backward compatible)
ALTER TABLE meanings_th
ADD COLUMN IF NOT EXISTS pos_th TEXT,
ADD COLUMN IF NOT EXISTS pos_eng TEXT,
ADD COLUMN IF NOT EXISTS definition_eng TEXT;

-- Add comments for documentation
COMMENT ON COLUMN meanings_th.pos_th IS 'Thai part of speech (V2 field)';
COMMENT ON COLUMN meanings_th.pos_eng IS 'English part of speech (V2 field)';
COMMENT ON COLUMN meanings_th.definition_eng IS 'English definition (V2 field)';
