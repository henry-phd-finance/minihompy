import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(resolve(process.argv[2])));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
const root = new URL('../', import.meta.url);
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => { throw new Error(`Unexpected dialog: ${dialog.message()}`); });
  await page.route('https://fixture.test/**', async route => {
    const path = new URL(route.request().url()).pathname.slice(1);
    if (!path) return route.fulfill({ contentType: 'text/html', body: '<div id="editor"></div>' });
    return route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL(path, root), 'utf8') });
  });
  await page.goto('https://fixture.test/');
  await page.addScriptTag({ url: 'assets/vendor/quill-2.0.3.js' });
  await page.evaluate(() => {
    window.MinihompyAdmin = { state: { role: 'admin' } };
    window.cleaned = []; window.revoked = []; window.saved = []; window.done = 0;
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = url => { revoked.push(url); revoke(url); };
    window.MinihompyPhotosRepository = {
      url: path => 'https://fixture.test/' + path,
      validate() {},
      upload: async path => { window.uploadPath = path; await new Promise(r => window.finishUpload = r); },
      save: async payload => { saved.push(payload); await new Promise(r => window.finishSave = r); return payload; },
      cleanup: async paths => { cleaned.push(...paths); },
    };
  });
  await page.addScriptTag({ url: 'post-routes.js' });
  await page.addScriptTag({ url: 'photo-editor.js' });
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
  async function start(title, attach = true) {
    await page.evaluate(() => {
      MinihompyPhotoEditor.start(null, 'folder');
      document.querySelector('#editor').replaceChildren(MinihompyPhotoEditor.render([{ id: 'folder', kind: 'folder', label: 'folder' }], () => window.done++));
    });
    await page.locator('.photo-editor-title').fill(title);
    if (attach) {
      await page.locator('.photo-editor-file').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: image });
      await page.waitForFunction(() => document.querySelector('.ql-editor img') && !MinihompyPhotoEditor.busy);
    }
  }
  await start('old upload');
  const preview = await page.locator('.ql-editor img').getAttribute('src');
  await page.locator('.photo-save').click();
  await page.waitForFunction(() => !!window.finishUpload);
  await page.evaluate(() => MinihompyPostRoutes.leave('photos'));
  await start('new draft', false);
  await page.evaluate(() => finishUpload());
  await page.waitForFunction(() => cleaned.includes(uploadPath));
  assert.equal(await page.locator('.photo-editor-title').inputValue(), 'new draft');
  assert.deepEqual(await page.evaluate(() => ({ saved: saved.length, done })), { saved: 0, done: 0 });
  assert(await page.evaluate(src => revoked.includes(src), preview));
  console.log('PASS: pending upload departure revokes preview, cleans unused file, never submits old draft or mutates new draft');

  await page.evaluate(() => MinihompyPostRoutes.leave('photos'));
  await start('committed attachment');
  await page.evaluate(() => { window.finishUpload = null; window.finishSave = null; });
  await page.locator('.photo-save').click();
  await page.waitForFunction(() => !!window.finishUpload);
  await page.evaluate(() => finishUpload());
  await page.waitForFunction(() => !!window.finishSave);
  const savedPath = await page.evaluate(() => saved.at(-1).body.find(b => b.type === 'image').path);
  await page.evaluate(() => MinihompyPostRoutes.leave('photos'));
  await start('next draft', false);
  await page.evaluate(() => finishSave());
  await page.waitForTimeout(50);
  assert.equal(await page.locator('.photo-editor-title').inputValue(), 'next draft');
  assert.equal(await page.evaluate(path => cleaned.includes(path), savedPath), false);
  assert.equal(await page.evaluate(() => done), 0);
  console.log('PASS: submitted write attachment survives departure and late save response cannot replace new draft');
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  assert.equal(await page.evaluate(() => MinihompyPhotoEditor.active), false);
  assert.equal(await page.locator('.photo-editor-title').count(), 0);
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
