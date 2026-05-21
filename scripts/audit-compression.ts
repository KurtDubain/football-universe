import { chromium } from 'playwright';
import * as fs from 'fs';

const URL = 'http://localhost:5173/';
const SAVE = JSON.parse(fs.readFileSync('/Users/mutu/Downloads/football-universe-s16.json', 'utf8'));

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`PAGE: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`CON: ${m.text()}`); });

  // 1. Load legacy uncompressed save
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.evaluate(`
    localStorage.clear();
    localStorage.setItem('football-universe-save', ${JSON.stringify(JSON.stringify(SAVE))});
  `);

  // Verify legacy reads correctly
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const beforeAdvance = await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    var rawSize = raw ? raw.length : 0;
    // Compute JSON-parseable form (we expect: legacy may still be plaintext until rewrite)
    var firstChar = raw ? raw[0] : '';
    var teams = 0;
    try {
      var data = JSON.parse(raw);
      teams = Object.keys(data.state.world.teamBases).length;
    } catch (e) {
      teams = -1; // compressed (not JSON)
    }
    return { rawSize: rawSize, firstChar: firstChar, teamsDirectParse: teams };
  })()`);
  console.log('=== Load legacy save (uncompressed) ===');
  console.log('Raw size:', beforeAdvance.rawSize, 'chars');
  console.log('First char:', beforeAdvance.firstChar, '(should be "{" — plaintext)');
  console.log('Teams parseable directly:', beforeAdvance.teamsDirectParse);

  // Click advance once to trigger save (zustand persist will compress on write)
  const btn = await page.$('button:has-text("推进"), button:has-text("开始模拟")');
  if (btn) {
    await btn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  const afterFirstSave = await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    return { size: raw ? raw.length : 0, firstChar: raw ? raw[0] : '' };
  })()`);
  console.log('\n=== After first advance (should be compressed) ===');
  console.log('Compressed size:', afterFirstSave.size, 'chars');
  console.log('First char:', afterFirstSave.firstChar, '(non-"{" = compressed)');
  console.log('Compression ratio:', ((1 - afterFirstSave.size / beforeAdvance.rawSize) * 100).toFixed(1) + '% reduction');

  // Reload page, verify state survives the compressed round trip
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const afterReload = await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    return { size: raw ? raw.length : 0 };
  })()`);
  // Verify world still loaded
  // Quick measurement: what does the raw zustand-persisted state look like
  // uncompressed vs compressed?
  const sizes = await page.evaluate(`(() => {
    // Build the partialize subset like zustand persist does
    var raw = localStorage.getItem('football-universe-save');
    if (!raw) return { compressed: 0, plaintext: 0 };
    // raw is compressed; decompress it to get plaintext size
    // Pull lz-string from window (if exposed) — fallback to just measuring raw
    var compressed = raw.length;
    // estimate plaintext by char count + utf16 char-pair sizing
    return { compressed: compressed };
  })()`);
  console.log('\n=== Compressed save state ===');
  console.log('Compressed size in localStorage:', sizes.compressed, 'chars (~' + (sizes.compressed * 2 / 1024).toFixed(0) + ' KB raw bytes)');

  console.log('\n=== ERRORS ===');
  console.log(errors.length === 0 ? 'NONE' : errors.join('\n'));
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
