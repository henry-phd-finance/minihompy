// Actual personal migrations and folder RPC/RLS in an isolated PGlite database.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2]||'../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js')));
const {pg}=await memberWritingDb(PGlite,{siteId:'20000000-0000-4000-8000-000000000001',centralUrl:'https://central.test/api',folders:false});
const id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const admin=id(2),other=id(3),removedAdmin=id(4);let sequence=100,passed=0;
const tables={board:['board_folders','board_posts'],photos:['photo_folders','photo_posts'],diary:['diary_folders','diary_entries']};
async function check(name,fn){await fn();passed++;console.log('PASS: '+name);}
async function as(uid,fn,role=uid?'authenticated':'anon'){
 await pg.exec(`set role ${role}`);await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);
 try{return await fn();}finally{await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub','',false)");}
}
const rpc=(action,args,uid=admin)=>as(uid,()=>pg.query('select public.manage_content_folders($1,$2) result',[action,args])).then(r=>r.rows[0].result);
const snapshot=menu=>rpc('snapshot',{menu});
async function mutation(menu,action,extra={}){
 const args={menu,request_id:id(sequence++),expected_revision:(await snapshot(menu)).menu_revision,...extra};
 return {args,result:await rpc(action,args)};
}
async function post(menu,folder,author=admin){
 const key=id(sequence++),table=tables[menu][1];
 const fields=menu==='board'?{title:'preserve',body:'body'}:menu==='photos'?{title:'preserve',body:JSON.stringify([{type:'image',path:`${key}/${id(99)}.png`}])}:{entry_date:'2026-09-24',entry_time:'12:30',weather:'맑음',body:'body'};
 const columns=['id','folder_id','author_id','author_name',...Object.keys(fields)];
 // Fixture setup permits a historical author who is no longer an administrator.
 await pg.query(`insert into public.${table}(${columns}) values(${columns.map((_,i)=>'$'+(i+1))})`,[key,folder,author,'fixture',...Object.values(fields)]);
 return (await pg.query(`select * from public.${table} where id=$1`,[key])).rows[0];
}
try{
 await pg.query('insert into auth.users values($1),($2),($3)',[admin,other,removedAdmin]);
 await pg.query('insert into private.minihompy_admins values($1)',[admin]);
 const before={};for(const [menu,[f,p]]of Object.entries(tables)){before[menu]={folders:(await pg.query(`select * from public.${f} order by id`)).rows,posts:[]};before[menu].posts.push(await post(menu,before[menu].folders[0].id));}
 // Simulate permissive hosted defaults for new private objects; explicit REVOKE must win.
 await pg.exec('alter default privileges in schema private grant all on tables to anon,authenticated,service_role');
 await pg.exec(await readFile(new URL('../supabase/migrations/202609240001_content_folders.sql',import.meta.url),'utf8'));
 await check('Upgrade preserves every existing folder and post value',async()=>{
  for(const [menu,[f,p]]of Object.entries(tables)){
   assert.deepEqual((await pg.query(`select * from public.${f} order by id`)).rows,before[menu].folders);
   assert.deepEqual((await pg.query(`select * from public.${p} order by id`)).rows,before[menu].posts);
  }
 });
 await check('Only real local administrator can obtain snapshot or mutate; anonymous EXECUTE denied',async()=>{
  assert.equal((await rpc('snapshot',{menu:'board'},other)).failure,'FORBIDDEN');
  await assert.rejects(rpc('snapshot',{menu:'board'},null),{code:'42501'});
  assert.equal((await as(null,()=>pg.query("select has_function_privilege('anon','public.manage_content_folders(text,jsonb)','execute') ok"))).rows[0].ok,false);
 });
 await check('Column grants cannot bypass folder RPC; private receipts hidden even from service role',async()=>{
  for(const [menu,[f]]of Object.entries(tables)){
   await assert.rejects(as(admin,()=>pg.query(`insert into public.${f}(label,sort_order) values('bypass',0)`)),{code:'42501'});
   await assert.rejects(as(admin,()=>pg.query(`update public.${f} set label='bypass'`)),{code:'42501'});
   await assert.rejects(as(admin,()=>pg.query(`delete from public.${f}`)),{code:'42501'});
   assert.ok((await as(null,()=>pg.query(`select * from public.${f}`))).rows.length);
  }
  for(const role of ['anon','authenticated','service_role'])for(const t of ['content_folder_state','content_folder_requests'])await assert.rejects(as(admin,()=>pg.query('select * from private.'+t),role),{code:'42501'});
 });
 for(const [menu,[f,p]]of Object.entries(tables))await check(`${menu}: create/rename/reorder/delete, retry, stale revision and all-content preservation`,async()=>{
  const first=(await snapshot(menu)).items[0].id,newId=id(sequence++);
  const created=await mutation(menu,'create',{id:newId,kind:'folder',label:'  새 폴더  '});assert.ok(!created.result.failure,JSON.stringify(created));
  assert.equal((await snapshot(menu)).items.at(-1).label,'새 폴더');
  assert.deepEqual(await rpc('create',created.args),created.result);
  assert.equal((await rpc('create',{...created.args,label:'different'})).failure,'REQUEST_CONFLICT');
  const stale=(await snapshot(menu)).menu_revision;
  if(menu!=='diary')await mutation(menu,'rename',{id:newId,label:'with description',description:'preserve description'});
  const renamed=await mutation(menu,'rename',{id:newId,label:'이름 변경'});assert.ok(!renamed.result.failure);
  if(menu!=='diary')assert.equal((await snapshot(menu)).items.find(x=>x.id===newId).description,'preserve description');
  assert.equal((await rpc('delete',{menu,id:newId,request_id:id(sequence++),expected_revision:stale})).failure,'CONFLICT');
  const arranged=await mutation(menu,'reorder',{ids:[newId,first]});assert.ok(!arranged.result.failure);
  assert.deepEqual((await snapshot(menu)).items.map(x=>[x.id,x.sort_order]),[[newId,0],[first,1]]);
  assert.equal((await mutation(menu,'reorder',{ids:[first,first]})).result.failure,'BAD_REQUEST');
  assert.equal((await mutation(menu,'reorder',{ids:[first]})).result.failure,'BAD_REQUEST');
  assert.equal((await mutation(menu,'reorder',{ids:[first,id(999)]})).result.failure,'BAD_REQUEST');
  // Future-column preservation only: visibility permissions themselves belong to Step 4.
  await pg.exec(`alter table public.${p} add column visibility text not null default 'public'`);
  const historical=await post(menu,first,removedAdmin);
  await pg.query(`update public.${p} set visibility='private' where id=$1`,[historical.id]);
  const comment=id(sequence++),col={board:'board_post_id',photos:'photo_post_id',diary:'diary_entry_id'}[menu];
  await as(admin,()=>pg.query(`insert into public.post_comments(id,${col},author_name,body) values($1,$2,'owner','keep comment')`,[comment,historical.id]));
  const oldComment=(await pg.query('select * from public.post_comments where id=$1',[comment])).rows[0];
  const beforeMove=(await pg.query(`select * from public.${p} where folder_id=$1 order by id`,[first])).rows;
  assert.equal((await mutation(menu,'delete',{id:first})).result.failure,'DESTINATION_REQUIRED');
  assert.equal((await mutation(menu,'delete',{id:first,destination_id:first})).result.failure,'BAD_REQUEST');
  assert.equal((await mutation(menu,'delete',{id:first,destination_id:id(999)})).result.failure,'BAD_REQUEST');
  const deletion=await mutation(menu,'delete',{id:first,destination_id:newId});assert.equal(deletion.result.moved_count,beforeMove.length);
  assert.deepEqual(await rpc('delete',deletion.args),deletion.result);
  for(const old of beforeMove){
   const row=(await pg.query(`select * from public.${p} where id=$1`,[old.id])).rows[0];
   assert.equal(row.folder_id,newId);assert.ok(row.updated_at>old.updated_at);
   if(menu!=='board')assert.equal(row.revision,old.revision+1);
   for(const k of Object.keys(old).filter(x=>!['folder_id','revision','updated_at'].includes(x)))assert.deepEqual(row[k],old[k],k);
  }
  assert.deepEqual((await pg.query('select * from public.post_comments where id=$1',[comment])).rows[0],oldComment);
  assert.equal((await mutation(menu,'delete',{id:newId})).result.failure,'LAST_FOLDER');
  const snap=await snapshot(menu);assert.equal(snap.items[0].count,beforeMove.length);
  assert.equal((await rpc('snapshot',{menu},other)).failure,'FORBIDDEN');
 });
 await check('Dividers preserve existing semantics, cannot contain posts or replace last real folder',async()=>{
  for(const menu of ['board','photos']){
   const divider=id(sequence++);assert.ok(!(await mutation(menu,'create',{id:divider,kind:'divider',label:''})).result.failure);
   const first=(await snapshot(menu)).items.find(x=>x.kind==='folder').id;
   assert.equal((await mutation(menu,'delete',{id:first,destination_id:divider})).result.failure,'LAST_FOLDER');
   const extra=id(sequence++);assert.ok(!(await mutation(menu,'create',{id:extra,kind:'folder',label:'extra'})).result.failure);
   assert.equal((await mutation(menu,'delete',{id:first,destination_id:divider})).result.failure,'BAD_REQUEST');
   await mutation(menu,'delete',{id:extra});
   const r=await mutation(menu,'rename',{id:divider,label:'separator',description:'note'});
   assert.equal(r.result.failure,menu==='board'?'BAD_REQUEST':undefined);
   assert.ok(!(await mutation(menu,'delete',{id:divider})).result.failure);
  }
  assert.equal((await mutation('diary','create',{id:id(sequence++),kind:'divider',label:''})).result.failure,'BAD_REQUEST');
 });
 await check('Direct post save moves valid folders, increments structural revision, stale target fails FK',async()=>{
  const menu='board',first=(await snapshot(menu)).items[0].id,target=id(sequence++);
  await mutation(menu,'create',{id:target,kind:'folder',label:'target'});
  const former=await post(menu,first,removedAdmin);
  await assert.rejects(as(removedAdmin,()=>pg.query('update public.board_posts set folder_id=$2 where id=$1',[former.id,target])),{code:'42501'});
  assert.equal((await as(removedAdmin,()=>pg.query("update public.board_posts set body='legacy body right' where id=$1 returning id",[former.id]))).rowCount,1);
  const row=await post(menu,first),revision=(await snapshot(menu)).menu_revision;
  await as(admin,()=>pg.query('update public.board_posts set folder_id=$2 where id=$1',[row.id,target]));
  assert.ok((await snapshot(menu)).menu_revision>revision);
  const nextRevision=(await snapshot(menu)).menu_revision;
  await as(admin,()=>pg.query("update public.board_posts set body='new body' where id=$1",[row.id]));
  assert.equal((await snapshot(menu)).menu_revision,nextRevision);
  await mutation(menu,'delete',{id:target,destination_id:first});
  await assert.rejects(as(admin,()=>pg.query('update public.board_posts set folder_id=$2 where id=$1',[row.id,target])),{code:'23503'});
 });
 await check('Strict API validation and failures leave folders, revisions and receipts unchanged',async()=>{
  const rev=await snapshot('board');
  for(const args of [null,[],{}, {menu:'board;drop table'}, {menu:'board',unknown:1}])assert.equal((await rpc('snapshot',args)).failure,'BAD_REQUEST');
  for(const extra of [{id:'bad'},{label:''},{label:4},{label:'x'.repeat(41)},{description:'x'.repeat(301)},{expected_revision:'1'},{expected_revision:-1},{expected_revision:1.5},{kind:'other'},{unexpected:true}]){
   const r=await mutation('board','create',{id:id(sequence++),kind:'folder',label:'valid',...extra});assert.equal(r.result.failure,'BAD_REQUEST',JSON.stringify(extra));
  }
  assert.deepEqual(await snapshot('board'),rev);
 });
 await check('Mid-move failure rolls back every post, folder, revision and retry receipt',async()=>{
  const first=(await snapshot('board')).items[0].id,target=id(sequence++);await mutation('board','create',{id:target,kind:'folder',label:'rollback'});
  const failRow=await post('board',first);const beforeRows=(await pg.query('select * from public.board_posts order by id')).rows,beforeSnap=await snapshot('board');
  await pg.exec(`create function private.fixture_move_fail() returns trigger language plpgsql as $$ begin if new.id='${failRow.id}' and new.folder_id='${target}' then raise exception 'fixture failure';end if;return new;end;$$;create trigger z_fixture_fail before update on public.board_posts for each row execute function private.fixture_move_fail();`);
  const args={menu:'board',id:first,destination_id:target,expected_revision:beforeSnap.menu_revision,request_id:id(sequence++)};
  await assert.rejects(rpc('delete',args),/fixture failure/);
  assert.deepEqual((await pg.query('select * from public.board_posts order by id')).rows,beforeRows);assert.deepEqual(await snapshot('board'),beforeSnap);
  assert.equal((await pg.query('select * from private.content_folder_requests where request_id=$1',[args.request_id])).rows.length,0);
  await pg.exec('drop trigger z_fixture_fail on public.board_posts;drop function private.fixture_move_fail()');
  assert.ok(!(await rpc('delete',args)).failure);
 });
 await check('Zero-folder legacy state is recoverable; removed admin cannot replay successful receipts',async()=>{
  await pg.exec('delete from public.diary_entries;delete from public.diary_folders');
  assert.equal((await snapshot('diary')).items.length,0);
  const made=await mutation('diary','create',{id:id(sequence++),kind:'folder',label:'first'});assert.ok(!made.result.failure);
  await pg.query('delete from private.minihompy_admins where user_id=$1',[admin]);
  assert.equal((await rpc('create',made.args)).failure,'FORBIDDEN');
 });
 console.log(`PASS: ${passed} folder SQL groups; isolated database only.`);
}finally{await pg.close();}
