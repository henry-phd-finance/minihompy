import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initialSettings, mockHomeSummary } from './settings-fixture.mjs';
const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const out = new URL(process.env.VERIFICATION_DIR||'../docs/verification/board-writing/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
try {
  for (const [width, dpr] of [[1000, 1], [375, 2]]) {
    const page = await browser.newPage({ viewport: { width, height: 812 }, deviceScaleFactor: dpr });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    const owner = '20ce5711-bac1-434b-a67d-86e994066b8f';
    const folder = 'd30cb4b6-c2e5-458e-b231-9fe3dcd34277';
    const second = '10000000-0000-0000-0000-000000000002';
    let posts = [], writes = 0, rejectWrite = false, failRead = false, loseResponse = false;
    let holdResponse = false, releaseResponse, responseStarted;
    const started = new Promise(resolve => { responseStarted = resolve; });
    // This isolated editor test must never visit the production central login.
    await page.addInitScript(()=>Object.defineProperty(window,'MINIHOMPY_VISITOR_IDENTITY_CONFIG',{get:()=>({enabled:false}),set:()=>{}}));
    await page.addInitScript(owner => {
      let backend;
      window.testAdmin = true;
      Object.defineProperty(window, 'MinihompyBackend', {
        set(value) { backend = value; },
        get() { return { getClient(kind) {
          const real = backend.getClient(kind);
          if (kind !== 'admin') return real;
          return {
            from: real.from.bind(real),
            rpc: async (name,args) => name==='is_minihompy_admin'?({ data: window.testAdmin, error: null }):real.rpc(name,args),
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
      if (failRead && method === 'GET') return send({ message: 'offline' }, 503);
      if (url.pathname.endsWith('/board_folders')) return send([
        { id: folder, kind: 'folder', label: '자유게시판', description: '', sort_order: 0 },
        { id: 'divider', kind: 'divider', label: '', description: '', sort_order: 1 },
        { id: second, kind: 'folder', label: '기록', description: '', sort_order: 2 },
      ]);
      assert(url.pathname.endsWith('/board_posts'), req.url());
      if (rejectWrite && method !== 'GET') return send({ message: 'permission denied', code: '42501' }, 403);
      const id = url.searchParams.get('id')?.slice(3);
      const stamp = url.searchParams.get('updated_at')?.slice(3);
      if (method === 'POST') {
        writes++;
        const fields = req.postDataJSON();
        assert.deepEqual(Object.keys(fields).sort(), ['author_name', 'body', 'folder_id', 'id', 'title', 'visibility']);
        assert(!posts.some(p => p.id === fields.id));
        const post = { ...fields, author_id: owner, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        posts.unshift(post);
        if (holdResponse) {
          responseStarted();
          await new Promise(resolve => { releaseResponse = resolve; });
        }
        if (loseResponse) { loseResponse = false; return send({message:'response lost'},503); }
        return send(post, 201);
      }
      if (method === 'PATCH') {
        const post = posts.find(p => p.id === id && p.updated_at === stamp);
        if (!post) return send(null);
        const fields = req.postDataJSON();
        assert.deepEqual(Object.keys(fields).sort(), ['body', 'folder_id', 'title', 'visibility']);
        Object.assign(post, fields, { updated_at: new Date().toISOString() }); return send(post);
      }
      if (method === 'DELETE') {
        const post = posts.find(p => p.id === id && p.updated_at === stamp);
        if (!post) return send(null);
        posts = posts.filter(p => p !== post); return send({ id: post.id });
      }
      if (id) return send(posts.find(p => p.id === id) || null);
      const selected = url.searchParams.get('folder_id')?.slice(3);
      const filtered = posts.filter(p => !selected || p.folder_id === selected);
      const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 10);
      return send(filtered.slice(offset, offset + limit), 200, { 'content-range': `${offset}-${Math.max(offset, offset + Math.min(limit, filtered.length) - 1)}/${filtered.length}` });
    });
    await mockHomeSummary(page);
    await page.route('**/functions/v1/member-writing/friend-reviews**',route=>route.fulfill({json:{items:[],next_cursor:null},headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}}));
    await page.route('**/functions/v1/member-writing/content/health',route=>route.fulfill({json:{friend_visibility_protocol:1,friend_visibility_ready:false,friend_media_ready:false,friend_summary_ready:false,friend_pages_ready:false},headers:{'access-control-allow-origin':'*'}}));
    await page.goto(`${new URL('../index.html', import.meta.url).href}#/board`);
    await page.locator('.board-write').waitFor();
    assert.equal(await page.locator('.board-empty').count(), 1);
    await page.locator('.board-write').click();
    await page.locator('#board-edit-title').fill('첫 번째 글');
    await page.locator('#board-edit-body').fill('반가워요.\n<script>window.bad=true</script>');
    await page.screenshot({ path: new URL(`editor-${width}-dpr${dpr}.png`, out).pathname });
    await page.locator('[data-menu="home"]').click();
    await page.locator('[data-menu="board"]').click();
    assert.equal(await page.locator('#board-edit-title').count(), 0);
    await page.locator('.board-write').click();
    assert.equal(await page.locator('#board-edit-title').inputValue(), '');
    await page.locator('#board-edit-title').fill('첫 번째 글');
    await page.locator('#board-edit-body').fill('반가워요.\n<script>window.bad=true</script>');
    rejectWrite = true;
    await page.locator('.board-save').click();
    await page.locator('.board-status').filter({ hasText: '입력 내용은 남아' }).waitFor();
    assert.equal(await page.locator('#board-edit-title').inputValue(), '첫 번째 글');
    rejectWrite = false;
    loseResponse = true;
    await page.locator('.board-save').click();
    await page.locator('.board-status').filter({ hasText: 'response lost' }).waitFor();
    assert.equal(posts.length,1);
    await page.locator('.board-save').click();
    await page.locator('.board-post').waitFor();
    assert.equal(writes, 1);
    assert.equal(await page.locator('.board-body script').count(), 0);
    assert.equal(await page.evaluate(() => window.bad), undefined);
    await page.screenshot({ path: new URL(`saved-${width}-dpr${dpr}.png`, out).pathname });
    await page.locator('.board-edit').click();
    await page.locator('#board-edit-title').fill('수정한 글');
    await page.locator('#board-edit-folder').selectOption(second);
    await page.locator('.board-save').click();
    await page.locator('.board-post').waitFor();
    assert.equal(posts[0].title, '수정한 글');
    assert.equal(posts[0].folder_id, second);
    await page.locator('.board-edit').click();
    posts[0].updated_at = '2099-01-01T00:00:00.000Z';
    await page.locator('#board-edit-title').fill('충돌 수정');
    await page.locator('.board-save').click();
    await page.locator('.board-status').filter({ hasText: '다른 곳에서 변경' }).waitFor();
    assert.equal(posts[0].title, '수정한 글');
    await page.locator('.board-cancel').click();
    await page.reload();
    await page.locator('.board-post-link').click();
    await page.locator('.board-delete').click();
    await page.locator('.board-empty').waitFor();
    assert.equal(posts.length, 0);
    posts = Array.from({ length: 115 }, (_, i) => ({ id: `page-${i}`, folder_id: folder, title: `글 ${i}`, author_name: '테스트', author_id: owner, body: '긴본문'.repeat(1000), created_at: '2007-06-01T00:00:00Z', updated_at: '2007-06-01T00:00:00Z' }));
    await page.locator(`[data-board-folder="${folder}"]`).click();
    await page.locator('.board-pagination [aria-label="다음 10페이지"]').click();
    await page.locator('.board-pagination [aria-label="12페이지"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.board-post-link').length === 5);
    await page.locator('.board-post-link').first().click();
    await page.locator('.board-back').click();
    await page.locator('.board-post-link').first().waitFor();
    assert.equal(await page.locator('.board-scroll').getAttribute('data-page'), '12');
    await page.locator('.board-write').click();
    await page.locator('#board-edit-title').fill('권한 변경 중');
    await page.locator('#board-edit-body').fill('늦은 응답 검사');
    holdResponse = true;
    await page.locator('.board-save').click();
    await started;
    await page.evaluate(async () => { window.testAdmin = false; await window.MinihompyAdmin.refresh(); });
    releaseResponse();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.board-save').count(),0);
    assert.equal(await page.locator('#board-edit-title').count(),0);
    assert.equal(await page.locator('.board-post').count(),0);
    assert.equal(await page.locator('.board-write').count(), 0);
    failRead = true;
    await page.locator(`[data-board-folder="${second}"]`).click();
    await page.locator('.board-status').filter({ hasText: 'offline' }).waitFor();
    assert.equal(await page.locator('.board-post-link').count(), 0);
    failRead = false;
    await page.getByRole('button', { name: '다시 조회', exact: true }).click();
    await page.locator('.board-empty').waitFor();
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: real SDK with intercepted API; create/edit/move/delete, conflicts, denied writes, draft retention, auth change, pagination, error recovery, desktop/mobile. No hosted writes.');
} finally { await browser.close(); }
