import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])));
const root=new URL('../',import.meta.url), id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const own={id:id(1),site_id:id(101),handle:'alice',display_name:'동명',homepage_url:'https://fixture.test/home/'};
const other={...own,id:id(2),site_id:id(102),handle:'bob',homepage_url:'https://target.test/home/'};
const third={...other,id:id(3),site_id:id(103),handle:'charlie'};
const html=(await readFile(new URL('index.html',root),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
try{
 for(const width of [1280,375]){
  const page=await browser.newPage({viewport:{width,height:820},hasTouch:width===375});let mode='normal',release,held=false;const calls=[],errors=[];
  page.setDefaultTimeout(10000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='central.test'){
    calls.push(u);let body;
    if(u.pathname.endsWith('/random'))body={item:mode==='empty'?null:mode==='self'?own:mode==='unsafe'?{...other,homepage_url:'javascript:alert(1)'}:other};
    else body=mode==='empty'?{items:[],next_cursor:null}:u.searchParams.has('after')?{items:[third],next_cursor:null}:u.searchParams.get('q')?{items:[{...other,handle:u.searchParams.get('q')}],next_cursor:null}:{items:[own,other],next_cursor:other.id};
    const fail=mode==='offline';if(mode==='hold'){held=true;await new Promise(r=>release=r);}
    return route.fulfill({status:fail?503:200,json:fail?{error:'unavailable'}:body}).catch(()=>{});
   }
   if(u.hostname==='target.test')return route.fulfill({contentType:'text/html',body:'arrived'});
   const path=u.pathname.slice('/home/'.length)||'index.html';
   if(path==='index.html')return route.fulfill({contentType:'text/html',body:html});
   const ext=extname(path);try{return route.fulfill({contentType:ext==='.js'?'text/javascript':ext==='.css'?'text/css':ext==='.png'?'image/png':undefined,body:await readFile(new URL(path,root))});}catch{return route.abort();}
  });
  await page.goto('https://fixture.test/home/');
  await page.evaluate(own=>{window.MINIHOMPY_VISITOR_IDENTITY_CONFIG={enabled:true,siteId:own.site_id,centralApiUrl:'https://central.test',navigationTimeoutMs:1000};window.MinihompySharedIdentity={state:{status:'unverified'}};window.MINIHOMPY_VIEWS={};},own);
  for(const file of ['member-navigation.js','views/home.js','surf-navigation.js'])await page.addScriptTag({url:file});
  await page.evaluate(()=>document.querySelector('[data-view-slot="left"]').append(window.MINIHOMPY_VIEWS.home.createLeft()));
  async function waitHeld(){const deadline=Date.now()+5000;while(!held){if(Date.now()>deadline)throw Error('Request not started: '+JSON.stringify({mode,calls:calls.map(u=>u.href),status:await page.locator('#surf-status').innerText()}));await page.waitForTimeout(10);}}
  const open=async()=>{await page.locator('[data-surf-open]').click();await page.waitForFunction(()=>!document.querySelector('#surf-status').textContent.includes('불러오고'));};
  const submit=async q=>{await page.locator('#surf-query').fill(q);await page.locator('#surf-search button').click();};
  await open();assert.equal(await page.locator('#surf-results li').count(),2);assert.match(await page.locator('#surf-results [aria-current]').innerText(),/현재 홈/);
  assert.equal(await page.locator('#surf-results a').count(),1);assert.match(await page.locator('#surf-description').innerText(),/일촌 목록이 아닙니다/);
  await page.locator('#surf-next').click();await page.waitForFunction(()=>document.querySelector('#surf-results').textContent.includes('charlie'));assert.ok(calls.at(-1).searchParams.has('after'));assert.equal(await page.locator('#surf-next').isVisible(),false);
  const before=calls.length;await submit('a');assert.match(await page.locator('#surf-status').innerText(),/2~30/);assert.equal(calls.length,before);
  mode='hold';held=false;await submit('old');await waitHeld();
  mode='normal';await submit('new');await page.waitForFunction(()=>document.querySelector('#surf-results').textContent.includes('@new'));release();await page.waitForTimeout(50);assert.match(await page.locator('#surf-results').innerText(),/@new/);assert.equal(calls.at(-1).searchParams.has('after'),false);
  mode='empty';await submit('nothing');await page.waitForFunction(()=>document.querySelector('#surf-status').textContent==='검색 결과가 없습니다.');
  await submit('');await page.waitForFunction(()=>document.querySelector('#surf-status').textContent.includes('등록 미니홈피가 없습니다'));
  mode='offline';await submit('');await page.locator('#surf-retry').waitFor();mode='normal';await page.locator('#surf-retry').click();await page.waitForFunction(()=>document.querySelectorAll('#surf-results li').length===2);
  // Modal remains inside the mobile viewport and returns keyboard focus to its opener.
  const box=await page.locator('#surf-dialog').boundingBox();assert.ok(box.x>=0&&box.width<=width&&box.y>=0);
  await mkdir(new URL('docs/verification/member-navigation-step4/',root),{recursive:true});await page.screenshot({path:new URL(`docs/verification/member-navigation-step4/${width}.png`,root).pathname});
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#surf-dialog').open);assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute('data-surf-open')),true);
  // Closed dialog discards delayed results.
  mode='hold';held=false;await page.locator('[data-surf-open]').click();await waitHeld();await page.locator('#surf-close').click();mode='normal';release();await page.waitForTimeout(50);assert.equal(await page.locator('#surf-results li').count(),0);
  console.log('PASS list scenarios',width);
  mode='empty';await page.locator('#random-visit').click();await page.waitForFunction(()=>document.querySelector('#surf-status').textContent.includes('현재 홈을 제외'));assert.equal(page.url(),'https://fixture.test/home/');await page.locator('#surf-close').click();
  for(const bad of ['self','unsafe']){mode=bad;await page.locator('#random-visit').click();await page.locator('#surf-retry').waitFor();assert.equal(await page.locator('#surf-results a').count(),0);await page.locator('#surf-close').click();}
  // Delay random response, reject duplicate clicks, and cancel actual browser navigation.
  mode='hold';held=false;const beforeRandom=calls.length;
  await page.evaluate(()=>{window.draft='초안';window.guard=e=>{e.preventDefault();e.returnValue='';};addEventListener('beforeunload',window.guard);});
  await page.locator('#random-visit').click();await waitHeld();
  await page.evaluate(()=>document.querySelector('#random-visit').click());assert.equal(calls.length,beforeRandom+1);assert.equal(calls.at(-1).searchParams.get('site_id'),own.site_id);
  const cancelled=page.waitForEvent('dialog').then(d=>d.dismiss());mode='normal';release();await cancelled;assert.equal(page.url(),'https://fixture.test/home/');assert.equal(await page.evaluate(()=>window.draft),'초안');assert.equal(await page.locator('#surf-results a').getAttribute('href'),other.homepage_url);
  // List links also retain the existing unload guard.
  const cancelLink=page.waitForEvent('dialog').then(d=>d.dismiss());await page.locator('#surf-results a').click({noWaitAfter:true});await cancelLink;assert.equal(page.url(),'https://fixture.test/home/');
  await page.evaluate(()=>removeEventListener('beforeunload',window.guard));await page.locator('#surf-close').click();
  // Keyboard activation follows the server-selected candidate.
  await page.locator('#random-visit').focus();await page.keyboard.press('Enter');await page.waitForURL(other.homepage_url);assert.deepEqual(errors,[]);
  await page.close();
 }
 console.log('PASS surf desktop/mobile: list/search/pages, zero/one/many candidates, current-home exclusion, empty/error/retry, search/close races, duplicate random, native unload cancellation, keyboard/focus and viewport.');
}finally{await browser.close();}
