-- Re-enable RLS after migration
-- Run this in Supabase Dashboard → SQL Editor after migration

ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE subtitles ENABLE ROW LEVEL SECURITY;
ALTER TABLE words_th ENABLE ROW LEVEL SECURITY;
ALTER TABLE meanings_th ENABLE ROW LEVEL SECURITY;
