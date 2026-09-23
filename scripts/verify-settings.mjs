import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initialSettings, mockHomeSummary } from './settings-fixture.mjs';
const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const out = new URL('../docs/verification/settings/', import.meta.url); await mkdir(out,{recursive:true});
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
try {
  for (const [width,dpr] of [[1000,1],[375,2]]) {
    const page = await browser.newPage({viewport:{width,height:812},deviceScaleFactor:dpr});
    const errors=[]; page.on('pageerror',e=>errors.push(e.message)); page.on('dialog',d=>d.accept());
    let payload=structuredClone(initialSettings),revision=1, fail=false, deny=false;
    // This isolated editor test must never visit the production central login.
    await page.addInitScript(()=>Object.defineProperty(window,'MINIHOMPY_VISITOR_IDENTITY_CONFIG',{get:()=>({enabled:false}),set:()=>{}}));
    await page.addInitScript(()=>{
      let backend; window.testAdmin=true;
      Object.defineProperty(window,'MinihompyBackend',{
        set(value){backend=value;},get(){return {getClient(kind){
          const real=backend.getClient(kind); if(kind!=='admin')return real;
          return {from:real.from.bind(real),rpc:async()=>({data:window.testAdmin}),auth:{
            getSession:async()=>({data:{session:window.testAdmin?{user:{id:'owner'}}:null}}),
            getUser:async()=>({data:{user:{id:'owner'}}}),onAuthStateChange:()=>({}),
          }};
        }};}
      });
    });
    await page.route('**/rest/v1/minihompy_settings*',route=>{
      const request=route.request(),url=new URL(request.url());
      if(fail)return route.fulfill({status:503,json:{message:'offline'}});
      if(request.method()==='PATCH'){
        if(deny)return route.fulfill({status:403,json:{message:'denied'}});
        if(url.searchParams.get('revision')!==`eq.${revision}`)return route.fulfill({json:null});
        payload=request.postDataJSON().payload; revision++;
        return route.fulfill({json:{payload,revision}});
      }
      return route.fulfill({json:[{payload,revision}]});
    });
    await page.route('**/rest/v1/board_*',route=>route.fulfill({json:[],headers:{'content-range':'*/0','access-control-expose-headers':'content-range'}}));
    await mockHomeSummary(page);
    await page.goto(`${new URL('../index.html',import.meta.url).href}#/settings`);
    await page.locator('.settings-form').waitFor();
    assert.equal(await page.locator('.page-tab').last().getAttribute('data-menu'),'settings');
    assert.equal(await page.locator('[data-menu="settings"]').count(),1);
    await page.locator('#setting-page-title').fill('discard settings');
    await page.locator('[data-menu=home]').click(); await page.locator('[data-menu=settings]').click();
    assert.equal(await page.locator('#setting-page-title').inputValue(), initialSettings.page.title);
    await page.locator('#setting-page-title').fill('새 미니홈피');
    await page.locator('.settings-save').click();
    await page.getByRole('status').filter({hasText:'저장했습니다.'}).waitFor();
    assert.equal(payload.page.title,'새 미니홈피');
    assert.equal(await page.locator('.homepage-title').textContent(),'새 미니홈피');
    assert.equal(await page.locator('[data-view-slot="main"]').getAttribute('data-view'),'settings');
    await page.screenshot({path:new URL(`basic-${width}-dpr${dpr}.png`,out).pathname});
    await page.locator('[data-settings-section="profile"]').click();
    await page.locator('#setting-profile-name').fill('새 이름');
    await page.locator('#setting-profile-introduction').fill('<script>안녕하세요</script>');
    deny=true; await page.locator('.settings-save').click();
    await page.getByRole('status').filter({hasText:'저장 결과'}).waitFor();
    assert.equal(await page.locator('#setting-profile-name').inputValue(),'새 이름');
    deny=false; revision++; await page.locator('.settings-save').click();
    await page.getByRole('status').filter({hasText:'다른 곳에서 변경'}).waitFor();
    await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.settings-save')?.disabled);
    assert.equal(await page.locator('#setting-profile-name').inputValue(),initialSettings.profile.name);
    await page.locator('#setting-profile-name').fill('새 이름');
    await page.locator('.settings-save').click();
    await page.getByRole('status').filter({hasText:'저장했습니다.'}).waitFor();
    await page.locator('[data-settings-section="home"]').click();
    assert.equal(await page.locator('#setting-home-today, #setting-home-total').count(),0);
    await page.locator('#setting-home-recentEmptyLines-0').fill('새 소식');
    await page.locator('.settings-save').click();
    await page.getByRole('status').filter({hasText:'저장했습니다.'}).waitFor();
    assert.equal(payload.home.today,initialSettings.home.today);
    await page.locator('[data-settings-section="menus"]').click();
    assert.equal(await page.locator('[data-setting-menu="settings"]').count(),0);
    for(const checkbox of await page.locator('.settings-menu-row input[type="checkbox"]').all())await checkbox.check();
    await page.locator('[data-setting-menu="home"] input:not([type="checkbox"])').fill('아주아주긴홈메뉴표시이름입니다');
    await page.locator('[data-setting-menu="guestbook"] .settings-order').first().click();
    await page.locator('.settings-save').click();
    await page.getByRole('status').filter({hasText:'저장했습니다.'}).waitFor();
    assert.equal(await page.locator('.page-tab').count(),10);
    assert.equal(await page.locator('.page-tab').last().getAttribute('data-menu'),'settings');
    assert(await page.locator('[data-menu="home"] .tab-label').evaluate(e=>e.classList.contains('text-clipped')));
    const geometry=await page.locator('.page-tab').evaluateAll(elements=>elements.map(e=>({top:e.getBoundingClientRect().top,height:e.getBoundingClientRect().height})));
    const scale=await page.locator('.minihompy').evaluate(e=>e.getBoundingClientRect().width/e.offsetWidth);
    assert.equal(geometry[9].top,234*scale); assert.equal(geometry[9].height,18*scale);
    assert(await page.locator('.settings-scroll').evaluate(e=>e.scrollWidth<=e.clientWidth));
    await page.screenshot({path:new URL(`menus-${width}-dpr${dpr}.png`,out).pathname});
    if(width<579){await page.evaluate(()=>scrollTo(1000,0));await page.screenshot({path:new URL(`menus-right-${width}-dpr${dpr}.png`,out).pathname});}
    for(const checkbox of await page.locator('.settings-menu-row input[type="checkbox"]').all())await checkbox.uncheck();
    await page.locator('.settings-save').click();
    await page.getByRole('status').filter({hasText:'저장했습니다.'}).waitFor();
    assert.equal(await page.locator('.page-tab').count(),1);
    assert.equal(await page.locator('.page-tab').getAttribute('data-menu'),'settings');
    await page.reload(); await page.locator('.settings-form').waitFor();
    assert.equal(await page.locator('.page-tab').count(),1);
    await page.evaluate(async()=>{window.testAdmin=false;await window.MinihompyAdmin.refresh();});
    assert.equal(await page.locator('.page-tab').count(),0);
    assert.equal(await page.locator('.settings-form').count(),0);
    await page.evaluate(()=>window.MinihompyApp.renderView('settings'));
    assert.equal(await page.locator('.settings-form').count(),0);
    payload=structuredClone(initialSettings);
    await page.evaluate(()=>window.MinihompySettings.load());
    await page.locator('[data-menu="home"]').waitFor();
    assert.equal(await page.locator('[data-menu="settings"]').count(),0);
    fail=true; await page.evaluate(()=>window.MinihompySettings.load());
    assert.equal(await page.locator('.page-tab').count(),0);
    assert.equal(await page.locator('.homepage-title').textContent(),'');
    await page.evaluate(async()=>{window.testAdmin=true;await window.MinihompyAdmin.refresh();});
    assert.equal(await page.locator('.page-tab').getAttribute('data-menu'),'settings');
    assert.equal(await page.locator('.settings-form').count(),0);
    fail=false; await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();
    await page.locator('.settings-form').waitFor();
    assert.equal(await page.locator('.page-tab').last().getAttribute('data-menu'),'settings');
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('PASS: DB settings load/save/error/conflict; administrator-only immutable last tab; 10-tab geometry; all hidden; logout/direct URL; no fallback; desktop/mobile. API mocked.');
}finally{await browser.close();}
