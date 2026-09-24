import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])));
const root=new URL('../',import.meta.url);
const output=resolve(process.env.MINIHOMPY_NAVIGATION_UI_OUTPUT||'docs/verification/member-navigation-step2');
const id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const a={id:id(1),site_id:id(11),handle:'alice',display_name:'같은 이름',homepage_url:'https://a.example/home/'};
const b={...a,id:id(2),site_id:id(12),handle:'bob',homepage_url:'https://b.example/home/'};
const html=(await readFile(new URL('index.html',root),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
try {
 for(const width of [1280,375]){
  const page=await browser.newPage({viewport:{width,height:820}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let current=a,owner=b,offline=false;
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='central.example')return route.fulfill({status:offline?503:200,json:u.pathname.endsWith('/site')?{item:owner}:{items:[current]}});
   if(u.hostname==='a.example')return route.fulfill({contentType:'text/html',body:'Arrived at A'});
   const path=u.pathname.slice('/home/'.length)||'index.html';
   if(path==='index.html')return route.fulfill({contentType:'text/html',body:html});
   try{return route.fulfill({body:await readFile(new URL(path,root)),contentType:path.endsWith('.css')?'text/css':path.endsWith('.js')?'text/javascript':undefined});}catch{return route.abort();}
  });
  await page.goto('https://b.example/home/');
  await page.evaluate(({a,b})=>{
   window.MINIHOMPY_VISITOR_IDENTITY_CONFIG={enabled:true,siteId:b.site_id,centralApiUrl:'https://central.example/api'};
   window.MINIHOMPY_VIEWS={};window.loginCalls=0;window.retryCalls=0;
   window.MinihompyAdmin={state:{role:'admin',userId:'local-unrelated'}};document.documentElement.dataset.identity='admin';
   window.MinihompySharedIdentity={state:{status:'identified',visitor:a},getLoginUrl(){window.loginCalls++;return '#login-entry';},retry(){window.retryCalls++;}};
   window.changeIdentity=state=>{window.MinihompySharedIdentity.state=state;window.dispatchEvent(new CustomEvent('minihompy:visitor-identity',{detail:state}));};
  },{a,b});
  await page.addScriptTag({url:'member-navigation.js'});await page.addScriptTag({url:'views/home.js'});
  await page.evaluate(()=>document.querySelector('[data-view-slot="main"]').append(window.MINIHOMPY_VIEWS.home.createMain()));
  await page.waitForFunction(()=>window.MinihompyNavigation.state.status==='other');
  assert.match(await page.locator('#visitor-name').innerText(),/@alice/);assert.match(await page.locator('#home-owner-name').innerText(),/@bob/);
  assert.equal(await page.locator('#my-home-link').getAttribute('href'),a.homepage_url);
  assert.equal(await page.locator('.friend-request').count(),0);assert.ok(!(await page.locator('body').innerText()).includes('사촌'));
  assert.equal(await page.evaluate(()=>window.MinihompyAdmin.state.userId),'local-unrelated');
  // Native same-tab link honors a cancelled beforeunload without a custom navigation bypass.
  await page.evaluate(()=>{window.draft='작성 중';window.guard=e=>{e.preventDefault();e.returnValue='';};addEventListener('beforeunload',window.guard);});
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#my-home-link').click({noWaitAfter:true});
  await page.waitForTimeout(100);assert.equal(page.url(),'https://b.example/home/');assert.equal(await page.evaluate(()=>window.draft),'작성 중');
  await page.evaluate(()=>removeEventListener('beforeunload',window.guard));
  current=b;await page.evaluate(b=>window.changeIdentity({status:'identified',visitor:b}),b);await page.waitForFunction(()=>window.MinihompyNavigation.state.status==='self');
  await page.evaluate(()=>window.changeIdentity({status:'anonymous'}));await page.waitForFunction(()=>window.MinihompyNavigation.state.status==='anonymous');
  await page.locator('#my-home-login').click();assert.equal(await page.evaluate(()=>window.loginCalls),1);assert.equal(await page.evaluate(()=>window.MinihompyAdmin.state.role),'admin');
  current=a;offline=true;await page.evaluate(a=>window.changeIdentity({status:'identified',visitor:a}),a);await page.waitForFunction(()=>window.MinihompyNavigation.state.status==='error');
  assert.equal(await page.locator('#my-home-link').getAttribute('href'),null);await page.locator('#navigation-retry').click();assert.equal(await page.evaluate(()=>window.retryCalls),1);
  offline=false;await page.evaluate(a=>window.changeIdentity({status:'identified',visitor:a}),a);await page.waitForFunction(()=>window.MinihompyNavigation.state.status==='other');
  await page.evaluate(()=>dispatchEvent(new Event('minihompy:navigation-invalidate')));assert.equal(await page.locator('#my-home-link').getAttribute('href'),null);
  await page.evaluate(a=>window.changeIdentity({status:'identified',visitor:a}),a);await page.waitForFunction(()=>window.MinihompyNavigation.state.status==='other');
  await mkdir(output,{recursive:true});
  await page.screenshot({path:resolve(output,`${width}.png`)});
  await page.locator('#my-home-link').focus();await page.keyboard.press('Enter');await page.waitForURL('https://a.example/home/');assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS navigation UI desktop/mobile: same-name identities, admin separation, self/other/anonymous, login, retry, logout invalidation, native draft cancellation and keyboard link.');
}finally{await browser.close();}
