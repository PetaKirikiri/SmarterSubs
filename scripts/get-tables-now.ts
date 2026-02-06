/**
 * Script to get all Supabase tables RIGHT NOW
 * Run: npx tsx scripts/get-tables-now.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://gbsopnbovsxlstnmaaga.supabase.co';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '[YOUR-ANON-KEY]';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const knownTables = [
  'episodes',
  'subtitles',
  'words_th',
  'meanings_th',
  'episode_lookup',
  'shows',
  'failed_words',
  'failed_word_senses',
  'thai_tokens'
];

async function getAllTables() {
  console.log('\n🔍 Checking Supabase tables...\n');
  
  const results: Record<string, { exists: boolean; rowCount?: number; columns?: string[]; sample?: any }> = {};
  
  for (const tableName of knownTables) {
    try {
      const { data, error, count } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        if (error.code === 'PGRST204' || error.message.includes('does not exist')) {
          results[tableName] = { exists: false };
        } else {
          console.error(`[ERROR] Error checking table ${tableName}:`, error.message);
          results[tableName] = { exists: false };
        }
      } else {
        // Table exists, get actual data to see columns
        const { data: sampleData, error: sampleError } = await supabase
          .from(tableName)
          .select('*')
          .limit(1);
        
        const columns = sampleData && sampleData.length > 0 ? Object.keys(sampleData[0]) : [];
        
        results[tableName] = {
          exists: true,
          rowCount: count || 0,
          columns,
          sample: sampleData?.[0]
        };
      }
    } catch (err: any) {
      console.error(`[ERROR] Exception checking table ${tableName}:`, err.message);
      results[tableName] = { exists: false };
    }
  }
  
  console.log('\n=== SUPABASE TABLES SUMMARY ===\n');
  const existingTables = Object.entries(results).filter(([_, info]) => info.exists);
  const missingTables = Object.entries(results).filter(([_, info]) => !info.exists);
  
  console.log(`✅ EXISTING TABLES (${existingTables.length}):\n`);
  existingTables.forEach(([name, info]) => {
    console.log(`  ${name}:`);
    console.log(`    Rows: ${info.rowCount || 0}`);
    if (info.columns && info.columns.length > 0) {
      console.log(`    Columns: ${info.columns.join(', ')}`);
    }
    if (info.sample) {
      console.log(`    Sample:`, JSON.stringify(info.sample, null, 2).substring(0, 300));
    }
    console.log('');
  });
  
  if (missingTables.length > 0) {
    console.log(`\n❌ MISSING TABLES (${missingTables.length}):\n`);
    missingTables.forEach(([name]) => {
      console.log(`  - ${name}`);
    });
  }
  
  console.log('\n================================\n');
  
  return results;
}

getAllTables().catch(console.error);
