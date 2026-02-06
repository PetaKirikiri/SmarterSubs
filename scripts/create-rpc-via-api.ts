/**
 * Create RPC function via Supabase Management API
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const accessToken = process.env.SUPABASE_SERVICE_ROLE_KEY; // This is actually an access token
const projectRef = 'gbsopnbovsxlstnmaaga';
const supabaseUrl = `https://api.supabase.com/v1/projects/${projectRef}`;

async function createRPCFunction() {
  if (!accessToken || !accessToken.startsWith('sbp_')) {
    console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY is not a valid access token (should start with sbp_)');
    console.error('   This script requires a Supabase access token from the Management API');
    return;
  }

  const sql = fs.readFileSync('scripts/create-schema-rpc-function.sql', 'utf-8');

  try {
    // Try to execute SQL via Management API
    const response = await fetch(`${supabaseUrl}/database/query`, {
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
      console.log('2. Copy SQL from: scripts/create-schema-rpc-function.sql');
      console.log('3. Click "Run"\n');
      return;
    }

    const result = await response.json();
    console.log('✓ RPC function created successfully!');
    console.log('Now run: npx tsx scripts/setup-and-inspect-schema.ts\n');
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.log('\n⚠️  Could not create function via API.');
    console.log('Please run the SQL manually in Supabase Dashboard:\n');
    console.log('1. Go to: https://supabase.com/dashboard/project/gbsopnbovsxlstnmaaga/sql/new');
    console.log('2. Copy SQL from: scripts/create-schema-rpc-function.sql');
    console.log('3. Click "Run"\n');
  }
}

createRPCFunction();
