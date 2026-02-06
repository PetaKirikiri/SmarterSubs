-- Disable RLS for phonetic_g2p_rules table
-- Run this in Supabase Dashboard → SQL Editor
-- This allows the table to be accessed without RLS restrictions

ALTER TABLE phonetic_g2p_rules DISABLE ROW LEVEL SECURITY;
