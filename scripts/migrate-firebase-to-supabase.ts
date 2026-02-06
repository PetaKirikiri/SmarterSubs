/**
 * Firebase to Supabase Migration CLI Script
 * 
 * Usage:
 *   npx tsx scripts/migrate-firebase-to-supabase.ts [--dry-run] [--limit N] [--collections episodes,subtitles,words,meanings]
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import {
  migrateEpisodes,
  migrateSubtitles,
  migrateWords,
  migrateMeanings,
} from '../src/firebase/migrateToSupabase';

dotenv.config();

interface MigrationOptions {
  dryRun: boolean;
  limit?: number;
  collections: string[];
}

function parseArgs(): MigrationOptions {
  const args = process.argv.slice(2);
  const options: MigrationOptions = {
    dryRun: false,
    collections: ['episodes', 'subtitles', 'words', 'meanings'],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--limit' && i + 1 < args.length) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--collections' && i + 1 < args.length) {
      options.collections = args[i + 1].split(',').map(c => c.trim());
      i++;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();

  console.log('Firebase to Supabase Migration');
  console.log('================================\n');
  console.log(`Dry run: ${options.dryRun ? 'YES' : 'NO'}`);
  console.log(`Limit: ${options.limit || 'unlimited'}`);
  console.log(`Collections: ${options.collections.join(', ')}\n`);

  if (options.dryRun) {
    console.log('⚠️  DRY RUN MODE - No data will be saved\n');
  }

  const allStats: Array<{ collection: string; stats: any }> = [];
  const allErrors: Array<{ collection: string; errors: any[] }> = [];

  try {
    // Migrate episodes
    if (options.collections.includes('episodes')) {
      console.log('\n📺 Migrating episodes...');
      if (!options.dryRun) {
        const stats = await migrateEpisodes(options.limit);
        allStats.push({ collection: 'episodes', stats });
        allErrors.push({ collection: 'episodes', errors: stats.errorLog });
      } else {
        console.log('  [DRY RUN] Would migrate episodes');
      }
    }

    // Migrate subtitles
    if (options.collections.includes('subtitles')) {
      console.log('\n📝 Migrating subtitles...');
      if (!options.dryRun) {
        const stats = await migrateSubtitles(options.limit);
        allStats.push({ collection: 'subtitles', stats });
        allErrors.push({ collection: 'subtitles', errors: stats.errorLog });
      } else {
        console.log('  [DRY RUN] Would migrate subtitles');
      }
    }

    // Migrate words (must be before meanings)
    let wordIdMap = new Map<string, string>();
    if (options.collections.includes('words')) {
      console.log('\n📚 Migrating words...');
      if (!options.dryRun) {
        const result = await migrateWords(options.limit);
        allStats.push({ collection: 'words', stats: result.stats });
        allErrors.push({ collection: 'words', errors: result.stats.errorLog });
        wordIdMap = result.wordIdMap;
      } else {
        console.log('  [DRY RUN] Would migrate words');
      }
    }

    // Migrate meanings (requires wordIdMap)
    if (options.collections.includes('meanings')) {
      console.log('\n💭 Migrating meanings...');
      if (!options.dryRun) {
        if (wordIdMap.size === 0 && options.collections.includes('words')) {
          console.log('  ⚠️  Warning: No words migrated, meanings may not link correctly');
        }
        const stats = await migrateMeanings(wordIdMap, options.limit);
        allStats.push({ collection: 'meanings', stats });
        allErrors.push({ collection: 'meanings', errors: stats.errorLog });
      } else {
        console.log('  [DRY RUN] Would migrate meanings');
      }
    }

    // Print summary
    console.log('\n\nMigration Summary');
    console.log('=================\n');

    if (options.dryRun) {
      console.log('DRY RUN - No data was saved\n');
    } else {
      allStats.forEach(({ collection, stats }) => {
        console.log(`${collection}:`);
        console.log(`  Total: ${stats.total}`);
        console.log(`  Success: ${stats.success}`);
        console.log(`  Errors: ${stats.errors}`);
        console.log('');
      });

      // Save error log
      const errorLogPath = path.join(process.cwd(), 'migration-errors.json');
      const errorLog = {
        timestamp: new Date().toISOString(),
        dryRun: options.dryRun,
        collections: options.collections,
        errors: allErrors,
      };
      fs.writeFileSync(errorLogPath, JSON.stringify(errorLog, null, 2));
      console.log(`Error log saved to: ${errorLogPath}\n`);

      const totalErrors = allErrors.reduce((sum, e) => sum + e.errors.length, 0);
      if (totalErrors > 0) {
        console.log(`⚠️  ${totalErrors} errors occurred during migration. Check error log for details.`);
      } else {
        console.log('✅ Migration completed successfully with no errors!');
      }
    }
  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main().catch(console.error);
