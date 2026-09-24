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
const request=(url,body,token,extra={})=>new Request(url,{method:extra.method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
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
  if(name==='member_content_read'||name==='member_content_comments'){if(afterRead){const f=afterRead;afterRead=null;await f();}if(dbTransform)value=dbTransform(value);}
  return value;
 }}});const data=await r.json();assert.equal(r.status,expected,path+' '+JSON.stringify(data));assert.equal(r.headers.get('Cache-Control'),(path.startsWith('/content/')||path.startsWith('/comments'))?'private, no-store':'no-store');
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

 const comment=(kind,n=1)=>({kind,parent_id:post(kind,n)});
 const createBody=(kind='board',n=1)=>({...comment(kind,n),id:randomUUID(),request_id:randomUUID(),body:'친구 댓글'});
 const create=(body,t=ab,status=200)=>call(2,'/comments',body,t,status);
 const listComments=(kind='board',n=1,t=ab,status=200,mode='member')=>call(2,'/comments?'+new URLSearchParams(comment(kind,n)),undefined,mode==='public'?undefined:t,status,mode);
 const change=(body,verb='update',t=ab,status=200,mode='member')=>call(2,'/comments/'+body.id,{kind:body.kind,parent_id:body.parent_id,request_id:body.request_id,revision:body.revision,...(verb==='update'?{body:body.body}:{})},t,status,mode,{method:verb==='update'?'PATCH':'DELETE'});
 const lookup=(body,t=ab,status=200,mode='member')=>call(2,'/comments/operations/'+body.request_id+'?'+new URLSearchParams({kind:body.kind,parent_id:body.parent_id}),undefined,mode==='public'?undefined:t,status,mode);
 const unlock=()=>homes[2].pg.query("update private.member_writing_limits set last_write=clock_timestamp()-interval '1 minute'");
 await check('nonfriends/pending/public cannot read/write friend comments, public member comment still works',async()=>{
  await listComments('board',1,ab,404);await create(createBody(),ab,404);await listComments('board',1,undefined,404,'public');
  await create(createBody('board',0));await act(2,ab,2,'request');await listComments('board',1,ab,404);await act(1,ba,1,'accept');
 });
 const saved={};
 await check('accepted A writes/reads/updates all three menus with fresh context per request',async()=>{
  for(const kind of Object.keys(tables)){
   await unlock();const b=createBody(kind),before=readChecks;const result=await create(b);assert.equal(result.data.revision,1);assert.equal(readChecks,before+1);
   const rows=(await listComments(kind)).data;assert.equal(rows.count,1);assert.equal(rows.items[0].author_member_id,member(1));assert.equal(rows.items[0].can_edit,true);
   assert.equal((await create(b)).data.replayed,true);assert.equal((await lookup(b)).data.id,b.id);
   const edit={...b,request_id:randomUUID(),revision:1,body:'수정'};assert.equal((await change(edit)).data.revision,2);assert.equal((await lookup(edit)).data.operation,'update');saved[kind]={...b,revision:2};
  }
 });
 await check('another accepted friend cannot edit/delete/lookup A receipts; owner only moderates',async()=>{
  await act(2,cb,2,'request');await act(1,ba,3,'accept');
  const b={...saved.board,request_id:randomUUID(),body:'not mine'};await change(b,'update',cb,404);await change(b,'delete',cb,404);await lookup(saved.board,cb,404);
  await change(b,'update','owner.valid.jwt',403,'owner');assert.equal((await listComments('board',1,'owner.valid.jwt',200,'owner')).data.items[0].can_delete,true);
 });
 await check('disconnect blocks list/count/create/edit/delete/replay/result including same author; regain restores idempotency',async()=>{
  await act(1,ba,1,'disconnect');
  await listComments('board',1,ab,404);await create(saved.board,ab,400); // revisions are not allowed on create
  const retry={...saved.board};delete retry.revision;await create(retry,ab,404);await lookup(saved.board,ab,404);
  await change({...saved.board,request_id:randomUUID(),body:'blocked'},'update',ab,404);await change({...saved.board,request_id:randomUUID()},'delete',ab,404);
  await central.pg.exec('reset role;truncate private.identity_relationship_cooldowns;set role service_role');await act(2,ab,2,'request');await act(1,ba,1,'accept');
  assert.equal((await create(retry)).data.replayed,true);assert.equal((await listComments()).data.count,1);assert.equal((await lookup(saved.board)).data.operation,'create');
 });
 await check('deleted comment receipt stays parent-bound; hiding/deleting parent prevents all recovery',async()=>{
  const removal={...saved.board,request_id:randomUUID()};assert.equal((await change(removal,'delete')).data.deleted,true);assert.equal((await lookup(removal)).data.deleted,true);
  await lookup({...removal,parent_id:post('board',0)},ab,404);
  await homes[2].pg.query("update public.board_posts set visibility='private' where id=$1",[post('board',1)]);await lookup(removal,ab,404);await change(removal,'delete',ab,404);
  await homes[2].pg.query("update public.board_posts set visibility='friends' where id=$1",[post('board',1)]);assert.equal((await change(removal,'delete')).data.replayed,true);
  await homes[2].pg.query('delete from public.board_posts where id=$1',[post('board',1)]);await lookup(removal,ab,404);
 });
 await check('parent switches private after central check: no comment/receipt/quota is inserted',async()=>{
  await unlock();const b=createBody('diary');afterContext=()=>homes[2].pg.query("update public.diary_entries set visibility='private' where id=$1",[b.parent_id]);await create(b,ab,404);
  assert.equal((await homes[2].pg.query('select count(*)::int n from private.member_writing_requests where request_id=$1',[b.request_id])).rows[0].n,0);
  await homes[2].pg.query("update public.diary_entries set visibility='friends' where id=$1",[b.parent_id]);
 });
 await check('lost successful response recovers once; same operation with different body conflicts',async()=>{
  await unlock();const b=createBody('diary');dbTransform=r=>{if(r.data?.id===b.id)throw Error('lost response');return r;};await create(b,ab,503);dbTransform=null;
  assert.equal((await lookup(b)).data.id,b.id);assert.equal((await create(b)).data.replayed,true);await create({...b,body:'different'},ab,409);
  assert.equal((await homes[2].pg.query('select count(*)::int n from public.post_comments where id=$1',[b.id])).rows[0].n,1);
 });
 await check('central outage/quota never becomes public fallback; invalid context cannot authorize comments',async()=>{
  centralDown=true;await listComments('diary',1,ab,503);await listComments('diary',0,undefined,200,'public');centralDown=false;
  centralReply=()=>Response.json({},{status:429,headers:{'Retry-After':'9'}});assert.equal((await listComments('diary',1,ab,429)).r.headers.get('Retry-After'),'9');centralReply=null;
  mutateContext=d=>({...d,owner_member_id:member(3)});await listComments('diary',1,ab,403);mutateContext=null;
 });
 await check('local logout after commit hides response; new login recovers stored receipt without duplicate mutation',async()=>{
  await unlock();const b=createBody('photos'),hash=await tokenHash(ab);afterRead=()=>homes[2].db.rpc('member_writing_session',{p_action:'revoke',p_args:{site_id:site(2),token_hash:hash}});await create(b,ab,401);ab=await login(1,2);assert.equal((await lookup(b)).data.id,b.id);assert.equal((await create(b)).data.replayed,true);
 });
 await check('owner may delete protected comments, but readiness-off legacy path never exposes friends',async()=>{
  const b={...saved.photos,request_id:randomUUID()};assert.equal((await change(b,'delete','owner.valid.jwt',200,'owner')).data.deleted,true);
  await homes[2].pg.query('update private.friend_visibility_state set ready=false');homes[2].protected=false;await listComments('diary',1,ab,404);await listComments('diary',0,ab);await homes[2].pg.query('update private.friend_visibility_state set ready=true');homes[2].protected=true;
 });
 console.log(`All ${groups} friend comment central/A/B/C API groups passed; actual SQL/handlers, fixture Auth and readiness, no hosted writes.`);
}finally{await central.pg.close();for(const h of Object.values(homes))await h.pg.close();}
