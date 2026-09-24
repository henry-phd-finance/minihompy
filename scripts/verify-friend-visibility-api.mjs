import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {createIdentityDb} from '../../minihompy-central/scripts/helpers/identity-db.mjs';
import {seedRelationships,member,site,session,id} from '../../minihompy-central/scripts/helpers/relationship-fixture.mjs';
import {handleIdentityApiRequest} from '../../minihompy-central/supabase/functions/identity-api/handler.js';
import {sha256,randomSecret} from '../../minihompy-central/supabase/functions/_shared/auth-proof.js';
import {signToken} from '../../minihompy-central/supabase/functions/_shared/tokens.js';
import {handleMemberWriting,tokenHash} from '../supabase/functions/member-writing/handler.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
const centralUrl='https://central.test/functions/v1/identity-api',secret='integration-fixture-only-secret-at-least-32-characters';
const central=await createIdentityDb(),homes={};let groups=0,centralDown=false,centralCalls=0,readChecks=0,mutateContext=null,afterContext=null,afterRead=null,dbTransform=null,oldDb=false,centralReply=null;
const options={supabaseClient:central.db,centralSecret:secret,allowedOrigins:new Set(['https://m1.test','https://m2.test']),transportPeerIp:'127.0.0.1'};
const request=(url,body,token,extra={})=>new Request(url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function centralCall(path,body,token){const r=await handleIdentityApiRequest(request(centralUrl+path,body,token),options),d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d;}
const fetcher=async(url,init={})=>{
 if(!url.startsWith(centralUrl)){
  const h=Object.values(homes).find(h=>url.startsWith(h.config.SUPABASE_URL));assert.ok(h,'Unknown HTTP destination');assert.equal(init.headers.Authorization,'Bearer owner.valid.jwt');
  if(url.endsWith('/auth/v1/user'))return Response.json({id:h.owner,is_anonymous:false});
  if(url.endsWith('/is_minihompy_admin'))return new Response(String((await h.pg.query('select exists(select 1 from private.minihompy_admins where user_id=$1) b',[h.owner])).rows[0].b));
  throw Error('Unexpected owner request');
 }
 centralCalls++;if(centralDown)throw Error('Central unavailable');assert.equal(init.headers?.Origin,undefined);assert.equal(init.credentials,'omit');
 if(url.endsWith('/read-context')){readChecks++;if(centralReply)return centralReply();}
 const r=await handleIdentityApiRequest(new Request(url,init),options);
 if(url.endsWith('/read-context')&&r.ok){let d=await r.json();if(mutateContext)d=mutateContext(d);if(afterContext){const f=afterContext;afterContext=null;await f();}return Response.json(d);}
 return r;
};
async function call(home,path,body,credential,expected=200,mode='member',extra={}){
 const h=homes[home],req=request(h.config.SUPABASE_URL+'/functions/v1/member-writing'+path,body,credential,{Origin:h.config.MINIHOMPY_SITE_ORIGIN,'X-Minihompy-Auth-Mode':mode,...extra});
 const r=await handleMemberWriting(req,{config:h.config,fetcher,db:{rpc:async(name,args)=>{
  if(oldDb&&name==='friend_visibility_status')return {error:{code:'42883'}};
  let value=await h.db.rpc(name,args);
  if(name==='member_content_read'){if(afterRead){const f=afterRead;afterRead=null;await f();}if(dbTransform)value=dbTransform(value);}
  return value;
 }}});const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));assert.equal(r.headers.get('Cache-Control'),path.startsWith('/content/')?'private, no-store':'no-store');
 if(path.startsWith('/content/'))assert.equal(r.headers.get('Vary'),'Origin, Authorization, X-Minihompy-Auth-Mode');return {data,r};
}
async function login(n,home){const now=Math.floor(Date.now()/1000),verifier=randomSecret(),attempt=randomUUID(),token=await signToken({kind:'central_session',sub:member(n),central_session_id:session(n),session_version:1,iat:now,exp:now+86400},secret);
 const p=await centralCall('/writing-proofs/issue',{central_session:token,target_site_id:site(home),code_challenge:await sha256(verifier),protocol:2,attempt_id:attempt,return_path:'/home/'});
 return (await call(home,'/sessions/exchange',{writing_proof:p.writing_proof,code_verifier:verifier,protocol:2,attempt_id:attempt})).data.session_token;
}
const post=(kind,n)=>id(({board:1000,photos:2000,diary:3000})[kind]+n),tables={board:'board_posts',photos:'photo_posts',diary:'diary_entries'};
const state=async(h,t,n)=>(await call(h,'/relationships/state',{target_member_id:member(n)},t)).data;
const act=async(h,t,n,verb)=>{const s=await state(h,t,n);return (await call(h,'/relationships/actions',{operation_id:randomUUID(),target_member_id:member(n),action:verb,expected_revision:s.revision,...(verb==='request'?{}:{request_id:s.request_id})},t)).data;};
const list=(t,mode='member',home=2,body={kind:'board'},status=200)=>call(home,'/content/list',body,t,status,mode);
const detail=(t,kind='board',n=1,status=200,mode='member')=>call(2,'/content/detail',{kind,id:post(kind,n)},t,status,mode);
const check=async(name,fn)=>{await fn();console.log(`PASS ${++groups}: ${name}`);};
let ab,aa,ba,cb;
try{
 await central.pg.exec('reset role');await seedRelationships(central.pg,3);await central.pg.exec('set role service_role');
 for(const n of [1,2]){
  const h=await memberWritingDb(PGlite,{siteId:site(n),centralUrl,photoMedia:true,friendVisibility:true});h.owner=id(300+n);h.config={MINIHOMPY_SITE_ORIGIN:`https://m${n}.test`,MINIHOMPY_SITE_ID:site(n),MINIHOMPY_CENTRAL_API_URL:centralUrl,SUPABASE_URL:`https://${String.fromCharCode(96+n).repeat(20)}.supabase.co`,MINIHOMPY_PUBLIC_KEY:'fixture'};homes[n]=h;
  await h.pg.query('insert into auth.users values($1)',[h.owner]);await h.pg.query('insert into private.minihompy_admins values($1)',[h.owner]);
  await h.pg.query('update private.friend_visibility_state set owner_member_id=$1,media_ready=true,summary_ready=true,pages_ready=true,ready=true',[member(n)]);await h.pg.query("update private.photo_media_state set mode='protected',ready=true");await h.pg.query("select set_config('request.jwt.claim.sub',$1,false)",[h.owner]);
  for(const kind of Object.keys(tables))for(const i of [0,1,2]){
   const p=post(kind,i),v=['public','friends','private'][i];
   if(kind==='board')await h.pg.query("insert into public.board_posts(id,folder_id,author_id,author_name,title,body,visibility) select $1,id,$2,'owner','title','body',$3 from public.board_folders limit 1",[p,h.owner,v]);
   if(kind==='diary')await h.pg.query("insert into public.diary_entries(id,folder_id,author_id,author_name,entry_date,entry_time,body,visibility) select $1,id,$2,'owner','2026-09-24','12:30','diary',$3 from public.diary_folders limit 1",[p,h.owner,v]);
   if(kind==='photos'){const path=p+'/'+id(999)+'.png';await h.pg.query("insert into private.photo_assets(path,post_id,uploaded_by,complete,size,mime,sha256) values($1,$2,$3,true,1,'image/png',$4)",[path,p,h.owner,'b'.repeat(64)]);await h.pg.query("insert into public.photo_posts(id,folder_id,author_id,author_name,title,body,visibility) select $1,id,$2,'owner','photo',$3,$4 from public.photo_folders limit 1",[p,h.owner,JSON.stringify([{type:'image',path}]),v]);}
  }
  await h.pg.query("select set_config('request.jwt.claim.sub','',false)");
 }
 ab=await login(1,2);aa=await login(1,1);ba=await login(2,1);cb=await login(3,2);
 await check('health exposes only capabilities; unprepared server blocks member reads',async()=>{
  const h=(await call(2,'/content/health',undefined,undefined,200,'public')).data;assert.equal(h.friend_visibility_protocol,1);assert.equal('owner_member_id'in h,false);
  await homes[2].pg.query('update private.friend_visibility_state set ready=false');await list(ab,'member',2,{kind:'board'},503);assert.equal((await list(undefined,'public')).data.data.count,1);await homes[2].pg.query('update private.friend_visibility_state set ready=true');
 });
 await check('UUID, foreign-site token, absent mode, forged input and public credential fallback denied',async()=>{
  await list(member(1),'member',2,{kind:'board'},401);await list(aa,'member',2,{kind:'board'},401);await list(ab,'public',2,{kind:'board'},400);
  for(const extra of [{owner_id:homes[2].owner},{context:{}},{page:0},{size:21},{page:'1'},{scope:'all'},{kind:'guestbook'},{month:'2026-01'}])await list(ab,'member',2,{kind:'board',...extra},400);
  await call(2,'/content/list',{kind:'board'},ab,400,'');await call(2,'/content/list',{kind:'board'},ab,403,'member',{Origin:'https://evil.test'});
 });
 await check('nonfriend and pending see public only; own central member is not local admin',async()=>{
  assert.equal((await list(ab)).data.data.count,1);assert.equal((await list(aa,'member',1)).data.data.count,1);assert.equal((await list('owner.valid.jwt','owner')).data.data.count,3);
  await act(2,ab,2,'request');assert.equal((await list(ab)).data.data.count,1);await act(1,ba,1,'accept');
 });
 await check('actual central grant + per-request context + personal SQL filters all three menus',async()=>{
  for(const kind of Object.keys(tables)){
   const before=readChecks,d=(await list(ab,'member',2,{kind,size:1})).data;assert.equal(readChecks,before+1);assert.equal(d.data.count,2);assert.equal(d.data.items.length,1);
   await detail(ab,kind);await detail(ab,kind,2,404);assert.equal((await list(cb,'member',2,{kind})).data.data.count,1);
   assert.equal((await list(ab,'member',2,{kind,scope:'public'})).data.data.count,1);assert.equal((await list('owner.valid.jwt','owner',2,{kind})).data.data.count,3);
  }
 });
 await check('central binding, relationship and clock tampering fail before response',async()=>{
  for(const field of ['actor_member_id','site_id','owner_member_id','central_session_id','request_id','request_hash']){mutateContext=d=>({...d,[field]:field==='request_hash'?'f'.repeat(64):id(9999)});await list(ab,'member',2,{kind:'board'},403);}
  mutateContext=d=>({...d,can_read_friends:false});await list(ab,'member',2,{kind:'board'},503);
  mutateContext=d=>({...d,expires_at:new Date(Date.now()+60000).toISOString()});await list(ab,'member',2,{kind:'board'},503);mutateContext=null;
 });
 await check('central outage preserves explicit public and local owner; no automatic retry on 429',async()=>{
  centralDown=true;await list(ab,'member',2,{kind:'board'},503);const before=centralCalls;await list(undefined,'public');await list('owner.valid.jwt','owner');assert.equal(centralCalls,before);centralDown=false;
  centralReply=()=>Response.json({error:{code:'RATE_LIMITED'}},{status:429,headers:{'Retry-After':'7'}});const n=readChecks,r=await list(ab,'member',2,{kind:'board'},429);assert.equal(r.r.headers.get('Retry-After'),'7');assert.equal(readChecks,n+1);centralReply=null;
 });
 await check('old DB/old central and malformed DB output fail closed; internal fields are stripped',async()=>{
  oldDb=true;await list(ab,'member',2,{kind:'board'},503);oldDb=false;centralReply=()=>Response.json({},{status:404});await list(ab,'member',2,{kind:'board'},503);centralReply=null;
  dbTransform=r=>({...r,data:{...r.data,view:{...r.data.view,mode:'owner'}}});await list(ab,'member',2,{kind:'board'},503);
  dbTransform=r=>({...r,data:{...r.data,data:{...r.data.data,items:r.data.data.items.map(p=>({...p,secret:'must not leak'})),secret:'must not leak'}}});assert.ok(!JSON.stringify((await list(ab)).data).includes('must not leak'));dbTransform=null;
 });
 await check('disconnect after central authorization allows only bounded in-flight read, next read excludes friends',async()=>{
  afterContext=()=>act(1,ba,1,'disconnect');assert.equal((await list(ab)).data.data.count,2);assert.equal((await list(ab)).data.data.count,1);
  await central.pg.exec('reset role;truncate private.identity_relationship_cooldowns;set role service_role');await act(2,ab,2,'request');await act(1,ba,1,'accept');
 });
 await check('latest personal privacy beats prior central authorization',async()=>{
  afterContext=()=>homes[2].pg.query("update public.board_posts set visibility='private' where id=$1",[post('board',1)]);await detail(ab,'board',1,404);await homes[2].pg.query("update public.board_posts set visibility='friends' where id=$1",[post('board',1)]);
 });
 await check('logout after SQL result blocks final response; independent login continues',async()=>{
  const other=await login(1,2),hash=await tokenHash(ab);afterRead=()=>homes[2].db.rpc('member_writing_session',{p_action:'revoke',p_args:{site_id:site(2),token_hash:hash}});
  await list(ab,'member',2,{kind:'board'},401);ab=other;await list(ab);
 });
 await check('owner revocation after query denies final owner response',async()=>{
  afterRead=()=>homes[2].pg.query('delete from private.minihompy_admins where user_id=$1',[homes[2].owner]);await list('owner.valid.jwt','owner',2,{kind:'board'},403);await homes[2].pg.query('insert into private.minihompy_admins values($1)',[homes[2].owner]);
 });
 await check('central redirect/malformed body fail closed and stalled body is cancelled',async()=>{
  centralReply=()=>new Response(null,{status:302,headers:{Location:'https://evil.test'}});await list(ab,'member',2,{kind:'board'},503);
  centralReply=()=>new Response('{',{headers:{'Content-Type':'application/json'}});await list(ab,'member',2,{kind:'board'},503);
  let cancelled=false;centralReply=()=>new Response(new ReadableStream({cancel(){cancelled=true;}}));await list(ab,'member',2,{kind:'board'},503);assert.equal(cancelled,true);centralReply=null;
 });
 await check('late result is discarded and central logout blocks next request',async()=>{
  afterRead=()=>new Promise(r=>setTimeout(r,4100));await list(ab,'member',2,{kind:'board'},503);
  await central.pg.exec('reset role');await central.pg.query("select private.identity_writing_action('logout',$1)",[{session_id:session(1),member_id:member(1),session_version:1}]);await central.pg.exec('set role service_role');await list(ab,'member',2,{kind:'board'},401);
 });
 console.log(`All ${groups} friend visibility central/A/B/C API integration groups passed; owner Auth HTTP and readiness are fixtures, all authorization/content SQL and handlers are real.`);
}finally{await central.pg.close();for(const h of Object.values(homes))await h.pg.close();}
