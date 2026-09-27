import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';import {site,owner,seed,activate,request,id,post,photoPath} from './helpers/friend-visibility-fixture.mjs';import {contentRead} from '../supabase/functions/member-writing/content-read.js';
const {pg,db}=await memberWritingDb(PGlite,{siteId:site,centralUrl:'https://central.test/api',photoMedia:true,friendVisibility:true});let groups=0;
const test=async(name,fn)=>{await fn();console.log(`PASS ${++groups}: ${name}`);};
const revision=async n=>(await pg.query('select revision from public.photo_posts where id=$1',[post('photos',n)])).rows[0].revision;
const posts=async(...ns)=>Promise.all(ns.map(async n=>({id:post('photos',n),revision:await revision(n)})));
const check=async(mode,items,change=x=>x)=>(await db.rpc('member_photo_check',{p_action:'photo-check',p_args:change(request(mode,'photo-check',{posts:items}))})).data;
const api=async(body,path='photo-check',transform=x=>x)=>{const r=await contentRead(new Request('https://home.test/content/'+path,{method:path==='health'?'GET':'POST',headers:{'Content-Type':'application/json'},...(path==='health'?{}:{body:JSON.stringify(body)})}),{siteId:site,db:{rpc:async(n,a)=>{const r=await db.rpc(n,a);return {...r,data:transform(r.data,n)};}}},'public','/content/'+path,(status,data,headers)=>Response.json(data,{status,headers}));return {status:r.status,data:await r.json()};};
try{
 await seed(pg);await activate(pg);
 await test('public/friend/nonfriend/owner per-target permissions; only IDs and validity returned',async()=>{
  const items=await posts(0,1);assert.deepEqual((await check('public',items)).data.items,items.map((p,i)=>({id:p.id,valid:i===0})));
  assert.ok((await check('member',items)).data.items.every(p=>p.valid));
  assert.equal((await check('member',items,a=>{a.context.relationship='none';a.context.can_read_friends=false;return a;})).data.items[1].valid,false);
  assert.equal((await check('member',await posts(2))).data.items[0].valid,false);assert.equal((await check('owner',await posts(2))).data.items[0].valid,true);
 });
 await test('missing, hidden and wrong revision are indistinguishable; all targets hash-bound',async()=>{
  for(const p of [{id:id(9999),revision:1},...(await posts(2)),{...(await posts(0))[0],revision:999}])assert.deepEqual((await check('public',[p])).data.items,[{id:p.id,valid:false}]);
  assert.equal((await check('member',await posts(1),a=>{a.selectors.posts[0].revision++;return a;})).failure,'TARGET_MISMATCH');
 });
 await test('API/SQL reject excessive, duplicate, malformed and path selectors',async()=>{
  const [p]=await posts(0);for(const items of [[],[p,p],[p,{...p,id:id(9998)},{...p,id:id(9999)}],[{...p,path:photoPath(0)}],[{...p,revision:0}],[{...p,revision:1.5}],[{...p,id:'invalid'}]]){assert.equal((await check('public',items)).failure,'BAD_REQUEST');assert.equal((await api({posts:items})).status,400);}
  assert.equal((await api({posts:[p],extra:'x'})).status,400);assert.equal((await api({posts:[p],extra:'x'.repeat(9000)})).status,400);
 });
 await test('body, title, folder and privacy edits increment revision and invalidate old result',async()=>{
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  const folder=(await pg.query("insert into public.photo_folders(label,sort_order) values('fixture',99) returning id")).rows[0].id;
  for(const [field,value] of [['title','changed'],['body',JSON.stringify([{type:'text',text:'changed'},{type:'image',path:photoPath(0)}])],['folder_id',folder],['visibility','private']]){const old=await posts(0);await pg.query(`update public.photo_posts set ${field}=$1 where id=$2`,[value,post('photos',0)]);assert.ok(await revision(0)>old[0].revision);assert.equal((await check('owner',old)).data.items[0].valid,false);}
  await pg.query("update public.photo_posts set visibility='public' where id=$1",[post('photos',0)]);
 });
 await test('image replacement, detached asset and deletion invalidate checks',async()=>{
  const old=await posts(0),path=post('photos',0)+'/'+id(998)+'.png';await pg.query("insert into private.photo_assets(path,post_id,uploaded_by,complete,size,mime,sha256) values($1,$2,$3,true,1,'image/png',$4)",[path,post('photos',0),owner,'c'.repeat(64)]);
  await pg.query('update public.photo_posts set body=$1 where id=$2',[JSON.stringify([{type:'image',path}]),post('photos',0)]);assert.equal((await check('owner',old)).data.items[0].valid,false);
  const current=await posts(0);assert.equal((await check('public',current)).data.items[0].valid,true);await pg.query("update private.photo_assets set complete=false where path=$1",[path]);assert.equal((await check('public',current)).data.items[0].valid,false);await pg.query('delete from public.photo_posts where id=$1',[post('photos',0)]);assert.equal((await check('public',current)).data.items[0].valid,false);
 });
 await test('capability only advertised by matching SQL; malformed response/failure never succeeds',async()=>{
  assert.equal((await api(null,'health')).data.photo_check_protocol,1);const body={posts:await posts(1)};assert.equal((await api(body)).status,200);
  assert.equal((await api(body,'photo-check',(d,n)=>n==='friend_visibility_status'?{...d,photo_check_protocol:undefined}:d)).status,503);
  for(const items of [[],[{id:post('photos',1),valid:'false'}],[{id:id(9999),valid:true}]])assert.equal((await api(body,'photo-check',(d,n)=>n==='member_photo_check'?{...d,data:{items}}:d)).status,503);
 });
 await test('service-only ACL, idempotent migration, session revocation',async()=>{
  for(const role of ['anon','authenticated']){await pg.exec('set role '+role);await assert.rejects(pg.query("select public.member_photo_check('photo-check','{}')"));await pg.exec('reset role');}
  const before=(await pg.query('select * from public.photo_posts order by id')).rows;await pg.exec(await readFile('supabase/migrations/202609270002_photo_check.sql','utf8'));assert.deepEqual((await pg.query('select * from public.photo_posts order by id')).rows,before);
  const args=request('member','photo-check',{posts:await posts(1)});await db.rpc('member_writing_session',{p_action:'revoke',p_args:{site_id:site,token_hash:args.token_hash}});assert.equal((await db.rpc('member_photo_check',{p_action:'photo-check',p_args:args})).data.failure,'SESSION_REVOKED');
 });
}finally{await pg.close();}
