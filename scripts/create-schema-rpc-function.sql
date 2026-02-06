-- Create a SQL function in Supabase to query information_schema
-- Run this in Supabase Dashboard → SQL Editor

CREATE OR REPLACE FUNCTION get_schema_info()
RETURNS TABLE (
  table_name text,
  column_name text,
  data_type text,
  is_nullable text,
  column_default text
) 
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    c.table_name::text,
    c.column_name::text,
    c.data_type::text,
    c.is_nullable::text,
    COALESCE(c.column_default::text, NULL) as column_default
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
  ORDER BY c.table_name, c.ordinal_position;
$$;

-- Grant execute permission to anon role
GRANT EXECUTE ON FUNCTION get_schema_info() TO anon;
