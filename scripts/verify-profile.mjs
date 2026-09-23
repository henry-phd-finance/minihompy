import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mockSettings } from './settings-fixture.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const out = resolve(root, 'docs/verification/profile-step2');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
const results = [];
try {
  for (const [width, height, dpr] of [[1000, 700, 1], [375, 812, 1], [375, 812, 2]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
    const errors = [];
    await page.addInitScript(()=>Object.defineProperty(window,'MINIHOMPY_VISITOR_IDENTITY_CONFIG',{get:()=>({enabled:false}),set:()=>{}}));
    await mockSettings(page);
    page.on('pageerror', e => errors.push(e.message));
    page.on('requestfailed', r => errors.push(r.url()));
    await page.goto(`${pathToFileURL(resolve(root, 'index.html')).href}#/profile`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => window.MinihompySettings.status === 'ready');
    await page.locator('.profile-introduction').waitFor();
    assert.equal(await page.locator('.profile-section-button').count(), 5);
    assert.equal(await page.locator('.profile-introduction-name').textContent(), await page.evaluate(() => window.MINIHOMPY_CONFIG.profile.name));
    assert(await page.locator('.profile-introduction-image').evaluate(e => e.complete && e.naturalWidth > 0));
    await page.screenshot({ path: resolve(out, `profile-${width}-dpr${dpr}.png`) });
    for (const id of ['keywords', 'history', 'questions', 'information']) {
      await page.locator(`[data-profile-section="${id}"]`).click();
      assert.equal(await page.locator('.profile-content-scroll').textContent(), '');
      assert.equal(await page.locator('.profile-content-scroll > *').count(), 0);
      assert.equal(await page.locator(`[data-profile-section="${id}"]`).getAttribute('aria-current'), 'page');
    }
    await page.screenshot({ path: resolve(out, `profile-blank-${width}-dpr${dpr}.png`) });
    for (const id of ['network', 'favorites']) {
      await page.locator(`[data-profile-group="${id}"]`).click();
      assert.equal(await page.locator('.profile-content-scroll').textContent(), '');
      assert.equal(await page.locator(`#profile-group-${id} > *`).count(), 0);
    }
    await page.locator('[data-profile-group="about"]').click();
    assert.equal(await page.locator('.profile-introduction').count(), 1);
    await page.locator('[data-profile-section="history"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.profile-content-scroll').textContent(), '');
    await page.locator('[data-menu="home"]').click();
    await page.locator('[data-menu="profile"]').click();
    assert.equal(await page.locator('.profile-content-scroll').getAttribute('data-section'), 'history');
    await page.route('**/rest/v1/minihompy_profile*', route => route.fulfill({ json: [{ id: 1, image_path: '', image_alt: '', image_width: 192, name: null, paragraphs: ['긴소개'.repeat(1000), '<script>plain text</script>'], revision: 2 }] }));
    await page.locator('[data-menu="home"]').click();
    await page.locator('[data-menu="profile"]').click();
    await page.locator('[data-profile-section="introduction"]').click();
    await page.locator('.profile-introduction-paragraph').first().filter({ hasText: '긴소개' }).waitFor();
    assert(await page.locator('.profile-content-scroll').evaluate(e => e.scrollWidth <= e.clientWidth && e.scrollHeight > e.clientHeight));
    assert.equal(await page.locator('.profile-introduction script').count(), 0);
    await page.locator('.profile-content-scroll').focus();
    await page.keyboard.press('End');
    await page.waitForTimeout(150);
    assert(await page.locator('.profile-content-scroll').evaluate(e => e.scrollTop > 0));
    assert.deepEqual(errors, []);
    results.push({ width, height, dpr, errors, blankSections: 'passed', longText: 'passed' });
    await page.close();
  }
  await writeFile(resolve(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log('PASS: profile introduction, empty sections/groups, keyboard, navigation, image, long text, desktop/mobile.');
} finally { await browser.close(); }
