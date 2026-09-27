// Integrated visibility lifecycle across isolated central/A/B databases and third-party C.
import {handlePhotoMedia} from '../supabase/functions/photo-media/handler.js';
import {digest,BUCKET} from '../supabase/functions/photo-media/io.js';
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
  if(name==='member_content_read'||name==='member_content_aggregate'||name==='member_content_comments'){if(afterRead){const f=afterRead;afterRead=null;await f();}if(dbTransform)value=dbTransform(value);}
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
const check=async(name,fn)=>{await central.pg.exec('reset role;truncate private.identity_relationship_limits;set role service_role');await fn();console.log(`PASS ${++groups}: ${name}`);};
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



 const menus=Object.keys(tables),png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
 for(const [home,h] of Object.entries(homes)){
  await h.pg.query('update private.photo_assets set size=$1,sha256=$2',[png.length,await digest(png)]);
  await h.pg.query("select set_config('request.jwt.claim.sub',$1,false)",[h.owner]);
  for(const kind of menus)for(let n=0;n<3;n++){
   const marker=home+':'+kind+':'+['public','friends','private'][n];
   if(kind==='diary')await h.pg.query("update public.diary_entries set body=$1,entry_date=date '2026-09-24'+$2::int where id=$3",[marker,n,post(kind,n)]);
   else await h.pg.query('update public.'+tables[kind]+' set title=$1 where id=$2',[marker,post(kind,n)]);
  }
  await h.pg.query("select set_config('request.jwt.claim.sub','',false)");
 }
 const args=(kind,n=1)=>({kind,parent_id:post(kind,n)}),path=n=>post('photos',n)+'/'+id(999)+'.png';
 const photo=async(home,token,n=1,status=200,mode='member')=>{
  const h=homes[home];const r=await handlePhotoMedia(request(h.config.SUPABASE_URL+'/functions/v1/photo-media/read',{post_id:post('photos',n),path:path(n)},token,{Origin:h.config.MINIHOMPY_SITE_ORIGIN,'X-Minihompy-Auth-Mode':mode}),{env:{...h.config,SUPABASE_SERVICE_ROLE_KEY:'fixture'},fetcher,db:h.db,storage:{get:async bucket=>{assert.equal(bucket,BUCKET);return png.slice();}},rpc:async(action,body)=>(await h.pg.query('select public.photo_media($1,$2) r',[action,body])).rows[0].r});
  assert.equal(r.status,status);if(status===200)assert.deepEqual(new Uint8Array(await r.arrayBuffer()),png);else assert.ok((await r.json()).error);return r;
 };
 const comments=(home,token,kind,n=1,status=200,mode='member')=>call(home,'/comments?'+new URLSearchParams(args(kind,n)),undefined,token,status,mode);
 const content=(home,token,action,body,status=200,mode='member')=>call(home,'/content/'+action,body,token,status,mode);
 async function matrix(home,token,total,mode='member'){
  const summary=(await content(home,token,'summary',{menus},200,mode)).data.data;
  assert.deepEqual((await content(home,token,'calendar',{month:'2026-09'},200,mode)).data.data.dates,['2026-09-24','2026-09-25','2026-09-26'].slice(0,total));
  for(const kind of menus){
   const rows=(await content(home,token,'list',{kind,size:10},200,mode)).data.data;
   assert.equal(rows.count,total);assert.equal(rows.items.length,total);assert.equal(summary.counts[kind].total,total);
   assert.ok(rows.items.every(row=>(row.title||row.body).startsWith(home+':'+kind+':')));
   for(let n=0;n<3;n++){
    const status=n<total?200:404;
    await content(home,token,'detail',{kind,id:post(kind,n)},status,mode);
    const loc=await content(home,token,'location',{kind,id:post(kind,n),size:1},status,mode);
    await comments(home,token,kind,n,status,mode);
    if(n<total){const located=(await content(home,token,'list',{kind,folder_id:loc.data.data.folder_id,page:loc.data.data.page,size:1,...(kind==='diary'?{date:loc.data.data.entry_date}:{})},200,mode)).data.data;assert.equal(located.items[0].id,post(kind,n));}
    else {assert.ok(!JSON.stringify(summary).includes(post(kind,n)));assert.ok(!JSON.stringify(summary).includes(home+':'+kind+':'+['public','friends','private'][n]));}
   }
  }
  for(let n=0;n<3;n++)await photo(home,token,n,n<total?200:404,mode);
 }
 await check('visit before acceptance and pending request expose only public content across every surface',async()=>{
  assert.notEqual(homes[1].pg,homes[2].pg);assert.notEqual(homes[1].pg,central.pg);
  await matrix(2,ab,1);await matrix(2,undefined,1,'public');await act(2,ab,2,'request');await matrix(2,ab,1);
 });
 await check('acceptance unlocks both directions; C and central self-login do not become local administrators',async()=>{
  await act(1,ba,1,'accept');await matrix(2,ab,2);await matrix(1,ba,2);await matrix(2,cb,1);await matrix(1,aa,1);
  await matrix(2,'owner.valid.jwt',3,'owner');await content(1,ab,'list',{kind:'board'},401);
 });
 await check('final schema keeps local anonymous-account public writing and blocks direct RLS/RPC/Storage bypass',async()=>{
  const h=homes[2],guest=id(8888);await h.pg.query('insert into auth.users values($1)',[guest]);
  await h.pg.query('insert into storage.objects(bucket_id,name) values($1,$2)',[BUCKET,path(1)]);
  // A permissive policy must not override the restrictive protected-media policy.
  await h.pg.exec('create policy fixture_allow_storage on storage.objects for select to anon,authenticated using(true)');
  for(const role of ['anon','authenticated']){
   await h.pg.exec('set role '+role);await h.pg.query("select set_config('request.jwt.claim.sub',$1,false)",[role==='authenticated'?guest:'']);
   try{
    assert.equal((await h.pg.query('select * from storage.objects')).rows.length,0);
    for(const kind of menus){
     assert.equal((await h.pg.query('select count(*)::int n from public.'+tables[kind])).rows[0].n,1);
     assert.equal((await h.pg.query('select public.post_location($1,$2,1) r',[kind,post(kind,1)])).rows[0].r,null);
     const column={board:'board_post_id',photos:'photo_post_id',diary:'diary_entry_id'}[kind];
     await assert.rejects(h.pg.query('insert into public.post_comments(id,'+column+",author_name,body) values(gen_random_uuid(),$1,'guest','hidden')",[post(kind,1)]),e=>e.code==='42501');
     if(role==='authenticated'){
      const row=(await h.pg.query('insert into public.post_comments(id,'+column+",author_name,body) values(gen_random_uuid(),$1,'guest','public local comment') returning id,author_id",[post(kind,0)])).rows[0];assert.equal(row.author_id,guest);
      assert.equal((await h.pg.query("update public.post_comments set body='local edit' where id=$1 returning id",[row.id])).rows.length,1);
      assert.equal((await h.pg.query('delete from public.post_comments where id=$1 returning id',[row.id])).rows.length,1);
      await h.pg.exec('reset role');await h.pg.query('delete from private.comment_write_limits where user_id=$1',[guest]);await h.pg.exec('set role authenticated');
     }
    }
    const legacy=(await h.pg.query('select public.home_summary($1) r',[menus])).rows[0].r;for(const kind of menus)assert.equal(legacy.counts[kind].total,1);
    for(const fn of ['member_content_read','member_content_comments','member_content_aggregate','member_photo_read'])await assert.rejects(h.pg.query('select public.'+fn+"('list','{}')"),e=>e.code==='42501');
   }finally{await h.pg.exec('reset role');await h.pg.query("select set_config('request.jwt.claim.sub','',false)");}
  }
 });
 const writes=[];
 await check('all three friend comment writes stay in B; lost response replays once without duplicate rows',async()=>{
  for(const kind of menus){
   await homes[2].pg.query("delete from private.member_writing_limits");const body={...args(kind),id:randomUUID(),request_id:randomUUID(),body:'A to B '+kind};writes.push(body);
   dbTransform=r=>{if(r.data?.id===body.id)throw Error('lost acknowledgement');return r;};await call(2,'/comments',body,ab,503);dbTransform=null;
   assert.equal((await call(2,'/comments',body,ab)).data.replayed,true);const rows=(await comments(2,ab,kind)).data;
   assert.equal(rows.count,1);assert.equal(rows.items[0].author_member_id,member(1));assert.equal(rows.items[0].body,body.body);
   assert.equal((await homes[1].pg.query('select count(*)::int n from public.post_comments where id=$1',[body.id])).rows[0].n,0);
  }
  const summary=(await content(2,ab,'summary',{menus})).data.data;assert.equal(summary.today_comments,3);
 });
 await check('disconnect after permitted response preserves historical bytes but all new surfaces and receipts deny access',async()=>{
  const delivered=(await content(2,ab,'detail',{kind:'photos',id:post('photos',1)})).data.data;
  await act(1,ba,1,'disconnect');assert.ok(JSON.stringify(delivered).includes('2:photos:friends'));
  await matrix(2,ab,1);await matrix(1,ba,1);
  for(const body of writes){await call(2,'/comments',body,ab,404);await call(2,'/comments/operations/'+body.request_id+'?'+new URLSearchParams(args(body.kind)),undefined,ab,404);}
  assert.equal((await content(2,ab,'summary',{menus})).data.data.today_comments,0);
  await central.pg.exec('reset role;truncate private.identity_relationship_cooldowns;set role service_role');await act(2,ab,2,'request');await act(1,ba,1,'accept');
 });
 await check('central outage and quota fail consistently, public and local owner remain independent',async()=>{
  for(const status of [503,429]){
   if(status===503)centralDown=true;else centralReply=()=>Response.json({},{status:429,headers:{'Retry-After':'7'}});
   for(const [action,body] of [['list',{kind:'photos'}],['detail',{kind:'board',id:post('board',1)}],['summary',{menus}],['calendar',{month:'2026-09'}],['location',{kind:'diary',id:post('diary',1),size:1}]]){const r=await content(2,ab,action,body,status);if(status===429)assert.equal(r.r.headers.get('Retry-After'),'7');}
   await comments(2,ab,'photos',1,status);await photo(2,ab,1,status);
   if(status===503){await matrix(2,undefined,1,'public');await matrix(2,'owner.valid.jwt',3,'owner');}
   centralDown=false;centralReply=null;
  }
 });
 await check('local family revocation after SQL discards successful response; new visit and central revocation affect every route',async()=>{
  const hash=await tokenHash(ab);afterRead=()=>homes[2].db.rpc('member_writing_session',{p_action:'revoke',p_args:{site_id:site(2),token_hash:hash}});
  await content(2,ab,'summary',{menus},401);await photo(2,ab,1,401);await comments(2,ab,'photos',1,401);ab=await login(1,2);await matrix(2,ab,2);
  await central.pg.exec('reset role');await central.pg.query('update private.identity_sessions set revoked_at=clock_timestamp() where id=$1',[session(1)]);await central.pg.exec('set role service_role');
  await content(2,ab,'list',{kind:'board'},401);await content(2,ab,'summary',{menus},401);await content(2,ab,'calendar',{month:'2026-09'},401);await content(2,ab,'location',{kind:'photos',id:post('photos',1),size:1},401);await photo(2,ab,1,401);await comments(2,ab,'diary',1,401);await content(2,cb,'list',{kind:'board'});
 });
 console.log('All '+groups+' cross-surface central/A/B/C lifecycle groups passed; actual handlers/SQL and PNG bytes, fixture Auth/Storage, no hosted writes.');
}finally{for(const h of Object.values(homes))await h.pg.close();await central.pg.close();}
