import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mockSettings } from './settings-fixture.mjs';
const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const out = new URL('../docs/verification/admin-login/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
try {
  for (const width of [1000, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 812 } });
    const errors = [];
    await mockSettings(page);
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(window, 'MINIHOMPY_VISITOR_IDENTITY_CONFIG', { get: () => ({ enabled: false }), set() {} });
      let backend;
      let user = null;
      window.testMode = 'invalid';
      window.logoutScopes = [];
      localStorage.setItem('visitor-sentinel', 'untouched');
      const client = {
        auth: {
          async getSession() { return { data: { session: user ? { user } : null } }; },
          async getUser() { return { data: { user } }; },
          async signInWithPassword(credentials) {
            if (credentials.options?.captchaToken) throw new Error('Unexpected CAPTCHA');
            if (window.testMode === 'invalid') return { error: new Error('invalid') };
            user = { id: 'test-user' };
            return { error: null };
          },
          async signOut(options) { window.logoutScopes.push(options.scope); user = null; return { error: null }; },
          onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
        },
        async rpc() {
          if (window.testMode === 'network') throw new Error('offline');
          return { data: window.testMode === 'admin', error: null };
        },
      };
      Object.defineProperty(window, 'MinihompyBackend', {
        set(value) { backend = value; },
        get() { return { getClient(kind) { return kind === 'admin' ? client : backend.getClient(kind); } }; },
      });
    });
    await page.goto(new URL('../index.html', import.meta.url).href);
    await page.locator('#login-auth-toggle').click();
    await page.locator('#login-email').fill('owner@example.com');
    await page.locator('#login-password').fill('not-a-real-password');
    await page.screenshot({ path: new URL(`dialog-${width}.png`, out).pathname });
    await page.locator('#login-submit').click();
    await page.waitForFunction(() => document.querySelector('.login-auth-message').textContent.includes('입력 정보'));
    assert.equal(await page.locator('#login-password').inputValue(), '');
    for (const mode of ['visitor', 'network', 'admin']) {
      await page.evaluate(mode => { window.testMode = mode; }, mode);
      await page.locator('#login-password').fill('not-a-real-password');
      await page.locator('#login-submit').click();
      await page.waitForFunction(() => !document.querySelector('#login-submit').disabled);
      assert.equal(await page.evaluate(() => window.MinihompyAdmin.state.role), mode === 'admin' ? 'admin' : 'reader');
    }
    assert.equal(await page.locator('.login-dialog').isVisible(), false);
    assert.equal(await page.locator('#login-auth-toggle').textContent(), '로그아웃');
    await page.locator('#login-auth-toggle').click();
    await page.waitForFunction(() => !document.querySelector('#login-auth-toggle').disabled);
    assert.equal(await page.evaluate(() => window.MinihompyAdmin.state.role), 'reader');
    assert.equal(await page.evaluate(() => localStorage.getItem('visitor-sentinel')), 'untouched');
    assert((await page.evaluate(() => window.logoutScopes)).every(scope => scope === 'local'));
    await page.locator('#login-auth-toggle').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.login-dialog').isVisible(), false);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: admin UI desktop/mobile; invalid/non-admin/network denied; verified admin; local logout; password cleared; Escape. Auth calls mocked.');
} finally { await browser.close(); }
