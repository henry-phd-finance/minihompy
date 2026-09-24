// Chromium → actual personal/central handlers → PGlite SQL. No hosted writes.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {handleMemberWriting,authenticateMember,tokenHash} from '../supabase/functions/member-writing/handler.js';
import {requestReviewPermit} from '../supabase/functions/member-writing/relationships.js';
const root=resolve('../minihompy-central'),load=p=>import(pathToFileURL(root+'/'+p));
const {PGlite}=await load('node_modules/@electric-sql/pglite/dist/index.js');
const {createIdentityDb}=await load('scripts/helpers/identity-db.mjs');
const {seedRelationships,member,site,session}=await load('scripts/helpers/relationship-fixture.mjs');
const {handleIdentityApiRequest}=await load('supabase/functions/identity-api/handler.js');
const {sha256,randomSecret}=await load('supabase/functions/_shared/auth-proof.js');
const {signToken}=await load('supabase/functions/_shared/tokens.js');
const centralUrl='https://central.test/functions/v1/identity-api',secret='test-only-relationship-api-secret-at-least-32';
const central=await createIdentityDb(),personal=await memberWritingDb(PGlite,{siteId:site(2),centralUrl});
const config={MINIHOMPY_SITE_ORIGIN:'https://m2.test',MINIHOMPY_SITE_ID:site(2),MINIHOMPY_CENTRAL_API_URL:centralUrl,SUPABASE_URL:'https://bbbbbbbbbbbbbbbbbbbb.supabase.co',MINIHOMPY_PUBLIC_KEY:'fixture'};
const opts={supabaseClient:central.db,centralSecret:secret,allowedOrigins:new Set(['https://m2.test']),transportPeerIp:'127.0.0.1'};
let loginData,losePermit=false,permitHook=null,failStore=false,dropStore=false,offline=false,dropAction=false,revokeAfter=false,mutate=null,groups=0;
const request=(url,body,token,method=body===undefined?'GET':'POST',extra={})=>new Request(url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
const fetcher=async(url,init)=>{
 if(url.includes('/auth/v1/user'))return Response.json({id:member(9),is_anonymous:false});
 if(url.includes('/rest/v1/rpc/is_minihompy_admin'))return Response.json(true);
 assert.ok(url.startsWith(centralUrl));assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.ok(init.signal);
 if(offline)throw Error('internal fixture secret');
 let r=await handleIdentityApiRequest(new Request(url,init),opts);
 if(dropAction&&url.endsWith('/relationships/actions')){dropAction=false;throw Error('lost ACK after commit');}
 if(revokeAfter&&url.endsWith('/relationships/state')){revokeAfter=false;await personal.pg.exec('update private.member_writing_families set revoked_at=clock_timestamp()');}
 if(mutate&&url.includes('/relationships/')){const d=await r.json();mutate(d);r=Response.json(d,{status:r.status,headers:r.headers});}
 if(losePermit&&url.endsWith('/relationships/review-permits')){losePermit=false;throw Error('lost permit ACK');}
 if(permitHook&&url.endsWith('/relationships/review-permits')){const hook=permitHook;permitHook=null;await hook();}
 return r;
};
const context={db:personal.db,fetcher,centralUrl,siteId:site(2)};
async function ccall(path,body,token,status=200,overrides={},extra={}){const r=await handleIdentityApiRequest(request(centralUrl+path,body,token,undefined,extra),{...opts,...overrides});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return {r,d};}
async function pcall(path,body,token,status=200,mode='member',extra={}){const r=await handleMemberWriting(request(config.SUPABASE_URL+'/functions/v1/member-writing'+path,body,token,undefined,{Origin:config.MINIHOMPY_SITE_ORIGIN,'X-Minihompy-Auth-Mode':mode,...extra}),{config,db:{rpc:async(name,args)=>{if(name==='member_friend_reviews'&&args.p_action==='create'&&failStore){failStore=false;return {error:{code:'fixture'}};}const r=await personal.db.rpc(name,args);if(name==='member_friend_reviews'&&args.p_action==='create'&&dropStore){dropStore=false;throw Error('lost local ACK');}return r;}},fetcher,transportPeerIp:'127.0.0.1'});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));assert.equal(r.headers.get('Cache-Control'),'no-store');return {r,d};}
const check=async(name,fn)=>{await fn();console.log(`PASS ${++groups}: ${name}`);};
async function login(n){const now=Math.floor(Date.now()/1000),v=randomSecret(),attempt=randomUUID();const s=await signToken({kind:'central_session',sub:member(n),central_session_id:session(n),session_version:1,iat:now,exp:now+86400},secret);const {d:p}=await ccall('/writing-proofs/issue',{central_session:s,target_site_id:site(2),code_challenge:await sha256(v),protocol:2,attempt_id:attempt,return_path:'/home/'});const data=(await pcall('/sessions/exchange',{writing_proof:p.writing_proof,code_verifier:v,protocol:2,attempt_id:attempt})).d;if(n===1)loginData=data;return data.session_token;}
const auth=token=>authenticateMember(request('https://personal.test/',undefined,token),context);
const args=(action,target,revision,request_id)=>({action,target_member_id:target,expected_revision:revision,operation_id:randomUUID(),...(request_id?{request_id}:{})});
const migration=await readFile(new URL('../supabase/migrations/202609240006_friend_reviews.sql',import.meta.url),'utf8');
let A,B,C,relation;
const review=(body='일촌평\n테스트')=>({operation_id:randomUUID(),body});
const create=(b=review(),token=A,status=200)=>pcall('/friend-reviews',b,token,status);
const remove=(id,token=A,status=200,mode='member')=>pcall('/friend-reviews/delete',{operation_id:randomUUID(),review_id:id},token,status,mode);
const list=(query='',status=200)=>pcall('/friend-reviews'+query,undefined,undefined,status,'public');
async function accept(){await central.pg.exec('reset role');await central.pg.exec('truncate private.identity_relationship_limits,private.identity_relationship_cooldowns');await central.pg.exec('set role service_role');const current=(await pcall('/relationships/state',{target_member_id:member(2)},A)).d;if(current.state==='accepted'){relation=current;return;}const pending=(await pcall('/relationships/actions',args('request',member(2),current.revision),A)).d.relationship;relation=(await pcall('/relationships/actions',args('accept',member(1),pending.revision,pending.request_id),B)).d.relationship;}
async function disconnect(){await pcall('/relationships/actions',args('disconnect',member(1),relation.revision,relation.request_id),B);}
const clearQuota=async()=>{await central.pg.exec('reset role');await central.pg.exec('truncate private.identity_relationship_limits');await central.pg.exec('set role service_role');};
const {chromium}=await import(pathToFileURL(resolve(process.argv[2]))),out=resolve(process.env.MINIHOMPY_REVIEW_UI_OUTPUT||'docs/verification/member-relationship-step7');await mkdir(out,{recursive:true});
const html=(await readFile('index.html','utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
try{
 await central.pg.exec('reset role');await seedRelationships(central.pg,10);await central.pg.exec('set role service_role');await personal.pg.exec(migration);
 await personal.pg.query('insert into auth.users values($1)',[member(9)]);await personal.pg.query('insert into private.minihompy_admins values($1)',[member(9)]);
 for(const width of [1280,375]){
  A=await login(1);B=await login(2);await accept();await personal.pg.exec('truncate private.friend_reviews,private.friend_review_operations,private.friend_review_limits');
  const page=await browser.newPage({viewport:{width,height:850}});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));const createIds=[];let dropBefore=false,lose=false,hold=false,release,holdRenew=false,releaseRenew,listError=false,creates=0;
  await page.route('**/*',async route=>{
   const r=route.request(),u=new URL(r.url());
   if(u.hostname==='central.test'){const response=await handleIdentityApiRequest(new Request(r.url(),{method:r.method(),headers:r.headers(),...(r.postData()?{body:r.postData()}: {})}),opts);return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});}
   if(u.origin===config.SUPABASE_URL){
    if(u.pathname.endsWith('/friend-reviews')&&r.method()==='POST'){createIds.push(r.postDataJSON().operation_id);if(dropBefore){dropBefore=false;return route.abort();}}
    if(listError&&u.pathname.endsWith('/friend-reviews')&&r.method()==='GET')return route.fulfill({status:503,json:{error:{code:'IDENTITY_UNAVAILABLE'}}});
    if(holdRenew&&u.pathname.endsWith('/sessions/renew'))await new Promise(r=>releaseRenew=r);
    const request=new Request(r.url(),{method:r.method(),headers:r.headers(),...(r.postData()?{body:r.postData()}: {})});
    const response=await handleMemberWriting(request,{config,db:personal.db,fetcher,transportPeerIp:'127.0.0.1'});const body=await response.text();
    if(u.pathname.endsWith('/friend-reviews')&&r.method()==='POST'){creates++;if(lose){lose=false;return route.abort();}}
    if(hold&&u.pathname.endsWith('/friend-reviews')&&r.method()==='GET')await new Promise(r=>release=r);
    return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});
   }
   const path=u.pathname.replace(/^\/home\//,'')||'index.html';if(path==='index.html')return route.fulfill({contentType:'text/html',body:html});
   try{return route.fulfill({body:await readFile(path),contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':undefined});}catch{return route.abort();}
  });
  await page.goto('https://m2.test/home/');
  await page.evaluate(({config,A,memberId,renewal})=>{
   window.MINIHOMPY_VISITOR_IDENTITY_CONFIG={enabled:true,siteId:config.MINIHOMPY_SITE_ID,centralApiUrl:config.MINIHOMPY_CENTRAL_API_URL};window.MINIHOMPY_SUPABASE={url:config.SUPABASE_URL};window.MINIHOMPY_MEMBER_WRITING_CONFIG={enabled:true};
   window.MinihompySharedIdentity={state:{status:'identified',visitor:{id:memberId,display_name:'Member 1',handle:'member1'}},retry:async()=>{}};
   window.MinihompyAdmin={state:{role:'visitor'}};window.MinihompyVisitorSession={context:async()=>({role:MinihompyAdmin.state.role,client:{auth:{getSession:async()=>({data:{session:{access_token:'local.owner.jwt'}}})}}})};
   sessionStorage.setItem('minihompy.member-writing.v1:'+config.MINIHOMPY_SITE_ID+':'+config.SUPABASE_URL,A);sessionStorage.setItem('minihompy.member-writing.v1:'+config.MINIHOMPY_SITE_ID+':'+config.SUPABASE_URL+':renewal',renewal);window.MINIHOMPY_VIEWS={};
  },{config,A,memberId:member(1),renewal:loginData.renewal_token});
  for(const file of ['member-writing-client.js','member-writing-runtime.js','member-relationships-repository.js','member-navigation.js','author-navigation.js','friend-reviews-repository.js','friend-reviews.js','views/home.js'])await page.addScriptTag({url:file});
  const mount=()=>page.evaluate(()=>{const target=document.querySelector('[data-view-slot="main"]');target.dataset.view='home';target.replaceChildren(MINIHOMPY_VIEWS.home.createMain());});
  await mount();const input=page.locator('.friend-reviews textarea'),action=k=>page.locator(`[data-review-action="${k}"]`),items=page.locator('.friend-reviews li'),status=page.locator('.friend-review-status');
  const ready=()=>page.waitForFunction(()=>{const b=document.querySelector('[data-review-action="save"]');return b&&!b.hidden&&!b.disabled;});
  await ready();assert.match(await page.locator('.friend-reviews').innerText(),/등록된 일촌평/);
  await input.fill('첫 번째 평 <b>그대로</b>');await page.evaluate(()=>{const form=document.querySelector('.friend-reviews form');form.requestSubmit();form.requestSubmit();});await page.waitForFunction(()=>document.querySelectorAll('.friend-reviews li').length===1&&document.querySelector('.friend-review-status').textContent.includes('완료'));assert.equal(creates,1);assert.equal(await items.locator('b').count(),0);assert.equal(await input.inputValue(),'');
  await page.waitForFunction(()=>document.querySelector('.friend-review-author')?.hasAttribute('href'));assert.match(await items.innerText(),/@member1/);
  console.log(`PASS ${++groups}: ${width}px real API create, empty list, duplicate submit guard, safe text, author link`);
  await clearQuota();for(let i=0;i<5;i++)await create(review('추가 '+i));await action('refresh').click();await page.waitForFunction(()=>document.querySelectorAll('.friend-reviews li').length===5);await action('next').click();await page.waitForFunction(()=>document.querySelectorAll('.friend-reviews li').length===1);await action('delete').click();await action('confirm').click();await page.waitForFunction(()=>document.querySelectorAll('.friend-reviews li').length===5&&!document.querySelector('[data-review-action="next"]'));
  console.log(`PASS ${++groups}: ${width}px real pagination and author deletion reset final page`);
  await personal.pg.query("insert into private.friend_reviews(site_id,author_member_id,display_name,body) values($1,$2,'비활성 옛 이름','비활성 작성자의 과거 평')",[site(2),member(3)]);
  await central.pg.exec('reset role');await central.pg.query("update private.identity_members set status='suspended' where id=$1",[member(3)]);await central.pg.query("update private.identity_sites set base_path='/latest/',homepage_url='https://m1.test/latest/',login_url='https://m1.test/latest/login/' where member_id=$1",[member(1)]);await central.pg.exec('set role service_role');
  await action('refresh').click();await page.waitForFunction(()=>document.querySelector('.friend-reviews li')?.textContent.includes('비활성 옛 이름'));await page.waitForFunction(()=>document.querySelector('.friend-reviews li .author-navigation')?.dataset.status==='unavailable');assert.equal(await items.first().locator('a[href]').count(),0);await page.waitForFunction(()=>[...document.querySelectorAll('.friend-review-author')].some(a=>a.href==='https://m1.test/latest/'));
  console.log(`PASS ${++groups}: ${width}px inactive historical author retained without home link, latest verified destination`);
  await ready();await input.fill('갱신 중 유지');await personal.pg.query("update private.member_writing_sessions set expires_at=clock_timestamp()+interval '30 seconds' where token_hash=$1",[await tokenHash(A)]);holdRenew=true;await page.evaluate(()=>{void MinihompyMemberWriting.retry();});await page.waitForFunction(()=>MinihompyMemberWriting.state.status==='renewing');assert.equal(await input.inputValue(),'갱신 중 유지');assert.equal(await action('save').isDisabled(),true);while(!releaseRenew)await new Promise(r=>setTimeout(r,10));holdRenew=false;releaseRenew();await ready();A=await page.evaluate(()=>sessionStorage.getItem('minihompy.member-writing.v1:'+MINIHOMPY_VISITOR_IDENTITY_CONFIG.siteId+':'+MINIHOMPY_SUPABASE.url));await page.evaluate(()=>dispatchEvent(new CustomEvent('minihompy:writing-reset',{detail:{clearDraft:false}})));assert.equal(await input.inputValue(),'갱신 중 유지');await action('refresh').click();await ready();
  await clearQuota();lose=true;await action('save').click();await page.waitForFunction(()=>document.querySelector('[data-review-action="recover"]')&&!document.querySelector('[data-review-action="recover"]').disabled);const before=creates;await action('recover').click();await page.waitForFunction(()=>!document.querySelector('[data-review-action="recover"]'));assert.equal(creates,before);assert.equal(await input.inputValue(),'');
  await ready();await clearQuota();await input.fill('미전송 작업');dropBefore=true;await action('save').click();await page.waitForFunction(()=>document.querySelector('[data-review-action="recover"]')&&!document.querySelector('[data-review-action="recover"]').disabled);await action('recover').click();await page.waitForFunction(()=>document.querySelector('[data-review-action="resend"]'));assert.equal(await action('save').isDisabled(),true);await action('resend').click();await page.waitForFunction(()=>!document.querySelector('[data-review-action="recover"]'));assert.equal(createIds.at(-1),createIds.at(-2));
  console.log(`PASS ${++groups}: ${width}px draft survives session refresh; lost ACK recovers with no duplicate POST`);
  await ready();await input.fill('끊긴 뒤 저장 시도');await disconnect();await action('save').click();await page.waitForFunction(()=>document.querySelector('.friend-review-status').textContent.includes('현재 일촌'));assert.equal(await input.inputValue(),'끊긴 뒤 저장 시도');assert.equal(await action('save').isHidden(),true);
  listError=true;await action('refresh').click();await page.waitForFunction(()=>document.querySelector('.friend-reviews').textContent.includes('목록을 불러오지 못'));listError=false;await action('refresh').click();await page.waitForFunction(()=>document.querySelectorAll('.friend-reviews li').length===5);
  console.log(`PASS ${++groups}: ${width}px relationship revoked at server, public list error/retry`);
  await page.evaluate(()=>{MinihompyAdmin.state={role:'admin',userId:'local-admin'};dispatchEvent(new CustomEvent('minihompy:identity'));});await page.waitForFunction(()=>document.querySelector('[data-review-action="delete"]')?.textContent==='관리자 삭제');offline=true;await action('delete').first().click();await action('confirm').click();await page.waitForFunction(()=>document.querySelector('.friend-review-status').textContent.includes('완료'));offline=false;
  await page.locator('.friend-reviews').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(out,`home-${width}.png`)});assert.equal(await page.evaluate(()=>{const el=document.querySelector('.friend-reviews');return el.scrollWidth<=el.clientWidth;}),true);
  console.log(`PASS ${++groups}: ${width}px explicit local admin delete during central outage, bounded content width`);
  await accept();await page.evaluate(()=>MinihompyMemberWriting.retry());await action('refresh').click();await ready();await input.fill('메뉴 나가면 폐기');await page.evaluate(()=>document.querySelector('[data-view-slot="main"]').replaceChildren());await mount();await ready();assert.equal(await input.inputValue(),'');await input.fill('다른 계정에 남지 않음');
  hold=true;await action('refresh').click();while(!release)await new Promise(r=>setTimeout(r,10));
  await page.evaluate(()=>{MinihompyAdmin.state={role:'visitor'};MinihompySharedIdentity.state={status:'anonymous'};dispatchEvent(new CustomEvent('minihompy:visitor-identity'));});hold=false;release();await page.waitForFunction(()=>document.querySelector('.friend-reviews textarea').value===''&&document.querySelector('[data-review-action="save"]').hidden);assert.equal(await action('delete').count(),0);
  await action('refresh').click();await page.waitForFunction(()=>document.querySelectorAll('.friend-reviews li').length>0);await action('refresh').focus();await page.keyboard.press('Enter');await page.evaluate(()=>{const owner={id:MINIHOMPY_VISITOR_IDENTITY_CONFIG.siteId,handle:'self',display_name:'내 홈'};MinihompySharedIdentity.state={status:'identified',visitor:owner};window.MinihompyNavigation={state:{owner,visitor:owner,status:'self'}};dispatchEvent(new CustomEvent('minihompy:navigation-state'));});assert.match(await page.locator('.friend-reviews').innerText(),/자신의 홈/);assert.equal(await action('save').isHidden(),true);assert.deepEqual(errors,[]);
  console.log(`PASS ${++groups}: ${width}px menu draft discard, identity switch drops stale authority/responses, anonymous read and keyboard retry`);
  await page.close();
 }
 console.log(`All ${groups} Chromium real repository/API/SQL review groups passed.`);
}finally{await browser.close();await central.pg.close();await personal.pg.close();}
