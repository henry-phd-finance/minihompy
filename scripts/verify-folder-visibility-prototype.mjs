// Step 1 architecture experiment ONLY. Not deployed SQL, an Edge handler, or Supabase Storage.
// Existing migrations + authenticateOwner are real; Auth/Storage and the clock are test doubles.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHmac, randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {authenticateOwner} from '../supabase/functions/member-writing/handler.js';
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2]||'../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js')));
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const admin=id(1),visitor=id(2),post=id(10),hidden=id(11),draft=id(12),missing=id(13);
const file=id(20)+'.png', path=p=>`${p}/${file}`;
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const db=await memberWritingDb(PGlite,{siteId:id(3),centralUrl:'https://central.test/api',visibility:false});
const pg=db.pg, results=[];
let clock=0,afterRead=null,server,base;
const tokens=new Map([
 ['owner.A.token',{user:admin,project:'a',expiry:1000}],
 ['visitor.A.token',{user:visitor,project:'a',expiry:1000}],
 ['owner.B.token',{user:admin,project:'b',expiry:1000}],
 ['expired.A.token',{user:admin,project:'a',expiry:0}],
]);
async function check(name,fn){await fn();results.push(name);console.log('PASS: '+name);}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
async function authFetcher(url,opts){
 const token=tokens.get(opts.headers.Authorization?.replace('Bearer ',''));
 if(!token||token.project!=='a'||token.expiry<=clock)return json({},401);
 if(url.endsWith('/auth/v1/user'))return json({id:token.user,is_anonymous:false});
 if(url.endsWith('/rest/v1/rpc/is_minihompy_admin'))return json(token.user===admin);
 throw Error('Unexpected authentication URL');
}
async function owner(token){
 if(!token)return false;
 try{await authenticateOwner(new Request('https://media.test/read',{headers:{Authorization:`Bearer ${token}`}}),{
  fetcher:authFetcher,projectUrl:'https://a.supabase.co',publicKey:'fixture-public-key'});return true;
 }catch{return false;}
}
async function permitted(postId,objectPath,isOwner){
 const result=await pg.query(`select 1 from private.photo_experiment_objects o
 where o.path=$2 and o.post_id=$1 and o.state<>'deleting' and
 ((o.state='staged' and $3 and o.owner_id=$4) or (o.state='attached' and exists (
 select 1 from public.photo_posts p where p.id=$1 and (p.visibility='public' or $3)
 and p.body @> jsonb_build_array(jsonb_build_object('type','image','path',$2::text)))))`,[postId,objectPath,isOwner,admin]);
 return result.rows.length===1;
}
async function setVisibility(postId,value){await pg.query('update public.photo_posts set visibility=$2 where id=$1',[postId,value]);}
async function call(postId=post,objectPath=path(post),token){
 return fetch(base+'/read',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({post_id:postId,path:objectPath})});
}
async function as(uid,fn){
 await pg.exec(`set role ${uid?'authenticated':'anon'}`);
 await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);
 try{return await fn();}finally{await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub','',false)");}
}
try{
 await pg.query('insert into auth.users values($1),($2)',[admin,visitor]);
 await pg.query('insert into private.minihompy_admins values($1)',[admin]);
 // Disposable candidate schema. Step 4/6 must implement and test production versions independently.
 await pg.exec(`alter table public.photo_posts add column visibility text not null default 'public' check(visibility in ('public','private'));
 drop policy photo_posts_read on public.photo_posts;
 create policy photo_posts_read on public.photo_posts for select to anon,authenticated using(visibility='public' or public.is_minihompy_admin());
 create table private.photo_experiment_objects(path text primary key,post_id uuid,owner_id uuid,state text check(state in ('staged','attached','deleting')));
 revoke all on private.photo_experiment_objects from public,anon,authenticated;`);
 const folder=(await pg.query("select id from public.photo_folders where kind='folder' limit 1")).rows[0].id;
 for(const [p,visibility] of [[post,'public'],[hidden,'private']]){
  await pg.query("insert into public.photo_posts(id,folder_id,author_id,author_name,title,body,visibility) values($1,$2,$3,'fixture','fixture',$4,$5)",[p,folder,admin,JSON.stringify([{type:'image',path:path(p)}]),visibility]);
  await pg.query("insert into private.photo_experiment_objects values($1,$2,$3,'attached')",[path(p),p,admin]);
 }
 await pg.query("insert into private.photo_experiment_objects values($1,$2,$3,'staged')",[path(draft),draft,admin]);
 const rawFiles=new Map([post,hidden,draft].map(p=>[path(p),bytes]));
 server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization, Origin');
  res.setHeader('X-Content-Type-Options','nosniff');
  const reject=()=>{res.writeHead(404,{'Content-Type':'application/json'});res.end('{"error":"NOT_FOUND"}');};
  try{
   if(req.method!=='POST'||req.url!=='/read')return reject();
   const chunks=[];for await(const c of req)chunks.push(c);
   const args=JSON.parse(Buffer.concat(chunks)),objectPath=args.path,postId=args.post_id;
   if(typeof postId!=='string'||typeof objectPath!=='string'||objectPath!==`${postId}/${file}`)return reject();
   const token=req.headers.authorization?.replace('Bearer ','');
   const isOwner=await owner(token);
   if(token&&!isOwner)return reject();
   if(!await permitted(postId,objectPath,isOwner))return reject();
   const content=rawFiles.get(objectPath);if(!content)return reject();
   if(afterRead){const hook=afterRead;afterRead=null;await hook();}
   // Bound the race: validate again after the Storage download, before emitting any bytes.
   if((token&&!await owner(token))||!await permitted(postId,objectPath,isOwner))return reject();
   res.writeHead(200,{'Content-Type':'image/png'});res.end(content);
  }catch(e){res.writeHead(500);res.end('fixture failure');console.error(e);}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
 await check('Real SQL: anonymous and non-admin see public only; local admin sees both',async()=>{
  for(const [uid,count]of [[null,1],[visitor,1],[admin,2]])assert.equal((await as(uid,()=>pg.query('select id from public.photo_posts'))).rows.length,count);
 });
 await check('Anonymous public image returns exact bytes with no-store, no redirect or signed URL',async()=>{
  const r=await call();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('location'),null);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);
 });
 await check('Private image: owner only; central ID, visitor and other-project owner rejected',async()=>{
  assert.equal((await call(hidden,path(hidden),'owner.A.token')).status,200);
  for(const token of [undefined,'visitor.A.token','owner.B.token',id(1),'central-member-proof'])assert.equal((await call(hidden,path(hidden),token)).status,404);
 });
 await check('Private, absent, path substitution and traversal have identical external error',async()=>{
  for(const [p,f]of [[hidden,path(hidden)],[missing,path(missing)],[post,path(hidden)],[post,'../'+path(post)]]){
   const r=await call(p,f);assert.equal(r.status,404);assert.equal(await r.text(),'{"error":"NOT_FOUND"}');
  }
 });
 await check('Expired and revoked administrator credentials cannot read private image',async()=>{
  assert.equal((await call(hidden,path(hidden),'expired.A.token')).status,404);
  const t=tokens.get('owner.A.token');tokens.delete('owner.A.token');
  assert.equal((await call(hidden,path(hidden),'owner.A.token')).status,404);tokens.set('owner.A.token',t);
 });
 await check('Unattached upload: owner preview only; direct Storage paths and listing unavailable',async()=>{
  assert.equal((await call(draft,path(draft))).status,404);
  assert.equal((await call(draft,path(draft),'owner.A.token')).status,200);
  for(const p of ['/storage/v1/object/public/new/'+path(hidden),'/storage/v1/object/sign/new/'+path(hidden),'/list'])assert.equal((await fetch(base+p)).status,404);
 });
 await check('Visibility changes stop new anonymous reads; owner retains access',async()=>{
  await setVisibility(post,'private');assert.equal((await call()).status,404);
  assert.equal((await call(post,path(post),'owner.A.token')).status,200);
  await setVisibility(post,'public');assert.equal((await call()).status,200);
 });
 await check('Visibility change during Storage download prevents response bytes',async()=>{
  afterRead=()=>setVisibility(post,'private');assert.equal((await call()).status,404);await setVisibility(post,'public');
 });
 await check('Auth-provider rejection during Storage download prevents private response bytes (mock revocation)',async()=>{
  const t=tokens.get('owner.A.token');afterRead=async()=>{tokens.delete('owner.A.token');};
  assert.equal((await call(hidden,path(hidden),'owner.A.token')).status,404);tokens.set('owner.A.token',t);
 });
 await check('Deleted or detached file cannot be fetched, even when its bytes remain stored',async()=>{
  await pg.query("update private.photo_experiment_objects set state='deleting' where post_id=$1",[post]);assert.equal((await call()).status,404);
  await pg.query("update private.photo_experiment_objects set state='attached' where post_id=$1",[post]);
  await pg.query('delete from public.photo_posts where id=$1',[post]);assert.equal((await call()).status,404);
 });
 await check('Rejected signed-URL alternative: valid bearer outlives policy change; expiry cannot recall cached bytes',async()=>{
  // Model of bearer URL semantics, NOT a test of Supabase signing or its CDN.
  const key=randomBytes(32),claims=JSON.stringify({path:path(hidden),exp:60});
  const sign=s=>createHmac('sha256',key).update(s).digest('hex'),signed={claims,signature:sign(claims)};
  const origin=()=>{assert.equal(signed.signature,sign(signed.claims));if(clock>=JSON.parse(signed.claims).exp)throw Error('expired');return bytes;};
  clock=0;const cache=origin();clock=59;assert.deepEqual(origin(),bytes);
  clock=60;assert.throws(origin,/expired/);assert.deepEqual(cache,bytes);clock=0;
 });
 const report={checkedAt:new Date().toISOString(),passed:results.length,checks:results,
  scope:'Existing personal migrations + authenticateOwner, disposable candidate photo RLS and real loopback HTTP bytes. Auth/Storage/clock are doubles. No production implementation or hosted Storage/CDN/browser validation.',
  decision:'Private bucket; per-request authenticated binary proxy, no signed/public Storage URLs to browsers.'};
 if(process.env.MINIHOMPY_PROTOTYPE_REPORT)await writeFile(process.env.MINIHOMPY_PROTOTYPE_REPORT,JSON.stringify(report,null,2)+'\n');
 console.log(`PASS: ${results.length} architecture checks`);
}finally{if(server)await new Promise(r=>server.close(r));await pg.close();}
