import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initialSettings } from './settings-fixture.mjs';
const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const out = new URL('../docs/verification/guestbook-writing/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
try {
  for (const [width, dpr] of [[1000, 1], [375, 2]]) {
    const page = await browser.newPage({ viewport: { width, height: 812 }, deviceScaleFactor: dpr });
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    const users = { admin: '20ce5711-bac1-434b-a67d-86e994066b8f', visitor: '10000000-0000-0000-0000-000000000002', other: '10000000-0000-0000-0000-000000000003' };
    let actor = 'reader', posts = [], signups = 0, rejectWrite = false, failRead = false, lostResponse = false;
    await page.exposeFunction('recordSignup', () => { signups++; actor = 'visitor'; });
    await page.addInitScript(users => {
      // This suite covers local anonymous writing; central redirects have a separate fixture.
      Object.defineProperty(window, 'MINIHOMPY_VISITOR_IDENTITY_CONFIG', { get: () => ({enabled:false}), set: () => {} });
      let backend;
      window.testActor = localStorage.getItem('mock-guestbook-session') || 'reader';
      Object.defineProperty(window, 'MinihompyBackend', {
        set(value) { backend = value; },
        get() { return { getClient(kind) {
          const real = backend.getClient(kind);
          const uid = () => kind === 'admin' ? (window.testActor === 'admin' ? users.admin : null) : (window.testActor !== 'admin' ? users[window.testActor] : null);
          return { from: real.from.bind(real), rpc: async () => ({ data: kind === 'admin' && window.testActor === 'admin', error: null }),
            auth: {
              getSession: async () => ({ data: { session: uid() ? { user: { id: uid() } } : null } }),
              getUser: async () => ({ data: { user: uid() ? { id: uid() } : null } }),
              onAuthStateChange: () => ({}),
              signInAnonymously: async options => {
                if (options !== undefined) throw new Error('Unexpected CAPTCHA options');
                await window.recordSignup(); window.testActor = 'visitor'; localStorage.setItem('mock-guestbook-session', 'visitor'); return { error: null };
              },
            },
          };
        } }; },
      });
    }, users);
    await page.route('https://itkymmxnbjylyzbmdxdb.supabase.co/**', async route => {
      const req = route.request(), url = new URL(req.url()), method = req.method();
      const send = (json, status = 200, headers = {}) => route.fulfill({ status, json, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', ...headers } });
      if (url.pathname.endsWith('/minihompy_settings')) return send([{ payload: initialSettings, revision: 1 }]);
      if (url.pathname.endsWith('/post_comments')) { assert.equal(method, 'GET'); return send([], 200, { 'content-range': '0-0/0' }); }
      assert(url.pathname.endsWith('/guestbook_posts'), req.url());
      if (failRead && method === 'GET') return send({ message: 'offline' }, 503);
      const uid = users[actor], id = url.searchParams.get('id')?.slice(3), revision = Number(url.searchParams.get('revision')?.slice(3));
      const visible = post => post.visibility === 'public' || (uid && post.author_id === uid) || actor === 'admin';
      if (rejectWrite && method !== 'GET') return send({ message: 'write denied', code: '42501' }, 403);
      if (method === 'POST') {
        assert(uid, 'Reading must not create an auth account; writing must authenticate');
        const fields = req.postDataJSON(); assert.deepEqual(Object.keys(fields).sort(), ['author_name', 'body', 'id', 'visibility']);
        const post = { ...fields, author_id: uid, number: posts.length + 1, revision: 1, created_at: '2026-09-13T01:00:00Z' }; posts.unshift(post);
        if (lostResponse) return route.abort('failed');
        return send(post, 201);
      }
      if (method === 'PATCH' || method === 'DELETE') {
        const post = posts.find(p => p.id === id && p.revision === revision && visible(p) && (p.author_id === uid || actor === 'admin'));
        if (!post) return send(null);
        if (method === 'DELETE') { posts = posts.filter(p => p !== post); return send({ id }); }
        const fields = req.postDataJSON();
        if ((fields.body !== undefined && post.author_id !== uid) || (post.visibility === 'private' && fields.visibility === 'public')) return send({ message: 'forbidden' }, 403);
        Object.assign(post, fields, { revision: revision + 1 }); return send(post);
      }
      if (id) return send(posts.find(p => p.id === id && visible(p)) || null);
      const filtered = posts.filter(visible), offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 5);
      return send(filtered.slice(offset, offset + limit), 200, { 'content-range': `${offset}-${Math.max(offset, offset + Math.min(limit, filtered.length) - 1)}/${filtered.length}` });
    });
    async function changeActor(next) {
      actor = next;
      await page.evaluate(async next => {
        window.testActor = next; localStorage.setItem('mock-guestbook-session', next);
        await window.MinihompyAdmin.refresh();
        window.dispatchEvent(new StorageEvent('storage', { key: null }));
      }, next);
      await page.locator('.guestbook-save').waitFor();
    }
    await page.goto(`${new URL('../index.html', import.meta.url).href}#/guestbook`);
    await page.locator('.guestbook-empty').waitFor(); assert.equal(signups, 0); assert.equal(await page.evaluate(() => typeof window.MinihompyCaptcha), 'undefined');
    await page.locator('.guestbook-name').fill('방문객'); await page.locator('.guestbook-body-input').fill('첫 인사\n<script>window.bad=true</script>');
    await page.locator('.guestbook-visibility').check();
    // Mobile fixed-width tabs may lie outside the viewport; exercise route changes directly.
    await page.locator('[data-menu="home"]').dispatchEvent('click'); await page.locator('[data-menu="guestbook"]').dispatchEvent('click');
    assert((await page.locator('.guestbook-body-input').inputValue()).includes('첫 인사'));
    rejectWrite = true; await page.locator('.guestbook-save').click();
    await page.locator('.guestbook-status').filter({ hasText: 'write denied' }).waitFor();
    assert.equal(signups, 1); assert.equal(posts.length, 0); assert.equal(await page.locator('.guestbook-name').inputValue(), '방문객');
    rejectWrite = false; lostResponse = true; await page.locator('.guestbook-save').click();
    await page.locator('.guestbook-status').filter({ hasText: 'Failed to fetch' }).waitFor(); assert.equal(posts.length, 1);
    lostResponse = false; await page.locator('.guestbook-save').click(); await page.locator('.guestbook-post.is-private').waitFor();
    assert.equal(posts.length, 1); assert.equal(signups, 1); assert.equal(await page.evaluate(() => window.bad), undefined);
    assert.equal(await page.locator('.guestbook-name').inputValue(), '방문객');
    await page.reload(); await page.locator('.guestbook-post.is-private').waitFor();
    assert.equal(await page.locator('.guestbook-name').inputValue(), '방문객'); assert.equal(signups, 1);
    await page.locator('.guestbook-edit').click(); assert(await page.locator('.guestbook-visibility').isDisabled());
    await page.locator('.guestbook-body-input').fill('수정된 비밀'); await page.locator('.guestbook-save').click();
    await page.locator('.guestbook-text').filter({ hasText: '수정된 비밀' }).waitFor();
    await changeActor('other'); await page.locator('.guestbook-empty').waitFor(); assert.equal(await page.locator('.guestbook-text').count(), 0);
    await changeActor('reader'); await page.locator('.guestbook-empty').waitFor(); assert.equal(signups, 1);
    await changeActor('admin'); await page.locator('.guestbook-post.is-private').waitFor();
    assert.equal(await page.locator('.guestbook-edit').count(), 0); assert.equal(await page.locator('.guestbook-delete').count(), 1);
    await page.locator('.guestbook-body-input').fill('관리자의 인사'); await page.locator('.guestbook-save').click();
    await page.waitForFunction(() => document.querySelectorAll('.guestbook-post').length === 2);
    assert.equal(signups, 1);
    await changeActor('visitor');
    await page.locator('.guestbook-body-input').fill('공개 인사'); await page.locator('.guestbook-save').click();
    await page.waitForFunction(() => document.querySelectorAll('.guestbook-post').length === 3);
    const publicId = posts[0].id;
    await page.locator(`[data-post="${publicId}"] .guestbook-edit`).click(); posts[0].revision++;
    await page.locator('.guestbook-body-input').fill('충돌 수정'); await page.locator('.guestbook-save').click();
    await page.locator('.guestbook-status').filter({ hasText: '다른 곳에서 변경' }).waitFor();
    await page.locator('.comment-body').first().waitFor();
    assert(await page.locator('.comment-body').first().isEnabled(), 'Post failure must not disable independent comment controls');
    await page.locator('.guestbook-cancel').click();
    await changeActor('admin'); await page.locator(`[data-post="${publicId}"] .guestbook-make-private`).click();
    await page.locator(`[data-post="${publicId}"].is-private`).waitFor();
    if (width === 375) await page.evaluate(() => window.scrollTo(120, 0));
    await page.screenshot({ path: new URL(`admin-${width}.png`, out).pathname });
    assert(await page.locator('.guestbook-scroll').evaluate(el => el.scrollWidth <= el.clientWidth));
    const thumb=page.locator('.guestbook-scrollbar .photo-scroll-thumb');
    await thumb.scrollIntoViewIfNeeded();
    const thumbBox=await thumb.boundingBox(), trackBox=await page.locator('.guestbook-scrollbar .photo-scroll-track').boundingBox();
    const travel=trackBox.height-thumbBox.height;
    await page.mouse.move(thumbBox.x+thumbBox.width/2,thumbBox.y+thumbBox.height/2);
    await page.mouse.down();
    await page.mouse.move(thumbBox.x+thumbBox.width/2,thumbBox.y+thumbBox.height/2+travel*0.3,{steps:5});
    await page.mouse.up();
    assert(await page.locator('.guestbook-scroll').evaluate(el => Math.abs(el.scrollTop-(el.scrollHeight-el.clientHeight)*0.3)<3));
    await changeActor('reader');
    await page.waitForFunction(() => document.querySelectorAll('.guestbook-post').length === 1);
    assert.equal(await page.locator('.guestbook-post.is-private').count(), 0);
    await page.screenshot({ path: new URL(`reader-${width}.png`, out).pathname });
    await changeActor('visitor'); await page.locator(`[data-post="${publicId}"] .guestbook-delete`).click();
    await page.waitForFunction(id => !document.querySelector(`[data-post="${id}"]`), publicId);
    failRead = true; await page.reload(); await page.locator('.guestbook-retry').waitFor(); assert.equal(await page.locator('.guestbook-text').count(), 0);
    failRead = false; await page.locator('.guestbook-retry').click(); await page.locator('.guestbook-save').waitFor();
    posts = Array.from({ length: 6 }, (_, index) => ({ id: `page-${index}`, number: index + 1, author_id: users.other, author_name: '아주긴방문자닉네임입니다', body: '긴문구LongUnbrokenText'.repeat(50), visibility: 'public', revision: 1, created_at: '2026-09-13T01:00:00Z' }));
    await changeActor('reader'); await page.waitForFunction(() => document.querySelectorAll('.guestbook-post').length === 5);
    await page.locator('.guestbook-body-input').fill('페이지를 넘겨도 남는 초안');
    await page.getByRole('button', { name: '다음 페이지', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.guestbook-post').length === 1);
    assert.equal(await page.locator('.guestbook-body-input').inputValue(), '페이지를 넘겨도 남는 초안');
    assert(await page.locator('.guestbook-scroll').evaluate(el => el.scrollWidth <= el.clientWidth));
    await page.locator('.guestbook-scrollbar .photo-scroll-thumb').focus(); await page.keyboard.press('End');
    assert(await page.locator('.guestbook-scroll').evaluate(el => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 2));
    await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
    await page.locator('.guestbook-save').waitFor();
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('PASS: lazy anonymous identity without CAPTCHA, remembered nickname, private visibility, own edit/delete, admin private-only moderation, conflict, denied/lost writes, drafts, logout/read failure clears private DOM; desktop/mobile. Mock auth/API, actual SDK.');
} finally { await browser.close(); }
