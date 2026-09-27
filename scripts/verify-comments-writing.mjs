import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initialSettings } from './settings-fixture.mjs';
const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const out = new URL('../docs/verification/comments/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
try {
  for (const [width, dpr] of [[1000, 1], [375, 2]]) {
    const page = await browser.newPage({ viewport: { width, height: 812 }, deviceScaleFactor: dpr });
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    const users = { admin: '20ce5711-bac1-434b-a67d-86e994066b8f', visitor: '10000000-0000-0000-0000-000000000002', other: '10000000-0000-0000-0000-000000000003' };
    const folder = '20000000-0000-0000-0000-000000000001';
    const ids = { board: '30000000-0000-0000-0000-000000000001', photos: '30000000-0000-0000-0000-000000000002', diary: '30000000-0000-0000-0000-000000000003', guestbook: '30000000-0000-0000-0000-000000000004' };
    const columns = { board: 'board_post_id', photos: 'photo_post_id', diary: 'diary_entry_id', guestbook: 'guestbook_post_id' };
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
    const base = { folder_id: folder, author_id: users.admin, author_name: '주인', revision: 1, title: '제목', body: '본문', created_at: '2026-09-13T01:00:00Z', updated_at: '2026-09-13T01:00:00Z' };
    const parents = {
      board_posts: { ...base, id: ids.board },
      photo_posts: { ...base, id: ids.photos, body: [{ type: 'text', text: '사진 글' }] },
      diary_entries: { ...base, id: ids.diary, entry_date: today, entry_time: '12:00:00', weather: '맑음' },
      guestbook_posts: { ...base, id: ids.guestbook, number: 1, visibility: 'public' },
    };
    let actor = 'reader', signups = 0, comments = [], rejectWrite = false, lostResponse = false, failRead = false;
    await page.exposeFunction('recordSignup', () => { signups++; actor = 'visitor'; });
    await page.addInitScript(users => {
      Object.defineProperty(window, 'MINIHOMPY_VISITOR_IDENTITY_CONFIG', { get: () => ({enabled:false}), set: () => {} });
      let backend; window.testActor = 'reader';
      Object.defineProperty(window, 'MinihompyBackend', {
        set(value) { backend = value; },
        get() { return { getClient(kind) {
          const real = backend.getClient(kind);
          const uid = () => kind === 'admin' ? (window.testActor === 'admin' ? users.admin : null) : (window.testActor !== 'admin' ? users[window.testActor] : null);
          return { from: real.from.bind(real), storage: real.storage,
            rpc: async (name, args) => name === 'is_minihompy_admin' ? { data: kind === 'admin' && window.testActor === 'admin', error: null } : real.rpc(name, args),
            auth: {
              getSession: async () => ({ data: { session: uid() ? { user: { id: uid() } } : null } }),
              getUser: async () => ({ data: { user: uid() ? { id: uid() } : null } }),
              onAuthStateChange: () => ({}),
              signInAnonymously: async options => {
                if (options !== undefined) throw new Error('Unexpected CAPTCHA');
                await window.recordSignup(); window.testActor = 'visitor'; return { error: null };
              },
            },
          };
        } }; },
      });
    }, users);
    const visibleParent = row => row && (row.visibility !== 'private' || row.author_id === users[actor] || actor === 'admin');
    const visibleComment = row => Object.entries(columns).some(([kind, col]) => row[col] === ids[kind] && visibleParent(parents[{ board: 'board_posts', photos: 'photo_posts', diary: 'diary_entries', guestbook: 'guestbook_posts' }[kind]]));
    await page.route('https://itkymmxnbjylyzbmdxdb.supabase.co/**', async route => {
      const req = route.request(), url = new URL(req.url()), method = req.method(), table = url.pathname.split('/').at(-1);
      const send = (json, status = 200, headers = {}) => route.fulfill({ status, json, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', ...headers } });
      if (table === 'minihompy_settings') return send([{ payload: initialSettings, revision: 1 }]);
      if (table.endsWith('_folders')) return send([{ id: folder, kind: 'folder', label: '기록', description: '기록', sort_order: 0 }]);
      if (table === 'diary_written_dates') return send([today]);
      const id = url.searchParams.get('id')?.slice(3), revision = Number(url.searchParams.get('revision')?.slice(3));
      if (Object.hasOwn(parents, table)) {
        const parent = parents[table];
        if (method === 'PATCH' && table === 'guestbook_posts') { assert.equal(actor, 'admin'); Object.assign(parent, req.postDataJSON(), { revision: parent.revision + 1 }); return send(parent); }
        assert.equal(method, 'GET');
        if (id) return send(id === parent?.id && visibleParent(parent) ? parent : null);
        const items = visibleParent(parent) ? [parent] : [];
        return send(items, 200, { 'content-range': `0-0/${items.length}` });
      }
      assert.equal(table, 'post_comments', req.url());
      if (failRead && method === 'GET') return send({ message: 'offline' }, 503);
      if (rejectWrite && method !== 'GET') return send({ message: 'write denied', code: '42501' }, 403);
      if (method === 'POST') {
        const fields = req.postDataJSON(), target = Object.values(columns).filter(col => fields[col]);
        assert.equal(target.length, 1); assert.deepEqual(Object.keys(fields).sort(), ['author_name', 'body', 'id', target[0]].sort());
        const comment = { ...fields, author_id: users[actor], revision: 1, created_at: new Date().toISOString() };
        assert(comment.author_id && visibleComment(comment)); comments.push(comment);
        if (lostResponse) return route.abort('failed'); return send(comment, 201);
      }
      if (method === 'PATCH' || method === 'DELETE') {
        const row = comments.find(c => c.id === id && c.revision === revision && visibleComment(c) && (c.author_id === users[actor] || (method === 'DELETE' && actor === 'admin')));
        if (!row) return send(null);
        if (method === 'DELETE') { comments = comments.filter(c => c !== row); return send({ id }); }
        assert.deepEqual(Object.keys(req.postDataJSON()), ['body']); Object.assign(row, req.postDataJSON(), { revision: revision + 1 }); return send(row);
      }
      if (id) return send(comments.find(c => c.id === id && visibleComment(c)) || null);
      const field = Object.values(columns).find(col => url.searchParams.has(col));
      const filtered = comments.filter(c => c[field] === url.searchParams.get(field).slice(3) && visibleComment(c));
      const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 20);
      return send(filtered.slice(offset, offset + limit), 200, { 'content-range': `${offset}-${Math.max(offset, offset + Math.min(limit, filtered.length) - 1)}/${filtered.length}` });
    });
    async function navigate(kind) {
      await page.locator(`[data-menu="${kind}"]`).click();
      if (kind === 'board') {
        await page.locator('.board-post,.board-post-link').first().waitFor();
        if (await page.locator('.board-post-link').count()) await page.locator('.board-post-link').click();
      }
      await page.locator('.comment-body').waitFor();
    }
    async function changeActor(next) {
      actor = next;
      await page.evaluate(async next => { window.testActor = next; await window.MinihompyAdmin.refresh(); window.dispatchEvent(new StorageEvent('storage', { key: null })); }, next);
    }
    await page.goto(`${new URL('../index.html', import.meta.url).href}#/board`);
    await page.locator('.board-post-link').click(); await page.locator('.comment-body').waitFor(); assert.equal(signups, 0);
    await page.locator('.comment-name').fill('방문객'); await page.locator('.comment-body').fill('첫 댓글 <script>window.bad=true</script>');
    await page.locator('[data-menu="home"]').click(); await navigate('board');
    assert.equal(await page.locator('.comment-body').inputValue(), '');
    await page.locator('.comment-name').fill('방문객'); await page.locator('.comment-body').fill('첫 댓글 <script>window.bad=true</script>');
    rejectWrite = true; await page.locator('.comment-save').click(); await page.locator('.comment-status').filter({ hasText: 'write denied' }).waitFor();
    assert.equal(signups, 1); assert.equal(comments.length, 0);
    rejectWrite = false; lostResponse = true; await page.locator('.comment-save').click(); await page.locator('.comment-status').filter({ hasText: 'Failed to fetch' }).waitFor(); assert.equal(comments.length, 1);
    lostResponse = false; await page.locator('.comment-save').click(); await page.locator('[data-comment]').waitFor();
    assert.equal(comments.length, 1); assert.equal(await page.evaluate(() => window.bad), undefined);
    assert.match(await page.locator('.photo-comment-date').textContent(), /^\(\d{2}\.\d{2} \d{2}:\d{2}\)$/);
    for (const kind of ['photos', 'diary', 'guestbook']) {
      await navigate(kind); assert.equal(await page.locator('.comment-name').inputValue(), '방문객');
      await page.locator('.comment-body').fill('discard comment');
      await page.locator('[data-menu=home]').click(); await navigate(kind);
      assert.equal(await page.locator('.comment-body').inputValue(), '');
      await page.locator('.comment-body').fill(`${kind} 댓글`); await page.locator('.comment-save').click(); await page.locator('[data-comment]').waitFor();
      assert.equal(comments.at(-1)[columns[kind]], ids[kind]);
      if (width === 375) await page.evaluate(() => window.scrollTo(120, 0));
      await page.locator('[data-comment]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: new URL(`${kind}-${width}.png`, out).pathname });
      assert(await page.locator('.comments-widget').evaluate(el => el.scrollWidth <= el.clientWidth));
    }
    assert.equal(signups, 1);
    await navigate('photos'); await page.locator('.comment-edit').click(); await page.locator('.comment-body').fill('수정한 댓글');
    await page.locator('.comment-save').click(); await page.locator('[data-comment]').filter({ hasText: '수정한 댓글' }).waitFor();
    await page.locator('.comment-edit').click(); comments.find(c => c.photo_post_id).revision++;
    await page.locator('.comment-body').fill('충돌'); await page.locator('.comment-save').click(); await page.locator('.comment-status').filter({ hasText: '댓글이 변경' }).waitFor();
    assert.equal(await page.locator('.comment-body').inputValue(), '충돌');
    await page.locator('.comment-cancel').click(); await page.locator('.comment-reload').click(); await page.locator('.comment-delete').waitFor();
    await page.locator('.comment-delete').click(); await page.waitForFunction(() => !document.querySelector('[data-comment]'));
    await changeActor('admin'); await navigate('guestbook');
    assert.equal(await page.locator('.comment-edit').count(), 0); assert.equal(await page.locator('.comment-delete').count(), 1);
    await page.locator('.guestbook-make-private').click(); await page.locator('.guestbook-post.is-private [data-comment]').waitFor();
    await changeActor('visitor'); await page.locator('.guestbook-empty').waitFor(); assert.equal(await page.locator('[data-comment]').count(), 0);
    const hidden = await page.evaluate(async id => { try { await window.MinihompyCommentsRepository.list('guestbook', id, 1, 20); return false; } catch { return true; } }, ids.guestbook);
    assert(hidden);
    await changeActor('admin'); await page.locator('.comment-delete').waitFor(); await page.locator('.comment-delete').click(); await page.waitForFunction(() => !document.querySelector('[data-comment]'));
    await navigate('board'); failRead = true; await page.locator('.comment-reload').click(); await page.locator('.comment-retry').waitFor();
    assert.equal(await page.locator('[data-comment]').count(), 0); assert.equal(await page.locator('.comment-body').count(), 0);
    failRead = false; await page.locator('.comment-retry').click(); await page.locator('[data-comment]').waitFor();
    comments = Array.from({ length: 21 }, (_, i) => ({ id: `page-${i}`, board_post_id: ids.board, author_id: users.other, author_name: '긴닉네임입니다', body: '긴문구LongText'.repeat(70), revision: 1, created_at: '2026-09-13T01:00:00Z' }));
    await page.locator('.comment-reload').click(); await page.waitForFunction(() => document.querySelectorAll('[data-comment]').length === 20);
    await page.locator('.comment-next').click(); await page.waitForFunction(() => document.querySelectorAll('[data-comment]').length === 1);
    await page.locator('.comment-body').fill('역할 변경 시 지울 초안'); await changeActor('reader'); await page.locator('.comment-body').waitFor();
    assert.equal(await page.locator('.comment-body').inputValue(), ''); assert.equal(await page.locator('.comment-delete,.comment-edit').count(), 0);
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('PASS: comments on all four real views, shared nickname/one anonymous identity, no CAPTCHA, drafts, failed/lost writes, retry dedup, ownership/edit/delete/conflicts, private parent access loss, admin moderation, pagination, read errors, desktop/mobile. Mock API/Auth, actual SDK.');
} finally { await browser.close(); }
