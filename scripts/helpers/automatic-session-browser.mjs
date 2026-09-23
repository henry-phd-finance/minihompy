import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {handleMemberWriting} from '../../supabase/functions/member-writing/handler.js';
export async function verifyAutomaticSessionBrowser({playwrightPath,centralRoot,centralHandler,centralOptions,centralSession,ownerCentralSession,personal,options,member,memberB,parents}){
 const {chromium}=await import(pathToFileURL(resolve(playwrightPath)));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
 const site='https://bob.github.io/home/',centralPage='https://central.test/pages/',centralApi='https://central.test/functions/v1/identity-api';
 const counters={exchange:0,renew:0,writes:0,visits:0};let offline=false,loseWrite=false;const errors=[];
 try{
 const ctx=await browser.newContext();
 await ctx.addInitScript(({centralSession})=>{if(location.origin==='https://central.test')localStorage.setItem('minihompy.identity.session.v1',centralSession);},{centralSession});
 await ctx.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  const send=async response=>route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
  const request=()=>new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}:{})});
  if(req.url().startsWith(options.config.SUPABASE_URL+'/functions/v1/member-writing')){
   if(url.pathname.endsWith('/exchange'))counters.exchange++;if(url.pathname.endsWith('/renew'))counters.renew++;
   if(offline)return send(Response.json({error:{code:'IDENTITY_UNAVAILABLE'}},{status:503}));
   if(url.pathname.endsWith('/guestbook')&&req.method()==='POST')counters.writes++;
   const res=await handleMemberWriting(request(),options);
   if(loseWrite&&url.pathname.endsWith('/guestbook')&&req.method()==='POST'&&res.ok)return send(Response.json({error:{code:'IDENTITY_UNAVAILABLE'}},{status:503}));
   return send(res);
  }
  if(req.url().startsWith(centralApi)){if(url.pathname.endsWith('/visits/issue'))counters.visits++;return send(await centralHandler(request(),{...centralOptions,allowedOrigins:new Set(['https://bob.github.io'])}));}
  if(url.origin==='https://central.test'){
   const name=url.pathname.slice('/pages/'.length);
   if(name==='config.js')return route.fulfill({contentType:'text/javascript',body:`window.MINIHOMPY_CENTRAL_CONFIG=${JSON.stringify({apiBaseUrl:centralApi,pageBaseUrl:centralPage.slice(0,-1)})};`});
   assert.ok(['visit.html','visit-flow.js','login-flow.js','login.css','logout.html'].includes(name));
   return route.fulfill({contentType:name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript',body:await readFile(resolve(centralRoot,'public',name))});
  }
  assert.equal(url.origin,'https://bob.github.io');const name=url.pathname.slice('/home/'.length);
  if(!name){
   return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><span id="member-session-status"></span><button id="member-session-retry" hidden>인증 재시도</button><div id="host"></div><div id="comments"></div>
   <script>window.MINIHOMPY_VIEWS={home:{createLeft:()=>document.createDocumentFragment()}};window.MINIHOMPY_CONFIG={profile:{name:'Bob'}};window.MinihompyAdmin={state:{role:'reader',userId:null}};window.MinihompyVisitorSession={nickname:()=>'',context:async()=>({role:'reader',userId:null})};</script>
   ${['supabase-config.js','visitor-identity-config.js','member-writing-config.js','member-writing-client.js','member-writing-runtime.js','visitor-identity.js','comments-repository.js','comments.js','guestbook-repository.js','views/guestbook.js'].map(s=>`<script src="${s}"></script>`).join('')}
   <script>document.querySelector('#host').append(window.MINIHOMPY_VIEWS.guestbook.createMain());for(const [kind,id]of Object.entries(${JSON.stringify(parents)}))document.querySelector('#comments').append(window.MinihompyComments.create(kind,id));</script>`});
  }
  const custom={'supabase-config.js':`window.MINIHOMPY_SUPABASE=${JSON.stringify({url:options.config.SUPABASE_URL})};`,'visitor-identity-config.js':`window.MINIHOMPY_VISITOR_IDENTITY_CONFIG=${JSON.stringify({enabled:true,siteId:options.config.MINIHOMPY_SITE_ID,centralApiUrl:centralApi,centralPageUrl:centralPage.slice(0,-1)})};`,'member-writing-config.js':'window.MINIHOMPY_MEMBER_WRITING_CONFIG={enabled:true};'};
  if(custom[name])return route.fulfill({contentType:'text/javascript',body:custom[name]});
  assert.ok(/^[a-zA-Z0-9_./-]+$/.test(name)&&!name.includes('..'));
  return route.fulfill({contentType:extname(name)==='.js'?'text/javascript':extname(name)==='.css'?'text/css':'image/png',body:await readFile(resolve(name))});
 });
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(site+'#/guestbook');
 await page.waitForFunction(()=>window.MinihompyMemberWriting?.state.status==='ready');
 await page.locator('.guestbook-body-input').waitFor();await page.locator('.comment-body').first().waitFor();
 assert.equal(counters.exchange,1);assert.equal(counters.visits,1);assert.equal(await page.locator('.guestbook-authorize,.comment-authorize').count(),0);
 assert.equal(await page.evaluate(()=>window.MinihompySharedIdentity.state.visitor.id),member);
 await page.evaluate(()=>Promise.all(Array.from({length:10},()=>window.MinihompyMemberWriting.context())));assert.equal(counters.exchange,1);assert.equal(counters.renew,0);
 console.log('PASS: initial central visit automatically exchanges one proof; concurrent contexts reuse it, no authorization buttons');
 const draft=page.locator('.guestbook-body-input');await draft.fill('automatic renewal draft');await draft.focus();
 let navigation=0;page.on('framenavigated',()=>navigation++);
 await personal.pg.query("update private.member_writing_sessions set issued_at=now()-interval '16 minutes',expires_at=now()-interval '1 minute' where family_id is not null");
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 // Poll the server-observed renewal without depending on UI timing.
 for(let i=0;i<100&&counters.renew===0;i++)await new Promise(r=>setTimeout(r,20));
 await page.waitForFunction(()=>window.MinihompyMemberWriting.state.status==='ready');
 assert.equal(counters.renew,1);assert.equal(navigation,0);assert.equal(await draft.inputValue(),'automatic renewal draft');assert.equal(await draft.evaluate(el=>el===document.activeElement),true);
 console.log('PASS: expired token renews once without navigation, input or focus loss');
 offline=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.locator('#member-session-retry').waitFor();
 assert.equal(await draft.inputValue(),'automatic renewal draft');assert.equal(await page.locator('.guestbook-save').isDisabled(),true);
 offline=false;await page.locator('#member-session-retry').click();await page.waitForFunction(()=>window.MinihompyMemberWriting.state.status==='ready');await draft.waitFor();assert.equal(await draft.inputValue(),'automatic renewal draft');
 console.log('PASS: temporary failure uses common retry, blocks writing, preserves draft');
 await personal.pg.exec("update private.member_writing_limits set last_write=now()-interval '2 minutes',window_start=now(),writes=0");
 loseWrite=true;await page.locator('.guestbook-save').click();await page.locator('#member-session-retry').waitFor();loseWrite=false;
 await page.locator('#member-session-retry').click();await page.waitForFunction(()=>window.MinihompyMemberWriting.state.status==='ready');assert.equal(counters.writes,1);
 console.log('PASS: ambiguous successful write response is not automatically replayed');
 const peer=await ctx.newPage();peer.on('dialog',d=>d.accept());peer.on('pageerror',e=>errors.push(e.message));
 await peer.goto(site+'#/guestbook');await peer.waitForFunction(()=>window.MinihompyMemberWriting?.state.status==='ready');await peer.locator('.guestbook-body-input').waitFor();
 assert.equal(await draft.inputValue(),'automatic renewal draft');
 console.log('PASS: new tab gets independent family without clearing same-member draft');
 await ctx.addInitScript(({session})=>{if(location.origin==='https://central.test')localStorage.setItem('minihompy.identity.session.v1',session);},{session:ownerCentralSession});
 await page.evaluate(()=>{void window.MinihompySharedIdentity.retry();});
 await page.waitForFunction(id=>window.MinihompySharedIdentity?.state.visitor?.id===id&&window.MinihompyMemberWriting.state.status==='ready',memberB);
 await page.locator('.guestbook-body-input').waitFor();assert.equal(await page.locator('.guestbook-body-input').inputValue(),'');
 await peer.waitForFunction(()=>window.MinihompyMemberWriting.state.status==='loginRequired');assert.equal(await peer.locator('.guestbook-body-input').count(),0);
 console.log('PASS: account switch exchanges B proof, clears A inputs and revokes other-tab family');
 await page.evaluate(()=>window.MinihompyMemberWriting.logout());assert.equal(await page.locator('.guestbook-body-input').count(),0,'guestbook removed after logout');assert.equal(await page.locator('.comment-body').count(),0,'comments removed after logout');
 assert.deepEqual(errors,[]);console.log('PASS: logout removes inputs and restricted content; no page errors');
 }finally{await browser.close();}
}
