import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const modulePath = process.argv[2];
const { chromium } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : 'playwright');
const output = resolve(root, 'docs/verification/integration-step4');
await mkdir(output, { recursive: true });
const hash = async () => createHash('sha256').update(await readFile(resolve(root, 'config.js'))).digest('hex');
const beforeConfig = await hash();
for (const [script, directory] of [['verify-navigation.mjs', 'navigation'], ['verify-config.mjs', 'config']]) {
  const module = modulePath || fileURLToPath(import.meta.resolve('playwright'));
  const result = spawnSync(process.execPath, [resolve(root, 'scripts', script), module, resolve(output, directory)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${script}\n${result.stdout}\n${result.stderr}`);
  console.log(result.stdout.trim());
}
const browser = await chromium.launch({ headless: true });
const results = [];
const entry = pathToFileURL(resolve(root, 'index.html')).href;
try {
  for (const [width, height, dpr] of [[579, 349, 1], [1280, 800, 1], [375, 812, 1], [320, 740, 2]]) {
    for (const kind of ['current', 'long', 'empty', 'invalid']) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('requestfailed', request => errors.push(request.url()));
      await page.addInitScript(kind => {
        if (kind === 'current') return;
        let config;
        Object.defineProperty(window, 'MINIHOMPY_CONFIG', { get: () => config, set: value => {
          config = value;
          config.menus = [{ id: 'home', label: kind === 'long' ? '아주 긴 홈 메뉴 이름'.repeat(10) : '홈', visible: true }, { id: 'photos', label: '사진첩', visible: true }];
          const text = kind === 'long' ? '긴문구와LongUnbrokenText'.repeat(30) : kind === 'empty' ? '' : null;
          config.page.title = text;
          config.profile = { name: text, introduction: text, detail: text };
          config.home.roomMessage = text;
          config.home.friendsMessage = text;
          config.home.recentEmptyLines = kind === 'long' ? Array(10).fill(text) : kind === 'empty' ? [] : 42;
          config.home.today = kind === 'long' ? Number.MAX_SAFE_INTEGER : kind === 'empty' ? 0 : -1;
          config.home.total = kind === 'long' ? Number.MAX_SAFE_INTEGER : kind === 'empty' ? 0 : 'invalid';
        } });
      }, kind);
      await page.goto(entry);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.MinihompyContent.fit());
      await page.evaluate(() => document.fonts.ready);
      if (kind === 'current' && await page.evaluate(() => window.MinihompyApp.currentView !== 'home')) {
        await page.screenshot({ path: resolve(output, `${kind}-${width}-dpr${dpr}.png`) });
        assert.deepEqual(errors, []);
        results.push({ viewport: { width, height }, dpr, kind, homeNotSelected: true, errors });
        await page.close();
        continue;
      }
      const layout = await page.evaluate(() => {
        const selectors = ['.homepage-title', '.profile-status', '.profile-name', '.recent-empty', '.room-balloon > span', '.friends-prompt > [data-config]', '.tab-label', '.visit-count > span'];
        const text = selectors.flatMap(selector => [...document.querySelectorAll(selector)].map(element => ({ selector, overflow: element.scrollWidth > element.clientWidth, clipped: getComputedStyle(element).overflowX === 'hidden', title: element.title.length, width: element.getBoundingClientRect().width })));
        const relationship = document.querySelector('.relationship-slot');
        const badge = relationship.querySelector('.relationship-badge').getBoundingClientRect();
        const panel = document.querySelector('.utility-panel').getBoundingClientRect();
        const name = relationship.querySelector('[data-config]');
        const action = document.querySelector('.friend-request').getBoundingClientRect();
        const prompt = document.querySelector('.friends-prompt').getBoundingClientRect();
        return { text, relationshipOverflow: relationship.scrollWidth > relationship.clientWidth, badgeRight: badge.right, panelRight: panel.right, nameTitle: name.title.length, actionRight: action.right, promptRight: prompt.right, lines: document.querySelectorAll('.recent-empty br').length + 1, canvasWidth: document.querySelector('.minihompy').getBoundingClientRect().width };
      });
      assert(layout.text.every(item => !item.overflow || item.clipped), JSON.stringify(layout.text));
      assert.equal(layout.relationshipOverflow, false);
      assert(layout.badgeRight <= layout.panelRight);
      assert(layout.actionRight <= layout.promptRight + .1);
      assert.equal(layout.canvasWidth, 579);
      assert(layout.lines <= 3);
      if (kind === 'long') {
        assert(layout.text.filter(item => item.overflow && item.clipped).length >= 6);
        assert(layout.nameTitle > 100);
        assert((await page.locator('.recent-empty').getAttribute('title')).length > 1000);
      }
      if (kind === 'invalid') {
        assert.equal(await page.locator('[data-visit="today"]').textContent(), '—');
        assert.equal(await page.locator('[data-visit="total"]').textContent(), '—');
      }
      await page.screenshot({ path: resolve(output, `${kind}-${width}-dpr${dpr}.png`) });
      if (width < 579) {
        assert.equal(await page.evaluate(() => { scrollTo(1000, 0); return scrollX; }), 579 - width);
        if (kind === 'long') await page.screenshot({ path: resolve(output, `${kind}-${width}-right.png`) });
      }
      const other = page.locator('.page-tab:not([data-menu="home"])').first();
      if (await other.count()) {
        const target = await other.getAttribute('data-menu');
        await other.click();
        assert.equal(await page.evaluate(() => window.MinihompyApp.currentView), target);
        await page.locator('[data-menu="home"]').click();
      }
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator('.miniroom').count(), 1);
      const stillContained = await page.locator('.relationship-slot').evaluate(e => e.scrollWidth <= e.clientWidth);
      assert(stillContained);
      assert.deepEqual(errors, []);
      results.push({ viewport: { width, height }, dpr, kind, layout, errors });
      await page.close();
    }
  }
  assert.equal(await hash(), beforeConfig, 'User config must remain untouched');
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ browser: browser.version(), configHash: beforeConfig, results }, null, 2) + '\n');
  console.log('PASS: integration, long/empty/invalid content, tooltips, relationship badge, DPR 1/2, unchanged user config.');
} finally { await browser.close(); }
