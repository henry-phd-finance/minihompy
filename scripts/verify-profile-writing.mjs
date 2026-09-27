import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mockSettings, initialProfile, mockHomeSummary } from './settings-fixture.mjs';
const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const out = new URL('../docs/verification/profile-writing/', import.meta.url); await mkdir(out, { recursive: true });
const jpg = await readFile(new URL('../assets/photos/lake.jpg', import.meta.url));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
try {
  for (const width of [1000,375]) {
    const page = await browser.newPage({ viewport: { width, height: 812 }, deviceScaleFactor: width === 375 ? 2 : 1 });
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    let row = structuredClone(initialProfile), deny = false, failRead = false, failUpload = false, loseSave = false, uploaded = 0;
    const objects = new Set();
    // This isolated editor test must never visit the production central login.
    await page.addInitScript(()=>Object.defineProperty(window,'MINIHOMPY_VISITOR_IDENTITY_CONFIG',{get:()=>({enabled:false}),set:()=>{}}));
    await page.addInitScript(() => {
      let backend; window.testAdmin = true;
      Object.defineProperty(window, 'MinihompyBackend', {
        set(value) { backend = value; }, get() { return { getClient(kind) {
          const real = backend.getClient(kind); if (kind !== 'admin') return real;
          return { from: real.from.bind(real), storage: real.storage, rpc: async () => ({ data: window.testAdmin }), auth: {
            getSession: async () => ({ data: { session: window.testAdmin ? { user: { id: 'owner' } } : null } }),
            getUser: async () => ({ data: { user: { id: 'owner' } } }), onAuthStateChange: () => ({}),
          } };
        } }; },
      });
    });
    await mockSettings(page);
    await page.route('**/rest/v1/minihompy_profile*', route => {
      const req = route.request();
      if (req.method() === 'PATCH') {
        if (deny) return route.fulfill({ status: 403, json: { message: 'denied' } });
        if (new URL(req.url()).searchParams.get('revision') !== `eq.${row.revision}`) return route.fulfill({ json: null });
        row = { ...row, ...req.postDataJSON(), revision: row.revision + 1 };
        if (loseSave) { loseSave = false; return route.fulfill({ status: 503, json: { message: 'lost response' } }); }
        return route.fulfill({ json: row });
      }
      return failRead ? route.fulfill({ status: 503, json: { message: 'offline' } }) : route.fulfill({ json: [row] });
    });
    await page.route('**/storage/v1/object/**', route => {
      const req = route.request(), path = new URL(req.url()).pathname.split('/').at(-1);
      if (req.method() === 'POST') {
        if (failUpload) return route.fulfill({ status: 400, json: { message: 'upload failed', statusCode: '400' } });
        if (objects.has(path)) return route.fulfill({ status: 409, json: { message: 'exists', statusCode: '409' } });
        objects.add(path); uploaded++; return route.fulfill({ json: { Key: path } });
      }
      if (req.method() === 'DELETE') return route.fulfill({ json: [] });
      return route.fulfill({ contentType: 'image/jpeg', body: jpg });
    });
    await mockHomeSummary(page);
    await page.goto(`${new URL('../index.html', import.meta.url).href}#/profile`);
    await page.locator('.profile-edit').waitFor();
    await page.locator('.profile-edit').click();
    assert(await page.locator('#profile-edit-name').isDisabled());
    await page.locator('[data-profile-inherit="name"]').uncheck();
    await page.locator('#profile-edit-name').fill('프로필 이름');
    await page.locator('[data-profile-inherit="paragraphs"]').uncheck();
    await page.locator('#profile-edit-paragraphs').fill('<script>문자 그대로</script>\n\n두 번째 문단');
    await page.locator('#profile-edit-file').setInputFiles({ name: 'lake.jpg', mimeType: 'image/jpeg', buffer: jpg });
    assert.equal(uploaded,0);
    assert.match(await page.locator('.profile-edit-preview').getAttribute('src'), /^blob:/);
    await page.locator('[data-menu="home"]').click(); await page.locator('[data-menu="profile"]').click();
    assert.equal(await page.locator('#profile-edit-name').count(),0);
    await page.locator('.profile-edit').click();
    await page.locator('[data-profile-inherit="name"]').uncheck();
    await page.locator('#profile-edit-name').fill('프로필 이름');
    await page.locator('[data-profile-inherit="paragraphs"]').uncheck();
    await page.locator('#profile-edit-paragraphs').fill('<script>문자 그대로</script>\n\n두 번째 문단');
    await page.locator('#profile-edit-file').setInputFiles({ name: 'lake.jpg', mimeType: 'image/jpeg', buffer: jpg });

    await page.locator('.profile-content-scroll').evaluate(e => { e.scrollTop = 0; });
    await page.evaluate(w => window.scrollTo(w === 375 ? 145 : 0,0),width);
    await page.screenshot({ path: new URL(`editor-${width}.png`,out).pathname });
    failUpload = true; await page.locator('.profile-save').click();
    await page.locator('[role="status"]').filter({ hasText: 'upload failed' }).waitFor();
    assert.equal(await page.locator('#profile-edit-name').inputValue(),'프로필 이름');
    failUpload = false; deny = true; await page.locator('.profile-save').click();
    await page.locator('[role="status"]').filter({ hasText: '저장 결과' }).waitFor();
    deny = false; loseSave = true; await page.locator('.profile-save').click();
    await page.waitForFunction(() => !document.querySelector('.profile-save').disabled);
    assert.equal(row.name,'프로필 이름');
    await page.locator('.profile-save').click();
    await page.locator('.profile-edit').waitFor();
    assert.equal(uploaded,1);
    assert.equal(row.revision,2);
    assert.equal(await page.locator('.profile-introduction-paragraph').count(),2);
    assert.equal(await page.locator('.profile-introduction script').count(),0);
    await page.screenshot({ path: new URL(`saved-${width}.png`,out).pathname });
    await page.reload(); await page.locator('.profile-edit').waitFor();
    assert.equal(await page.locator('.profile-introduction-name').textContent(),'프로필 이름');
    await page.locator('.profile-edit').click();
    await page.locator('#profile-edit-name').fill('충돌 초안'); row.revision++;
    await page.locator('.profile-save').click();
    await page.locator('[role="status"]').filter({ hasText: '다른 곳' }).waitFor();
    assert.equal(await page.locator('#profile-edit-name').inputValue(),'충돌 초안');
    await page.getByRole('button',{name:'다시 불러오기',exact:true}).click(); await page.locator('.profile-edit').waitFor();
    await page.locator('.profile-edit').click();
    await page.getByRole('button',{name:'사진 없애기',exact:true}).click();
    await page.locator('[data-profile-inherit="name"]').check();
    await page.locator('[data-profile-inherit="paragraphs"]').check();
    await page.locator('.profile-save').click(); await page.locator('.profile-edit').waitFor();
    assert.equal(row.name,null); assert.equal(row.paragraphs,null); assert.equal(row.image_path,'');
    assert.equal(await page.locator('.profile-introduction-image').count(),0);
    await page.locator('.profile-edit').click();
    await page.locator('#profile-edit-file').setInputFiles({name:'unsafe.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});
    await page.locator('[role="status"]').filter({hasText:'6MB'}).waitFor();
    await page.evaluate(async () => { window.testAdmin = false; await window.MinihompyAdmin.refresh(); });
    assert.equal(await page.locator('.profile-editor').count(),0); assert.equal(await page.locator('.profile-edit').count(),0);
    assert.equal(await page.evaluate(async () => { try { await window.MinihompyProfileRepository.save({image_path:'',image_alt:'',image_width:192,name:null,paragraphs:null,revision:1}); return false; } catch { return true; } }),true);
    for (const section of ['keywords','history','questions','information']) {
      await page.locator(`[data-profile-section="${section}"]`).click(); assert.equal(await page.locator('.profile-content-scroll > *').count(),0);
    }
    failRead = true;
    await page.locator('[data-menu="home"]').click(); await page.locator('[data-menu="profile"]').click();
    await page.locator('[data-profile-section="introduction"]').click();
    await page.locator('[role="status"]').filter({hasText:'불러오지 못했습니다'}).waitFor();
    failRead = false; await page.getByRole('button',{name:'다시 불러오기',exact:true}).click(); await page.locator('.profile-introduction').waitFor();
    assert(await page.locator('.profile-content-scroll').evaluate(e=>e.scrollWidth<=e.clientWidth));
    assert.deepEqual(errors,[]); await page.close();
  }
  console.log('PASS: profile edit, upload preview/retry, save response loss, CAS, drafts, inheritance, removal, permission loss, read failure/retry, empty sections, desktop/mobile. Mock API with real SDK.');
} finally { await browser.close(); }
