import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
const {PGlite}=await import(pathToFileURL(resolve('../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js')));
const {pg}=await memberWritingDb(PGlite,{siteId:'60000000-0000-4000-8000-000000000099',centralUrl:'https://central.test/api',visibility:false});
const id=n=>`60000000-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(1),local=id(2),stranger=id(3);
const tables={board:'board_posts',photos:'photo_posts',diary:'diary_entries'},posts={};let next=100,groups=0;
async function as(uid,fn,role=uid?'authenticated':'anon'){await pg.exec(`set role ${role}`);await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);try{return await fn();}finally{await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub','',false)");}}
async function check(name,fn){await fn();console.log(`PASS ${++groups}: ${name}`);}
const row=async kind=>(await pg.query('select * from public.'+tables[kind]+' where id=$1',[posts[kind]])).rows[0];
const version=r=>r.revision===undefined?r.updated_at:String(r.revision);
const set=async(kind,visibility,uid=owner,expected,requestId=id(next++))=>as(uid,async()=>(await pg.query('select public.set_content_visibility($1,$2,$3,$4,$5) result',[kind,posts[kind],visibility,expected??version(await row(kind)),requestId])).rows[0].result);
try{
 await pg.query('insert into auth.users values($1),($2),($3)',[owner,local,stranger]);await pg.query('insert into private.minihompy_admins values($1)',[owner]);
 for(const kind of Object.keys(tables)){
  const key=id(next++);posts[kind]=key;
  if(kind==='board')await pg.query("insert into public.board_posts(id,folder_id,author_id,author_name,title,body) select $1,id,$2,'former owner','sentinel','body' from public.board_folders",[key,local]);
  if(kind==='photos')await pg.query("insert into public.photo_posts(id,folder_id,author_id,author_name,title,body) select $1,id,$2,'former owner','sentinel',$3 from public.photo_folders",[key,local,JSON.stringify([{type:'image',path:key+'/'+id(66)+'.jpg'}])]);
  if(kind==='diary')await pg.query("insert into public.diary_entries(id,folder_id,author_id,author_name,entry_date,entry_time,body) select $1,id,$2,'former owner','2026-09-24','12:30','body' from public.diary_folders",[key,local]);
 }
 const before={};for(const k of Object.keys(tables))before[k]=await row(k);
 await pg.exec('alter default privileges in schema private grant all on tables to anon,authenticated,service_role');
 await pg.exec(await readFile(new URL('../supabase/migrations/202609240002_content_visibility.sql',import.meta.url),'utf8'));
 await check('Upgrade preserves all existing columns; visibility defaults public',async()=>{
  for(const kind of Object.keys(tables)){const r=await row(kind);assert.equal(r.visibility,'public');delete r.visibility;assert.deepEqual(r,before[kind]);}
 });
 await check('Unprepared photo private insert/update/RPC rejected; readiness and receipts cannot be forged',async()=>{
  assert.equal((await set('photos','private')).failure,'MEDIA_NOT_READY');
  await assert.rejects(pg.query("update public.photo_posts set visibility='private'"),/MEDIA_NOT_READY/);
  const k=id(next++);await assert.rejects(as(owner,()=>pg.query("insert into public.photo_posts(id,folder_id,author_name,title,body,visibility) select $1,id,'owner','x',$2,'private' from public.photo_folders",[k,JSON.stringify([{type:'image',path:k+'/'+id(66)+'.jpg'}])])),/MEDIA_NOT_READY/);
  for(const role of ['anon','authenticated','service_role'])for(const t of ['photo_media_state','content_visibility_requests'])await assert.rejects(as(owner,()=>pg.query('select * from private.'+t),role),{code:'42501'});
  assert.equal((await pg.query('select count(*)::int n from private.content_visibility_requests')).rows[0].n,0);
 });
 for(const [kind,table]of Object.entries(tables))await check(kind+': role matrix, counts, local comment ownership and stale/replayed visibility changes',async()=>{
  if(kind==='photos')await pg.exec('update private.photo_media_state set ready=true');
  const parent=posts[kind],col={board:'board_post_id',photos:'photo_post_id',diary:'diary_entry_id'}[kind],cid=id(next++);
  await pg.exec("update private.comment_write_limits set last_write=now()-interval '1 minute'");
  await as(local,()=>pg.query(`insert into public.post_comments(id,${col},author_name,body) values($1,$2,'local','keep')`,[cid,parent]));
  const old=await row(kind),request=id(next++),hidden=await set(kind,'private',owner,version(old),request);assert.ok(!hidden.failure,JSON.stringify(hidden));
  assert.equal((await set(kind,'private',owner,version(old),request)).replayed,true);
  assert.equal((await set(kind,'public',owner,version(old),request)).failure,'REQUEST_CONFLICT');
  assert.equal((await set(kind,'public',owner,version(old))).failure,'REVISION_CONFLICT');
  for(const who of [null,local,stranger,owner]){
   const can=who===owner?1:0;
   assert.equal((await as(who,()=>pg.query(`select count(*)::int n from public.${table}`))).rows[0].n,can);
   assert.equal((await as(who,()=>pg.query(`select * from public.${table} where id=$1`,[parent]))).rows.length,can);
   assert.equal((await as(who,()=>pg.query('select count(*)::int n from public.post_comments where id=$1',[cid]))).rows[0].n,can);
  }
  assert.equal((await set(kind,'public',stranger,'1')).failure,'FORBIDDEN');
  assert.equal((await as(local,()=>pg.query("update public.post_comments set body='forbidden' where id=$1 returning id",[cid]))).rows.length,0);
  assert.equal((await as(local,()=>pg.query('delete from public.post_comments where id=$1 returning id',[cid]))).rows.length,0);
  await assert.rejects(as(local,()=>pg.query(`insert into public.post_comments(id,${col},author_name,body) values($1,$2,'local','blocked')`,[id(next++),parent])),{code:'42501'});
  // No WHERE or RETURNING must not bypass private-row UPDATE/DELETE restrictions.
  await as(local,()=>pg.query(`update public.${table} set body=$1`,[kind==='photos'?JSON.stringify(old.body):'forbidden']));
  await as(local,()=>pg.query(`delete from public.${table}`));assert.ok(await row(kind));assert.deepEqual((await row(kind)).body,old.body);
  const latest=await row(kind);assert.deepEqual(latest.author_id,old.author_id);assert.deepEqual(latest.created_at,old.created_at);
  assert.ok((await set(kind,'public')).visibility==='public');
  await as(local,()=>pg.query("update public.post_comments set body='restored' where id=$1",[cid]));
  assert.equal((await pg.query('select body from public.post_comments where id=$1',[cid])).rows[0].body,'restored');
  await set(kind,'private');
  assert.equal((await as(owner,()=>pg.query("update public.post_comments set body='not my comment' where id=$1 returning id",[cid]))).rows.length,0);
  assert.equal((await as(owner,()=>pg.query('delete from public.post_comments where id=$1 returning id',[cid]))).rows.length,1);
  await set(kind,'public');
  if(kind==='photos')await pg.exec('update private.photo_media_state set ready=false');
 });
 await check('Non-admin cannot change own public board visibility, administrator changes metadata without body ownership',async()=>{
  await assert.rejects(as(local,()=>pg.query("update public.board_posts set visibility='private'")),{code:'42501'});
  assert.equal((await set('board','private')).visibility,'private');
  assert.equal((await as(owner,()=>pg.query("update public.board_posts set body='not my body' returning id"))).rows.length,0);
  assert.equal((await row('board')).body,'body');
  await set('board','public');
 });
 await check('Malformed versions, invalid scopes and anonymous function access fail closed',async()=>{
  assert.equal((await set('board','friends')).failure,'BAD_REQUEST');
  assert.equal((await set('diary','private',owner,'not-a-version')).failure,'BAD_REQUEST');
  await assert.rejects(as(null,()=>pg.query("select public.set_content_visibility('board',$1,'private','1',$2)",[posts.board,id(next++)])),{code:'42501'});
 });
 await check('Existing local guestbook privacy, author/admin split and one-way hiding are preserved',async()=>{
  const p=id(next++),cid=id(next++);
  await pg.exec("update private.comment_write_limits set last_write=now()-interval '1 minute'");
  await as(local,()=>pg.query("insert into public.guestbook_posts(id,author_name,body,visibility) values($1,'local','secret','private')",[p]));
  await as(local,()=>pg.query("insert into public.post_comments(id,guestbook_post_id,author_name,body) values($1,$2,'local','secret comment')",[cid,p]));
  for(const who of [null,stranger,local,owner])assert.equal((await as(who,()=>pg.query('select * from public.post_comments where id=$1',[cid]))).rows.length,[local,owner].includes(who)?1:0);
  await assert.rejects(as(local,()=>pg.query("update public.guestbook_posts set visibility='public' where id=$1",[p])));
  await assert.rejects(as(owner,()=>pg.query("update public.guestbook_posts set body='not my body' where id=$1",[p])));
  await as(local,()=>pg.query("update public.guestbook_posts set body='own body' where id=$1",[p]));
  assert.equal((await as(owner,()=>pg.query('delete from public.post_comments where id=$1 returning id',[cid]))).rows.length,1);
 });
 await check('Existing folder RPC moves private posts without changing privacy or historical author',async()=>{
  await set('board','private');
  const call=(action,args)=>as(owner,async()=>(await pg.query('select public.manage_content_folders($1,$2) r',[action,args])).rows[0].r);
  const snap=()=>call('snapshot',{menu:'board'});let state=await snap();const source=(await row('board')).folder_id,target=id(next++);
  assert.equal(state.items.find(x=>x.id===source).count,1);
  assert.ok(!(await call('create',{menu:'board',request_id:id(next++),expected_revision:state.menu_revision,id:target,kind:'folder',label:'private destination'})).failure);
  state=await snap();assert.equal((await call('delete',{menu:'board',request_id:id(next++),expected_revision:state.menu_revision,id:source,destination_id:target})).moved_count,1);
  const moved=await row('board');assert.equal(moved.folder_id,target);assert.equal(moved.visibility,'private');assert.equal(moved.author_id,local);
  await set('board','public');
 });
 await check('Visibility-only changes do not change folder structure revision; revoked admin cannot replay',async()=>{
  const revision=(await pg.query("select revision from private.content_folder_state where menu='board'")).rows[0].revision;
  const old=await row('board'),request=id(next++);await set('board','private',owner,version(old),request);
  assert.equal((await pg.query("select revision from private.content_folder_state where menu='board'")).rows[0].revision,revision);
  await pg.query('delete from private.minihompy_admins where user_id=$1',[owner]);
  assert.equal((await set('board','private',owner,version(old),request)).failure,'FORBIDDEN');
 });
 console.log(`PASS: ${groups} visibility SQL groups; no hosted changes.`);
}finally{await pg.close();}
