// Step 1 only. Real existing Auth handlers/SQL; proposed relationship/receipt state is an in-memory model.
// Does not implement production endpoints, PostgreSQL relation locks, browser UI or network delivery.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {authenticateMember,handleMemberWriting} from '../supabase/functions/member-writing/handler.js';
const root=resolve(process.env.MINIHOMPY_CENTRAL_ROOT||'../minihompy-central');
const load=p=>import(pathToFileURL(root+'/'+p));
const {createIdentityDb}=await load('scripts/helpers/identity-db.mjs');
const {handleIdentityApiRequest}=await load('supabase/functions/identity-api/handler.js');
const {signToken}=await load('supabase/functions/_shared/tokens.js');
const {randomSecret,sha256}=await load('supabase/functions/_shared/auth-proof.js');
const {PGlite}=await load('node_modules/@electric-sql/pglite/dist/index.js');
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A=id(1),B=id(2),C=id(3),siteA=id(11),siteB=id(12);
const centralUrl='https://central.test/functions/v1/identity-api';
const secret='relationship-step1-local-test-signing-key-only';
const central=await createIdentityDb(), personal=await memberWritingDb(PGlite,{siteId:siteB,centralUrl});
const options={supabaseClient:central.db,centralSecret:secret,allowedOrigins:new Set()};
const config={MINIHOMPY_SITE_ORIGIN:'https://bob.github.io',MINIHOMPY_SITE_ID:siteB,MINIHOMPY_CENTRAL_API_URL:centralUrl,SUPABASE_URL:'https://bbbbbbbbbbbbbbbbbbbb.supabase.co',MINIHOMPY_PUBLIC_KEY:'fixture'};
let offline=false,clock=Date.now();
const deny=code=>{throw Object.assign(Error(code),{code});};
const rejects=(fn,code)=>assert.rejects(fn,e=>e.code===code);
async function fetcher(url,init){
 if(offline)throw Error('fixture offline');
 assert.ok(url.startsWith(centralUrl));
 return handleIdentityApiRequest(new Request(url,init),options);
}
async function call(path,body,token){
 const response=await fetcher(centralUrl+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
 const data=await response.json();if(!response.ok)deny(data.error.code);return data;
}
const req=token=>new Request('https://bbbbbbbbbbbbbbbbbbbb.supabase.co/functions/v1/member-writing/relationships',{headers:{Authorization:'Bearer '+token}});
const auth=token=>authenticateMember(req(token),{db:personal.db,fetcher,centralUrl,siteId:siteB});
let sessionA,sessionB;
// New relationship state: serialized critical sections are synchronous in this model, not real SQL locks.
const pairs=new Map(),operations=new Map(),receipts=new Map(),reviews=new Map();
const key=(a,b)=>[a,b].sort().join(':');
const pair=(a,b)=>pairs.get(key(a,b))||{state:'none',revision:0,request_id:null};
const digest=text=>createHash('sha256').update(text).digest('hex');
async function verified(grant,site){return call('/writing-grants/check',{site_id:site},grant);}
async function relationship(grant,site,body){
 const g=await verified(grant,site),actor=g.member.id;
 const allowed=['action','target_member_id','operation_id','expected_revision','request_id'];
 if(Object.keys(body).some(k=>!allowed.includes(k)))deny('BAD_REQUEST');
 const {action,target_member_id:target,operation_id:op,expected_revision:version}=body;
 if(actor===target)deny('FORBIDDEN');
 if(![A,B,C].includes(target))deny('NOT_FOUND');
 const opKey=key(actor,site)+':'+op,fp=JSON.stringify(body),old=operations.get(opKey);
 if(old){if(old.fp!==fp)deny('REQUEST_CONFLICT');return {operation:old.result,current:{...pair(actor,target)}};}
 const p=pair(actor,target);if(p.revision!==version)deny('REVISION_CONFLICT');
 if(action==='request'){
  if(p.state!=='none')deny('REVISION_CONFLICT');
  pairs.set(key(actor,target),{state:'pending',revision:p.revision+1,request_id:randomUUID(),sender:actor,receiver:target});
 }else{
  if(body.request_id!==p.request_id)deny('REVISION_CONFLICT');
  if(['accept','reject'].includes(action)){if(p.state!=='pending'||p.receiver!==actor)deny('FORBIDDEN');}
  else if(action==='cancel'){if(p.state!=='pending'||p.sender!==actor)deny('FORBIDDEN');}
  else if(action==='disconnect'){if(p.state!=='accepted')deny('FORBIDDEN');}
  else deny('BAD_REQUEST');
  pairs.set(key(actor,target),{...p,state:action==='accept'?'accepted':'none',revision:p.revision+1});
 }
 const result={...pair(actor,target)};operations.set(opKey,{fp,result});return {operation:result,current:result};
}
async function bridge(token,body){const a=await auth(token);return relationship(a.session.central_grant,siteB,body);}
const command=(action,actor,target,overrides={})=>({action,target_member_id:target,operation_id:randomUUID(),expected_revision:pair(actor,target).revision,...(action==='request'?{}:{request_id:pair(actor,target).request_id}),...overrides});
async function receipt(grant,site,op,text){
 const g=await verified(grant,site),actor=g.member.id;
 if(site!==siteB)deny('TARGET_MISMATCH'); // fixture's personal site owner is B
 if(actor===B)deny('FORBIDDEN');
 const k=actor+':'+site+':'+op,fp=digest(text),prior=receipts.get(k);
 if(prior){if(prior.digest!==fp)deny('REQUEST_CONFLICT');if(prior.expires<=clock)deny('PERMIT_EXPIRED');return {...prior};}
 if(pair(actor,B).state!=='accepted')deny('NOT_FRIENDS');
 // Central authorization linearizes here under the same pair lock as disconnect in the future SQL.
 const r={id:randomUUID(),actor,site,owner:B,operation_id:op,digest:fp,revision:pair(actor,B).revision,expires:Math.min(clock+30000,Date.parse(g.expires_at)),central_session_id:g.central_session_id};
 receipts.set(k,r);return {...r};
}
async function save(token,op,text,{beforePermit,afterPermit}={}){
 const a=await auth(token),k=a.session.member_id+':'+op,prior=reviews.get(k);
 if(prior){if(prior.digest!==digest(text))deny('REQUEST_CONFLICT');return {...prior};}
 await beforePermit?.();
 const r=await receipt(a.session.central_grant,siteB,op,text);
 await afterPermit?.(r);
 if(r.actor!==a.session.member_id||r.site!==siteB||r.owner!==B||r.central_session_id!==a.session.central_session_id||r.operation_id!==op||r.digest!==digest(text))deny('TARGET_MISMATCH');
 await auth(token); // production must recheck personal family/session inside insert transaction too
 if(r.expires<=clock)deny('PERMIT_EXPIRED');
 const v={id:randomUUID(),member:r.actor,site:r.site,text,digest:r.digest,deleted:false};
 // Atomic unique(actor,operation_id) + tombstone in production; no awaits in model commit.
 const duplicate=reviews.get(k);if(duplicate)return {...duplicate};reviews.set(k,v);return {...v};
}
let count=0;const check=async(name,fn)=>{await fn();console.log(`PASS ${++count}: ${name}`);};
try{
 await central.pg.query("insert into private.identity_members(id,handle,display_name) values($1,'alice','Alice'),($2,'bob','Bob'),($3,'charlie','Charlie')",[A,B,C]);
 for(const [site,member,name,n] of [[siteA,A,'alice',1],[siteB,B,'bob',2]]){
  await central.pg.query("insert into private.identity_sites(id,member_id,origin,base_path,homepage_url,login_url,supabase_project_ref,verification_status) values($1,$2,$3,'/home/',$4,$5,$6,'verified')",[site,member,`https://${name}.github.io`,`https://${name}.github.io/home/`,`https://${name}.github.io/home/login/`,name.repeat(4)]);
  await central.pg.query('insert into private.identity_bindings(site_id,member_id,local_user_id) values($1,$2,$3)',[site,member,id(20+n)]);
  await central.pg.query("insert into private.identity_sessions(id,member_id,site_id,session_version,owner_user_id,expires_at) values($1,$2,$3,1,$4,now()+interval '1 day')",[id(30+n),member,site,id(20+n)]);
 }
 async function login(member,sessionId){
  const now=Math.floor(Date.now()/1000),verifier=randomSecret();
  const centralSession=await signToken({kind:'central_session',sub:member,central_session_id:sessionId,session_version:1,iat:now,exp:now+86400},secret);
  const p=await call('/writing-proofs/issue',{central_session:centralSession,target_site_id:siteB,code_challenge:await sha256(verifier),return_path:'/home/',protocol:2,attempt_id:randomUUID()});
  // Retrieve the protocol-bound attempt from the real proof payload via real verification.
  const {verifyToken}=await load('supabase/functions/_shared/tokens.js');
  const claims=await verifyToken(p.writing_proof,'writing_proof',secret);
  const response=await handleMemberWriting(new Request(config.SUPABASE_URL+'/functions/v1/member-writing/sessions/exchange',{method:'POST',headers:{Origin:config.MINIHOMPY_SITE_ORIGIN,'Content-Type':'application/json','X-Minihompy-Auth-Mode':'member'},body:JSON.stringify({writing_proof:p.writing_proof,code_verifier:verifier,protocol:2,attempt_id:claims.attempt_id})}),{config,db:personal.db,fetcher});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result.session_token;
 }
 sessionA=await login(A,id(31));sessionB=await login(B,id(32));
 await check('real v2 proof/PKCE, personal SQL and central SQL derive A/B without caller identity',async()=>{
  assert.equal((await auth(sessionA)).session.member_id,A);assert.equal((await auth(sessionB)).session.member_id,B);
 });
 await check('UUID, owner JWT, forged actor and wrong-site grant cannot authorize relationships',async()=>{
  await rejects(()=>auth(A),'AUTH_REQUIRED');await rejects(()=>auth('local.owner.jwt'),'AUTH_REQUIRED');
  await rejects(()=>bridge(sessionA,{...command('request',A,B),member_id:B}),'BAD_REQUEST');
  const a=await auth(sessionA);await rejects(()=>relationship(a.session.central_grant,siteA,command('request',A,B)),'TARGET_MISMATCH');
 });
 await check('self request denied; A request has matching B perspective',async()=>{
  await rejects(()=>bridge(sessionA,command('request',A,A)),'FORBIDDEN');
  await bridge(sessionA,command('request',A,B));assert.equal(pair(B,A).sender,A);
 });
 await check('reverse request cannot auto-accept; sender cannot accept; response-loss retry is idempotent',async()=>{
  await rejects(()=>bridge(sessionB,command('request',B,A)),'REVISION_CONFLICT');
  await rejects(()=>bridge(sessionA,command('accept',A,B)),'FORBIDDEN');
  const b=command('accept',B,A);await bridge(sessionB,b);await bridge(sessionB,b);assert.equal(pair(A,B).state,'accepted');
  await rejects(()=>bridge(sessionB,{...b,action:'reject'}),'REQUEST_CONFLICT');
 });
 await check('permit-before-disconnect allows only that in-flight write, not new writes',async()=>{
  const v=await save(sessionA,randomUUID(),'before disconnect',{afterPermit:async()=>bridge(sessionB,command('disconnect',B,A))});
  assert.equal(v.member,A);assert.equal(pair(A,B).state,'none');
  await rejects(()=>save(sessionA,randomUUID(),'after disconnect'),'NOT_FRIENDS');
 });
 await check('disconnect-before-permit denies write; re-request has a new generation',async()=>{
  const oldRequest=pair(A,B).request_id;
  await bridge(sessionA,command('request',A,B));await bridge(sessionB,command('accept',B,A));
  assert.notEqual(pair(A,B).request_id,oldRequest);
  await rejects(()=>save(sessionA,randomUUID(),'race',{beforePermit:async()=>bridge(sessionB,command('disconnect',B,A))}),'NOT_FRIENDS');
  const stale=command('cancel',A,B,{request_id:oldRequest});await rejects(()=>bridge(sessionA,stale),'REVISION_CONFLICT');
 });
 await bridge(sessionA,command('request',A,B));await bridge(sessionB,command('accept',B,A));
 await check('lost permit response can recover identical authorization after disconnect without extending expiry',async()=>{
  const a=await auth(sessionA),op=randomUUID(),r=await receipt(a.session.central_grant,siteB,op,'recover');
  await bridge(sessionB,command('disconnect',B,A));
  assert.deepEqual(await receipt(a.session.central_grant,siteB,op,'recover'),r);
  await rejects(()=>receipt(a.session.central_grant,siteB,op,'changed'),'REQUEST_CONFLICT');
  assert.equal((await save(sessionA,op,'recover')).member,A);
 });
 await bridge(sessionA,command('request',A,B));await bridge(sessionB,command('accept',B,A));
 await check('personal commit rejects mismatched permit actor, site, owner, session, operation and body',async()=>{
  for(const patch of [{actor:B},{site:siteA},{owner:A},{central_session_id:id(999)},{operation_id:randomUUID()},{digest:digest('other')}]){
   const before=reviews.size;await rejects(()=>save(sessionA,randomUUID(),'bound',{afterPermit:r=>Object.assign(r,patch)}),'TARGET_MISMATCH');assert.equal(reviews.size,before);
  }
 });
 await check('expired permit cannot commit or be reissued using old operation ID',async()=>{
  const op=randomUUID();await rejects(()=>save(sessionA,op,'expired',{afterPermit:()=>{clock+=30001;}}),'PERMIT_EXPIRED');
  await rejects(()=>save(sessionA,op,'expired'),'PERMIT_EXPIRED');
 });
 await check('saved response loss retries once; changed payload conflicts; tombstone never resurrects',async()=>{
  const op=randomUUID(),v=await save(sessionA,op,'once');assert.equal((await save(sessionA,op,'once')).id,v.id);
  await rejects(()=>save(sessionA,op,'different'),'REQUEST_CONFLICT');reviews.get(A+':'+op).deleted=true;
  assert.equal((await save(sessionA,op,'once')).deleted,true);
 });
 await check('central outage denies new authorization; stored public content remains',async()=>{
  offline=true;try{await rejects(()=>save(sessionA,randomUUID(),'offline'),'IDENTITY_UNAVAILABLE');assert.ok([...reviews.values()].some(v=>!v.deleted));}finally{offline=false;}
 });
 await check('local logout during in-flight permit blocks personal commit',async()=>{
  const before=reviews.size;
  await rejects(()=>save(sessionA,randomUUID(),'logout',{afterPermit:()=>personal.pg.exec('update private.member_writing_families set revoked_at=clock_timestamp()')}),'SESSION_REVOKED');
  assert.equal(reviews.size,before);
 });
 sessionA=await login(A,id(31));
 await check('central revocation invalidates a previously issued permit retry',async()=>{
  const a=await auth(sessionA),op=randomUUID();await receipt(a.session.central_grant,siteB,op,'revoked');
  await central.pg.query('update private.identity_sessions set revoked_at=clock_timestamp() where id=$1',[id(31)]);
  await rejects(()=>save(sessionA,op,'revoked'),'SESSION_REVOKED');
 });
 console.log(JSON.stringify({status:'passed',groups:count,authentication:'existing handlers + actual migrations in PGlite',relationships:'in-memory model; controlled interleavings, not PostgreSQL lock verification',production_changed:false}));
}finally{await personal.pg.close();await central.pg.close();}
