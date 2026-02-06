/**
 * Fix phonetic_g2p_rules table nullable constraint via Supabase Management API
 * Creates the RPC function and executes it to allow NULL values
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const accessToken = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = 'gbsopnbovsxlstnmaaga';
const apiUrl = `https://api.supabase.com/v1/projects/${projectRef}`;

async function fixNullableConstraint() {
  if (!accessToken) {
    console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ACCESS_TOKEN not found in environment');
    console.error('   Get it from: Supabase Dashboard → Settings → API → Access Tokens');
    return;
  }

  if (!accessToken.startsWith('sbp_')) {
    console.error('❌ Error: Access token must start with "sbp_" for Management API');
    console.error(`   Current token starts with: "${accessToken.substring(0, 10)}"`);
    console.error('   Get it from: Supabase Dashboard → Settings → API → Access Tokens');
    return;
  }

  // Read the SQL file
  const sqlPath = path.join(process.cwd(), 'scripts', 'fix-phonetic-g2p-rules-nullable-rpc.sql');
  let sql: string;
  
  try {
    sql = fs.readFileSync(sqlPath, 'utf-8');
  } catch (err: any) {
    console.error(`❌ Error reading SQL file: ${err.message}`);
    return;
  }

  console.log('🚀 Fixing phonetic_g2p_rules nullable constraint...\n');
  console.log('Creating RPC function via Management API...\n');

  try {
    // Step 1: Create the RPC function
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
      console.log('2. Copy SQL from: scripts/fix-phonetic-g2p-rules-nullable-rpc.sql');
      console.log('3. Click "Run"\n');
      return;
    }

    const result = await response.json();
    console.log('✓ RPC function created successfully!');
    console.log('✓ Now calling the RPC function to fix the constraint...\n');

    // Step 2: Call the RPC function to fix the constraint
    // We need to use the Supabase client for this
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://gbsopnbovsxlstnmaaga.supabase.co';
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
    
    if (!anonKey) {
      console.error('❌ Error: VITE_SUPABASE_ANON_KEY not found in environment');
      return;
    }

    const supabase = createClient(supabaseUrl, anonKey);
    const { data: rpcResult, error: rpcError } = await supabase.rpc('fix_phonetic_g2p_rules_nullable');

    if (rpcError) {
      console.error('❌ Error calling RPC function:', rpcError.message);
      console.log('\n⚠️  RPC function was created but failed to execute.');
      console.log('You can try calling it manually from the Supabase Dashboard → SQL Editor:\n');
      console.log('SELECT fix_phonetic_g2p_rules_nullable();\n');
      return;
    }

    console.log('✓ Constraint fixed successfully!');
    console.log('Result:', rpcResult);
    console.log('\n✅ The phonetic_g2p_rules table now allows NULL values.');
    console.log('✅ You can now seed Thai vowels with IDs 1-31.\n');
    console.log('Refresh the Phonetic Inspector page and seeding should work!\n');
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.log('\n⚠️  Could not fix constraint via API.');
    console.log('Please run the SQL manually in Supabase Dashboard:\n');
    console.log('1. Go to: https://supabase.com/dashboard/project/gbsopnbovsxlstnmaaga/sql/new');
    console.log('2. Copy SQL from: scripts/fix-phonetic-g2p-rules-nullable-rpc.sql');
    console.log('3. Click "Run"\n');
  }
}

fixNullableConstraint();
