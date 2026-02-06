/**
 * Test Supabase Connection
 * 
 * Tests if the service role key can connect and what tables are accessible
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://gbsopnbovsxlstnmaaga.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '[YOUR-KEY]';

console.log('Testing Supabase connection...\n');
console.log(`URL: ${supabaseUrl}`);
console.log(`Key (first 30 chars): ${supabaseServiceKey.substring(0, 30)}...`);
console.log(`Key length: ${supabaseServiceKey.length} characters\n`);

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function testConnection() {
  // Test 1: Try to get project info
  console.log('Test 1: Checking connection...');
  try {
    // Try a simple query to see if we can connect
    const { data, error } = await supabase.from('_realtime').select('*').limit(1);
    if (error) {
      console.log(`  Error: ${error.message}`);
      console.log(`  Code: ${error.code}`);
      console.log(`  Details: ${error.details}`);
      console.log(`  Hint: ${error.hint}\n`);
    } else {
      console.log('  ✓ Connection successful!\n');
    }
  } catch (err: any) {
    console.log(`  ✗ Connection failed: ${err.message}\n`);
  }

  // Test 2: Try to list all tables by querying information_schema via RPC
  console.log('Test 2: Attempting to list tables...');
  try {
    // Try using a PostgreSQL function if available
    const { data: tables, error } = await supabase.rpc('get_schema_tables');
    if (!error && tables) {
      console.log(`  ✓ Found tables: ${tables.length}`);
      tables.forEach((t: any) => console.log(`    - ${t.table_name}`));
    } else {
      console.log(`  ✗ RPC not available: ${error?.message || 'Function does not exist'}`);
    }
  } catch (err: any) {
    console.log(`  ✗ RPC failed: ${err.message}`);
  }
  console.log('');

  // Test 3: Try querying each expected table
  const expectedTables = [
    'episodes',
    'subtitles', 
    'words',
    'failed_words',
    'senses',
    'failed_word_senses',
    'episode_lookup',
    'shows',
    'thai_tokens'
  ];

  console.log('Test 3: Testing table access...');
  for (const tableName of expectedTables) {
    try {
      const { data, error, count } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        if (error.code === 'PGRST116') {
          console.log(`  ✗ ${tableName}: Table does not exist`);
        } else if (error.message.includes('permission denied') || error.message.includes('Invalid API key')) {
          console.log(`  ✗ ${tableName}: Access denied - ${error.message}`);
        } else {
          console.log(`  ✗ ${tableName}: ${error.message} (code: ${error.code})`);
        }
      } else {
        console.log(`  ✓ ${tableName}: Accessible (${count || 0} rows)`);
      }
    } catch (err: any) {
      console.log(`  ✗ ${tableName}: ${err.message}`);
    }
  }
}

testConnection().catch(console.error);
