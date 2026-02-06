/**
 * Test Save Functions
 * 
 * Creates test objects for each table and saves them to verify database connection and schema matching
 */

import * as dotenv from 'dotenv';
import { saveEpisode, saveSubtitle, saveWord, saveMeaning } from '../src/supabase/migrations';
import { episodeSchema, type Episode } from '../src/schemas/episodeSchema';
import { subtitleSchema, type Subtitle } from '../src/schemas/subtitleSchema';
import { wordSchema, type Word } from '../src/schemas/wordSchema';
import { senseSchema, type Sense } from '../src/schemas/senseSchema';

dotenv.config();

async function testSaveEpisode() {
  console.log('Testing saveEpisode...');
  
  const testEpisode: Episode = {
    id: BigInt(999999), // Test bigint ID
    media_id: 'test-media-123',
    show_title: 'Test Show',
    season_number: 1,
    episode_number: 1,
    episode_title: 'Test Episode',
  };

  try {
    // Validate first
    const validated = episodeSchema.parse(testEpisode);
    console.log('  ✓ Episode validated');
    
    // Save
    await saveEpisode(validated);
    console.log('  ✓ Episode saved successfully');
    return true;
  } catch (error: any) {
    console.error('  ✗ Failed to save episode:', error.message);
    return false;
  }
}

async function testSaveSubtitle() {
  console.log('Testing saveSubtitle...');
  
  const testSubtitle: Subtitle = {
    id: 'test-subtitle-123',
    thai: 'ทดสอบ',
    english: 'Test',
    startSecThai: 10.5,
    endSecThai: 15.5,
    thaiTokens: { tokens: ['word1', 'word2'] },
  };

  try {
    // Validate first
    const validated = subtitleSchema.parse(testSubtitle);
    console.log('  ✓ Subtitle validated');
    
    // Save
    await saveSubtitle(validated);
    console.log('  ✓ Subtitle saved successfully');
    return true;
  } catch (error: any) {
    console.error('  ✗ Failed to save subtitle:', error.message);
    return false;
  }
}

async function testSaveWord() {
  console.log('Testing saveWord...');
  
  const testWord: Word = {
    id: BigInt(888888), // Test bigint ID
    text_th: 'ทดสอบ',
    g2p: 'test-g2p',
    phonetic_en: 'test-phonetic',
  };

  try {
    // Validate first
    const validated = wordSchema.parse(testWord);
    console.log('  ✓ Word validated');
    
    // Save
    const wordId = await saveWord(validated);
    console.log(`  ✓ Word saved successfully (ID: ${wordId})`);
    return { success: true, wordId };
  } catch (error: any) {
    console.error('  ✗ Failed to save word:', error.message);
    return { success: false, wordId: null };
  }
}

async function testSaveMeaning() {
  console.log('Testing saveMeaning...');
  
  const testMeaning: Sense = {
    id: BigInt(777777), // Test bigint ID
    definition_th: 'คำอธิบายทดสอบ',
    word_id_th: undefined, // Leave null for now
    source: 'test',
    created_at: new Date().toISOString(),
  };

  try {
    // Validate first
    const validated = senseSchema.parse(testMeaning);
    console.log('  ✓ Meaning validated');
    
    // Save
    await saveMeaning(validated);
    console.log('  ✓ Meaning saved successfully');
    return true;
  } catch (error: any) {
    console.error('  ✗ Failed to save meaning:', error.message);
    return false;
  }
}

async function main() {
  console.log('Testing Save Functions');
  console.log('======================\n');

  const results = {
    episode: false,
    subtitle: false,
    word: false,
    meaning: false,
  };

  // Test episodes
  results.episode = await testSaveEpisode();
  console.log('');

  // Test subtitles
  results.subtitle = await testSaveSubtitle();
  console.log('');

  // Test words
  const wordResult = await testSaveWord();
  results.word = wordResult.success;
  console.log('');

  // Test meanings
  results.meaning = await testSaveMeaning();
  console.log('');

  // Summary
  console.log('\nTest Summary');
  console.log('============');
  console.log(`Episodes: ${results.episode ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Subtitles: ${results.subtitle ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Words: ${results.word ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Meanings: ${results.meaning ? '✓ PASS' : '✗ FAIL'}`);

  const allPassed = Object.values(results).every(r => r);
  if (allPassed) {
    console.log('\n✅ All tests passed! Migration can proceed.');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed. Fix issues before running migration.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
