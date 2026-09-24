import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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
let losePermit=false,permitHook=null,failStore=false,dropStore=false,offline=false,dropAction=false,revokeAfter=false,mutate=null,groups=0;
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
async function login(n){const now=Math.floor(Date.now()/1000),v=randomSecret(),attempt=randomUUID();const s=await signToken({kind:'central_session',sub:member(n),central_session_id:session(n),session_version:1,iat:now,exp:now+86400},secret);const {d:p}=await ccall('/writing-proofs/issue',{central_session:s,target_site_id:site(2),code_challenge:await sha256(v),protocol:2,attempt_id:attempt,return_path:'/home/'});return (await pcall('/sessions/exchange',{writing_proof:p.writing_proof,code_verifier:v,protocol:2,attempt_id:attempt})).d.session_token;}
const auth=token=>authenticateMember(request('https://personal.test/',undefined,token),context);
const args=(action,target,revision,request_id)=>({action,target_member_id:target,expected_revision:revision,operation_id:randomUUID(),...(request_id?{request_id}:{})});
const migration=await readFile(new URL('../supabase/migrations/202609240006_friend_reviews.sql',import.meta.url),'utf8');
let A,B,C,relation;
const review=(body='일촌평\n테스트')=>({operation_id:randomUUID(),body});
const create=(b=review(),token=A,status=200)=>pcall('/friend-reviews',b,token,status);
const remove=(id,token=A,status=200,mode='member')=>pcall('/friend-reviews/delete',{operation_id:randomUUID(),review_id:id},token,status,mode);
const list=(query='',status=200)=>pcall('/friend-reviews'+query,undefined,undefined,status,'public');
async function accept(){await central.pg.exec('reset role');await central.pg.exec('truncate private.identity_relationship_limits,private.identity_relationship_cooldowns');await central.pg.exec('set role service_role');const current=(await pcall('/relationships/state',{target_member_id:member(2)},A)).d;const pending=(await pcall('/relationships/actions',args('request',member(2),current.revision),A)).d.relationship;relation=(await pcall('/relationships/actions',args('accept',member(1),pending.revision,pending.request_id),B)).d.relationship;}
async function disconnect(){await pcall('/relationships/actions',args('disconnect',member(1),relation.revision,relation.request_id),B);}
const clearQuota=async()=>{await central.pg.exec('reset role');await central.pg.exec('truncate private.identity_relationship_limits');await central.pg.exec('set role service_role');};
try{
 await central.pg.exec('reset role');await seedRelationships(central.pg,10);await central.pg.exec('set role service_role');
 A=await login(1);B=await login(2);C=await login(3);
 await check('additive migration preserves guestbook/comments/sessions and advertises local capability only when installed',async()=>{
  assert.equal((await pcall('/relationships/health',undefined,undefined,200,'public')).d.friend_reviews_ready,false);
  await personal.pg.query("insert into public.guestbook_posts(id,author_kind,author_member_id,author_name,body,author_homepage_url) values($1,'member',$2,'Legacy','Existing guestbook','https://m1.test/home/')",[member(90),member(1)]);
  await personal.pg.query("insert into public.post_comments(id,guestbook_post_id,author_kind,author_member_id,author_name,body,author_homepage_url) values($1,$2,'member',$3,'Legacy','Existing comment','https://m1.test/home/')",[member(91),member(90),member(1)]);
  const beforeContent=(await personal.pg.query('select to_jsonb(g) row from public.guestbook_posts g union all select to_jsonb(c) row from public.post_comments c')).rows;
  const before=await personal.pg.query('select id,member_id from private.member_writing_sessions order by id');
  await personal.pg.exec(migration);
  assert.deepEqual((await personal.pg.query('select id,member_id from private.member_writing_sessions order by id')).rows,before.rows);
  assert.equal((await pcall('/relationships/health',undefined,undefined,200,'public')).d.friend_reviews_ready,true);
  assert.deepEqual((await personal.pg.query('select to_jsonb(g) row from public.guestbook_posts g union all select to_jsonb(c) row from public.post_comments c')).rows,beforeContent);
 });
 await check('anonymous, owner, nonfriend, self, author/site/permit injection and malformed body are rejected',async()=>{
  await create(review(),null,401);await create(review(),C,403);await create(review(),B,403);
  await pcall('/friend-reviews',review(),'local.owner.jwt',403,'owner');
  for(const extra of [{author_member_id:member(2)},{site_id:site(1)},{permit:{}},{display_name:'forged'}])await create({...review(),...extra},A,400);
  for(const body of ['', 'x'.repeat(201),'a\tb','a\u0000b','a\rb'])await create(review(body),A,400);
  await pcall('/friend-reviews/delete',{operation_id:randomUUID(),review_id:'bad'},A,400);
 });
 await accept();
 let saved,body;
 await check('verified author/name, normalized Unicode body, public projection and keyset pages',async()=>{
  body=review('  첫 평\r\n😀  ');saved=(await create(body)).d;
  const second=(await create(review('둘째 평'))).d;
  const first=(await list('?limit=1')).d;assert.equal(first.items[0].id,second.id);assert.ok(first.next_cursor);
  const next=(await list('?limit=1&cursor='+first.next_cursor)).d;assert.equal(next.items[0].body,'첫 평\n😀');assert.equal(next.items[0].author_member_id,member(1));assert.equal(next.items[0].display_name,(await auth(A)).session.display_name);assert.equal(next.next_cursor,null);
  assert.deepEqual(Object.keys(next.items[0]).sort(),['author_member_id','body','created_at','display_name','id']);
  await list('?limit=1&limit=2',400);await list('?member_id='+member(2),400);await list('?cursor=bad',400);
  const c=JSON.parse(Buffer.from(first.next_cursor,'base64url'));c.site=site(1);await list('?cursor='+Buffer.from(JSON.stringify(c)).toString('base64url'),400);
 });
 await check('same operation dedupes, altered body conflicts, third party cannot delete/query receipts',async()=>{
  const again=(await create({...body,body:'첫 평\n😀'})).d;assert.equal(again.id,saved.id);assert.equal(again.replayed,true);
  await create({...body,body:'다른 본문'},A,409);await remove(saved.id,C,404);
  await pcall('/friend-reviews/operations',{operation_id:body.operation_id},C,404);
  assert.equal((await pcall('/friend-reviews/operations',{operation_id:body.operation_id},A)).d.id,saved.id);
 });
 await check('local commit ACK loss recovers one saved review without new permit; local failure retries same permit',async()=>{
  const one=review('ACK');dropStore=true;await create(one,A,503);const result=(await pcall('/friend-reviews/operations',{operation_id:one.operation_id},A)).d;assert.ok(result.id);assert.equal((await create(one)).d.id,result.id);
  const two=review('storage retry');failStore=true;await create(two,A,503);await pcall('/friend-reviews/operations',{operation_id:two.operation_id},A,404);assert.ok((await create(two)).d.id);
 });
 await check('permit precedes disconnect: in-flight save succeeds, new writes fail; historical author delete is allowed',async()=>{
  await clearQuota();permitHook=disconnect;const inflight=(await create(review('진행 중'))).d;await create(review('끊긴 후'),A,403);
  assert.ok((await list()).d.items.some(i=>i.id===inflight.id));await remove(saved.id);
  const retry=(await create(body)).d;assert.equal(retry.deleted,true);assert.equal(retry.id,saved.id);
  assert.ok(!(await list()).d.items.some(i=>i.id===saved.id));
 });
 await check('central outage rejects new writes/member deletes but public read and local admin delete remain available',async()=>{
  await personal.pg.query('insert into auth.users values($1)',[member(9)]);await personal.pg.query('insert into private.minihompy_admins values($1)',[member(9)]);
  const target=(await list()).d.items[0].id;offline=true;await create(review(),A,503);await remove(target,A,503);assert.ok((await list()).d.items.length);
  await remove(target,'local.owner.jwt',200,'owner');assert.equal((await pcall('/relationships/health',undefined,undefined,200,'public')).d.friend_reviews_ready,false);offline=false;
 });
 await check('direct REST table access and service-only RPC cannot be bypassed by browser roles or GUCs',async()=>{
  for(const role of ['anon','authenticated']){
   await personal.pg.exec('set role '+role);
   for(const query of ["select * from private.friend_reviews","insert into private.friend_reviews(site_id,author_member_id,display_name,body) values('"+site(2)+"','"+member(1)+"','fake','fake')","select public.member_friend_reviews('create','{}')","select * from private.friend_review_operations"]){await assert.rejects(personal.pg.exec(query),e=>e.code==='42501');}
   await personal.pg.exec('reset role');
  }
  await personal.pg.exec('set role service_role');await assert.rejects(personal.pg.exec('select * from private.friend_review_operations'),e=>e.code==='42501');await personal.pg.exec('reset role');
 });
 await accept();
 await check('service RPC consumes permit once and rejects mismatched actor/site/hash/session, deadline and replay',async()=>{
  const authenticated=await auth(A),b=review('SQL permit'),permit=await requestReviewPermit(context,authenticated,{operation_id:b.operation_id,body_sha256:await tokenHash(b.body)});
  const base={site_id:site(2),mode:'member',token_hash:authenticated.tokenHash,...b,permit,checked_at:new Date().toISOString()};
  const sql=async args=>(await personal.db.rpc('member_friend_reviews',{p_action:'create',p_args:args})).data;
  for(const changed of [{actor_member_id:member(3)},{site_id:site(1)},{central_session_id:session(3)},{body_sha256:'f'.repeat(64)},{owner_member_id:member(1)}])assert.equal((await sql({...base,permit:{...permit,...changed}})).failure,'TARGET_MISMATCH');
  assert.equal((await sql({...base,permit:{...permit,authorized_at:new Date(Date.now()-40000).toISOString(),expires_at:new Date(Date.now()-10000).toISOString()}})).failure,'PERMIT_EXPIRED');
  assert.equal((await sql({...base,checked_at:new Date(Date.now()-10000).toISOString()})).failure,'IDENTITY_UNAVAILABLE');
  const result=await sql(base);assert.ok(result.id);const other=review('SQL permit');assert.equal((await sql({...base,...other,permit:{...permit,operation_id:other.operation_id}})).failure,'REQUEST_CONFLICT');
 });
 await check('lost central permit response recovers original permit; expired unsaved operations never receive a renewed deadline',async()=>{
  await clearQuota();const b=review('permit ACK');losePermit=true;await create(b,A,503);assert.ok((await create(b)).d.id);
  const expired=review('expired unsaved');failStore=true;await create(expired,A,503);
  await central.pg.exec('reset role');await central.pg.query("update private.identity_review_permits set authorized_at=clock_timestamp()-interval '40 seconds',expires_at=clock_timestamp()-interval '10 seconds' where operation_id=$1",[expired.operation_id]);await central.pg.exec('set role service_role');
  assert.equal((await create(expired,A,409)).d.error.code,'PERMIT_EXPIRED');await pcall('/friend-reviews/operations',{operation_id:expired.operation_id},A,404);
 });
 await check('delete quota rejects new mutations while identical receipts remain recoverable and content stays deleted',async()=>{
  const target=(await list()).d.items[0].id,b={operation_id:randomUUID(),review_id:target};await pcall('/friend-reviews/delete',b,'local.owner.jwt',200,'owner');
  const bucket='delete:'+site(2)+':owner:'+member(9);await personal.pg.query("insert into private.friend_review_limits values($1,date_trunc('minute',clock_timestamp()),30) on conflict(bucket,window_start) do update set count=30",[bucket]);
  assert.equal((await pcall('/friend-reviews/delete',b,'local.owner.jwt',200,'owner')).d.replayed,true);
  const another=(await list()).d.items[0].id;await remove(another,'local.owner.jwt',429,'owner');assert.ok((await list()).d.items.some(i=>i.id===another));
 });
 await check('post-permit central logout and local logout are rechecked before commit',async()=>{
  await clearQuota();permitHook=async()=>{await personal.pg.exec('update private.member_writing_families set revoked_at=clock_timestamp()');};await create(review('local revoked'),A,401);
  A=await login(1);B=await login(2);
  permitHook=async()=>{await central.pg.exec('reset role');await central.pg.query('update private.identity_sessions set revoked_at=clock_timestamp() where id=$1',[session(1)]);await central.pg.exec('set role service_role');};await create(review('central revoked'),A,401);
 });
 await check('public quota is atomic; forged forwarding headers cannot create a new rate bucket',async()=>{
  await personal.pg.exec("update private.friend_review_limits set count=120 where bucket like 'public:%'");await list('',429);
  const r=await handleMemberWriting(request(config.SUPABASE_URL+'/functions/v1/member-writing/friend-reviews',undefined,undefined,'GET',{'X-Minihompy-Auth-Mode':'public','X-Forwarded-For':'other'}),{config,db:personal.db,fetcher,transportPeerIp:'127.0.0.1'});assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'60');
  const missing=await handleMemberWriting(request(config.SUPABASE_URL+'/functions/v1/member-writing/friend-reviews',undefined,undefined,'GET',{'X-Minihompy-Auth-Mode':'public','X-Forwarded-For':'127.0.0.1'}),{config,db:personal.db,fetcher});assert.equal(missing.status,503);
 });
 console.log(`All ${groups} friend-review handler/SQL groups passed. Real central/personal handlers and PGlite SQL; no hosted changes.`);
}finally{await central.pg.close();await personal.pg.close();}
