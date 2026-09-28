import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {site,owner,seed,activate,request,post,photoPath,canonical} from './helpers/friend-visibility-fixture.mjs';
import {handlePhotoMedia} from '../supabase/functions/photo-media/handler.js';
import {contentRead} from '../supabase/functions/member-writing/content-read.js';
const {pg,db}=await memberWritingDb(PGlite,{siteId:site,centralUrl:'https://central.test/api',photoMedia:true,friendVisibility:true});
const files=['202609280001_photo_asset_variants.sql','202609280002_photo_variant_status.sql','202609280003_photo_variant_reads.sql'];
let groups=0;const test=async(name,fn)=>{await fn();console.log('PASS '+(++groups)+': '+name);};
const rev=async n=>(await pg.query('select revision from public.photo_posts where id=$1',[post('photos',n)])).rows[0].revision;
const selectors=async ns=>({posts:await Promise.all(ns.map(async n=>({id:post('photos',n),revision:await rev(n)}))),variant:'display-v1'});
const sql=async(name,args)=>{await pg.exec('set role service_role');try{return (await pg.query('select public.'+name+'($1,$2) v',[name==='member_photo_check'?'photo-check':'read',args])).rows[0].v;}finally{await pg.exec('reset role');}};
const check=async(mode,ns,change=x=>x)=>sql('member_photo_check',change(request(mode,'photo-check',await selectors(ns))));
const api=async(body,transform=(d)=>d)=>{const r=await contentRead(new Request('https://home.test/content/photo-check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),{siteId:site,db:{rpc:async(n,a)=>{const r=await db.rpc(n,a);return {...r,data:transform(r.data,n)};}}},'public','/content/photo-check',(status,data,headers)=>Response.json(data,{status,headers}));return {status:r.status,data:await r.json()};};
const memberArgs=async n=>{
 const a=request('member','read',{post_id:post('photos',n),path:photoPath(n),representation:{kind:'display-v1',source_sha256:'b'.repeat(64),sha256:'c'.repeat(64),revision:await rev(n)}});
 a.context.request_hash=createHash('sha256').update(canonical({protocol:1,mode:'member',scope:'visible',action:'photo.read',selectors:a.selectors})).digest('hex');return a;
};
try{
 await seed(pg);await activate(pg);await pg.query('update private.photo_assets set size=100');
 // Old DB: new photo-check must fail closed instead of silently returning v1 data.
 assert.equal((await api(await selectors([0]))).status,503);
 for(const f of files)await pg.exec(await readFile('supabase/migrations/'+f,'utf8'));
 for(const n of [0,1,2]){
  const args={owner_id:owner,path:photoPath(n),post_id:post('photos',n),source_sha256:'b'.repeat(64),recipe:'display-v1',sha256:'c'.repeat(64),size:50,mime:'image/webp',width:1,height:1};
  const call=async(action,args)=>(await pg.query('select public.photo_variant($1,$2) v',[action,args])).rows[0].v;
  const v=await call('reserve',args);assert(!v.failure);const binding={...args,id:v.id,operation_id:v.operation_id};await call('upload_confirm',binding);await call('complete',binding);
 }
 await test('public/friend/nonfriend/owner descriptor boundaries; legacy shape unchanged',async()=>{
  const p=(await check('public',[0,1])).data.items;assert.equal(p[0].photos.length,1);assert.deepEqual(p[1],{id:post('photos',1),valid:false,photos:[]});
  assert.equal((await check('member',[1])).data.items[0].photos[0].representation.kind,'display-v1');
  assert.deepEqual((await check('member',[1],a=>{a.context.relationship='none';a.context.can_read_friends=false;return a;})).data.items[0].photos,[]);
  assert.equal((await check('member',[2])).data.items[0].valid,false);assert.equal((await check('owner',[2])).data.items[0].photos.length,1);
  const s=await selectors([0]);delete s.variant;assert.deepEqual((await sql('member_photo_check',request('public','photo-check',s))).data.items,[{id:post('photos',0),valid:true}]);
  const out=await api(await selectors([0]));assert.equal(out.status,200);assert(!JSON.stringify(out).includes('storage_path'));assert(!JSON.stringify(out).includes('variants/'));
 });
 await test('variant selector and every representation component are canonical context-bound',async()=>{
  assert.equal((await check('member',[1],a=>{delete a.selectors.variant;return a;})).failure,'TARGET_MISMATCH');
  for(const key of ['sha256','source_sha256','revision','kind']){const a=await memberArgs(1);a.selectors.representation[key]=key==='revision'?999:key==='kind'?'display-v2':'d'.repeat(64);assert.equal((await sql('member_photo_read',a)).failure,'TARGET_MISMATCH');}
  const a=await memberArgs(1);assert.equal((await sql('member_photo_read',a)).recipe,'display-v1');
 });
 await test('invalid selectors, excessive targets and malformed output never downgrade or leak metadata',async()=>{
  const s=await selectors([0]);for(const variant of [null,'display-v2',{},1]){assert.equal((await api({...s,variant})).status,400);assert.equal((await sql('member_photo_check',request('public','photo-check',{...s,variant}))).failure,'BAD_REQUEST');}
  assert.equal((await api(await selectors([0,1,2]))).status,400);
  for(const mutate of [p=>{p.photos[0].source_sha256='bad';},p=>{p.photos[0].representation.size=-1;},p=>{p.photos[0].revision++;},p=>{p.valid=false;}]){
   assert.equal((await api(s,(d,n)=>{if(n==='member_photo_check')mutate(d.data.items[0]);return d;})).status,503);
  }
  assert.equal((await api(s,(d,n)=>n==='friend_visibility_status'?{...d,photo_variant_read_protocol:undefined}:d)).status,503);
 });
 await test('pending/missing/deleted representation yields null only after original authorization; selected missing never falls back',async()=>{
  await pg.query("update private.photo_asset_variants set state='deleting' where source_path=$1",[photoPath(0)]);
  assert.equal((await check('public',[0])).data.items[0].photos[0].representation,null);
  const s=(await memberArgs(0)).selectors;assert.equal((await sql('photo_representation_read',s)).failure,'NOT_FOUND');
  await pg.query("update private.photo_asset_variants set state='ready' where source_path=$1",[photoPath(0)]);
  assert.equal((await sql('photo_representation_read',s)).recipe,'display-v1');
  assert.equal((await sql('photo_representation_read',{...(await memberArgs(2)).selectors})).failure,'NOT_FOUND');
  assert.equal((await sql('photo_representation_read',{...(await memberArgs(2)).selectors,owner_id:owner})).recipe,'display-v1');
 });
 await test('revision/source-hash changes, detach and deletion reject stale read descriptors',async()=>{
  const a=await memberArgs(1);await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await pg.query("update public.photo_posts set title='changed' where id=$1",[post('photos',1)]);assert.equal((await sql('member_photo_read',a)).failure,'NOT_FOUND');
  const b=await memberArgs(1);await pg.query('update private.photo_assets set sha256=$1 where path=$2',['d'.repeat(64),photoPath(1)]);assert.equal((await sql('member_photo_read',b)).failure,'NOT_FOUND');
  await pg.query('delete from public.photo_posts where id=$1',[post('photos',1)]);assert.equal((await sql('member_photo_read',await memberArgs(0))).recipe,'display-v1');assert.equal((await sql('member_photo_read',b)).failure,'NOT_FOUND');
 });
 await test('new RPC and resolver remain inaccessible to browser roles',async()=>{
  for(const role of ['anon','authenticated']){await pg.exec('set role '+role);await assert.rejects(()=>pg.query("select public.photo_representation_read('read','{}')"));await assert.rejects(()=>pg.query("select private.photo_representation('{}','{}')"));await pg.exec('reset role');}
 });
 await test('read capability requires DB functions/readiness; disabled media rejects variant reads',async()=>{
  const variantStatus=async()=>(await pg.query('select public.photo_variant_status() v')).rows[0].v;
  const health=async()=>{const r=await handlePhotoMedia(new Request('https://edge.test/functions/v1/photo-media/health',{headers:{'X-Minihompy-Auth-Mode':'public'}}),{env:{MINIHOMPY_SITE_ORIGIN:'https://home.test',MINIHOMPY_SITE_ID:site,MINIHOMPY_CENTRAL_API_URL:'https://central.test/api',SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture'},variantStatus});return r.json();};
  assert.equal((await health()).photo_variant_read_protocol,1);
  const response=await contentRead(new Request('https://home.test/content/health'),{siteId:site,db},'public','/content/health',(status,data)=>Response.json(data,{status}));assert.equal((await response.json()).photo_variant_read_protocol,1);
  await pg.query('update private.photo_media_state set ready=false where singleton');assert.equal((await health()).photo_variant_read_protocol,undefined);
  assert.equal((await sql('photo_representation_read',(await memberArgs(0)).selectors)).failure,'NOT_CONFIGURED');assert.equal((await check('public',[0])).failure,'NOT_CONFIGURED');
  await pg.query('update private.photo_media_state set ready=true where singleton');await pg.exec('drop function public.photo_representation_read(text,jsonb)');assert.equal((await health()).photo_variant_read_protocol,undefined);
 });
 console.log('PASS '+groups+' descriptor/SQL/compatibility groups');
}finally{await pg.close();}
