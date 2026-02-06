/**
 * Inspect Supabase Database Schema via Supabase Client
 * 
 * This script uses the Supabase client with anon key to discover tables
 * and attempts to query column structure via SQL function or by inserting
 * a test row to infer structure.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://gbsopnbovsxlstnmaaga.supabase.co';
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!anonKey) {
  console.error('❌ Error: VITE_SUPABASE_ANON_KEY not set in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, anonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

interface ColumnInfo {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

async function querySchemaViaRPC(): Promise<ColumnInfo[]> {
  // Try to call a SQL function that queries information_schema
  // This requires the function to exist in Supabase
  try {
    const { data, error } = await supabase.rpc('get_schema_info');
    if (!error && data) {
      return data;
    }
  } catch (err) {
    // Function doesn't exist
  }
  return [];
}

async function discoverTables(): Promise<string[]> {
  // Try to discover tables by querying pg_catalog via RPC
  // Or we can try common table names and see which exist
  const commonTables = [
    'episodes', 'subtitles', 'words_th', 'meanings_th',
    'words', 'senses', 'failed_words', 'failed_word_senses',
    'thai_tokens', 'episode_lookup', 'shows'
  ];
  
  const existingTables: string[] = [];
  
  for (const tableName of commonTables) {
    try {
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .limit(0);
      
      if (!error) {
        existingTables.push(tableName);
      }
    } catch (err) {
      // Table doesn't exist or not accessible
    }
  }
  
  return existingTables;
}

async function getTableColumns(tableName: string): Promise<ColumnInfo[]> {
  // Try to get column info by inserting a test row and seeing what columns exist
  // But this won't work if table has required fields
  
  // Better: Try to query via RPC function
  try {
    const { data, error } = await supabase.rpc('get_table_columns', {
      table_name: tableName
    });
    if (!error && data) {
      return data;
    }
  } catch (err) {
    // Function doesn't exist
  }
  
  return [];
}

async function main() {
  console.log('Inspecting Supabase database schema via Supabase client...\n');
  console.log(`URL: ${supabaseUrl}`);
  console.log(`Using: Anon Key\n`);
  
  // Try to query schema via RPC function
  console.log('Attempting to query schema via RPC function...');
  const rpcSchema = await querySchemaViaRPC();
  
  if (rpcSchema.length > 0) {
    console.log(`✓ Found ${rpcSchema.length} columns via RPC\n`);
    // Process and save results
    const tablesMap = new Map<string, ColumnInfo[]>();
    rpcSchema.forEach(col => {
      if (!tablesMap.has(col.table_name)) {
        tablesMap.set(col.table_name, []);
      }
      tablesMap.get(col.table_name)!.push(col);
    });
    
    // Save results
    const outputDir = path.join(process.cwd(), 'drizzle-introspect');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const reportFile = path.join(outputDir, 'ACTUAL_COLUMNS.md');
    const jsonFile = path.join(outputDir, 'actual-columns.json');
    
    // Generate report
    const report: string[] = [];
    report.push('# Actual Database Schema Columns\n');
    report.push(`**Generated**: ${new Date().toISOString()}\n`);
    report.push(`**Method**: Supabase RPC Function\n\n`);
    report.push(`Found ${tablesMap.size} tables:\n\n`);
    
    tablesMap.forEach((cols, tableName) => {
      report.push(`## ${tableName}\n\n`);
      report.push('| Column Name | Type | Nullable | Default |\n');
      report.push('|-------------|------|----------|---------|\n');
      cols.forEach(col => {
        const nullable = col.is_nullable === 'YES' ? 'YES' : 'NO';
        const defaultVal = col.column_default || '-';
        report.push(`| \`${col.column_name}\` | ${col.data_type} | ${nullable} | ${defaultVal} |\n`);
      });
      report.push('\n');
    });
    
    fs.writeFileSync(reportFile, report.join(''));
    fs.writeFileSync(jsonFile, JSON.stringify(Object.fromEntries(tablesMap), null, 2));
    
    console.log(`✓ Report written to: ${reportFile}`);
    console.log(`✓ JSON written to: ${jsonFile}\n`);
    
    // Print summary
    tablesMap.forEach((cols, tableName) => {
      console.log(`${tableName}:`);
      cols.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'NOT NULL'})`);
      });
      console.log('');
    });
    
    return;
  }
  
  // Fallback: Discover tables
  console.log('RPC function not available. Discovering tables...\n');
  const tables = await discoverTables();
  
  if (tables.length === 0) {
    console.log('⚠️  No accessible tables found.\n');
    console.log('To get exact column structure, you need to:');
    console.log('1. Go to Supabase Dashboard → SQL Editor');
    console.log('2. Run this query:');
    console.log(`
SELECT 
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
`);
    console.log('3. Copy the results and save them to drizzle-introspect/ACTUAL_COLUMNS.json\n');
    return;
  }
  
  console.log(`Found ${tables.length} tables: ${tables.join(', ')}\n`);
  console.log('⚠️  Cannot determine column structure without data or RPC function.');
  console.log('Tables are empty, so column types cannot be inferred.\n');
  console.log('To get exact column structure:');
  console.log('1. Go to Supabase Dashboard → SQL Editor');
  console.log('2. Run: SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = \'public\' ORDER BY table_name, ordinal_position;');
  console.log('3. Copy results to drizzle-introspect/ACTUAL_COLUMNS.json\n');
}

main().catch(console.error);
