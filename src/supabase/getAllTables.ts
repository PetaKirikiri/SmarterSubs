/**
 * Get all tables from Supabase database
 * Uses information_schema to query PostgreSQL metadata
 */

import { supabase } from './index';

export async function getAllTables() {
  console.log('[DEBUG] Getting all tables from Supabase...');
  
  // Query information_schema to get all tables
  // Note: Supabase doesn't allow direct queries to information_schema via REST API
  // So we'll try querying each known table and see what exists
  
  // ONLY Supabase tables that actually exist (from ACTUAL_COLUMNS.md)
  const knownTables = [
    'episodes',
    'subtitles',
    'words_th',
    'meanings_th'
  ];
  
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
          console.error(`[ERROR] Error checking table ${tableName}:`, error);
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
      console.error(`[ERROR] Exception checking table ${tableName}:`, err);
      results[tableName] = { exists: false };
    }
  }
  
  console.log('[DEBUG] All tables check complete:', results);
  
  // Also log in a more readable format
  console.log('\n=== SUPABASE TABLES SUMMARY ===');
  const existingTables = Object.entries(results).filter(([_, info]) => info.exists);
  const missingTables = Object.entries(results).filter(([_, info]) => !info.exists);
  
  console.log(`\n✅ EXISTING TABLES (${existingTables.length}):`);
  existingTables.forEach(([name, info]) => {
    console.log(`  - ${name}: ${info.rowCount || 0} rows`);
    if (info.columns && info.columns.length > 0) {
      console.log(`    Columns: ${info.columns.join(', ')}`);
    }
    if (info.sample) {
      console.log(`    Sample:`, info.sample);
    }
  });
  
  console.log(`\n❌ MISSING TABLES (${missingTables.length}):`);
  missingTables.forEach(([name]) => {
    console.log(`  - ${name}`);
  });
  console.log('================================\n');
  
  return results;
}

// Also try to get tables via RPC if available
export async function getAllTablesViaRPC() {
  try {
    const { data, error } = await supabase.rpc('get_schema_tables');
    if (error) {
      console.log('[DEBUG] RPC get_schema_tables not available:', error.message);
      return null;
    }
    return data;
  } catch (err: any) {
    console.log('[DEBUG] RPC call failed:', err.message);
    return null;
  }
}
