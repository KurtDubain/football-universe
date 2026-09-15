import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import * as BRAND from './brand';
import zh from '../locales/zh.json';
import en from '../locales/en.json';

it('keeps the formal brand consistent across static metadata and locales', () => {
  const html = readFileSync('index.html', 'utf8');
  expect(html).toContain(`<title>${BRAND.fullName}</title>`);
  expect(html).toContain(`"name": "${BRAND.fullName}"`);
  for (const locale of [zh, en]) expect(locale.welcome.title).toBe(BRAND.fullName);
  expect(html).not.toMatch(/足球联赛宇宙|Football Universe|电子斗蛐蛐/);
  for (const path of ['public/og-image.svg', 'src/edition/contest/og-image.svg']) {
    const svg = readFileSync(path, 'utf8');
    expect(svg).toContain(BRAND.shortName);
    expect(svg).toContain(BRAND.subtitle);
    expect(svg).toContain(BRAND.tagline);
    expect(svg).not.toMatch(/足球联赛宇宙|Football Universe/);
  }
  expect(readFileSync('src/edition/contest/og-image.svg', 'utf8')).toContain('三岸纪');
  expect(readFileSync('src/edition/contest/og-image.svg', 'utf8')).toContain('三岸纪 · 参赛世界');
  expect(readFileSync('src/edition/contest/og-image.svg', 'utf8')).not.toContain('待审阅');
  expect(readFileSync('public/og-image.svg', 'utf8')).toContain('赛季观察档案');
  expect(readFileSync('public/og-image.svg', 'utf8')).not.toContain('vercel.app');
});
