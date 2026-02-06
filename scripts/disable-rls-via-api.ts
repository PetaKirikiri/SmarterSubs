/**
 * Disable RLS via Management API for migration
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const accessToken = process.env.SUPABASE_SERVICE_ROLE_KEY;
const projectRef = 'gbsopnbovsxlstnmaaga';
const apiUrl = `https://api.supabase.com/v1/projects/${projectRef}`;

async function disableRLS() {
  if (!accessToken || !accessToken.startsWith('sbp_')) {
    console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY is not a valid access token (should start with sbp_)');
    return;
  }

  const sql = fs.readFileSync('scripts/disable-rls-temporarily.sql', 'utf-8');

  try {
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
      console.log('\n⚠️  Could not disable RLS via API.');
      console.log('Please run the SQL manually in Supabase Dashboard:\n');
      console.log('1. Go to: https://supabase.com/dashboard/project/gbsopnbovsxlstnmaaga/sql/new');
      console.log('2. Copy SQL from: scripts/disable-rls-temporarily.sql');
      console.log('3. Click "Run"\n');
      return;
    }

    console.log('✓ RLS disabled successfully!');
    console.log('You can now run the migration. Remember to re-enable RLS after migration.\n');
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.log('\n⚠️  Could not disable RLS via API.');
    console.log('Please run the SQL manually in Supabase Dashboard:\n');
    console.log('1. Go to: https://supabase.com/dashboard/project/gbsopnbovsxlstnmaaga/sql/new');
    console.log('2. Copy SQL from: scripts/disable-rls-temporarily.sql');
    console.log('3. Click "Run"\n');
  }
}

disableRLS();
