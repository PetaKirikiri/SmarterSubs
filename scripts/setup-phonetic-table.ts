/**
 * Setup phonetic_g2p_rules table via Supabase Management API
 * Creates the RPC function and table automatically
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const accessToken = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = 'gbsopnbovsxlstnmaaga';
const apiUrl = `https://api.supabase.com/v1/projects/${projectRef}`;

async function setupPhoneticTable() {
  if (!accessToken) {
    console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ACCESS_TOKEN not found in environment');
    console.error('   Get it from: Supabase Dashboard → Settings → API → Service Role Key');
    return;
  }

  // Read the SQL file
  const sqlPath = path.join(process.cwd(), 'scripts', 'create-phonetic-table-rpc.sql');
  let sql: string;
  
  try {
    sql = fs.readFileSync(sqlPath, 'utf-8');
  } catch (err: any) {
    console.error(`❌ Error reading SQL file: ${err.message}`);
    return;
  }

  console.log('🚀 Setting up phonetic_g2p_rules table...\n');
  console.log('Creating RPC function and table via Management API...\n');

  try {
    // Try Management API first (requires access token starting with sbp_)
    if (accessToken.startsWith('sbp_')) {
      const response = await fetch(`${apiUrl}/database/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: sql
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ API Error:', response.status, errorText);
        console.log('\n⚠️  Management API approach failed.');
        console.log('Please run the SQL manually in Supabase Dashboard:\n');
        console.log('1. Go to: https://supabase.com/dashboard/project/gbsopnbovsxlstnmaaga/sql/new');
        console.log('2. Copy SQL from: scripts/create-phonetic-table-rpc.sql');
        console.log('3. Click "Run"\n');
        return;
      }

      const result = await response.json();
      console.log('✓ RPC function created successfully!');
      console.log('✓ Table will be created automatically when the component loads.\n');
      console.log('Now refresh the Phonetic Inspector page and it should work!\n');
      return;
    }

    // If not Management API token, try using Supabase client with service role key
    console.log('⚠️  Access token format not recognized (should start with sbp_ for Management API)');
    console.log('Trying alternative approach...\n');
    
    // Alternative: Use Supabase client to call RPC (but RPC doesn't exist yet, so this won't work)
    console.log('❌ Cannot execute DDL (CREATE TABLE) via Supabase client.');
    console.log('Please run the SQL manually:\n');
    console.log('1. Go to: https://supabase.com/dashboard/project/gbsopnbovsxlstnmaaga/sql/new');
    console.log('2. Copy SQL from: scripts/create-phonetic-table-rpc.sql');
    console.log('3. Click "Run"\n');
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.log('\n⚠️  Could not set up table via API.');
    console.log('Please run the SQL manually in Supabase Dashboard:\n');
    console.log('1. Go to: https://supabase.com/dashboard/project/gbsopnbovsxlstnmaaga/sql/new');
    console.log('2. Copy SQL from: scripts/create-phonetic-table-rpc.sql');
    console.log('3. Click "Run"\n');
  }
}

setupPhoneticTable();
