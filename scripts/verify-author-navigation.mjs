import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])));
const root=new URL('../',import.meta.url),id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
try {
 for(const width of [1280,375]){
  const page=await browser.newPage({viewport:{width,height:820}});let mode='ready',version=1,held,release;const calls=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='central.test'){
    if(!u.pathname.endsWith('/members'))return route.fulfill({status:503,json:{error:'fixture'}});
    const ids=u.searchParams.get('member_ids').split(',');calls.push(ids);
    const items=ids.filter(v=>v!==id(3)).map(v=>({id:v,site_id:id(100+Number(v.slice(-12))),display_name:'동명',handle:v===id(1)?'alice':'bob',homepage_url:`https://homes.test/v${version}/${v}/`}));
    if(mode==='hold'){held=true;await new Promise(r=>release=r);}
    return route.fulfill({status:mode==='offline'?503:200,json:{items:mode==='malformed'?[{...items[0],homepage_url:'javascript:alert(1)'}]:items}}).catch(()=>{});
   }
   if(u.hostname==='homes.test')return route.fulfill({contentType:'text/html',body:'visited'});
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><main id="guest"></main><section id="comments"></section><section id="extra"></section>'});
   return route.fulfill({contentType:'text/javascript',body:await readFile(new URL(u.pathname.slice(1),root),'utf8')});
  });
  await page.goto('https://fixture.test/');
  await page.evaluate(({id1,id2,id3})=>{
   window.MINIHOMPY_VISITOR_IDENTITY_CONFIG={enabled:true,siteId:id3,centralApiUrl:'https://central.test',navigationTimeoutMs:2000};
   window.MINIHOMPY_VIEWS={};window.MinihompySharedIdentity={state:{status:'unverified'}};
   const row={id:id1,number:1,author_kind:'member',author_member_id:id1,author_name:'동명',author_homepage_url:'https://historical.invalid/',body:'본문 유지',created_at:'2026-09-23T00:00:00Z',visibility:'public'};
   window.rows=[row,{...row,id:id2,author_member_id:id2},{...row,id:id3,author_kind:'local',author_member_id:null}];
   window.MinihompyVisitorSession={nickname:()=>''};
   window.MinihompyGuestbookRepository={nickname:()=>'',context:async()=>({role:'reader'}),list:async()=>({items:[row],count:1})};
   window.MinihompyCommentsRepository={list:async()=>({items:window.rows,count:3,context:{role:'reader'}})};
  },{id1:id(1),id2:id(2),id3:id(3)});
  for(const file of ['post-routes.js','member-navigation.js','author-navigation.js','comments.js','views/guestbook.js'])await page.addScriptTag({url:'/'+file});
  mode='hold';
  await page.evaluate(()=>{document.querySelector('#guest').append(window.MINIHOMPY_VIEWS.guestbook.createMain());for(const k of ['board','photos','diary'])document.querySelector('#comments').append(window.MinihompyComments.create(k,'parent'));});
  await page.waitForFunction(()=>document.querySelectorAll('.comment-list').length===4);
  assert.match(await page.locator('#guest').innerText(),/본문 유지/);assert.equal(await page.locator('.author-navigation a[href]').count(),0);
  while(!held)await page.waitForTimeout(10);mode='ready';release();
  await page.waitForFunction(()=>document.querySelectorAll('.author-navigation[data-status="ready"]').length===9);
  assert.equal(calls.length,1);assert.deepEqual(calls[0].sort(),[id(1),id(2)]);
  for(const author of await page.locator('.author-navigation[data-status="ready"]').all()){
   const hrefs=await author.locator('a').evaluateAll(nodes=>nodes.map(n=>n.href));assert.equal(hrefs.length,2);assert.equal(hrefs[0],hrefs[1]);assert.ok(!hrefs[0].includes('historical'));assert.match(await author.innerText(),/@alice|@bob/);
  }
  assert.equal(await page.locator('.author-navigation:not([data-status]) a').count(),0);
  // Drafts stay while lookup refreshes; leaving the page discards them without a confirmation.
  await page.locator('.guestbook-body-input').fill('방명록 초안');await page.locator('.comment-body').first().fill('댓글 초안');
  // Invalidation removes all old links synchronously; a later re-read uses the changed URL.
  version=2;mode='offline';await page.evaluate(()=>dispatchEvent(new Event('minihompy:navigation-invalidate')));
  assert.equal(await page.locator('.author-home[href]').count(),0);await page.waitForFunction(()=>document.querySelector('.author-navigation[data-status="error"]'));
  mode='ready';await page.locator('.author-home-retry').first().click();await page.waitForFunction(()=>document.querySelector('.author-home[href*="/v2/"]'));
  // An inactive member has no fallback link; malformed responses also fail closed.
  await page.evaluate(id=>document.querySelector('#extra').append(window.MinihompyAuthorNavigation.create({author_kind:'member',author_member_id:id,author_name:'동명'},'test-author')),id(3));
  await page.waitForFunction(()=>document.querySelector('#extra [data-status="unavailable"]'));
  mode='malformed';await page.locator('#extra .author-home-retry').click();await page.waitForFunction(()=>document.querySelector('#extra [data-status="error"]'));assert.equal(await page.locator('#extra a[href]').count(),0);
  // Detached old rows cannot receive a late response or overwrite replacements.
  mode='hold';held=false;await page.locator('.author-home-retry:visible').first().click();while(!held)await page.waitForTimeout(10);
  await page.evaluate(()=>{window.oldAuthor=document.querySelector('.author-navigation[data-status="loading"]');window.oldAuthor.remove();dispatchEvent(new Event('minihompy:navigation-invalidate'));});
  mode='ready';release();await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.oldAuthor.querySelector('a').hasAttribute('href')),false);
  await page.waitForFunction(()=>!document.querySelector('.author-navigation[data-status="loading"]'));
  calls.length=0;
  await page.evaluate(ids=>{const root=document.createElement('section');root.id='many';document.body.append(root);for(const member of ids)root.append(window.MinihompyAuthorNavigation.create({author_kind:'member',author_member_id:member,author_name:'동명'},'many-author'));},Array.from({length:55},(_,i)=>id(200+i)));
  await page.waitForFunction(()=>document.querySelectorAll('#many [data-status="ready"]').length===55);
  assert.deepEqual(calls.map(v=>v.length),[50,5]);
  assert.equal(await page.locator('.guestbook-body-input').inputValue(),'방명록 초안');assert.equal(await page.locator('.comment-body').first().inputValue(),'댓글 초안');
  const dialogs=[];page.on('dialog',d=>{dialogs.push(d.type());void d.dismiss();});
  await page.locator('.author-home[href]').first().click();await page.waitForURL('https://homes.test/**');assert.equal(await page.locator('body').innerText(),'visited');assert.deepEqual(dialogs,[]);
  assert.deepEqual(errors,[]);await page.close({runBeforeUnload:false});
 }
 console.log('PASS author navigation desktop/mobile: actual guestbook + four comment parents, batched lookup, nonblocking content, latest URLs, same names, anonymous/inactive/error/retry, lookup preserves drafts, page departure without confirmation, and stale detached responses.');
}finally{await browser.close();}
