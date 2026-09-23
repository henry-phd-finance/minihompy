import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initialSettings, mockHomeSummary } from './settings-fixture.mjs';
const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const out = new URL('../docs/verification/diary-writing/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
try {
  for (const [width, dpr] of [[1000, 1], [375, 2]]) {
    const page = await browser.newPage({ viewport: { width, height: 812 }, deviceScaleFactor: dpr });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', dialog => dialog.accept());
    const owner = '20ce5711-bac1-434b-a67d-86e994066b8f', folder = 'eed35ef2-5832-49a5-9fab-f846cc2b255b', second = '10000000-0000-0000-0000-000000000002';
    let entries = [], rejectWrite = false, failRead = false, loseResponse = false;
    // This isolated editor test must never visit the production central login.
    await page.addInitScript(()=>Object.defineProperty(window,'MINIHOMPY_VISITOR_IDENTITY_CONFIG',{get:()=>({enabled:false}),set:()=>{}}));
    await page.addInitScript(owner => {
      let backend; window.testAdmin = true;
      Object.defineProperty(window, 'MinihompyBackend', {
        set(value) { backend = value; },
        get() { return { getClient(kind) {
          const real = backend.getClient(kind);
          if (kind !== 'admin') return real;
          return { from: real.from.bind(real), rpc: async () => ({ data: window.testAdmin, error: null }),
            auth: {
              getSession: async () => ({ data: { session: window.testAdmin ? { user: { id: owner } } : null } }),
              getUser: async () => ({ data: { user: { id: owner } } }), onAuthStateChange: () => ({}),
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
      if (failRead && (method === 'GET' || url.pathname.includes('/rpc/'))) return send({ message: 'offline' }, 503);
      if (url.pathname.endsWith('/diary_folders')) return send([{ id: folder, label: '나의 다이어리', sort_order: 0 }, { id: second, label: '기억', sort_order: 1 }]);
      if (url.pathname.endsWith('/diary_written_dates')) {
        const fields = req.postDataJSON();
        return send([...new Set(entries.filter(e => e.folder_id === fields.selected_folder && e.entry_date.startsWith(fields.month_start.slice(0, 7))).map(e => e.entry_date))]);
      }
      assert(url.pathname.endsWith('/diary_entries'), req.url());
      const id = url.searchParams.get('id')?.slice(3), revision = Number(url.searchParams.get('revision')?.slice(3));
      if (rejectWrite && method !== 'GET') return send({ message: 'write denied', code: '42501' }, 403);
      if (method === 'POST') {
        const fields = req.postDataJSON();
        assert.deepEqual(Object.keys(fields).sort(), ['author_name', 'body', 'entry_date', 'entry_time', 'folder_id', 'id', 'weather']);
        const entry = { ...fields, entry_time: `${fields.entry_time}:00`, revision: 1, author_id: owner, created_at: '2026-09-13T01:00:00Z' };
        entries.push(entry);
        if (loseResponse) return route.abort('failed');
        return send(entry, 201);
      }
      if (method === 'PATCH') {
        const entry = entries.find(e => e.id === id && e.revision === revision);
        if (!entry) return send(null);
        const fields = req.postDataJSON();
        assert.deepEqual(Object.keys(fields).sort(), ['body', 'entry_date', 'entry_time', 'folder_id', 'weather']);
        Object.assign(entry, fields, { revision: revision + 1, entry_time: `${fields.entry_time}:00` }); return send(entry);
      }
      if (method === 'DELETE') {
        const entry = entries.find(e => e.id === id && e.revision === revision);
        if (!entry) return send(null);
        entries = entries.filter(e => e !== entry); return send({ id });
      }
      if (id) return send(entries.find(e => e.id === id) || null);
      const selected = url.searchParams.get('folder_id')?.slice(3), date = url.searchParams.get('entry_date')?.slice(3);
      const filtered = entries.filter(e => e.folder_id === selected && e.entry_date === date).sort((a, b) => a.entry_time.localeCompare(b.entry_time) || a.id.localeCompare(b.id));
      const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 20);
      return send(filtered.slice(offset, offset + limit), 200, { 'content-range': `${offset}-${Math.max(offset, offset + Math.min(limit, filtered.length) - 1)}/${filtered.length}` });
    });
    await mockHomeSummary(page);
    await page.goto(`${new URL('../index.html', import.meta.url).href}#/diary`);
    await page.locator('.diary-empty').filter({ hasText: '등록된 일기' }).waitFor();
    await page.locator('.diary-write').click();
    await page.locator('.diary-field-entry_date').fill('2024-02-29');
    await page.locator('.diary-field-entry_time').fill('23:15');
    await page.locator('.diary-field-weather').selectOption('맑음');
    await page.locator('.diary-field-body').fill(`윤년의 기록\n\n<script>window.bad=true</script>\n${'긴문구LongUnbrokenText'.repeat(150)}`);
    await page.screenshot({ path: new URL(`editor-${width}.png`, out).pathname });
    await page.locator('[data-menu="home"]').click(); await page.locator('[data-menu="diary"]').click();
    assert.equal(await page.locator('.diary-field-entry_date').inputValue(), '2024-02-29');
    assert((await page.locator('.diary-field-body').inputValue()).includes('윤년'));
    rejectWrite = true; await page.locator('.diary-save').click();
    await page.locator('.diary-status').filter({ hasText: 'write denied' }).waitFor();
    assert.equal(entries.length, 0);
    rejectWrite = false; loseResponse = true; await page.locator('.diary-save').click();
    await page.locator('.diary-status').filter({ hasText: 'Failed to fetch' }).waitFor();
    assert.equal(entries.length, 1);
    loseResponse = false; await page.locator('.diary-save').click(); await page.locator('.diary-entry').waitFor();
    assert.equal(entries.length, 1, 'Retry must not duplicate a saved diary');
    assert.equal(await page.locator('.diary-day').count(), 29);
    assert.equal(await page.locator('.diary-day.written[data-date="2024-02-29"]').count(), 1);
    assert.equal(await page.evaluate(() => window.bad), undefined);
    assert.deepEqual(await page.evaluate(() => ({
      canvas: document.querySelector('.minihompy').offsetWidth,
      width: document.querySelector('.home-panel').offsetWidth,
      height: document.querySelector('.home-panel').offsetHeight,
      overflow: document.querySelector('.diary-scroll').scrollWidth > document.querySelector('.diary-scroll').clientWidth,
    })), { canvas: 579, width: 279, height: 240, overflow: false });
    await page.locator('.diary-scrollbar .photo-scroll-arrow.down').click();
    assert(await page.locator('.diary-scroll').evaluate(el => el.scrollTop > 0));
    await page.locator('.diary-scrollbar .photo-scroll-thumb').focus(); await page.keyboard.press('End');
    assert(await page.locator('.diary-scroll').evaluate(el => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 2));
    await page.locator('.diary-scroll').evaluate(el => { el.scrollTop = 0; });
    if (width === 375) await page.evaluate(() => window.scrollTo(120, 0));
    await page.screenshot({ path: new URL(`saved-${width}.png`, out).pathname });
    await page.locator('[data-month="1"]').click();
    await page.locator('.diary-empty').filter({ hasText: '등록된 일기' }).waitFor();
    assert.equal(await page.locator('.diary-day').count(), 31);
    await page.locator('[data-month="-1"]').click(); await page.locator('.diary-entry').waitFor();
    await page.locator('.diary-edit').click();
    await page.locator('.diary-field-folder_id').selectOption(second);
    await page.locator('.diary-field-entry_date').fill('2023-12-31');
    await page.locator('.diary-field-body').fill('이동한 일기');
    await page.locator('.diary-save').click(); await page.locator('.diary-entry').waitFor();
    assert.equal(entries[0].folder_id, second); assert.equal(entries[0].entry_date, '2023-12-31');
    assert.equal(await page.locator(`[data-diary-folder="${second}"]`).getAttribute('aria-pressed'), 'true');
    await page.locator('[data-month="1"]').click();
    await page.locator('[data-date="2024-01-31"]').waitFor();
    await page.locator('[data-month="-1"]').click(); await page.locator('.diary-entry').waitFor();
    await page.locator('.diary-edit').click(); entries[0].revision++;
    await page.locator('.diary-field-body').fill('충돌 내용'); await page.locator('.diary-save').click();
    await page.locator('.diary-status').filter({ hasText: '다른 곳에서 변경' }).waitFor();
    assert.equal(await page.locator('.diary-field-body').inputValue(), '충돌 내용');
    await page.locator('.diary-cancel').click(); await page.locator('.diary-entry').waitFor();
    await page.locator('.diary-delete').click(); await page.locator('.diary-empty').filter({ hasText: '등록된 일기' }).waitFor();
    assert.equal(entries.length, 0); assert.equal(await page.locator('.diary-day.written').count(), 0);
    entries = Array.from({ length: 21 }, (_, i) => ({ id: `entry-${String(i).padStart(2, '0')}`, folder_id: second, entry_date: '2023-12-31', entry_time: '12:00:00', weather: '', body: `일기 ${i}`, revision: 1, author_id: owner }));
    await page.locator('[data-date="2023-12-31"]').click(); await page.waitForFunction(() => document.querySelectorAll('.diary-entry').length === 20);
    await page.getByRole('button', { name: '다음 일기 페이지', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('.diary-entry').length === 1);
    await page.locator('.diary-write').click(); await page.locator('.diary-field-body').fill('로그아웃 시 삭제할 초안');
    await page.evaluate(async () => { window.testAdmin = false; await window.MinihompyAdmin.refresh(); });
    await page.waitForFunction(() => !document.querySelector('.diary-editor'));
    assert(await page.locator('.diary-write').isHidden());
    assert.equal(await page.locator('.diary-edit,.diary-delete').count(), 0);
    await page.evaluate(() => {
      for (const entry_date of ['2023-02-29', '1899-12-31', 'bad']) {
        let rejected = false;
        try { window.MinihompyDiaryRepository.validate({ entry_date, entry_time: '12:00', folder_id: 'id', weather: '', body: 'x' }); } catch { rejected = true; }
        if (!rejected) throw new Error('Invalid date accepted');
      }
    });
    failRead = true; await page.reload(); await page.locator('.diary-retry').waitFor();
    failRead = false; await page.locator('.diary-retry').click(); await page.locator('.diary-empty').filter({ hasText: '등록된 일기' }).waitFor();
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('PASS: diary create/edit/date+folder move/delete, calendar/leap year/months, drafts, denied/lost response retry, conflict, pagination, logout, errors; desktop/mobile, actual SDK with mock API.');
} finally { await browser.close(); }
