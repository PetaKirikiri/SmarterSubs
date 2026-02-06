/**
 * Inspect Supabase Database Schema via Direct PostgreSQL Connection
 * 
 * This script queries information_schema directly to get exact column structure
 * even when tables are empty.
 */

import postgres from 'postgres';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl || databaseUrl.includes('YOUR-PASSWORD')) {
  console.error('❌ Error: DATABASE_URL not set or contains placeholder password');
  console.error('   Please set DATABASE_URL in .env with actual database password');
  process.exit(1);
}

interface ColumnInfo {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
}

async function main() {
  console.log('Connecting to PostgreSQL database...\n');
  
  const sql = postgres(databaseUrl, {
    max: 1, // Only need one connection
  });

  try {
    // Query information_schema to get all columns
    const columns = await sql<ColumnInfo[]>`
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
    `;

    if (columns.length === 0) {
      console.log('⚠️  No columns found in public schema');
      console.log('   The database may be empty or tables may not exist.\n');
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

    console.log(`✓ Found ${tablesMap.size} tables with ${columns.length} total columns:\n`);

    // Display results
    const report: string[] = [];
    report.push('# Actual Database Schema Columns\n');
    report.push(`**Generated**: ${new Date().toISOString()}\n`);
    report.push('## Summary\n');
    report.push(`Found ${tablesMap.size} tables:\n`);

    tablesMap.forEach((cols, tableName) => {
      report.push(`- **${tableName}**: ${cols.length} columns`);
    });

    report.push('\n---\n');

    // Detailed column information
    tablesMap.forEach((cols, tableName) => {
      report.push(`\n## ${tableName}\n`);
      report.push('| Column Name | Type | Nullable | Default | Max Length |\n');
      report.push('|-------------|------|----------|---------|------------|\n');

      cols.forEach(col => {
        const nullable = col.is_nullable === 'YES' ? 'YES' : 'NO';
        const defaultVal = col.column_default || '-';
        const maxLength = col.character_maximum_length || '-';
        
        report.push(`| \`${col.column_name}\` | ${col.data_type} | ${nullable} | ${defaultVal} | ${maxLength} |\n`);
      });

      report.push('\n### Zod Schema Mapping\n');
      report.push('```typescript\n');
      report.push(`// Database table: ${tableName}\n`);
      report.push(`export const ${tableName}Schema = z.object({\n`);
      
      cols.forEach(col => {
        const zodType = mapPostgresToZod(col.data_type, col.is_nullable === 'YES');
        const required = col.is_nullable === 'NO' && !col.column_default ? '' : '.optional()';
        report.push(`  ${col.column_name}: ${zodType}${required},\n`);
      });
      
      report.push('});\n');
      report.push('```\n');
    });

    // Write report
    const outputDir = path.join(process.cwd(), 'drizzle-introspect');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const reportFile = path.join(outputDir, 'ACTUAL_COLUMNS.md');
    fs.writeFileSync(reportFile, report.join(''));

    // Also write JSON for programmatic access
    const jsonFile = path.join(outputDir, 'actual-columns.json');
    const jsonData = Object.fromEntries(tablesMap);
    fs.writeFileSync(jsonFile, JSON.stringify(jsonData, null, 2));

    console.log('✓ Schema inspection complete!\n');
    console.log(`📄 Report written to: ${reportFile}`);
    console.log(`📄 JSON written to: ${jsonFile}\n`);

    // Print summary to console
    tablesMap.forEach((cols, tableName) => {
      console.log(`\n${tableName}:`);
      cols.forEach(col => {
        const nullable = col.is_nullable === 'YES' ? 'nullable' : 'NOT NULL';
        console.log(`  - ${col.column_name}: ${col.data_type} (${nullable})`);
      });
    });

  } catch (error) {
    console.error('❌ Error querying database:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

function mapPostgresToZod(postgresType: string, nullable: boolean): string {
  // Map PostgreSQL types to Zod types
  const typeMap: Record<string, string> = {
    'text': 'z.string()',
    'varchar': 'z.string()',
    'character varying': 'z.string()',
    'integer': 'z.number().int()',
    'bigint': 'z.number().int()',
    'smallint': 'z.number().int()',
    'numeric': 'z.number()',
    'real': 'z.number()',
    'double precision': 'z.number()',
    'boolean': 'z.boolean()',
    'jsonb': 'z.record(z.any())',
    'json': 'z.record(z.any())',
    'timestamp without time zone': 'z.string().datetime()',
    'timestamp with time zone': 'z.string().datetime()',
    'date': 'z.string().date()',
    'time': 'z.string()',
  };

  // Normalize type name
  const normalizedType = postgresType.toLowerCase().trim();
  const zodType = typeMap[normalizedType] || 'z.any()';

  return zodType;
}

main().catch(console.error);
