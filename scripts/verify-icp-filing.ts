import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const enabled = process.env.EXPECT_ICP !== 'false';
const output = `output/playwright/icp-${enabled ? 'enabled' : 'disabled'}`;
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report: unknown[] = [];
try {
  for (const edition of ['personal', 'contest']) {
    const url = edition === 'personal' ? 'http://127.0.0.1:4186' : 'http://127.0.0.1:4185';
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1280, height: 720 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
      const inspect = async (state: string) => {
        const prefix = `${edition}-${viewport.width}-${state}`;
        await page.screenshot({ path: `${output}/${prefix}-top.png` });
        const filing = page.getByTestId('icp-filing');
        assert.equal(await filing.count(), enabled ? 1 : 0);
        if (enabled) {
          const link = filing.getByRole('link', { name: '冀ICP备2023028175号-1', exact: true });
          assert.equal(await link.getAttribute('href'), 'https://beian.miit.gov.cn/');
          await link.scrollIntoViewIfNeeded();
          await page.waitForTimeout(500);
          if (state === 'saved-home') {
            assert.equal(await page.getByTestId('dashboard-tab-content').getByTestId('icp-filing').count(), 1);
          }
          const style = await link.evaluate(el => {
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return { size: s.fontSize, weight: s.fontWeight, color: s.color, visible: hit === el || el.contains(hit), clipped: el.scrollWidth > el.clientWidth, position: getComputedStyle(el.parentElement!).position };
          });
          assert.equal(style.size, '12px');
          assert.equal(style.weight, '400');
          assert(style.visible && !style.clipped, JSON.stringify(style));
          assert(!['fixed', 'sticky'].includes(style.position));
          await page.screenshot({ path: `${output}/${prefix}-footer.png` });
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert(await page.locator('main, [data-testid="dashboard-tab-content"]').evaluateAll(elements => elements.every(el => el.scrollWidth <= el.clientWidth + 1)));
        assert.deepEqual(errors, []);
        report.push({ edition, viewport, state, enabled, errors: [...errors] });
      };
      await page.goto(url, { waitUntil: 'networkidle' });
      await inspect('welcome');
      await page.getByTestId('start-observation').click();
      await page.getByTestId('dashboard').waitFor();
      await page.waitForTimeout(800);
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByTestId('dashboard').waitFor();
      await page.waitForTimeout(800);
      await inspect('saved-home');
      await context.close();
    }
  }
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, states: report.length, output }));
} finally {
  await browser.close();
}
