import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mockSettings } from './settings-fixture.mjs';
const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
try {
  const page = await browser.newPage();
  await page.addInitScript(()=>Object.defineProperty(window,'MINIHOMPY_VISITOR_IDENTITY_CONFIG',{get:()=>({enabled:false}),set:()=>{}}));
  await mockSettings(page);
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.goto(new URL('../index.html', import.meta.url).href);
  const result = await page.evaluate(async () => {
    const visitor = window.MinihompyBackend.getClient();
    const admin = window.MinihompyBackend.getClient('admin');
    const identity = window.createMinihompyIdentity(visitor);
    return {
      same: visitor === window.MinihompyBackend.getClient(),
      separate: visitor !== admin,
      differentKeys: visitor.auth.storageKey !== admin.auth.storageKey,
      identity: await identity.current(),
    };
  });
  assert(result.same && result.separate && result.differentKeys);
  assert.deepEqual(result.identity, { role: 'reader', userId: null });
  assert.deepEqual(errors, []);
  assert(requests.every(url => url.startsWith('file:') || /\/rest\/v1\/minihompy_(settings|profile)\?/.test(url)), 'Reading must not create a remote user');
  console.log('PASS: actual vendored SDK, isolated sessions, client reuse, reader identity, settings/profile reads only, no user creation.');
} finally { await browser.close(); }
