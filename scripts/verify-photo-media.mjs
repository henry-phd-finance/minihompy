import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {handlePhotoMedia} from '../supabase/functions/photo-media/handler.js';
import {digest,BUCKET,LEGACY_BUCKET,fail,adapters} from '../supabase/functions/photo-media/io.js';
import {migratePhotos} from '../setup/photo-media-migration.mjs';
const id=n=>'80000000-0000-4000-8000-'+String(n).padStart(12,'0'),owner=id(1),other=id(2);
const env={SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service-fixture',SUPABASE_ANON_KEY:'public-fixture',MINIHOMPY_SITE_ORIGIN:'https://home.test'};
const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
let groups=0;
const check=async(name,fn)=>{await fn();console.log('PASS '+(++groups)+': '+name);};
export function memoryStorage(){
 const objects=new Map(),buckets={[BUCKET]:{public:false},[LEGACY_BUCKET]:{public:true}};
 return {objects,buckets,
  async get(bucket,path){const b=objects.get(bucket+'/'+path);if(!b)fail('NOT_FOUND');return b.slice();},
  async put(bucket,path,bytes){const key=bucket+'/'+path;if(objects.has(key))fail('EXISTS');objects.set(key,bytes.slice());},
  async remove(bucket,paths){for(const p of paths)objects.delete(bucket+'/'+p);},
  async bucket(bucket){return {...buckets[bucket]};},async close(bucket){buckets[bucket].public=false;},
  async list(bucket,prefix='',offset=0){
   const keys=[...objects.keys()].filter(k=>k.startsWith(bucket+'/')).map(k=>k.slice(bucket.length+1));
   const rows=prefix?keys.filter(k=>k.startsWith(prefix+'/')).map(k=>({id:k,name:k.slice(prefix.length+1)})):[...new Set(keys.map(k=>k.split('/')[0]))].map(name=>({name,id:null}));
   return rows.sort((a,b)=>a.name.localeCompare(b.name)).slice(offset,offset+100);
  }
 };
}
const {pg}=await memberWritingDb(PGlite,{siteId:id(9),centralUrl:'https://central.test/api'});
const storage=memoryStorage();let valid=true,permission=true,afterGet=null;
const fetcher=async(url,opts)=>{
 assert.equal(opts.headers.Authorization,'Bearer a.b.c');
 if(url.endsWith('/auth/v1/user'))return Response.json(valid?{id:owner,is_anonymous:false}:{},{status:valid?200:401});
 if(url.endsWith('/is_minihompy_admin'))return new Response(String(permission));
 throw Error('Unexpected external request');
};
const rpc=async(action,args={})=>{
 await pg.exec('set role service_role');
 try{const v=(await pg.query('select public.photo_media($1,$2) v',[action,args])).rows[0].v;if(v.failure)fail(v.failure);return v;}
 finally{await pg.exec('reset role');}
};
const actor=async(uid,fn)=>{await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);await pg.exec('set role '+(uid?'authenticated':'anon'));try{return await fn();}finally{await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub','',false)");}};
const request=async(action,body,{auth=false,method='POST',headers={},options={}}={})=>{
 const multipart=body instanceof FormData;
 const req=new Request('https://edge.test/functions/v1/photo-media/'+action,{method,headers:{Origin:'https://home.test',...(multipart?{}:{'Content-Type':'application/json'}),...(auth?{Authorization:'Bearer a.b.c'}:{}),...headers},...(['GET','HEAD'].includes(method)?{}:{body:multipart?body:JSON.stringify(body)})});
 return handlePhotoMedia(req,{env,fetcher,rpc,storage:{...storage,get:async(...args)=>{const b=await storage.get(...args);if(afterGet){const f=afterGet;afterGet=null;await f();}return b;}},...options});
};
const path=n=>id(n)+'/'+id(77)+'.png';
const upload=(n,bytes=png,mime='image/png')=>{const f=new FormData();f.set('post_id',id(n));f.set('path',path(n));f.set('file',new Blob([bytes],{type:mime}),'photo.png');return f;};
const read=(n,auth=false)=>request('read',{post_id:id(n),path:path(n)},{auth});
let folder;
const save=n=>actor(owner,()=>pg.query("insert into public.photo_posts(id,folder_id,author_name,title,body) values($1,$2,'owner','photo',$3)",[id(n),folder,JSON.stringify([{type:'image',path:path(n)}])]));
try{
 await pg.query('insert into auth.users values($1),($2)',[owner,other]);await pg.query('insert into private.minihompy_admins values($1)',[owner]);
 folder=(await pg.query('select id from public.photo_folders limit 1')).rows[0].id;
 for(const file of ['202609240004_photo_media.sql','202609240005_photo_media_safeupdate.sql'])await pg.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await check('private registry/service RPC inaccessible; storage restrictive policies deny even permissive grant',async()=>{
  await pg.exec("create policy fixture_allow_all on storage.objects for all to anon,authenticated using(true) with check(true)");
  await pg.query("insert into storage.objects(bucket_id,name) values($1,$2)",[BUCKET,path(10)]);
  for(const uid of [null,owner,other])await actor(uid,async()=>{
   await assert.rejects(()=>pg.query("select * from private.photo_assets"),e=>e.code==='42501');
   await assert.rejects(()=>pg.query("select public.photo_media('inventory')"),e=>e.code==='42501');
   assert.equal((await pg.query("select * from storage.objects where bucket_id=$1",[BUCKET])).rows.length,0);
   await assert.rejects(()=>pg.query("insert into storage.objects(bucket_id,name) values($1,$2)",[BUCKET,path(11)]),e=>e.code==='42501');
  });
  await pg.query("insert into storage.objects(bucket_id,name) values($1,$2)",[LEGACY_BUCKET,path(90)]);
  await rpc('freeze');
  await actor(owner,async()=>{
   assert.equal((await pg.query("select * from storage.objects where bucket_id=$1",[LEGACY_BUCKET])).rows.length,0);
   await assert.rejects(()=>pg.query("insert into storage.objects(bucket_id,name) values($1,$2)",[LEGACY_BUCKET,path(91)]),e=>e.code==='42501');
  });
  await rpc('protect');await pg.exec('update private.photo_media_state set ready=true');
 });
 await check('upload, staged preview, duplicate response retry, immutable hash, invalid MIME/path/size',async()=>{
  assert.equal((await request('upload',upload(10))).status,401);
  assert.equal((await request('upload',upload(10),{auth:true})).status,200);
  assert.equal((await read(10)).status,404);assert.equal((await read(10,true)).status,200);
  assert.equal((await request('upload',upload(10),{auth:true})).status,200);
  const changed=png.slice();changed[changed.length-1]^=1;assert.equal((await request('upload',upload(10,changed),{auth:true})).status,409);
  assert.equal((await request('upload',upload(11,new Uint8Array([1,2,3])),{auth:true})).status,400);
  assert.equal((await request('upload',upload(11,png,'image/jpeg'),{auth:true})).status,400);
  assert.equal((await request('upload',upload(11,new Uint8Array(6291457)),{auth:true})).status,413);
  assert.equal((await request('read',{post_id:id(10),path:'../x'})).status,400);
 });
 await check('actual save attaches; public bytes no-store; private/absent/other path indistinguishable',async()=>{
  await save(10);const r=await read(10);assert.equal(r.status,200);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),png);
  assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('content-type'),'image/png');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(r.headers.get('vary'),'Origin, Authorization, X-Minihompy-Auth-Mode');assert.equal(r.headers.get('location'),null);
  assert.equal((await request('read',{post_id:id(11),path:path(10)})).status,400);
  await actor(owner,()=>pg.query("update public.photo_posts set visibility='private' where id=$1",[id(10)]));
  assert.deepEqual(await (await read(10)).json(),await (await read(99)).json());assert.equal((await read(10,true)).status,200);
  await assert.rejects(()=>actor(owner,()=>pg.query("update public.photo_posts set body=$1 where id=$2",[JSON.stringify([{type:'image',path:path(11)}]),id(10)])));
 });
 await check('explicit bad/expired/foreign/member auth never falls back; Origin/method/range/body guards',async()=>{
  valid=false;assert.equal((await read(10,true)).status,401);valid=true;
  permission=false;assert.equal((await read(10,true)).status,403);permission=true;
  assert.equal((await request('read',{post_id:id(10),path:path(10)},{headers:{Authorization:'Bearer opaque-member'}})).status,401);
  assert.equal((await request('read',{}, {headers:{Origin:'https://evil.test'}})).status,403);
  for(const method of ['GET','HEAD'])assert.equal((await request('read',{}, {method})).status,405);
  assert.equal((await request('read',{}, {headers:{Range:'bytes=0-10'}})).status,400);
  assert.equal((await request('read',{post_id:id(10),path:path(10),owner_id:owner})).status,400);
 });
 await check('read rechecks visibility, attachment and auth after Storage transfer',async()=>{
  await actor(owner,()=>pg.query("update public.photo_posts set visibility='public' where id=$1",[id(10)]));
  afterGet=()=>actor(owner,()=>pg.query("update public.photo_posts set visibility='private' where id=$1",[id(10)]));assert.equal((await read(10)).status,404);
  afterGet=async()=>{valid=false;};assert.equal((await read(10,true)).status,401);valid=true;
  afterGet=()=>actor(owner,()=>pg.query('delete from public.photo_posts where id=$1',[id(10)]));assert.equal((await read(10)).status,404); // Private request never downloads; clear below.
  afterGet=null;await actor(owner,()=>pg.query("update public.photo_posts set visibility='public' where id=$1",[id(10)]));
  afterGet=()=>actor(owner,()=>pg.query('delete from public.photo_posts where id=$1',[id(10)]));assert.equal((await read(10)).status,404);assert.equal((await read(10,true)).status,404);
 });
 await check('save vs cleanup: attached retained; deleting tombstone rejects save/upload; retry deletion after failure',async()=>{
  await request('upload',upload(20),{auth:true});await save(20);
  assert.equal((await request('cleanup',{paths:[path(20)]},{auth:true})).status,409);assert.ok(storage.objects.has(BUCKET+'/'+path(20)));
  await request('upload',upload(21),{auth:true});
  let broken=true;
  const override={...storage,remove:async(...a)=>{if(broken)throw Error('offline');return storage.remove(...a);}};
  assert.equal((await request('cleanup',{paths:[path(21)]},{auth:true,options:{storage:override}})).status,503);
  assert.equal((await read(21,true)).status,404);await assert.rejects(()=>save(21));
  broken=false;assert.equal((await request('cleanup',{paths:[path(21)]},{auth:true,options:{storage:override}})).status,200);
  assert.equal((await request('cleanup',{paths:[path(21)]},{auth:true})).status,200);
  assert.equal((await request('upload',upload(21),{auth:true})).status,409);
 });
 await check('upload success with response loss is recovered; incomplete reservation is not cleaned or attached',async()=>{
  const sha256=await digest(png);await rpc('reserve',{owner_id:owner,path:path(22),post_id:id(22),mime:'image/png',size:png.length,sha256});
  await assert.rejects(()=>rpc('cleanup_begin',{owner_id:owner,path:path(22)}),e=>e.code==='UPLOAD_PENDING');await assert.rejects(()=>save(22));
  const loss={...storage,put:async(...a)=>{await storage.put(...a);throw Error('response lost');}};
  assert.equal((await request('upload',upload(22),{auth:true,options:{storage:loss}})).status,200);await save(22);
 });
 await check('upload completion racing cleanup leaves no readable or attachable asset; retry cleanup removes orphan',async()=>{
  let committed=false;
  const race={...storage,put:async(...args)=>{
   // Another identical upload finishes and cleanup wins before this delayed upload reaches Storage.
   if(!committed){committed=true;await storage.put(...args);
    await rpc('complete',{owner_id:owner,path:path(23),sha256:await digest(png)});
    await rpc('cleanup_begin',{owner_id:owner,path:path(23)});await storage.remove(BUCKET,[path(23)]);
   }
   return storage.put(...args);
  }};
  assert.equal((await request('upload',upload(23),{auth:true,options:{storage:race}})).status,409);
  assert.equal((await read(23,true)).status,404);await assert.rejects(()=>save(23));
  assert.equal((await request('cleanup',{paths:[path(23)]},{auth:true})).status,200);assert.ok(!storage.objects.has(BUCKET+'/'+path(23)));
 });
 await check('loopback HTTP: actual service adapter, multipart upload, byte read and cleanup; no URL redirect',async()=>{
  const requests=[];
  let base;
  const rewrite=(url,options)=>fetch(base+new URL(url).pathname,options);
  const server=createServer(async(req,res)=>{
   try{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks),url=new URL(req.url,base);
    let response;
    if(url.pathname.startsWith('/functions/v1/photo-media')){
     response=await handlePhotoMedia(new Request(base+req.url,{method:req.method,headers:req.headers,body:body.length?body:undefined}),{env,fetcher:rewrite});
    }else if(url.pathname==='/auth/v1/user')response=Response.json({id:owner,is_anonymous:false});
    else if(url.pathname==='/rest/v1/rpc/is_minihompy_admin')response=new Response('true');
    else{
     requests.push(url.pathname);assert.equal(req.headers.authorization,'Bearer service-fixture');
     if(url.pathname==='/rest/v1/rpc/photo_media'){
      const q=JSON.parse(body);try{response=Response.json(await rpc(q.p_action,q.p_args));}catch(e){response=Response.json({failure:e.code});}
     }else{
      const parts=url.pathname.split('/'),authenticated=parts[4]==='authenticated',bucket=parts[authenticated?5:4],p=parts.slice(authenticated?6:5).join('/');
      if(req.method==='GET'&&authenticated)response=new Response(await storage.get(bucket,p));
      else if(req.method==='POST'){assert.equal(req.headers['x-upsert'],'false');await storage.put(bucket,p,new Uint8Array(body));response=Response.json({});}
      else if(req.method==='DELETE'){await storage.remove(bucket,JSON.parse(body).prefixes);response=Response.json({});}
      else throw Error('unexpected Storage HTTP request');
     }
    }
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
   }catch(e){res.writeHead(e.code==='NOT_FOUND'?404:500);res.end('fixture failure');}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
  const send=(action,body,auth=false)=>fetch(base+'/functions/v1/photo-media/'+action,{method:'POST',headers:{Origin:'https://home.test',...(auth?{Authorization:'Bearer a.b.c'}:{}),...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body)});
  try{
   assert.equal((await send('upload',upload(40),true)).status,200);await save(40);
   const r=await send('read',{post_id:id(40),path:path(40)});assert.equal(r.status,200);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),png);assert.equal(r.headers.get('location'),null);
   const large=new Uint8Array(6291456);large.set(png);
   assert.equal((await send('upload',upload(41,large),true)).status,200);
   const maxRead=await send('read',{post_id:id(41),path:path(41)},true);assert.equal(maxRead.status,200);assert.equal((await maxRead.arrayBuffer()).byteLength,6291456);
   assert.equal((await send('cleanup',{paths:[path(41)]},true)).status,200);
   await actor(owner,()=>pg.query('delete from public.photo_posts where id=$1',[id(40)]));
   assert.equal((await send('cleanup',{paths:[path(40)]},true)).status,200);
   assert.ok(requests.some(p=>p.startsWith('/storage/v1/object/authenticated/')));
   assert.ok(requests.every(p=>!p.includes('/sign/')&&!p.includes('/public/')&&!p.includes('/render/')));
  }finally{await new Promise(r=>server.close(r));}
 });
 await check('bounded slow bodies, public request quota and corrupted Storage fail closed',async()=>{
  const req=new Request('https://edge.test/photo-media/read',{method:'POST',headers:{'Content-Type':'application/json'},body:new ReadableStream({start(c){c.enqueue(new Uint8Array([123]));}}),duplex:'half'});
  assert.equal((await handlePhotoMedia(req,{env,fetcher,rpc,storage,bodyTimeout:10})).status,408);
  const broken={...storage,get:async()=>new Uint8Array([1,2,3])};assert.equal((await read(20)).status,200);
  assert.equal((await request('read',{post_id:id(20),path:path(20)},{options:{storage:broken}})).status,503);
  await pg.query("update private.photo_media_limits set amount=1200,window_at=clock_timestamp() where key='read:public'");
  assert.equal((await read(20)).status,429);await pg.exec('delete from private.photo_media_limits');
 });
 await check('frozen writes and legacy storage signing/writes blocked; migration dry-run/copy/recovery/closure',async()=>{
  // Fresh legacy installation, real migration SQL, separate from already-protected fixtures.
  const fresh=await memberWritingDb(PGlite,{siteId:id(90),centralUrl:'https://central.test/api'});
  const db=fresh.pg,s=memoryStorage(),backups=new Map();let journal;
  try{
   await db.query('insert into auth.users values($1)',[owner]);await db.query('insert into private.minihompy_admins values($1)',[owner]);
   await db.query("insert into public.photo_posts(id,folder_id,author_id,author_name,title,body) select $1,id,$2,'owner','legacy',$3 from public.photo_folders",[id(30),owner,JSON.stringify([{type:'image',path:path(30)}])]);
   await db.exec(await readFile(new URL('../supabase/migrations/202609240004_photo_media.sql',import.meta.url),'utf8'));
   const call=async(a,args={})=>{const v=(await db.query('select public.photo_media($1,$2) v',[a,args])).rows[0].v;if(v.failure)fail(v.failure);return v;};
   await s.put(LEGACY_BUCKET,path(30),png);await s.put(LEGACY_BUCKET,path(31),png);
   const opts=()=>({rpc:call,storage:s,journal,save:async j=>{journal=structuredClone(j);},backup:async(p,b)=>backups.set(p,b.slice()),loadBackup:async p=>backups.get(p)});
   s.objects.delete(LEGACY_BUCKET+'/'+path(30));
   await assert.rejects(()=>migratePhotos({...opts()}),e=>e.code==='MISSING_LEGACY_FILE');
   await s.put(LEGACY_BUCKET,path(30),png);
   assert.equal((await migratePhotos({...opts()})).files,2);assert.equal((await call('inventory')).mode,'legacy');
   await migratePhotos({...opts(),phase:'inventory',dryRun:false});
   await assert.rejects(()=>db.query("delete from public.photo_posts"),e=>e.message.includes('MEDIA_FROZEN'));
   const put=s.put;let failOnce=true;s.put=async(...a)=>{if(failOnce){failOnce=false;throw Error('interrupt');}return put(...a);};
   await assert.rejects(()=>migratePhotos({...opts(),phase:'copy',dryRun:false}));assert.ok(s.objects.has(LEGACY_BUCKET+'/'+path(30)));
   s.put=put;await migratePhotos({...opts(),phase:'copy',dryRun:false});await migratePhotos({...opts(),phase:'copy',dryRun:false});
   const good=backups.get(path(30));backups.set(path(30),new Uint8Array([0]));
   await assert.rejects(()=>migratePhotos({...opts(),phase:'protect',dryRun:false}),e=>e.code==='INTEGRITY_FAILURE');
   assert.ok(s.objects.has(LEGACY_BUCKET+'/'+path(30)));backups.set(path(30),good);
   await migratePhotos({...opts(),phase:'protect',dryRun:false});
   await assert.rejects(()=>db.query("delete from public.photo_posts"),e=>e.message.includes('MEDIA_NOT_READY'));
   const remove=s.remove;let once=true;s.remove=async(...a)=>{await remove(...a);if(once){once=false;throw Error('delete response lost');}};
   await assert.rejects(()=>migratePhotos({...opts(),phase:'close-legacy',dryRun:false}));assert.equal(s.buckets[LEGACY_BUCKET].public,false);
   s.remove=remove;await migratePhotos({...opts(),phase:'close-legacy',dryRun:false});await migratePhotos({...opts(),phase:'close-legacy',dryRun:false});
   assert.equal((await call('inventory')).ready,false);assert.equal(s.objects.size,2);assert.equal(backups.size,2);assert.equal(journal.phase,'closed');
   assert.equal((await call('read',{path:path(30),post_id:id(30)})).state,'attached');
  }finally{await db.close();}
 });
 console.log('PASS: '+groups+' photo media groups; SQL and handler, Storage/Auth fixtures, no deployment');
}finally{await pg.close();}
