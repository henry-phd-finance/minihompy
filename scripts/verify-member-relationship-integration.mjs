// Three isolated databases: central, A and B. Third member C is local fixture only.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {createIdentityDb} from '../../minihompy-central/scripts/helpers/identity-db.mjs';
import {seedRelationships,member,site,session} from '../../minihompy-central/scripts/helpers/relationship-fixture.mjs';
import {handleIdentityApiRequest} from '../../minihompy-central/supabase/functions/identity-api/handler.js';
import {sha256,randomSecret} from '../../minihompy-central/supabase/functions/_shared/auth-proof.js';
import {signToken} from '../../minihompy-central/supabase/functions/_shared/tokens.js';
import {handleMemberWriting,tokenHash} from '../supabase/functions/member-writing/handler.js';
import {relationshipBrowserFlow} from './helpers/relationship-browser-flow.mjs';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
const centralUrl='https://central.test/functions/v1/identity-api',secret='integration-fixture-only-secret-at-least-32-characters';
const central=await createIdentityDb(),homes={};let centralDown=false,downHome=null,dropAction=false,dropStore=false,groups=0;
const options={supabaseClient:central.db,centralSecret:secret,allowedOrigins:new Set(['https://m1.test','https://m2.test']),transportPeerIp:'127.0.0.1'};
const request=(url,body,token,extra={})=>new Request(url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function centralCall(path,body,token,expected=200){const response=await handleIdentityApiRequest(request(centralUrl+path,body,token),options),d=await response.json();assert.equal(response.status,expected,JSON.stringify(d));return d;}
const fetcher=async(url,init)=>{
 if(centralDown)throw Error('Central unavailable');assert.ok(url.startsWith(centralUrl));
 const r=await handleIdentityApiRequest(new Request(url,init),options);
 if(dropAction&&url.endsWith('/relationships/actions')){dropAction=false;throw Error('lost central action acknowledgement');}return r;
};
async function call(home,path,body,credential,expected=200,mode='member',origin){
 const h=homes[home],r=await handleMemberWriting(request(h.config.SUPABASE_URL+'/functions/v1/member-writing'+path,body,credential,{Origin:origin||h.config.MINIHOMPY_SITE_ORIGIN,'X-Minihompy-Auth-Mode':mode}),{config:h.config,fetcher,transportPeerIp:'127.0.0.1',db:{rpc:async(name,args)=>{
  if(downHome===home)return {error:{code:'offline'}};const r=await h.db.rpc(name,args);
  if(dropStore&&name==='member_friend_reviews'&&args.p_action==='create'){dropStore=false;throw Error('lost store acknowledgement');}return r;
 }}});const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));assert.equal(r.headers.get('Cache-Control'),'no-store');return data;
}
async function login(n,home){const now=Math.floor(Date.now()/1000),verifier=randomSecret(),attempt=randomUUID(),token=await signToken({kind:'central_session',sub:member(n),central_session_id:session(n),session_version:1,iat:now,exp:now+86400},secret);
 const p=await centralCall('/writing-proofs/issue',{central_session:token,target_site_id:site(home),code_challenge:await sha256(verifier),protocol:2,attempt_id:attempt,return_path:'/home/'});
 return call(home,'/sessions/exchange',{writing_proof:p.writing_proof,code_verifier:verifier,protocol:2,attempt_id:attempt});
}
const state=(h,t,target)=>call(h,'/relationships/state',{target_member_id:member(target)},t);
const act=(h,t,target,verb,s,status=200,operation=randomUUID())=>call(h,'/relationships/actions',{operation_id:operation,target_member_id:member(target),action:verb,expected_revision:s.revision,...(verb==='request'?{}:{request_id:s.request_id})},t,status);
const write=(h,t,body,op=randomUUID(),status=200)=>call(h,'/friend-reviews',{operation_id:op,body},t,status);
const reviews=h=>call(h,'/friend-reviews',undefined,undefined,200,'public');
const friends=n=>centralCall('/relationships/friends?member_id='+member(n));
const quota=async()=>{await central.pg.exec('reset role;truncate private.identity_relationship_limits,private.identity_relationship_cooldowns;set role service_role');};
const check=async(name,fn)=>{await fn();console.log(`PASS ${++groups}: ${name}`);};
let aa,ab,ba,bb,ca,cb,tab,requestState,reviewA,reviewB;
try{
 await central.pg.exec('reset role');await seedRelationships(central.pg,3);await central.pg.exec('set role service_role');
 for(const n of [1,2]){const fixture=await memberWritingDb(PGlite,{siteId:site(n),centralUrl,photoMedia:true});await fixture.pg.exec(await readFile(new URL('../supabase/migrations/202609240006_friend_reviews.sql',import.meta.url),'utf8'));homes[n]={...fixture,config:{MINIHOMPY_SITE_ORIGIN:`https://m${n}.test`,MINIHOMPY_SITE_ID:site(n),MINIHOMPY_CENTRAL_API_URL:centralUrl,SUPABASE_URL:`https://${String.fromCharCode(96+n).repeat(20)}.supabase.co`,MINIHOMPY_PUBLIC_KEY:'fixture'}};}
 aa=await login(1,1);ab=await login(1,2);ba=await login(2,1);bb=await login(2,2);ca=await login(3,1);cb=await login(3,2);tab=await login(1,2);
 if(process.argv[2]){await relationshipBrowserFlow({playwright:process.argv[2],homes,options,fetcher,member,credentials:{1:{1:aa,2:ab},2:{1:ba,2:bb},3:{1:ca,2:cb}}});for(const h of Object.values(homes))await h.pg.exec('truncate private.friend_reviews,private.friend_review_operations,private.friend_review_limits');await quota();}

 await check('isolated A/B credentials, cross-origin requests and injected actor/site cannot bypass verified target',async()=>{
  assert.notEqual(homes[1].pg,homes[2].pg);await state(1,aa.session_token,2);await state(2,ab.session_token,2);
  await call(2,'/sessions/current',undefined,aa.session_token,401);
  await call(2,'/relationships/state',{target_member_id:member(2)},ab.session_token,403,'member','https://m1.test');
  await call(2,'/relationships/requests',{direction:'incoming',member_id:member(2)},cb.session_token,400);
  await call(2,'/friend-reviews',{operation_id:randomUUID(),body:'forged',site_id:site(1)},ab.session_token,400);
 });
 await check('A requests B while visiting B; B sees own incoming queue from A and accepts there',async()=>{
  requestState=(await act(2,ab.session_token,2,'request',await state(2,ab.session_token,2))).relationship;
  assert.equal((await call(1,'/relationships/requests',{direction:'incoming'},ba.session_token)).items[0].target.member_id,member(1));
  assert.equal((await call(2,'/relationships/requests',{direction:'incoming'},cb.session_token)).items.length,0);
  await act(1,ba.session_token,1,'accept',await state(1,ba.session_token,1));
  assert.equal((await state(2,ab.session_token,2)).state,'accepted');assert.equal((await state(1,ba.session_token,1)).state,'accepted');
 });
 await check('both public friend lists resolve latest verified home and cross-home review bodies stay in target DB only',async()=>{
  assert.equal((await friends(1)).items[0].member_id,member(2));assert.equal((await friends(2)).items[0].member_id,member(1));
  const nav=await centralCall('/navigation/members?member_ids='+member(2));assert.equal(nav.items[0].homepage_url,'https://m2.test/home/');
  reviewB=await write(2,ab.session_token,'A → B');reviewA=await write(1,ba.session_token,'B → A');
  assert.deepEqual((await reviews(2)).items.map(x=>x.body),['A → B']);assert.deepEqual((await reviews(1)).items.map(x=>x.body),['B → A']);
  await write(2,cb.session_token,'C is not a friend',undefined,403);
  await call(1,'/friend-reviews/delete',{operation_id:randomUUID(),review_id:reviewB.id},aa.session_token,404);
  await call(2,'/friend-reviews/delete',{operation_id:randomUUID(),review_id:reviewB.id},cb.session_token,404);
 });
 await check('friendship grants neither local admin nor private post/folder access; private content stays absent from home summary',async()=>{
  const pg=homes[2].pg,localOwner=randomUUID(),post=randomUUID();await pg.query('insert into auth.users values($1),($2)',[localOwner,member(1)]);await pg.query('insert into private.minihompy_admins values($1)',[localOwner]);
  const folder=(await pg.query('select id from public.board_folders limit 1')).rows[0].id;
  await pg.exec('set session_replication_role=replica');await pg.query("insert into public.board_posts(id,folder_id,author_id,author_name,title,body,visibility) values($1,$2,$3,'owner','PRIVATE SENTINEL','secret','private')",[post,folder,localOwner]);await pg.exec('set session_replication_role=origin');
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[member(1)]);await pg.exec('set role authenticated');
  assert.equal((await pg.query('select public.is_minihompy_admin() value')).rows[0].value,false);
  assert.equal((await pg.query('select count(*)::int n from public.board_posts where id=$1',[post])).rows[0].n,0);
  assert.ok(!JSON.stringify((await pg.query('select public.home_summary() value')).rows).includes('PRIVATE SENTINEL'));
  assert.equal((await pg.query("select public.manage_content_folders('create',$1) value",[{menu:'board',id:randomUUID(),kind:'folder',label:'forged',expected_revision:0,request_id:randomUUID()}])).rows[0].value.failure,'FORBIDDEN');
  await pg.exec('reset role');await call(2,'/relationships/state',{target_member_id:member(2)},'local.owner.jwt',403,'owner');
 });
 await check('separate tab receives stale revision conflict after disconnect; old reviews remain and author may delete them',async()=>{
  const stale=await state(2,tab.session_token,2);await act(1,ba.session_token,1,'disconnect',await state(1,ba.session_token,1));await act(2,tab.session_token,2,'disconnect',stale,409);
  assert.equal((await friends(1)).items.length,0);assert.equal((await friends(2)).items.length,0);assert.equal((await reviews(2)).items[0].id,reviewB.id);
  await write(2,ab.session_token,'stale editor',undefined,403);
  await call(2,'/friend-reviews/delete',{operation_id:randomUUID(),review_id:reviewB.id},ab.session_token);
  assert.equal((await reviews(2)).items.length,0);assert.equal((await reviews(1)).items.length,1);
 });
 await check('reject, resubmit, cancel, resubmit never make friends automatically and old request generations cannot act',async()=>{
  await quota();const first=(await act(2,ab.session_token,2,'request',await state(2,ab.session_token,2))).relationship;await act(1,ba.session_token,1,'reject',await state(1,ba.session_token,1));
  await quota();const second=(await act(2,ab.session_token,2,'request',await state(2,ab.session_token,2))).relationship;assert.notEqual(first.request_id,second.request_id);await act(2,ab.session_token,2,'cancel',second);
  await quota();const third=(await act(1,ba.session_token,1,'request',await state(1,ba.session_token,1))).relationship;assert.equal(third.state,'outgoing');await act(2,ab.session_token,2,'accept',{...third,request_id:first.request_id},409);await act(2,ab.session_token,2,'accept',await state(2,ab.session_token,2));
 });
 await check('lost relationship acknowledgement and lost personal save recover existing operation without duplicating mutations',async()=>{
  const s=await state(2,ab.session_token,2),op=randomUUID();dropAction=true;await act(2,ab.session_token,2,'disconnect',s,503,op);const result=await call(2,'/relationships/operations',{operation_id:op},tab.session_token);assert.equal(result.relationship.state,'none');
  await quota();await act(2,ab.session_token,2,'request',await state(2,ab.session_token,2));await act(1,ba.session_token,1,'accept',await state(1,ba.session_token,1));
  const reviewOp=randomUUID();dropStore=true;await write(2,ab.session_token,'saved once',reviewOp,503);const recovered=await call(2,'/friend-reviews/operations',{operation_id:reviewOp},tab.session_token);assert.equal((await write(2,ab.session_token,'saved once',reviewOp)).id,recovered.id);assert.equal((await reviews(2)).items.length,1);
  await call(2,'/friend-reviews/operations',{operation_id:reviewOp},cb.session_token,404);
 });
 await check('central outage prevents new writes while A/B public history stays available; B DB outage does not affect A',async()=>{
  centralDown=true;await write(2,ab.session_token,'offline',undefined,503);assert.equal((await reviews(1)).items.length,1);assert.equal((await reviews(2)).items.length,1);centralDown=false;
  downHome=2;await call(2,'/friend-reviews',undefined,undefined,503,'public');assert.equal((await reviews(1)).items.length,1);assert.equal((await state(1,ba.session_token,1)).state,'accepted');downHome=null;
 });
 await check('expired local access token renews from its family; revoking one tab blocks its renewed tokens but not independent login',async()=>{
  await homes[2].pg.query("update private.member_writing_sessions set issued_at=clock_timestamp()-interval '2 seconds',expires_at=clock_timestamp()-interval '1 second' where token_hash=$1",[await tokenHash(ab.session_token)]);
  await call(2,'/sessions/current',undefined,ab.session_token,401);const renewed=await call(2,'/sessions/renew',{},ab.renewal_token);assert.equal(renewed.actor.member_id,member(1));
  await state(2,renewed.session_token,2);await call(2,'/sessions/revoke',{},ab.renewal_token);await call(2,'/sessions/current',undefined,renewed.session_token,401);await state(2,tab.session_token,2);
 });
 await check('central login revocation invalidates member on both homes without erasing public content',async()=>{
  await central.pg.exec('reset role');await central.pg.query('update private.identity_sessions set revoked_at=clock_timestamp() where id=$1',[session(1)]);await central.pg.exec('set role service_role');
  await call(1,'/relationships/state',{target_member_id:member(2)},aa.session_token,401);await call(2,'/relationships/state',{target_member_id:member(2)},tab.session_token,401);
  assert.equal((await reviews(1)).items.length,1);assert.equal((await reviews(2)).items.length,1);
 });
 console.log(`All ${groups} isolated central/A/B/C relationship integration groups passed.`);
}finally{for(const h of Object.values(homes))await h.pg.close();await central.pg.close();}
