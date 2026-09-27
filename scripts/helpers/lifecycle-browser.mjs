import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {handleMemberWriting} from '../../supabase/functions/member-writing/handler.js';
export async function verifyLifecycleBrowser({playwrightPath,centralRoot,centralHandler,centralOptions,centralSession,ownerCentralSession,personal,options,member,memberB,owner,ownerToken,parents}){
 const {chromium}=await import(pathToFileURL(resolve(playwrightPath)));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
 const site='https://bob.github.io/home/',centralPage='https://central.test/pages/',centralApi='https://central.test/functions/v1/identity-api';
 const contexts=[];const errors=[];const identities=new Map();
 let offlinePersonal=false,offlineCentral=false,holdPath=null,release,held;
 const backendOptions={...options,fetcher:async(url,init)=>{if(offlineCentral&&url.startsWith(centralApi))throw Error('fixture central offline');return options.fetcher(url,init);}};
 async function tab(identity,session,admin=false){
  const context=await browser.newContext({viewport:{width:1280,height:820}});contexts.push(context);
  await context.addInitScript(({session})=>{if(location.origin==='https://central.test')localStorage.setItem('minihompy.identity.session.v1',session);},{session});
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   async function api(response){await route.fulfill({status:response.status,body:await response.text(),headers:Object.fromEntries(response.headers)});}
   if(req.url().startsWith(options.config.SUPABASE_URL+'/functions/v1/member-writing')){
    if(offlinePersonal)return api(Response.json({error:{code:'IDENTITY_UNAVAILABLE'}},{status:503}));
    const response=await handleMemberWriting(new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}:{})}),backendOptions);
    if(holdPath && u.pathname.endsWith(holdPath)&&req.method()==='GET'){holdPath=null;held=true;await new Promise(resolve=>{release=resolve;});}
    return api(response);
   }
   if(req.url().startsWith(centralApi))return api(await centralHandler(new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}:{})}),{...centralOptions,allowedOrigins:new Set(['https://bob.github.io'])}));
   if(u.origin==='https://central.test'&&u.pathname.startsWith('/pages/')){
    const name=u.pathname.slice('/pages/'.length);
    if(name==='config.js')return route.fulfill({contentType:'text/javascript',body:`window.MINIHOMPY_CENTRAL_CONFIG=${JSON.stringify({apiBaseUrl:centralApi,pageBaseUrl:centralPage.slice(0,-1)})};`});
    if(!['writing.html','writing-flow.js','login-flow.js','login.css'].includes(name))throw Error('Unexpected central browser resource');
    return route.fulfill({contentType:name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript',body:await readFile(resolve(centralRoot,'public',name))});
   }
   if(u.origin!=='https://bob.github.io'||!u.pathname.startsWith('/home/'))throw Error('Unexpected external request');
   const name=u.pathname.slice('/home/'.length);
   if(!name){
    const setup=`window.MINIHOMPY_VIEWS={home:{createLeft:()=>document.createDocumentFragment()}};
      window.MINIHOMPY_CONFIG={profile:{name:'Bob'}};
      window.MinihompyAdmin={state:{role:${JSON.stringify(admin?'admin':'reader')},userId:${JSON.stringify(admin?owner:null)}}};
      window.MinihompySharedIdentity={retry:async()=>{},state:{status:'identified',visitor:{id:${JSON.stringify(identities.get(context)||identity)}}}};
      const localContext=${JSON.stringify({role:admin?'admin':'reader',userId:admin?owner:null})};
      localContext.client={auth:{getSession:async()=>(${JSON.stringify({data:{session:{access_token:ownerToken}}})})}};
      window.MinihompyVisitorSession={nickname:()=>'',context:async()=>localContext};
`;
    return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="styles.css"><script>${setup}</script>
      ${['supabase-config.js','visitor-identity-config.js','member-writing-config.js','member-writing-client.js','member-writing-runtime.js','member-navigation.js','author-navigation.js','comments-repository.js','comments.js','guestbook-repository.js','views/guestbook.js'].map(src=>`<script src="${src}"></script>`).join('')}
      <main id="host" style="position:relative;width:750px;height:700px;font-size:14px"></main><div id="other"></div><script>document.querySelector('#host').append(window.MINIHOMPY_VIEWS.guestbook.createMain());for(const [kind,id] of Object.entries(${JSON.stringify(parents)}))if(kind!=='guestbook')document.querySelector('#other').append(window.MinihompyComments.create(kind,id));</script>`});
   }
   const custom={
    'supabase-config.js':`window.MINIHOMPY_SUPABASE=${JSON.stringify({url:options.config.SUPABASE_URL})};`,
    'visitor-identity-config.js':`window.MINIHOMPY_VISITOR_IDENTITY_CONFIG=${JSON.stringify({enabled:true,siteId:options.config.MINIHOMPY_SITE_ID,centralApiUrl:centralApi,centralPageUrl:centralPage.slice(0,-1)})};`,
    'member-writing-config.js':'window.MINIHOMPY_MEMBER_WRITING_CONFIG={enabled:true};',
   };
   if(custom[name])return route.fulfill({contentType:'text/javascript',body:custom[name]});
   if(!/^(?:[a-z-]+\.js|styles\.css|views\/guestbook\.js|login\/writing\.html|assets\/[^.][A-Za-z0-9_./-]+)$/.test(name)||name.includes('..'))throw Error('Unexpected browser resource');
   const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'}[extname(name)]||'application/octet-stream';
   return route.fulfill({contentType:type,body:await readFile(resolve(name))});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(site+'#/guestbook');await page.locator('.guestbook-authorize').click({timeout:5000}).catch(async e=>{throw Error(JSON.stringify({errors,body:await page.locator('body').innerText()})+' '+e.message)});
  await page.waitForURL(site+'#/guestbook');await page.locator('.guestbook-body-input').waitFor();
  return page;
 }
 try{
  const page=await tab(member,centralSession);
  const token=await page.evaluate(()=>Object.entries(sessionStorage).find(([k])=>k.startsWith('minihompy.member-writing.v1:'))[1]);
  const privatePost=page.locator(`[data-post="${parents.guestbook}"]`);await privatePost.waitFor();
  const widget=page.locator(`[data-comment-target="board:${parents.board}"]`);
  await widget.locator('.comment-body').waitFor();
  await page.locator('.guestbook-body-input').fill('A의 방명록 초안');await widget.locator('.comment-body').fill('A의 댓글 초안');
  // Personal outage: both private DOMs clear, same-account drafts survive retry.
  offlinePersonal=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await privatePost.waitFor({state:'detached'});await page.locator('.guestbook-retry').waitFor();
  offlinePersonal=false;await page.locator('.guestbook-retry').click();await privatePost.waitFor();
  assert.equal(await page.locator('.guestbook-body-input').inputValue(),'A의 방명록 초안');
  await widget.locator('.comment-retry').click();assert.equal(await widget.locator('.comment-body').inputValue(),'A의 댓글 초안');
  // Central outage must also clear private content, never create anonymous records.
  offlineCentral=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await privatePost.waitFor({state:'detached'});
  offlineCentral=false;await page.locator('.guestbook-retry').click();await privatePost.waitFor();
  // Freeze a successful private response, then switch identities before delivery.
  holdPath='/guestbook';held=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  const until=Date.now()+10000;while(!held){if(Date.now()>until)throw Error('Held request not reached');await new Promise(r=>setTimeout(r,10));}
  await page.evaluate(id=>{window.MinihompySharedIdentity.state={status:'identified',visitor:{id}};window.dispatchEvent(new Event('minihompy:visitor-identity'));},memberB);
  release();release=null;await page.locator('.guestbook-authorize').waitFor();
  assert.equal(await page.locator(`[data-post="${parents.guestbook}"]`).count(),0);
  const previous=await handleMemberWriting(new Request(options.config.SUPABASE_URL+'/functions/v1/member-writing/sessions/current',{headers:{Authorization:'Bearer '+token,'X-Minihompy-Auth-Mode':'member'}}),options);assert.equal(previous.status,401);
  // B proves its own identity in the same tab, without adopting either A draft.
  identities.set(page.context(),memberB);
  await page.context().addInitScript(({memberB,ownerCentralSession})=>{
   if(location.origin==='https://central.test')localStorage.setItem('minihompy.identity.session.v1',ownerCentralSession);

  },{memberB,ownerCentralSession});
  await page.locator('.guestbook-authorize').click();await page.locator('.guestbook-name').waitFor();
  await page.waitForFunction(()=>document.querySelector('.guestbook-name')?.value==='Bob');
  assert.equal(await page.locator('.guestbook-body-input').inputValue(),'');
  assert.equal(await widget.locator('.comment-body').inputValue(),'');
  // A fresh browser/two tabs: local logout clears peers and rejects both old tokens.
  const aPage=await tab(member,centralSession);
  const old=await aPage.evaluate(()=>Object.entries(sessionStorage).find(([k])=>k.startsWith('minihompy.member-writing.v1:'))[1]);
  const peer=await aPage.context().newPage();peer.on('dialog',d=>d.accept());
  await peer.goto(site+'#/guestbook');await peer.locator('.guestbook-authorize').click();await peer.locator('.guestbook-body-input').waitFor();
  const peerToken=await peer.evaluate(()=>Object.entries(sessionStorage).find(([k])=>k.startsWith('minihompy.member-writing.v1:'))[1]);assert.notEqual(peerToken,old);
  offlineCentral=true;
  assert.equal(await aPage.evaluate(async()=>{try{await window.MinihompyMemberWriting.logout();return false;}catch{return true;}}),true);
  await peer.locator(`[data-post="${parents.guestbook}"]`).waitFor({state:'detached'});
  assert.equal(await aPage.locator(`[data-post="${parents.guestbook}"]`).count(),0);
  offlineCentral=false;await aPage.evaluate(()=>window.MinihompyMemberWriting.logout());await peer.evaluate(()=>window.MinihompyMemberWriting.retry());
  const rejected=await handleMemberWriting(new Request(options.config.SUPABASE_URL+'/functions/v1/member-writing/sessions/current',{headers:{Authorization:'Bearer '+old,'X-Minihompy-Auth-Mode':'member'}}),options);assert.equal(rejected.status,401);
  const peerRejected=await handleMemberWriting(new Request(options.config.SUPABASE_URL+'/functions/v1/member-writing/sessions/current',{headers:{Authorization:'Bearer '+peerToken,'X-Minihompy-Auth-Mode':'member'}}),options);assert.equal(peerRejected.status,401);
  // A new login survives a restored page; expired tokens clear private DOM, renewal works.
  const fresh=await tab(member,centralSession);
  const freshToken=await fresh.evaluate(()=>Object.entries(sessionStorage).find(([k])=>k.startsWith('minihompy.member-writing.v1:'))[1]);
  const {tokenHash}=await import('../../supabase/functions/member-writing/handler.js');
  await personal.pg.query("update private.member_writing_sessions set issued_at=now()-interval '20 minutes',expires_at=now()-interval '6 minutes' where token_hash=$1",[await tokenHash(freshToken)]);
  await fresh.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  await fresh.locator(`[data-post="${parents.guestbook}"]`).waitFor({state:'detached'});
  await fresh.locator('.guestbook-retry').click();await fresh.locator('.guestbook-authorize').waitFor();offlinePersonal=true;await fresh.locator('.guestbook-authorize').click();
  await fresh.waitForURL('**/login/writing.html');await fresh.locator('#message').filter({hasText:'확인하지 못했습니다'}).waitFor();
  assert.equal(await fresh.locator('.guestbook-post').count(),0);
  offlinePersonal=false;await fresh.goto(site+'#/guestbook');await fresh.locator('.guestbook-retry').click();await fresh.locator('.guestbook-authorize').click();await fresh.locator(`[data-post="${parents.guestbook}"]`).waitFor();
  // A draft waiting for authentication cannot be submitted after switching to B.
  await fresh.locator('.guestbook-body-input').fill('계정 전환 중 제출 금지');
  const pendingComment=fresh.locator(`[data-comment-target="board:${parents.board}"]`);
  await pendingComment.locator('.comment-body').fill('계정 전환 중 댓글 제출 금지');
  holdPath='/sessions/current';held=false;await fresh.locator('.guestbook-save').click();
  await pendingComment.locator('.comment-save').click();
  const deadline=Date.now()+10000;while(!held){if(Date.now()>deadline)throw Error('Pending save not reached');await new Promise(r=>setTimeout(r,10));}
  await fresh.evaluate(id=>{window.MinihompySharedIdentity.state={status:'identified',visitor:{id}};window.dispatchEvent(new Event('minihompy:visitor-identity'));},memberB);
  release();release=null;await fresh.locator('.guestbook-authorize').waitFor();
  assert.equal((await personal.pg.query("select * from public.guestbook_posts where body='계정 전환 중 제출 금지'")).rows.length,0);
  assert.equal((await personal.pg.query("select * from public.post_comments where body='계정 전환 중 댓글 제출 금지'")).rows.length,0);
  assert.deepEqual(errors,[]);
  console.log('PASS: lifecycle browser private DOM clearing, outage draft recovery, late response isolation, A→B, logout failure/retry, multi-tab logout, restored page, expiration/renewal.');
 }finally{release?.();for(const context of contexts)await context.close();await browser.close();}
}
