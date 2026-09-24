import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {handleMemberWriting,authenticateMember} from '../supabase/functions/member-writing/handler.js';
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
let offline=false,dropAction=false,revokeAfter=false,mutate=null,groups=0;
const request=(url,body,token,method=body===undefined?'GET':'POST',extra={})=>new Request(url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
const fetcher=async(url,init)=>{
 assert.ok(url.startsWith(centralUrl));assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.ok(init.signal);
 if(offline)throw Error('internal fixture secret');
 let r=await handleIdentityApiRequest(new Request(url,init),opts);
 if(dropAction&&url.endsWith('/relationships/actions')){dropAction=false;throw Error('lost ACK after commit');}
 if(revokeAfter&&url.endsWith('/relationships/state')){revokeAfter=false;await personal.pg.exec('update private.member_writing_families set revoked_at=clock_timestamp()');}
 if(mutate&&url.includes('/relationships/')){const d=await r.json();mutate(d);r=Response.json(d,{status:r.status,headers:r.headers});}
 return r;
};
const context={db:personal.db,fetcher,centralUrl,siteId:site(2)};
async function ccall(path,body,token,status=200,overrides={},extra={}){const r=await handleIdentityApiRequest(request(centralUrl+path,body,token,undefined,extra),{...opts,...overrides});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return {r,d};}
async function pcall(path,body,token,status=200,mode='member',extra={}){const r=await handleMemberWriting(request(config.SUPABASE_URL+'/functions/v1/member-writing'+path,body,token,undefined,{Origin:config.MINIHOMPY_SITE_ORIGIN,'X-Minihompy-Auth-Mode':mode,...extra}),{config,db:personal.db,fetcher});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));assert.equal(r.headers.get('Cache-Control'),'no-store');return {r,d};}
const check=async(name,fn)=>{await fn();console.log(`PASS ${++groups}: ${name}`);};
async function login(n){const now=Math.floor(Date.now()/1000),v=randomSecret(),attempt=randomUUID();const s=await signToken({kind:'central_session',sub:member(n),central_session_id:session(n),session_version:1,iat:now,exp:now+86400},secret);const {d:p}=await ccall('/writing-proofs/issue',{central_session:s,target_site_id:site(2),code_challenge:await sha256(v),protocol:2,attempt_id:attempt,return_path:'/home/'});return (await pcall('/sessions/exchange',{writing_proof:p.writing_proof,code_verifier:v,protocol:2,attempt_id:attempt})).d.session_token;}
const auth=token=>authenticateMember(request('https://personal.test/',undefined,token),context);
const args=(action,target,revision,request_id)=>({action,target_member_id:target,expected_revision:revision,operation_id:randomUUID(),...(request_id?{request_id}:{})});
let A,B,rawGrant,submitted,rid;
try{
 assert.equal(await readFile(new URL('../supabase/functions/member-writing/relationship-protocol.js',import.meta.url),'utf8'),await readFile(root+'/supabase/functions/_shared/relationship-protocol.js','utf8'));
 await central.pg.exec('reset role');await seedRelationships(central.pg,5);await central.pg.exec('set role service_role');A=await login(1);B=await login(2);rawGrant=(await auth(A)).session.central_grant;
 await check('health probes DB capability; private relay reports ready but reviews remain unavailable',async()=>{
  assert.equal((await ccall('/health')).d.relationship_protocol,1);
  assert.equal((await ccall('/health',undefined,undefined,200,{supabaseClient:{rpc:async()=>({error:{code:'missing'}})}})).d.relationship_protocol,0);
  assert.deepEqual((await pcall('/relationships/health',undefined,undefined,200,'public')).d,{relationship_protocol:1,relationship_relay_ready:true,friend_reviews_ready:false});
 });
 await check('personal verified session forwards server grant, never caller actor/site/owner JWT',async()=>{
  assert.equal((await pcall('/relationships/state',{target_member_id:member(2)},A)).d.state,'none');
  for(const extra of [{member_id:member(2)},{site_id:site(1)},{grant_hash:'fake'}])await pcall('/relationships/state',{target_member_id:member(2),...extra},A,400);
  await pcall('/relationships/state',{target_member_id:member(2)},'local.owner.jwt',403,'owner');
  await pcall('/relationships/state',{target_member_id:member(2)},'local.owner.jwt',401);
  await pcall('/relationships/state',{target_member_id:member(2)},undefined,401);
  await pcall('/relationships/state',{target_member_id:member(2)},undefined,403,'public');
 });
 await check('central rejects guessed UUID, site mismatch, identity injection, method/body/query violations',async()=>{
  const body={site_id:site(2),target_member_id:member(2)};
  await ccall('/relationships/state',body,member(1),401);
  await ccall('/relationships/state',{...body,site_id:site(1)},rawGrant,403);
  await ccall('/relationships/state',{...body,actor:member(2)},rawGrant,400);
  await ccall('/relationships/state',undefined,rawGrant,405);
  await ccall('/relationships/state?x=1',body,rawGrant,400);
  await ccall('/relationships/state',body,rawGrant,400,{}, {'Content-Type':'text/plain'});
  await ccall('/relationships/state',{...body,padding:'x'.repeat(9000)},rawGrant,400);
  await pcall('/relationships/review-permits',{operation_id:randomUUID(),body_sha256:'a'.repeat(64)},A,404);
 });
 await check('request, accept and result recovery execute against actual central/personal SQL',async()=>{
  submitted=args('request',member(2),0);const {d}=await pcall('/relationships/actions',submitted,A);rid=d.relationship.request_id;assert.equal(d.relationship.state,'outgoing');
  assert.ok(!JSON.stringify(d).includes(rawGrant));
  for(const extra of [{member_id:member(2)},{actor_member_id:member(2)},{site_id:site(1)}])await pcall('/relationships/requests',{direction:'incoming',...extra},A,400);
  assert.equal((await pcall('/relationships/requests',{direction:'incoming'},A)).d.items.length,0);
  await ccall('/relationships/requests',{site_id:site(2),direction:'incoming',member_id:member(2)},rawGrant,400);
  const inbox=(await pcall('/relationships/requests',{direction:'incoming'},B)).d;assert.equal(inbox.items[0].request_id,rid);
  await pcall('/relationships/actions',args('accept',member(1),1,rid),B);
  const old=(await pcall('/relationships/operations',{operation_id:submitted.operation_id},A)).d;assert.equal(old.relationship.state,'accepted');assert.equal(old.operation_result.relationship.state,'outgoing');
  await pcall('/relationships/actions',{...submitted,target_member_id:member(3)},A,409);
  await pcall('/relationships/operations',{operation_id:submitted.operation_id},B,404);
 });
 await check('public profiles need trusted transport address, not user forwarding headers',async()=>{
  const path='/relationships/friends?member_id='+member(1);
  const d=(await ccall(path)).d;assert.equal(d.items[0].member_id,member(2));assert.deepEqual(Object.keys(d.items[0]).sort(),['destination','display_name','handle','member_id']);
  await ccall(path,undefined,undefined,503,{transportPeerIp:undefined},{'X-Forwarded-For':'1.2.3.4','CF-Connecting-IP':'1.2.3.4'});
  await ccall(path+'&ip_hash='+'a'.repeat(64),undefined,undefined,400);
  await ccall(path+'&member_id='+member(2),undefined,undefined,400);
 });
 await check('wire cursors round-trip and cannot cross list owner/direction',async()=>{
  const C=await login(3),D=await login(4),E=await login(5);
  let d=(await pcall('/relationships/actions',args('request',member(1),0),C)).d;
  await pcall('/relationships/actions',args('accept',member(3),1,d.relationship.request_id),A);
  const first=(await ccall('/relationships/friends?member_id='+member(1)+'&limit=1')).d;
  assert.equal(typeof first.next_cursor,'string');
  const second=(await ccall('/relationships/friends?member_id='+member(1)+'&limit=1&cursor='+first.next_cursor)).d;
  assert.notEqual(first.items[0].member_id,second.items[0].member_id);
  await ccall('/relationships/friends?member_id='+member(2)+'&cursor='+first.next_cursor,undefined,undefined,400);
  for(const token of [D,E])await pcall('/relationships/actions',args('request',member(2),0),token);
  for(const extra of [{member_id:member(2)},{actor_member_id:member(2)},{site_id:site(1)}])await pcall('/relationships/requests',{direction:'incoming',...extra},A,400);
  assert.equal((await pcall('/relationships/requests',{direction:'incoming'},A)).d.items.length,0);
  await ccall('/relationships/requests',{site_id:site(2),direction:'incoming',member_id:member(2)},rawGrant,400);
  const inbox=(await pcall('/relationships/requests',{direction:'incoming',limit:1},B)).d;
  assert.equal(typeof inbox.next_cursor,'string');
  await pcall('/relationships/requests',{direction:'incoming',limit:1,cursor:inbox.next_cursor},B);
  await pcall('/relationships/requests',{direction:'outgoing',cursor:inbox.next_cursor},B,400);
  await pcall('/relationships/requests',{direction:'incoming',cursor:inbox.next_cursor},A,400);
  await pcall('/relationships/requests',{direction:'incoming',cursor:'not-json'},A,400);
 });
 await check('new permits remain server-only; validate owner/site/member/session/hash/deadline and clock',async()=>{
  const a=await auth(A),body={operation_id:randomUUID(),body_sha256:'a'.repeat(64)};
  const p=await requestReviewPermit(context,a,body);assert.equal(p.owner_member_id,member(2));
  for(const change of [d=>d.site_id=site(1),d=>d.actor_member_id=member(2),d=>d.owner_member_id=member(3),d=>d.central_session_id=session(2),d=>d.body_sha256='b'.repeat(64)]){mutate=change;await assert.rejects(requestReviewPermit(context,a,body),e=>e.code==='TARGET_MISMATCH');}
  mutate=d=>d.server_time=new Date(Date.now()+60000).toISOString();await assert.rejects(requestReviewPermit(context,a,body),e=>e.code==='IDENTITY_UNAVAILABLE');mutate=null;
 });
 await check('unexpected response fields are stripped; wrong target response is refused',async()=>{
  mutate=d=>{d.central_grant='private';d.target.password='private';};const d=(await pcall('/relationships/state',{target_member_id:member(2)},A)).d;assert.ok(!JSON.stringify(d).includes('private'));
  mutate=d=>d.target.member_id=member(3);await pcall('/relationships/state',{target_member_id:member(2)},A,403);mutate=null;
 });
 await check('lost successful action response is recovered by ID, never silently resubmitted',async()=>{
  const op=args('disconnect',member(2),2,rid);dropAction=true;await pcall('/relationships/actions',op,A,503);
  const d=(await pcall('/relationships/operations',{operation_id:op.operation_id},A)).d;assert.equal(d.relationship.state,'none');
  const again=(await pcall('/relationships/actions',op,A)).d;assert.deepEqual(again,d);
 });
 await check('503, 404, 409 and 429 stay distinct and Retry-After survives relay CORS',async()=>{
  offline=true;const e=(await pcall('/relationships/state',{target_member_id:member(2)},A,503)).d;assert.ok(!JSON.stringify(e).includes('internal'));offline=false;
  await pcall('/relationships/operations',{operation_id:randomUUID()},A,404);
  await pcall('/relationships/actions',args('accept',member(2),0,rid),A,409);
  await central.pg.exec('reset role');await central.pg.query("insert into private.identity_relationship_limits values($1,floor(extract(epoch from clock_timestamp())/60)::bigint,120) on conflict(bucket,window_start) do update set hits=120",['read:'+member(1)+':'+site(2)]);await central.pg.exec('set role service_role');
  const {r}=await pcall('/relationships/state',{target_member_id:member(2)},A,429);assert.equal(r.headers.get('Retry-After'),'60');assert.equal(r.headers.get('Access-Control-Expose-Headers'),'Retry-After');
  await central.pg.exec('reset role');await central.pg.exec('delete from private.identity_relationship_limits');await central.pg.exec('set role service_role');
 });
 await check('public rate limit cannot be reset by forged forwarding headers; CORS and backend failure are bounded',async()=>{
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(opts.transportPeerIp));const ip=[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
  await central.pg.exec('reset role');await central.pg.query("insert into private.identity_relationship_limits values($1,floor(extract(epoch from clock_timestamp())/60)::bigint,120) on conflict(bucket,window_start) do update set hits=120",['public:'+ip]);await central.pg.exec('set role service_role');
  const {r}=await ccall('/relationships/friends?member_id='+member(1),undefined,undefined,429,{}, {'X-Forwarded-For':'192.0.2.99'});assert.equal(r.headers.get('Retry-After'),'60');assert.equal(r.headers.get('Access-Control-Expose-Headers'),'Retry-After');
  await central.pg.exec('reset role');await central.pg.exec('delete from private.identity_relationship_limits');await central.pg.exec('set role service_role');
  await ccall('/relationships/state',{site_id:site(2),target_member_id:member(2)},rawGrant,403,{}, {Origin:'https://unregistered.test'});
  await pcall('/relationships/state',{target_member_id:member(2)},A,403,'member',{Origin:'https://unregistered.test'});
  const d=(await ccall('/relationships/state',{site_id:site(2),target_member_id:member(2)},rawGrant,503,{supabaseClient:{rpc:async()=>({error:{message:'private database detail'}})}})).d;assert.ok(!JSON.stringify(d).includes('private'));
 });
 await check('local logout during HTTP wait rejects stale response; central logout blocks future requests',async()=>{
  revokeAfter=true;await pcall('/relationships/state',{target_member_id:member(2)},A,401);
  A=await login(1);await central.pg.query("select private.identity_writing_action('logout',$1)",[{session_id:session(1),member_id:member(1),session_version:1}]);
  await pcall('/relationships/state',{target_member_id:member(2)},A,401);
 });
 console.log(`All ${groups} relationship API/relay groups passed; actual handlers + PGlite SQL, no hosted changes.`);
}finally{await personal.pg.close();await central.pg.close();}
