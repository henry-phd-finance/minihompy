// Step 1 prototype: actual existing authentication/SQL; proposed read context and content filtering are a TEST MODEL, not production APIs.
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
import {handleMemberWriting,tokenHash,authenticateMember,authenticateOwner} from '../supabase/functions/member-writing/handler.js';

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
const rows=[{id:'open',visibility:'public',body:'public fixture'},{id:'friend',visibility:'friends',body:'friend fixture'},{id:'secret',visibility:'private',body:'private fixture'}];
let clock=0;const requireOk=(condition,code)=>{if(!condition)throw Object.assign(Error(code),{code});};
// New API/transaction response fence is intentionally modeled. Existing grant,
// binding navigation, relationship state and local session checks below are real.
async function authorize(home,token){
 const h=homes[home],a=await authenticateMember(request('https://personal.test/',undefined,token),{db:h.db,fetcher,siteId:site(home),centralUrl});
 const ownerResponse=await fetcher(centralUrl+'/navigation/site?site_id='+site(home),{});requireOk(ownerResponse.ok,'IDENTITY_UNAVAILABLE');const owner=(await ownerResponse.json()).item;
 requireOk(owner.site_id===site(home),'TARGET_MISMATCH');
 const relation=await call(home,'/relationships/state',{target_member_id:owner.id},token);
 return {actor:a.session.member_id,site:site(home),owner:owner.id,centralSession:a.session.central_session_id,hash:a.tokenHash,friend:relation.state==='accepted',deadline:clock+5000,requestId:randomUUID()};
}
async function read(home,token,{between=async()=>{},contextMutator=x=>x}={}){
 const original=await authorize(home,token),ctx=contextMutator({...original});await between();
 for(const field of ['actor','site','owner','centralSession','hash','requestId'])requireOk(ctx[field]===original[field],'TARGET_MISMATCH');
 requireOk(clock<ctx.deadline&&ctx.deadline===original.deadline,'READ_CONTEXT_EXPIRED');
 const current=await homes[home].db.rpc('member_writing_session',{p_action:'current',p_args:{site_id:site(home),token_hash:ctx.hash}});
 requireOk(!current.error&&!current.data?.failure,current.data?.failure||'IDENTITY_UNAVAILABLE');requireOk(current.data.member_id===ctx.actor&&current.data.central_session_id===ctx.centralSession,'TARGET_MISMATCH');
 return rows.filter(x=>x.visibility==='public'||ctx.friend&&x.visibility==='friends');
}
const publicRead=()=>rows.filter(x=>x.visibility==='public');
let ab,ba,cb,aa;
try{
 await central.pg.exec('reset role');await seedRelationships(central.pg,3);await central.pg.exec('set role service_role');
 for(const n of [1,2]){const fixture=await memberWritingDb(PGlite,{siteId:site(n),centralUrl,photoMedia:true});homes[n]={...fixture,config:{MINIHOMPY_SITE_ORIGIN:`https://m${n}.test`,MINIHOMPY_SITE_ID:site(n),MINIHOMPY_CENTRAL_API_URL:centralUrl,SUPABASE_URL:`https://${String.fromCharCode(96+n).repeat(20)}.supabase.co`,MINIHOMPY_PUBLIC_KEY:'fixture'}};}
 ab=await login(1,2);ba=await login(2,1);cb=await login(3,2);aa=await login(1,1);
 await check('UUID alone and a session for another personal site fail existing server authentication',async()=>{
  await assert.rejects(read(2,member(1)),e=>e.code==='AUTH_REQUIRED');await assert.rejects(read(2,aa.session_token),e=>['SESSION_EXPIRED','AUTH_REQUIRED','SESSION_REVOKED'].includes(e.code));
 });
 await check('non-friend and pending request see public only through modeled predicate',async()=>{
  assert.deepEqual((await read(2,ab.session_token)).map(x=>x.id),['open']);
  await act(2,ab.session_token,2,'request',await state(2,ab.session_token,2));assert.deepEqual((await read(2,ab.session_token)).map(x=>x.id),['open']);
 });
 await check('accepted A→B sees public+friends; third C never sees friends or private',async()=>{
  await act(1,ba.session_token,1,'accept',await state(1,ba.session_token,1));
  assert.deepEqual((await read(2,ab.session_token)).map(x=>x.id),['open','friend']);assert.deepEqual((await read(2,cb.session_token)).map(x=>x.id),['open']);
 });
 await check('site/actor/session/owner/request binding rejects injected contexts',async()=>{
  for(const field of ['actor','site','owner','centralSession','hash','requestId'])await assert.rejects(read(2,ab.session_token,{contextMutator:c=>({...c,[field]:'forged'})}),e=>e.code==='TARGET_MISMATCH');
 });
 await check('central outage blocks protected member resolution without breaking public or local owner path',async()=>{
  centralDown=true;await assert.rejects(read(2,ab.session_token),e=>e.code==='IDENTITY_UNAVAILABLE');assert.deepEqual(publicRead().map(x=>x.id),['open']);
  const h=homes[2],owner=member(20);await h.pg.query('insert into auth.users(id) values($1)',[owner]);await h.pg.query('insert into private.minihompy_admins(user_id) values($1)',[owner]);
  let authCalls=0;const ownerFetch=async(url)=>{authCalls++;if(url.endsWith('/auth/v1/user'))return Response.json({id:owner,is_anonymous:false});assert.ok(url.endsWith('/is_minihompy_admin'));await h.pg.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);return Response.json((await h.pg.query('select public.is_minihompy_admin() yes')).rows[0].yes);};
  const o=await authenticateOwner(request('https://personal.test/',undefined,'fixture.owner.jwt'),{projectUrl:h.config.SUPABASE_URL,publicKey:'fixture',fetcher:ownerFetch});assert.equal(o.local_user_id,owner);assert.equal(authCalls,2);assert.equal(rows.length,3);centralDown=false;
 });
 await check('disconnect before a new check denies friends; in-flight authorization is bounded, not retroactively recalled',async()=>{
  const first=await read(2,ab.session_token,{between:async()=>{await act(1,ba.session_token,1,'disconnect',await state(1,ba.session_token,1));clock+=1000;}});assert.deepEqual(first.map(x=>x.id),['open','friend']);assert.deepEqual((await read(2,ab.session_token)).map(x=>x.id),['open']);
  await assert.rejects(read(2,ab.session_token,{between:async()=>{clock+=5000;}}),e=>e.code==='READ_CONTEXT_EXPIRED');
 });
 await check('latest personal visibility wins over earlier central authorization',async()=>{
  await quota();await act(2,ab.session_token,2,'request',await state(2,ab.session_token,2));await act(1,ba.session_token,1,'accept',await state(1,ba.session_token,1));
  const result=await read(2,ab.session_token,{between:async()=>{rows[1].visibility='private';}});assert.deepEqual(result.map(x=>x.id),['open']);rows[1].visibility='friends';
 });
 await check('local logout during authorization-to-response interval wins at actual SQL session recheck',async()=>{
  await assert.rejects(read(2,ab.session_token,{between:()=>call(2,'/sessions/revoke',{},ab.renewal_token)}),e=>e.code==='SESSION_REVOKED');
 });
 await check('central revocation wins on the next request even if local member session exists',async()=>{
  const another=await login(1,2);await central.pg.exec('reset role');await central.pg.query('update private.identity_sessions set revoked_at=clock_timestamp() where id=$1',[session(1)]);await central.pg.exec('set role service_role');
  await assert.rejects(read(2,another.session_token),e=>e.code==='SESSION_REVOKED');
 });
 console.log(`All ${groups} Step 1 prototype groups passed. Proposed read context/predicate uses a deterministic model; no new production read endpoint or migration, no hosted writes.`);
}finally{for(const h of Object.values(homes))await h.pg.close();await central.pg.close();}
