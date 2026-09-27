import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initialSettings, mockSettings } from './settings-fixture.mjs';
const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const out = resolve(process.argv[3] || 'docs/verification/settings-navigation'); await mkdir(out,{recursive:true});
const entry = new URL('../index.html',import.meta.url).href;
const item = id => structuredClone(initialSettings.menus.find(menu=>menu.id===id));
const cases = [
  ['current',initialSettings.menus],
  ['three',['home','photos','guestbook'].map(item)],
  ['reordered',['guestbook','photos'].map(item)],
  ['allhidden',initialSettings.menus.map(menu=>({...menu,visible:false}))],
  ['nine',initialSettings.menus.map(menu=>({...menu,visible:true}))],
];
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
try {
  for(const width of [579,1280,375])for(const [name,menus] of cases){
    const page=await browser.newPage({viewport:{width,height:812},deviceScaleFactor:1});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>Object.defineProperty(window,'MINIHOMPY_VISITOR_IDENTITY_CONFIG',{get:()=>({enabled:false}),set:()=>{}}));
    await page.route('https://**',route=>route.abort());
    await mockSettings(page,{...structuredClone(initialSettings),menus});
    await page.route('**/rest/v1/board_*',route=>route.fulfill({json:[],headers:{'content-range':'*/0','access-control-expose-headers':'content-range'}}));
    await page.goto(`${entry}#/invalid`);
    await page.waitForFunction(()=>window.MinihompySettings.status==='ready');
    const ids=menus.filter(menu=>menu.visible).map(menu=>menu.id);
    assert.deepEqual(await page.locator('.page-tab').evaluateAll(nodes=>nodes.map(n=>n.dataset.menu)),ids);
    assert.equal(await page.locator('[data-menu="settings"]').count(),0);
    const geometry=await page.locator('.page-tab').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x+scrollX,y:r.y,width:r.width,height:r.height};}));
    const scale=width>=1125?1.875:1;
    geometry.forEach((r,i)=>assert.deepEqual(r,{x:432*scale,y:(73+(i?17+(i-1)*18:0))*scale,width:31*scale,height:(i?18:17)*scale}));
    for(const id of ids){
      await page.locator(`[data-menu="${id}"]`).click();
      assert.equal(await page.locator('[data-view-slot="left"]').getAttribute('data-view'),id);
      assert.equal(await page.locator('[data-view-slot="main"]').getAttribute('data-view'),id);
      assert.equal(await page.locator('.page-tabs [aria-current="page"]').getAttribute('data-menu'),id);
      assert.equal(await page.locator('.home-scrollbar').isVisible(),id==='home');
    }
    if(ids.length>1){
      await page.locator(`[data-menu="${ids[0]}"]`).click();
      await page.locator(`[data-menu="${ids[1]}"]`).focus();await page.keyboard.press('Enter');
      await page.goBack();assert.equal(await page.evaluate(()=>window.MinihompyApp.currentView),ids[0]);
      await page.goForward();assert.equal(await page.evaluate(()=>window.MinihompyApp.currentView),ids[1]);
      await page.reload();await page.waitForFunction(()=>window.MinihompySettings.status==='ready');
      assert.equal(await page.evaluate(()=>window.MinihompyApp.currentView),ids[1]);
    }else assert.equal(await page.evaluate(()=>window.MinihompyApp.currentView),null);
    await page.evaluate(()=>window.MinihompyApp.renderView('settings'));
    assert.notEqual(await page.evaluate(()=>window.MinihompyApp.currentView),'settings');
    if(width===375){await page.evaluate(()=>scrollTo(1000,0));assert.equal(await page.evaluate(()=>scrollX),204);}
    assert.deepEqual(errors,[]);await page.close();
  }
  const page=await browser.newPage({viewport:{width:579,height:349},deviceScaleFactor:1});
  const reference=structuredClone(initialSettings);
  reference.page={title:'님의 미니홈피',browserTitle:'미니홈피'};
  reference.profile={name:'정',introduction:'자기소개가 없습니다.',detail:'(성)'};
  reference.menus=['home','profile','diary','music','photos','gallery','board','video','guestbook'].map(id=>({...item(id),visible:true}));
  await page.addInitScript(()=>Object.defineProperty(window,'MINIHOMPY_VISITOR_IDENTITY_CONFIG',{get:()=>({enabled:false}),set:()=>{}}));
  await mockSettings(page,reference);await page.goto(entry);
  await page.waitForFunction(()=>window.MinihompySettings.status==='ready');await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>{document.querySelector('#login-auth-toggle').parentElement.textContent='로그아웃';});
  const png=await page.screenshot({path:resolve(out,'reference-home.png')});
  const referencePng=await readFile(new URL('../docs/verification/step7/579x349.png',import.meta.url));
  // Typography changed intentionally. Keep the original frame/binder baseline.
  const frameMatches=await page.evaluate(async urls=>{
    const canvases=[];
    for(const src of urls){const img=new Image();img.src=src;await img.decode();const canvas=document.createElement('canvas');canvas.width=579;canvas.height=349;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);canvases.push(ctx);}
    for(const [x,y,w,h] of [[7,20,560,12],[19,32,435,20],[19,310,435,33],[147,70,8,235],[26,50,8,258]]){
      const a=canvases[0].getImageData(x,y,w,h).data,b=canvases[1].getImageData(x,y,w,h).data;
      // Chromium curve antialiasing differs by up to 3/255 on four baseline pixels.
      // Keep geometry exact and allow at most eight such edge pixels per region.
      let edges=0;for(let i=0;i<a.length;i+=4){const deltas=[0,1,2,3].map(k=>Math.abs(a[i+k]-b[i+k]));if(deltas.some(d=>d>3))return false;if(deltas.some(Boolean))edges++;}
      if(edges>8)return false;
    }
    return true;
  },[png,referencePng].map(buffer=>`data:image/png;base64,${buffer.toString('base64')}`));
  assert(frameMatches);
  console.log('PASS: 15 DB-backed menu scenarios, contiguous fixed geometry, hidden menus, settings access denied, keyboard/history/reload, HOME frame/binder reference pixels (text excluded).');
}finally{await browser.close();}
