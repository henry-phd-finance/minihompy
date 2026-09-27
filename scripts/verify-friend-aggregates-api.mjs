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
  if(name==='member_content_read'||name==='member_content_aggregate'){if(afterRead){const f=afterRead;afterRead=null;await f();}if(dbTransform)value=dbTransform(value);}
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


 const menus=['board','diary','guestbook','photos'];const h=homes[2];
 // Controlled clocks/comments only: authorization SQL and handlers remain real.
 await h.pg.exec('set session_replication_role=replica');
 for(const kind of Object.keys(tables))for(let n=0;n<3;n++){
  await h.pg.query('update public.'+tables[kind]+" set created_at=date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' where id=$1",[post(kind,n)]);
  const col={board:'board_post_id',photos:'photo_post_id',diary:'diary_entry_id'}[kind];await h.pg.query('insert into public.post_comments(id,'+col+",author_name,body,created_at) values(gen_random_uuid(),$1,'visitor','comment',clock_timestamp())",[post(kind,n)]);
  if(kind==='diary')await h.pg.query("update public.diary_entries set entry_date=date '2026-09-24'+$1::int where id=$2",[n,post(kind,n)]);
 }
 for(let n=0;n<2;n++)await h.pg.query("insert into public.guestbook_posts(id,author_name,body,visibility) values($1,'guest','guest sentinel',$2)",[id(4000+n),n?'private':'public']);
 await h.pg.exec('set session_replication_role=origin');
 const summary=(token=ab,mode='member',status=200,body={menus})=>call(2,'/content/summary',body,mode==='public'?undefined:token,status,mode);
 const calendar=(token=ab,mode='member',status=200)=>call(2,'/content/calendar',{month:'2026-09'},mode==='public'?undefined:token,status,mode);
 const locate=(kind,n,token=ab,mode='member',status=200)=>call(2,'/content/location',{kind,id:post(kind,n),size:1},mode==='public'?undefined:token,status,mode);
 await check('public/nonfriend/pending exclude friend/private counts, comments, dates and IDs',async()=>{
  for(const mode of ['public','member']){const d=(await summary(ab,mode)).data.data;for(const kind of Object.keys(tables))assert.deepEqual(d.counts[kind],{today:1,total:1});assert.equal(d.counts.guestbook.total,1);assert.equal(d.today_comments,3);assert.equal(d.recent.length,4);assert.deepEqual((await calendar(ab,mode)).data.data.dates,['2026-09-24']);for(const kind of Object.keys(tables)){await locate(kind,1,ab,mode,404);await locate(kind,2,ab,mode,404);}}
  await act(2,ab,2,'request');assert.equal((await summary()).data.data.counts.board.total,1);await act(1,ba,1,'accept');
 });
 await check('accepted friend sees public+friends, owner includes private; guestbook stays public for all',async()=>{
  for(const [token,mode,total] of [[ab,'member',2],['owner.valid.jwt','owner',3]]){const d=(await summary(token,mode)).data.data;for(const kind of Object.keys(tables))assert.equal(d.counts[kind].total,total);assert.equal(d.counts.guestbook.total,1);assert.equal(d.today_comments,total*3);assert.equal(d.recent.length,5);assert.equal((await calendar(token,mode)).data.data.dates.length,total);}
  assert.equal((await summary(ab,'member',200,{menus,scope:'public'})).data.data.counts.board.total,1);
 });
 await check('filtered location ranks match list order and never count hidden rows',async()=>{
  for(const kind of ['board','photos']){
   assert.equal((await locate(kind,0)).data.data.page,2);assert.equal((await locate(kind,1)).data.data.page,1);assert.equal((await locate(kind,0,ab,'public')).data.data.page,1);assert.equal((await locate(kind,0,'owner.valid.jwt','owner')).data.data.page,3);
   const p=(await locate(kind,0)).data.data;const rows=(await call(2,'/content/list',{kind,folder_id:p.folder_id,page:p.page,size:1},ab)).data.data.items;assert.equal(rows[0].id,p.id);
  }
  assert.equal((await locate('diary',1)).data.data.entry_date,'2026-09-25');await locate('diary',2,ab,'member',404);
 });
 await check('private change removes summary/comment/date/location metadata; stale ID fails current access',async()=>{
  await h.pg.query("select set_config('request.jwt.claim.sub',$1,false)",[h.owner]);await h.pg.query("update public.diary_entries set visibility='private' where id=$1",[post('diary',1)]);
  assert.equal((await summary()).data.data.counts.diary.total,1);assert.equal((await summary()).data.data.today_comments,5);assert.deepEqual((await calendar()).data.data.dates,['2026-09-24']);await locate('diary',1,ab,'member',404);
  await h.pg.query("update public.diary_entries set visibility='friends' where id=$1",[post('diary',1)]);
 });
 await check('hidden menu filtering, empty summary, strict inputs and service-only ACL',async()=>{
  const settings=(await h.pg.query('select payload from public.minihompy_settings where id=1')).rows[0].payload;
  const hidden=structuredClone(settings);hidden.menus.find(m=>m.id==='board').visible=false;await h.pg.query('update public.minihompy_settings set payload=$1 where id=1',[hidden]);assert.equal((await summary()).data.data.counts.board,undefined);await h.pg.query('update public.minihompy_settings set payload=$1 where id=1',[settings]);
  assert.deepEqual((await summary(ab,'member',200,{menus:[]})).data.data.counts,{});
  for(const body of [{menus:['board','board']},{menus:['unknown']},{menus,as_of:'2000-01-01'},{menus,context:{}}])await summary(ab,'member',400,body);
  await call(2,'/content/calendar',{month:'2026-13'},ab,400);await call(2,'/content/location',{kind:'guestbook',id:id(4001),size:1},ab,400);
  for(const role of ['anon','authenticated']){await h.pg.exec('set role '+role);await assert.rejects(h.pg.query("select public.member_content_aggregate('summary','{}')"),e=>e.code==='42501');await h.pg.exec('reset role');}
 });
 await check('response schema strips internal fields, rejects bad dates/ranks/order; missing settings is an error',async()=>{
  const before=readChecks;await summary();await calendar();await locate('board',0);assert.equal(readChecks,before+3);
  dbTransform=r=>({...r,data:{...r.data,data:{...r.data.data,secret:'internal'}}});assert.equal((await summary()).data.data.secret,undefined);dbTransform=null;
  dbTransform=r=>({...r,data:{...r.data,data:{...r.data.data,recent:r.data.data.recent.map((row,i)=>({...row,created_at:'2000-01-01T00:00:00.000'+(9-i)+'Z'}))}}});await summary();dbTransform=null;
  dbTransform=r=>({...r,data:{...r.data,data:{...r.data.data,recent:[...r.data.data.recent].reverse()}}});await summary(ab,'member',503);dbTransform=null;
  dbTransform=r=>({...r,data:{...r.data,data:{dates:['2026-09-31']}}});await calendar(ab,'member',503);dbTransform=null;
  dbTransform=r=>({...r,data:{...r.data,data:{...r.data.data,page:0}}});await locate('board',0,ab,'member',503);dbTransform=null;
  const saved=(await h.pg.query('select payload from public.minihompy_settings where id=1')).rows[0].payload;await h.pg.exec('set session_replication_role=replica');await h.pg.query("update public.minihompy_settings set payload=payload-'menus' where id=1");await h.pg.exec('set session_replication_role=origin');await summary(ab,'member',503);await h.pg.query('update public.minihompy_settings set payload=$1 where id=1',[saved]);
 });
 await check('disconnect makes next aggregate public-only and denies old location; response/session fences fail closed',async()=>{
  await act(1,ba,1,'disconnect');assert.equal((await summary()).data.data.counts.board.total,1);await locate('board',1,ab,'member',404);
  centralDown=true;await summary(ab,'member',503);await summary(ab,'public');centralDown=false;
  mutateContext=d=>({...d,site_id:site(1)});await summary(ab,'member',403);mutateContext=null;
  dbTransform=r=>({...r,data:{...r.data,data:{...r.data.data,today_comments:-1}}});await summary(ab,'member',503);dbTransform=null;
  const hash=await tokenHash(ab);afterRead=()=>h.db.rpc('member_writing_session',{p_action:'revoke',p_args:{site_id:site(2),token_hash:hash}});await summary(ab,'member',401);
 });
 console.log(`All ${groups} aggregate central/personal API groups passed; actual SQL/handlers, local Auth/readiness fixtures, no hosted writes.`);
}finally{for(const h of Object.values(homes))await h.pg.close();await central.pg.close();}
