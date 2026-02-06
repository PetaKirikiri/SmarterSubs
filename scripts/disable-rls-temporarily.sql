-- Temporarily disable RLS for migration
-- Run this in Supabase Dashboard → SQL Editor before migration
-- Re-enable RLS after migration using scripts/enable-rls.sql

ALTER TABLE episodes DISABLE ROW LEVEL SECURITY;
ALTER TABLE subtitles DISABLE ROW LEVEL SECURITY;
ALTER TABLE words_th DISABLE ROW LEVEL SECURITY;
ALTER TABLE meanings_th DISABLE ROW LEVEL SECURITY;
