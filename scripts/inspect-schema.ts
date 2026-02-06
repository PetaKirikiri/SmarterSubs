/**
 * Inspect Supabase Database Schema
 * 
 * This script queries the Supabase database to discover table structure
 * by attempting to fetch data from each table and inspecting the results.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://gbsopnbovsxlstnmaaga.supabase.co';
// Use service role key if it's valid (starts with eyJ), otherwise use anon key
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || '[YOUR-KEY]';
// Only use service role key if it's a valid JWT (starts with eyJ), otherwise use anon key
const supabaseKey = (serviceRoleKey && serviceRoleKey.startsWith('eyJ')) ? serviceRoleKey : anonKey;

// Use key for schema inspection
// Note: anon key respects RLS, service_role key bypasses RLS
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  sampleValue?: any;
}

interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  rowCount?: number;
}

async function inspectTable(tableName: string): Promise<TableInfo | null> {
  try {
    // Try to fetch one row to see structure
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .limit(1);

    if (error) {
      // Table might not exist or we don't have access
      if (error.code === 'PGRST116' || error.message.includes('does not exist')) {
        return null;
      }
      console.error(`Error querying ${tableName}:`, error.message);
      return null;
    }

    if (!data || data.length === 0) {
      // Table exists but is empty - try to get count
      const { count } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });
      
      return {
        name: tableName,
        columns: [],
        rowCount: count || 0,
      };
    }

    // Infer column types from first row
    const firstRow = data[0];
    const columns: ColumnInfo[] = Object.keys(firstRow).map(key => {
      const value = firstRow[key];
      let type = 'unknown';
      
      if (value === null) {
        type = 'nullable';
      } else if (typeof value === 'string') {
        type = 'text';
      } else if (typeof value === 'number') {
        type = Number.isInteger(value) ? 'integer' : 'numeric';
      } else if (typeof value === 'boolean') {
        type = 'boolean';
      } else if (Array.isArray(value)) {
        type = 'array';
      } else if (typeof value === 'object') {
        type = 'jsonb';
      }

      return {
        name: key,
        type,
        nullable: value === null,
        sampleValue: value,
      };
    });

    // Get row count
    const { count } = await supabase
      .from(tableName)
      .select('*', { count: 'exact', head: true });

    return {
      name: tableName,
      columns,
      rowCount: count || 0,
    };
  } catch (err) {
    console.error(`Failed to inspect ${tableName}:`, err);
    return null;
  }
}

async function queryInformationSchema(): Promise<any[]> {
  // Try to query information_schema via RPC or direct SQL
  // Service role key should have access to system tables
  try {
    // Attempt 1: Use RPC function (if it exists)
    const { data: rpcData, error: rpcError } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT 
          table_name,
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position;
      `
    });
    
    if (!rpcError && rpcData) {
      return rpcData;
    }
  } catch (err) {
    // RPC might not exist
  }

  // Attempt 2: Try querying via PostgREST (might work with service role)
  // Note: This is a workaround - PostgREST doesn't directly expose information_schema
  // But we can try to infer schema from actual table queries
  return [];
}

async function main() {
  console.log('Inspecting Supabase database schema...\n');
  console.log(`URL: ${supabaseUrl}`);
  
  // Determine which key we're actually using
  const isServiceRole = (serviceRoleKey && serviceRoleKey.startsWith('eyJ'));
  const keyType = isServiceRole ? 'Service Role Key' : 'Anon Key';
  
  console.log(`Key Type: ${keyType}`);
  console.log(`Key: ${supabaseKey.substring(0, 30)}...`);
  
  if (keyType === 'Anon Key') {
    console.log('ℹ️  Using anon key - will respect RLS policies. If tables have RLS enabled, some may be inaccessible.\n');
  } else {
    console.log('✓ Using service role key - bypasses RLS policies.\n');
  }
  
  // Validate key format
  if (!supabaseKey.startsWith('eyJ') && supabaseKey !== '[YOUR-KEY]') {
    console.error('❌ Error: Invalid key format. Supabase keys must be JWT tokens starting with "eyJ".');
    console.error(`   Current key starts with: "${supabaseKey.substring(0, 10)}"`);
    console.error('   Please check your .env file and ensure VITE_SUPABASE_ANON_KEY is set correctly.\n');
    process.exit(1);
  }
  console.log('');

  // List of tables to check (from our schema.ts and actual database)
  const tablesToCheck = [
    'episode_lookup',
    'shows',
    'episodes',
    'subtitles',
    'words', // Expected name
    'words_th', // Actual name in database
    'failed_words',
    'senses', // Expected name
    'meanings_th', // Actual name in database (renamed from senses)
    'failed_word_senses',
    'failed_word_meanings', // Possible renamed version
    'thai_tokens', // New junction table
  ];

  const results: TableInfo[] = [];

  for (const tableName of tablesToCheck) {
    console.log(`Checking table: ${tableName}...`);
    const info = await inspectTable(tableName);
    if (info) {
      results.push(info);
      console.log(`  ✓ Found: ${info.columns.length} columns, ${info.rowCount || 0} rows`);
    } else {
      console.log(`  ✗ Not found or inaccessible`);
    }
  }

  // Try to query information_schema directly
  console.log('\nAttempting to query information_schema...');
  const schemaInfo = await queryInformationSchema();
  if (schemaInfo && schemaInfo.length > 0) {
    console.log(`✓ Found ${schemaInfo.length} columns via information_schema`);
    // Group by table
    const tablesMap = new Map<string, any[]>();
    schemaInfo.forEach((row: any) => {
      if (!tablesMap.has(row.table_name)) {
        tablesMap.set(row.table_name, []);
      }
      tablesMap.get(row.table_name)!.push(row);
    });
    
    console.log(`\nDiscovered ${tablesMap.size} tables from information_schema:`);
    tablesMap.forEach((columns, tableName) => {
      console.log(`  - ${tableName} (${columns.length} columns)`);
    });
    
    // Add to results
    tablesMap.forEach((columns, tableName) => {
      // Check if we already have this table
      if (!results.find(t => t.name === tableName)) {
        results.push({
          name: tableName,
          columns: columns.map((col: any) => ({
            name: col.column_name,
            type: col.data_type,
            nullable: col.is_nullable === 'YES',
          })),
        });
      }
    });
  } else {
    console.log('  ✗ Could not query information_schema (may require direct PostgreSQL connection)');
  }

  // Write results to file
  const outputDir = path.join(process.cwd(), 'drizzle-introspect');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = path.join(outputDir, 'schema-inspection.json');
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));

  console.log(`\n✓ Inspection complete! Results written to: ${outputFile}`);
  console.log(`\nFound ${results.length} accessible tables:`);
  results.forEach(t => {
    console.log(`  - ${t.name} (${t.columns.length} columns)`);
  });
}

main().catch(console.error);
