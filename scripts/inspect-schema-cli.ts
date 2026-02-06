/**
 * Inspect Supabase Database Schema using Supabase CLI
 * 
 * This script uses the Supabase CLI with an access token to query the database schema.
 * Access tokens (sbp_*) are different from service_role keys (eyJ*).
 */

import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://gbsopnbovsxlstnmaaga.supabase.co';
const accessToken = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ACCESS_TOKEN;

async function inspectViaCLI() {
  if (!accessToken) {
    console.error('❌ No access token found. Set SUPABASE_ACCESS_TOKEN or SUPABASE_SERVICE_ROLE_KEY in .env');
    return;
  }

  if (!accessToken.startsWith('sbp_')) {
    console.log('⚠️  Token does not start with "sbp_" - this might be a service_role key instead.');
    console.log('   Service role keys (eyJ*) work with the Supabase client, not CLI.');
    return;
  }

  console.log('Attempting to use Supabase CLI with access token...\n');
  console.log(`URL: ${supabaseUrl}`);
  console.log(`Access Token: ${accessToken.substring(0, 20)}...\n`);

  try {
    // Set access token as environment variable for CLI
    process.env.SUPABASE_ACCESS_TOKEN = accessToken;
    
    // Try to list projects (to verify token works)
    console.log('Verifying access token...');
    const projectsOutput = execSync('supabase projects list', { 
      encoding: 'utf-8',
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: accessToken }
    });
    console.log('✓ Access token verified\n');
    
    // Try to introspect database
    console.log('Attempting database introspection...');
    // Note: Supabase CLI might need project linking first
    // This is a placeholder - actual CLI commands may vary
    
  } catch (error: any) {
    console.error('❌ CLI command failed:', error.message);
    console.log('\n💡 Alternative: Use the database password with Drizzle Kit instead.');
    console.log('   Update DATABASE_URL in .env with your actual password.');
  }
}

// For now, suggest using database password
console.log(`
⚠️  Access tokens (sbp_*) are for Supabase CLI/Management API, not database queries.

For schema inspection, you have two options:

Option 1: Use Database Password (Recommended)
  1. Get your database password from: Supabase Dashboard → Settings → Database
  2. Update DATABASE_URL in .env:
     DATABASE_URL=postgresql://postgres:your-password@db.gbsopnbovsxlstnmaaga.supabase.co:5432/postgres
  3. Run: npx drizzle-kit introspect --out ./drizzle-introspect

Option 2: Get Service Role Key (JWT)
  1. Go to: Supabase Dashboard → Settings → API
  2. Copy the "service_role" key (starts with eyJ...)
  3. Update SUPABASE_SERVICE_ROLE_KEY in .env
  4. Run: npx tsx scripts/inspect-schema.ts
`);

inspectViaCLI().catch(console.error);
