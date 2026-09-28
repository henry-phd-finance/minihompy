// Real independent PostgreSQL transactions; Storage byte verification belongs to Step 7.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import pg from '../../minihompy-central/node_modules/pg/lib/index.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
const container=execFileSync('docker',['run','--rm','-d','-e','POSTGRES_HOST_AUTH_METHOD=trust','-p','127.0.0.1::5432','postgres:16-alpine'],{encoding:'utf8'}).trim();
const id=n=>'90000000-0000-4000-8000-'+String(n).padStart(12,'0'),owner=id(1),other=id(2),path=n=>id(n)+'/'+id(77)+'.png',sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pool,a,b,c,fixture,folder,groups=0;
const check=async(name,fn)=>{await fn();console.log('PASS '+(++groups)+': '+name);};
const rpc=(client,action,args={},name='photo_variant')=>client.query('select public.'+name+'($1,$2) v',[action,args]).then(r=>r.rows[0].v);
const media=(action,args={})=>rpc(b,action,args,'photo_media');
const input=n=>({owner_id:owner,path:path(n),post_id:id(n),source_sha256:'a'.repeat(64),recipe:'display-v1',mime:'image/webp',size:80,width:10,height:10,sha256:'b'.repeat(64)});
const seed=async n=>{const args={owner_id:owner,path:path(n),post_id:id(n),mime:'image/png',size:100,sha256:'a'.repeat(64)};assert(!(await media('reserve',args)).failure);assert(!(await media('complete',args)).failure);};
const reserve=async n=>{const v=await rpc(b,'reserve',input(n));assert(!v.failure,JSON.stringify(v));return {...input(n),id:v.id,operation_id:v.operation_id};};
const complete=async args=>{assert(!(await rpc(b,'upload_confirm',args)).failure);assert.equal((await rpc(b,'complete',args)).state,'ready');};
const save=n=>c.query("insert into public.photo_posts(id,folder_id,author_name,title,body) values($1,$2,'owner','photo',$3)",[id(n),folder,JSON.stringify([{type:'image',path:path(n)}])]);
const waitLock=async client=>{for(let i=0;i<300;i++){if((await pool.query('select wait_event_type from pg_stat_activity where pid=$1',[client.processID])).rows[0]?.wait_event_type==='Lock')return;await sleep(10);}throw Error('Expected lock wait');};
try{
 const port=Number(execFileSync('docker',['port',container,'5432'],{encoding:'utf8'}).trim().split(':').at(-1)),config={host:'127.0.0.1',port,user:'postgres',database:'postgres'};
 pool=new pg.Pool(config);for(let i=0;;i++){try{await pool.query('select 1');break;}catch(e){if(i>100)throw e;await sleep(100);}}
 class Adapter{constructor(){this.client=new pg.Client(config);this.ready=this.client.connect();}async query(s,args){await this.ready;return this.client.query(s,args);}exec(s){return this.query(s);}close(){return this.client.end();}}
 fixture=await memberWritingDb(Adapter,{siteId:id(99),centralUrl:'https://central.test/api',photoMedia:true,friendVisibility:true});
 await pool.query('insert into auth.users values($1),($2)',[owner,other]);await pool.query('insert into private.minihompy_admins values($1)',[owner]);
 folder=(await pool.query('select id from public.photo_folders limit 1')).rows[0].id;
 await pool.query("update private.photo_media_state set mode='protected',ready=true where singleton");
 a=await pool.connect();b=await pool.connect();c=await pool.connect();
 for(const client of [a,b])await client.query("set role service_role;set statement_timeout='8s'");
 await c.query("set role authenticated;set statement_timeout='8s'");await c.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
 await seed(10);await save(10);
 const before=(await pool.query('select to_jsonb(t) v from private.photo_assets t order by path')).rows;
 const posts=(await pool.query('select to_jsonb(t) v from public.photo_posts t order by id')).rows;
 await pool.query(await readFile(new URL('../supabase/migrations/202609280001_photo_asset_variants.sql',import.meta.url),'utf8'));
 await check('migration preserves existing originals/posts and original read protocol',async()=>{
  assert.deepEqual((await pool.query('select to_jsonb(t) v from private.photo_assets t order by path')).rows,before);
  assert.deepEqual((await pool.query('select to_jsonb(t) v from public.photo_posts t order by id')).rows,posts);
  assert.equal((await media('read',{path:path(10),post_id:id(10)})).path,path(10));
 });
 await check('browser/service table denial, browser RPC denial, underlying cleanup cannot bypass wrapper',async()=>{
  for(const role of ['anon','authenticated','service_role']){
   const client=await pool.connect();try{await client.query('set role '+role);
    await assert.rejects(()=>client.query('select * from private.photo_asset_variants'),e=>e.code==='42501');
    await assert.rejects(()=>rpc(client,'inventory',{},'photo_media_without_variants'),e=>e.code==='42501');
    if(role!=='service_role')await assert.rejects(()=>rpc(client,'inventory',{owner_id:owner,path:path(10)}),e=>e.code==='42501');
   }finally{await client.query('reset role');client.release();}
  }
  assert.equal((await rpc(b,'reserve',{...input(10),owner_id:other})).failure,'FORBIDDEN');
  await pool.query("create policy fixture_allow_all on storage.objects for all to anon,authenticated using(true) with check(true)");
  await pool.query("insert into storage.objects(bucket_id,name) values('minihompy-photos-private',$1)",['variants/'+id(10)+'/'+id(4)+'.webp']);
  assert.equal((await c.query("select * from storage.objects where bucket_id='minihompy-photos-private'")).rows.length,0);
 });
 let live,unrelated;
 await check('reservation validates source, smaller WebP and bounded dimensions; immutable server paths',async()=>{
  for(const patch of [{source_sha256:'c'.repeat(64)},{post_id:id(11)},{size:100},{size:0},{width:1201},{height:0},{mime:'image/png'},{recipe:'unknown'},{sha256:'oops'}])assert((await rpc(b,'reserve',{...input(10),...patch})).failure);
  const v=await rpc(b,'reserve',{...input(10),storage_path:'attacker/path'});assert.match(v.storage_path,new RegExp('^variants/'+id(10)+'/'));assert.notEqual(v.operation_id,undefined);
  live={...input(10),id:v.id,operation_id:v.operation_id};assert.equal((await rpc(b,'reserve',input(10))).id,v.id);
  assert.equal((await rpc(b,'reserve',{...input(10),sha256:'c'.repeat(64)})).failure,'REQUEST_CONFLICT');
 });
 await check('upload confirmation distinct from ready; digest/metadata/operation/source binding and idempotent completion',async()=>{
  assert.equal((await rpc(b,'complete',live)).failure,'UPLOAD_PENDING');
  for(const patch of [{sha256:'c'.repeat(64)},{size:79},{width:9},{height:9},{mime:'image/png'}])assert.equal((await rpc(b,'upload_confirm',{...live,...patch})).failure,'INTEGRITY_FAILED');
  assert.equal((await rpc(b,'upload_confirm',{...live,recipe:'display-v2'})).failure,'REQUEST_CONFLICT');
  assert.equal((await rpc(b,'upload_confirm',{...live,operation_id:id(88)})).failure,'REQUEST_CONFLICT');
  assert.equal((await rpc(b,'upload_confirm',{...live,source_sha256:'c'.repeat(64)})).failure,'SOURCE_CHANGED');
  assert.equal((await rpc(b,'upload_confirm',live)).state,'pending');await complete(live);
  assert.equal((await rpc(b,'complete',live)).id,live.id);
  assert.equal((await rpc(b,'reserve',{...input(10),sha256:'c'.repeat(64),size:70})).id,live.id);
 });
 await check('linked files protected; cleanup fences all derivatives and requires individual deletion confirmation',async()=>{
  await seed(15);unrelated=await reserve(15);await complete(unrelated);
  assert.equal((await media('cleanup_begin',{owner_id:owner,path:path(10)})).failure,'IN_USE');
  assert.equal((await rpc(b,'cleanup_begin',live)).failure,'IN_USE');
  await c.query('delete from public.photo_posts where id=$1',[id(10)]);
  assert.equal((await media('cleanup_begin',{owner_id:owner,path:path(10)})).failure,'VARIANTS_PENDING');
  assert.equal((await rpc(b,'status',live)).state,'deleting');
  assert.equal((await rpc(b,'complete',live)).failure,'SOURCE_CHANGED');
  assert.equal((await media('cleanup_finish',{owner_id:owner,path:path(10)})).failure,'VARIANTS_PENDING');
  assert.equal((await rpc(b,'cleanup_finish',live)).failure,'REQUEST_CONFLICT');
  assert.equal((await rpc(b,'cleanup_finish',{...live,storage_deleted:true})).state,'deleted');
  assert.equal((await rpc(b,'cleanup_finish',{...live,storage_deleted:true})).state,'deleted');
  assert.equal((await media('cleanup_begin',{owner_id:owner,path:path(10)})).state,'deleting');
  assert.equal((await media('cleanup_finish',{owner_id:owner,path:path(10)})).ok,true);
  assert.equal((await rpc(b,'status',unrelated)).state,'ready');
  // Even an administrative source-row removal cannot cascade away cleanup history.
  await pool.query('delete from private.photo_assets where path=$1',[path(10)]);
  assert.equal((await rpc(b,'inventory',{owner_id:owner,path:path(10)})).items[0].storage_path.endsWith('.webp'),true);
 });
 await check('live upload protected, lease expiry fences completion and supports abandoned upload cleanup',async()=>{
  await seed(11);const v=await reserve(11);
  assert.equal((await rpc(b,'cleanup_begin',v)).failure,'UPLOAD_PENDING');
  assert.equal((await media('cleanup_begin',{owner_id:owner,path:path(11)})).failure,'UPLOAD_PENDING');
  await pool.query("update private.photo_asset_variants set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[v.id]);
  assert.equal((await rpc(b,'upload_confirm',v)).failure,'LEASE_EXPIRED');
  assert.equal((await rpc(b,'reserve',input(11))).failure,'REQUEST_CONFLICT');
  assert.equal((await rpc(b,'cleanup_begin',v)).state,'deleting');
  await rpc(b,'cleanup_finish',{...v,storage_deleted:true});
  const next=await reserve(11);assert.notEqual(next.id,v.id);assert.notEqual(next.operation_id,v.operation_id);
 });
 await check('expired/foreign draft and replaced/detached source cannot complete',async()=>{
  await seed(12);const v=await reserve(12);await pool.query("update private.photo_assets set sha256=$1 where path=$2",['c'.repeat(64),path(12)]);
  assert.equal((await rpc(b,'complete',v)).failure,'SOURCE_CHANGED');
  await seed(13);await pool.query("update private.photo_assets set created_at=clock_timestamp()-interval '16 minutes' where path=$1",[path(13)]);assert.equal((await rpc(b,'reserve',input(13))).failure,'SOURCE_CHANGED');
  await seed(14);await pool.query('update private.photo_assets set uploaded_by=$1 where path=$2',[other,path(14)]);assert.equal((await rpc(b,'reserve',input(14))).failure,'SOURCE_CHANGED');
 });
 await check('two independent reservations serialize to one operation/path',async()=>{
  await seed(20);await a.query('begin');const first=await rpc(a,'reserve',input(20));
  const second=rpc(b,'reserve',input(20));await waitLock(b);await a.query('commit');assert.equal((await second).id,first.id);
 });
 await check('completion wins then cleanup fences ready atomically; cleanup wins then late completion fails',async()=>{
  await seed(21);const v=await reserve(21);await rpc(b,'upload_confirm',v);
  await a.query('begin');assert.equal((await rpc(a,'complete',v)).state,'ready');
  const cleanup=media('cleanup_begin',{owner_id:owner,path:path(21)});await waitLock(b);await a.query('commit');assert.equal((await cleanup).failure,'VARIANTS_PENDING');
  assert.equal((await rpc(b,'complete',v)).failure,'SOURCE_CHANGED');
  await seed(22);const w=await reserve(22);await rpc(b,'upload_confirm',w);await pool.query("update private.photo_asset_variants set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[w.id]);
  await a.query('begin');await rpc(a,'cleanup_begin',{owner_id:owner,path:path(22)},'photo_media');
  const late=rpc(b,'complete',w);await waitLock(b);await a.query('commit');assert.equal((await late).failure,'SOURCE_CHANGED');
 });
 await check('post deletion and owner revocation during wait are checked after acquiring lock',async()=>{
  await seed(23);await save(23);const v=await reserve(23);await rpc(b,'upload_confirm',v);
  await c.query('begin');await c.query('delete from public.photo_posts where id=$1',[id(23)]);
  const late=rpc(b,'complete',v);await waitLock(b);await c.query('commit');assert.equal((await late).failure,'SOURCE_CHANGED');
  await a.query('begin');await rpc(a,'status',v);const revoked=rpc(b,'status',v);await waitLock(b);
  await pool.query('delete from private.minihompy_admins where user_id=$1',[owner]);await a.query('commit');assert.equal((await revoked).failure,'FORBIDDEN');
 });
 console.log('PASS: '+groups+' PostgreSQL lifecycle/permission/concurrency groups; no hosted Storage conversion or deployment.');
}finally{for(const client of [a,b,c])if(client){await client.query('rollback').catch(()=>{});client.release();}await fixture?.pg.close();await pool?.end();execFileSync('docker',['rm','-f',container],{stdio:'ignore'});}
