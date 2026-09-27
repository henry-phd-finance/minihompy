import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {handleMemberWriting} from '../../supabase/functions/member-writing/handler.js';
import {handleIdentityApiRequest} from '../../../minihompy-central/supabase/functions/identity-api/handler.js';
export async function relationshipBrowserFlow({playwright,homes,options,fetcher,credentials,member}){
 const {chromium}=await import(pathToFileURL(resolve(playwright))),out=resolve(process.env.VERIFICATION_DIR||'docs/verification/member-relationship-step8/browser');await mkdir(out,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});const errors=[];
 const source=(await readFile('index.html','utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
 const scripts=['member-writing-client.js','member-writing-runtime.js','member-relationships-repository.js','member-relationships.js','member-navigation.js','author-navigation.js','member-relationship-lists.js','friend-reviews-repository.js','friend-reviews.js','views/home.js'];
 async function pageFor(actor,target){
  const context=await browser.newContext({viewport:{width:1280,height:850}}),page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),init={method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}: {})};
   if(url.hostname==='central.test'){const r=await handleIdentityApiRequest(new Request(req.url(),init),options);return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:await r.text()});}
   const personal=Object.values(homes).find(h=>h.config.SUPABASE_URL===url.origin);
   if(personal){const r=await handleMemberWriting(new Request(req.url(),init),{config:personal.config,db:personal.db,fetcher,transportPeerIp:'127.0.0.1'});return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:await r.text()});}
   const home=Number(/^m([12])\.test$/.exec(url.hostname)?.[1]);if(!home)return route.abort();
   const path=url.pathname.replace(/^\/home\//,'')||'index.html';
   if(path==='index.html'){
    const cfg=homes[home].config,data=credentials[actor][home];
    const setup=`window.MINIHOMPY_VISITOR_IDENTITY_CONFIG=${JSON.stringify({enabled:true,siteId:cfg.MINIHOMPY_SITE_ID,centralApiUrl:cfg.MINIHOMPY_CENTRAL_API_URL})};window.MINIHOMPY_SUPABASE=${JSON.stringify({url:cfg.SUPABASE_URL})};window.MINIHOMPY_MEMBER_WRITING_CONFIG={enabled:true};window.MinihompySharedIdentity={state:${JSON.stringify({status:'identified',visitor:{id:member(actor),handle:'member'+actor,display_name:'Member '+actor}})},retry:async()=>{}};window.MinihompyAdmin={state:{role:'visitor'}};window.MINIHOMPY_VIEWS={};sessionStorage.setItem('minihompy.member-writing.v1:'+MINIHOMPY_VISITOR_IDENTITY_CONFIG.siteId+':'+MINIHOMPY_SUPABASE.url,${JSON.stringify(data.session_token)});sessionStorage.setItem('minihompy.member-writing.v1:'+MINIHOMPY_VISITOR_IDENTITY_CONFIG.siteId+':'+MINIHOMPY_SUPABASE.url+':renewal',${JSON.stringify(data.renewal_token)});addEventListener('DOMContentLoaded',()=>{const slot=document.querySelector('[data-view-slot="main"]');slot.dataset.view='home';slot.replaceChildren(MINIHOMPY_VIEWS.home.createMain());});`;
    return route.fulfill({contentType:'text/html',body:source.replace('<head>','<head><script>'+setup+'</script>'+scripts.map(s=>`<script src="${s}" defer></script>`).join(''))});
   }
   try{return route.fulfill({body:await readFile(path),contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':undefined});}catch{return route.abort();}
  });
  await page.goto(`https://m${target}.test/home/`);return page;
 }
 const action=(p,k)=>p.locator(`[data-relationship-action="${k}"]`),review=(p,k)=>p.locator(`[data-review-action="${k}"]`);
 const state=async(p,s)=>{try{await p.waitForFunction(s=>MinihompyRelationshipUI.state.status===s&&!MinihompyRelationshipUI.state.busy,s);}catch(e){console.log('state diagnostic',s,await p.evaluate(()=>({relationship:MinihompyRelationshipUI.state,navigation:MinihompyNavigation.state,session:MinihompyMemberWriting.state,visibility:document.visibilityState,message:document.querySelector('#relationship-message').textContent})));throw e;}};
 const ready=p=>p.waitForFunction(()=>{const b=document.querySelector('[data-review-action="save"]');return b&&!b.hidden&&!b.disabled;});
 try{
  const a=await pageFor(1,2),b=await pageFor(2,1),c=await pageFor(3,2);
  await state(a,'none');await a.locator('#relationship-open').click();await state(a,'none');await action(a,'request').click();await state(a,'outgoing');
  await b.locator('#relationship-open').click();await state(b,'incoming');await b.locator('[data-relationship-list="incoming"]').click();await b.locator('[data-list-action="accept"]').click();await state(b,'accepted');await b.locator('[data-list-close]').click();
  await a.locator('#relationship-close').click();await a.bringToFront();await a.evaluate(()=>dispatchEvent(new Event('focus')));await state(a,'accepted');await ready(a);await ready(b);
  console.log('PASS browser 1: independent A/B origins request → own inbox accept → focus refresh synchronizes relationship and review UI');
  for(const p of [a,b]){await p.locator('#relationship-open').click();await p.locator('[data-relationship-list="friends"]').click();await p.waitForFunction(()=>document.querySelectorAll('.relationship-list > li').length===1);}
  await a.waitForFunction(()=>document.querySelector('.relationship-list .relationship-member-name')?.hasAttribute('href'));assert.equal(await a.locator('.relationship-list .relationship-member-name').getAttribute('href'),'https://m1.test/home/');
  await a.locator('.relationship-list .relationship-member-name').click();await a.waitForURL('https://m1.test/home/');await state(a,'self');await a.goBack();await state(a,'accepted');await ready(a);await b.locator('[data-list-close]').click();
  console.log('PASS browser 2: both owner friend lists, latest member-ID link, actual cross-origin home visit and back');
  for(const [p,text] of [[a,'Browser A → B'],[b,'Browser B → A']]){await ready(p);await p.locator('.friend-reviews textarea').fill(text);await review(p,'save').click();await p.waitForFunction(()=>document.querySelector('.friend-review-status').textContent.includes('완료'));}
  assert.equal((await homes[2].pg.query('select body from private.friend_reviews')).rows[0].body,'Browser A → B');assert.equal((await homes[1].pg.query('select body from private.friend_reviews')).rows[0].body,'Browser B → A');
  await review(c,'refresh').click();await c.waitForFunction(()=>document.querySelectorAll('.friend-reviews li').length===1);assert.equal(await review(c,'delete').count(),0);assert.equal(await review(c,'save').isHidden(),true);
  console.log('PASS browser 3: both actual repositories write only target personal DB; C reads public reviews with no write/delete controls');
  await b.locator('.friend-reviews textarea').fill('stale friend screen');await a.locator('#relationship-open').click();await state(a,'accepted');await action(a,'disconnect').click();await action(a,'confirm').click();await state(a,'none');await a.locator('#relationship-close').click();
  await review(b,'save').click();await b.waitForFunction(()=>document.querySelector('.friend-review-status').textContent.includes('현재 일촌'));assert.equal(await b.locator('.friend-reviews textarea').inputValue(),'stale friend screen');await state(b,'none');
  assert.equal((await homes[1].pg.query('select count(*)::int n from private.friend_reviews')).rows[0].n,1);assert.equal((await homes[2].pg.query('select count(*)::int n from private.friend_reviews')).rows[0].n,1);
  await a.screenshot({path:resolve(out,'a-after-disconnect.png')});await b.screenshot({path:resolve(out,'b-stale-write-rejected.png')});assert.deepEqual(errors,[]);
  console.log('PASS browser 4: disconnect affects server immediately, stale other-origin editor is rejected without deleting historical reviews');
 }finally{await browser.close();}
}
