import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initialSettings, mockHomeSummary } from './settings-fixture.mjs';
const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const out = new URL('../docs/verification/photos-writing/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
const picture = await readFile(new URL('../assets/photos/lake.jpg', import.meta.url));
try {
  for (const [width, dpr] of [[1000, 1], [375, 2]]) {
    const page = await browser.newPage({ viewport: { width, height: 812 }, deviceScaleFactor: dpr });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', dialog => dialog.accept());
    const owner = '20ce5711-bac1-434b-a67d-86e994066b8f';
    const folder = 'ac04c50a-29da-4183-8634-2b5a4437fc0f';
    let posts = [], uploads = 0, rejectUpload = false, rejectWrite = false, failRead = false, duplicateUpload = false, abortUpload = false;
    // This isolated editor test must never visit the production central login.
    await page.addInitScript(()=>Object.defineProperty(window,'MINIHOMPY_VISITOR_IDENTITY_CONFIG',{get:()=>({enabled:false}),set:()=>{}}));
    await page.addInitScript(owner => {
      let backend; window.testAdmin = true;
      Object.defineProperty(window, 'MinihompyBackend', {
        set(value) { backend = value; },
        get() { return { getClient(kind) {
          const real = backend.getClient(kind);
          if (kind !== 'admin') return real;
          return { from: real.from.bind(real), storage: real.storage,
            rpc: async () => ({ data: window.testAdmin, error: null }),
            auth: {
              getSession: async () => ({ data: { session: window.testAdmin ? { user: { id: owner } } : null } }),
              getUser: async () => ({ data: { user: { id: owner } } }),
              onAuthStateChange: () => ({}),
            },
          };
        } }; },
      });
    }, owner);
    await page.route('https://itkymmxnbjylyzbmdxdb.supabase.co/**', async route => {
      const req = route.request(), url = new URL(req.url()), method = req.method();
      const send = (json, status = 200, headers = {}) => route.fulfill({ status, json, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', ...headers } });
      if (url.pathname.endsWith('/minihompy_settings')) return send([{ payload: initialSettings, revision: 1 }]);
      if (url.pathname.endsWith('/post_comments')) { assert.equal(method, 'GET'); return send([], 200, { 'content-range': '0-0/0' }); }
      if (url.pathname.includes('/storage/')) {
        if (method === 'GET') return route.fulfill({ status: 200, contentType: 'image/jpeg', body: picture });
        if (method === 'DELETE') return send([]);
        if (abortUpload) return route.abort('failed');
        if (duplicateUpload) return send({ message: 'already exists', statusCode: '409' }, 409);
        if (rejectUpload) return send({ message: 'upload denied', statusCode: '403' }, 403);
        uploads++; return send({ Key: url.pathname.split('/object/')[1] });
      }
      if (failRead && method === 'GET') return send({ message: 'offline' }, 503);
      if (url.pathname.endsWith('/photo_folders')) return send([{ id: folder, kind: 'folder', label: '일상', description: '사진첩', sort_order: 0 }]);
      assert(url.pathname.endsWith('/photo_posts'), req.url());
      const id = url.searchParams.get('id')?.slice(3);
      const revision = Number(url.searchParams.get('revision')?.slice(3));
      if (rejectWrite && method !== 'GET') return send({ message: 'write denied', code: '42501' }, 403);
      if (method === 'POST') {
        const fields = req.postDataJSON();
        assert.deepEqual(Object.keys(fields).sort(), ['author_name', 'body', 'folder_id', 'id', 'title']);
        const post = { ...fields, revision: 1, author_id: owner, created_at: '2026-09-13T01:00:00Z' };
        posts.unshift(post); return send(post, 201);
      }
      if (method === 'PATCH') {
        const post = posts.find(p => p.id === id && p.revision === revision);
        if (!post) return send(null);
        Object.assign(post, req.postDataJSON(), { revision: revision + 1 }); return send(post);
      }
      if (method === 'DELETE') {
        const post = posts.find(p => p.id === id && p.revision === revision);
        if (!post) return send(null);
        posts = posts.filter(p => p !== post); return send({ id });
      }
      if (id) return send(posts.find(p => p.id === id) || null);
      const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 2);
      return send(posts.slice(offset, offset + limit), 200, { 'content-range': `${offset}-${Math.max(offset, offset + Math.min(limit, posts.length) - 1)}/${posts.length}` });
    });
    await mockHomeSummary(page);
    await page.goto(`${new URL('../index.html', import.meta.url).href}#/photos`);
    await page.locator('.photo-write').click();
    await page.locator('.photo-editor-title').fill('본문 속의 사진');
    const body = page.locator('.ql-editor');
    await body.fill('사진 앞의 글\n');
    await body.press('Control+End');
    await page.locator('.photo-editor-file').setInputFiles({ name: 'one.jpg', mimeType: 'image/jpeg', buffer: picture });
    await page.waitForFunction(() => document.querySelector('.ql-editor img')?.complete && !window.MinihompyPhotoEditor.busy);
    assert.equal(uploads, 0, 'Local previews must not upload');
    await body.press('Control+End');
    await page.keyboard.insertText('사진 사이의 글');
    await page.keyboard.press('Enter');
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.photo-editor-toolbar button').click();
    await (await chooser).setFiles({ name: 'two.jpg', mimeType: 'image/jpeg', buffer: picture });
    await page.waitForFunction(() => document.querySelectorAll('.ql-editor img').length === 2 && !window.MinihompyPhotoEditor.busy);
    await body.press('Control+End'); await page.keyboard.insertText('마지막 글 <script>window.bad=true</script>');
    assert(await page.locator('.ql-editor img').evaluateAll(images => images.every(img => img.offsetWidth <= img.closest('.ql-editor').clientWidth)));
    await page.screenshot({ path: new URL(`editor-${width}.png`, out).pathname });
    await page.locator('.photos-scroll').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: new URL(`editor-top-${width}.png`, out).pathname });
    await page.locator('[data-menu="home"]').click(); await page.locator('[data-menu="photos"]').click();
    assert.equal(await page.locator('.ql-editor img').count(), 2);
    assert((await body.innerText()).includes('사진 사이의 글'));
    abortUpload = true; await page.locator('.photo-save').click();
    await page.locator('.photo-editor-message').filter({ hasText: '사진 업로드 (1/2) 실패: Failed to fetch' }).waitFor();
    assert.equal(posts.length, 0); assert.equal(await page.locator('.ql-editor img').count(), 2);
    abortUpload = false;
    rejectUpload = true; await page.locator('.photo-save').click();
    await page.locator('.photo-editor-message').filter({ hasText: 'upload denied' }).waitFor();
    assert.equal(posts.length, 0); assert.equal(await page.locator('.ql-editor img').count(), 2);
    rejectUpload = false; rejectWrite = true; await page.locator('.photo-save').click();
    await page.locator('.photo-editor-message').filter({ hasText: 'write denied' }).waitFor();
    assert.equal(uploads, 2); assert.equal(posts.length, 0);
    rejectWrite = false; await page.locator('.photo-save').click();
    await page.locator('.photo-post').waitFor();
    assert.equal(uploads, 2); assert.equal(posts.length, 1);
    assert.deepEqual(posts[0].body.map(b => b.type), ['text', 'image', 'text', 'image', 'text']);
    assert(posts[0].body[2].text.includes('사진 사이의 글'), JSON.stringify(posts[0].body));
    assert.equal(await page.evaluate(() => window.bad), undefined);
    await page.waitForFunction(() => [...document.querySelectorAll('.photo-image')].every(i => i.complete && i.naturalWidth));
    await page.screenshot({ path: new URL(`saved-${width}.png`, out).pathname });
    await page.locator('.photo-edit').click();
    assert.equal(await page.locator('.ql-editor img').count(), 2);
    await page.locator('.photo-editor-title').fill('수정한 사진글');
    await page.locator('.photo-editor-content').evaluate(el => {
      const q = window.Quill.find(el);
      const ops = q.getContents().ops;
      let index = 0;
      for (const op of ops) {
        if (op.insert?.image) { q.deleteText(index, 1, 'user'); break; }
        index += typeof op.insert === 'string' ? op.insert.length : 1;
      }
    });
    await page.locator('.photo-save').click(); await page.locator('.photo-post').waitFor();
    assert.equal(posts[0].title, '수정한 사진글'); assert.equal(uploads, 2);
    assert.equal(posts[0].body.filter(b => b.type === 'image').length, 1);
    await page.locator('.photo-edit').click(); posts[0].revision++;
    await page.locator('.photo-editor-title').fill('충돌'); await page.locator('.photo-save').click();
    await page.locator('.photo-editor-message').filter({ hasText: '다른 곳에서 변경' }).waitFor();
    assert.equal(posts[0].title, '수정한 사진글');
    await page.locator('.photo-cancel').click(); await page.locator('.photo-post').waitFor();
    await page.locator('.photo-delete').click(); await page.locator('.photo-empty').waitFor(); assert.equal(posts.length, 0);
    await page.locator('.photo-write').click();
    await page.locator('.photo-editor-file').setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
    await page.locator('.photo-editor-message').filter({ hasText: 'JPG' }).waitFor();
    duplicateUpload = true;
    await page.evaluate(async bytes => {
      await window.MinihompyPhotosRepository.upload(`${crypto.randomUUID()}/${crypto.randomUUID()}.jpg`, new File([new Uint8Array(bytes)], 'same.jpg', { type: 'image/jpeg' }));
    }, [...picture]);
    duplicateUpload = false;
    await page.evaluate(async () => {
      window.testAdmin = false;
      await window.MinihompyAdmin.refresh();
    });
    await page.waitForFunction(() => !window.MinihompyPhotoEditor.active && !document.querySelector('.photo-write'));
    assert.equal(await page.locator('.ql-editor').count(), 0);
    failRead = true; await page.reload(); await page.locator('.photo-retry').waitFor();
    failRead = false; await page.locator('.photo-retry').click(); await page.locator('.photo-empty').filter({ hasText: '등록된 사진' }).waitFor();
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: inline local images, text/image order, no early upload, save/edit/delete, retained drafts, failed upload/write, conflict, logout, invalid file, recovery, desktop/mobile. Mock API; real SDK and Quill.');
} finally { await browser.close(); }
