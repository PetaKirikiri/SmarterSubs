/**
 * Setup SQL function and inspect schema via Supabase
 * 
 * This script:
 * 1. Creates a SQL function in Supabase (via SQL Editor instructions)
 * 2. Calls the function via RPC to get schema information
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
  try {
    const { data, error } = await supabase.rpc('get_schema_info');
    if (error) {
      console.error('RPC Error:', error.message);
      return [];
    }
    return data || [];
  } catch (err: any) {
    console.error('RPC Exception:', err.message);
    return [];
  }
}

async function main() {
  console.log('Inspecting Supabase database schema...\n');
  console.log(`URL: ${supabaseUrl}\n`);
  
  // Try to query schema via RPC
  console.log('Querying schema via RPC function...');
  const columns = await querySchemaViaRPC();
  
  if (columns.length === 0) {
    console.log('❌ RPC function not found or returned no data.\n');
    console.log('📋 SETUP REQUIRED:');
    console.log('1. Go to: https://supabase.com/dashboard/project/gbsopnbovsxlstnmaaga/sql/new');
    console.log('2. Copy and paste the SQL from: scripts/create-schema-rpc-function.sql');
    console.log('3. Click "Run" to create the function');
    console.log('4. Then run this script again\n');
    return;
  }
  
  // Group by table
  const tablesMap = new Map<string, ColumnInfo[]>();
  columns.forEach(col => {
    if (!tablesMap.has(col.table_name)) {
      tablesMap.set(col.table_name, []);
    }
    tablesMap.get(col.table_name)!.push(col);
  });
  
  console.log(`✓ Found ${tablesMap.size} tables with ${columns.length} total columns\n`);
  
  // Generate report
  const outputDir = path.join(process.cwd(), 'drizzle-introspect');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const report: string[] = [];
  report.push('# Actual Database Schema Columns\n');
  report.push(`**Generated**: ${new Date().toISOString()}\n`);
  report.push(`**Method**: Supabase RPC Function (get_schema_info)\n\n`);
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
  
  const reportFile = path.join(outputDir, 'ACTUAL_COLUMNS.md');
  const jsonFile = path.join(outputDir, 'actual-columns.json');
  
  fs.writeFileSync(reportFile, report.join(''));
  fs.writeFileSync(jsonFile, JSON.stringify(Object.fromEntries(tablesMap), null, 2));
  
  console.log(`✓ Report written to: ${reportFile}`);
  console.log(`✓ JSON written to: ${jsonFile}\n`);
  
  // Print summary
  tablesMap.forEach((cols, tableName) => {
    console.log(`${tableName}:`);
    cols.forEach(col => {
      const nullable = col.is_nullable === 'YES' ? 'nullable' : 'NOT NULL';
      console.log(`  - ${col.column_name}: ${col.data_type} (${nullable})`);
    });
    console.log('');
  });
}

main().catch(console.error);
