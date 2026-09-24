// Actual SQL/RLS. Fixture-only media readiness does not enable production photos.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
const id=n=>'50000000-0000-4000-8000-'+String(n).padStart(12,'0');
const {pg}=await memberWritingDb(PGlite,{siteId:id(99),centralUrl:'https://central.test/api',visibilitySummary:false});
const kinds={board:['board_posts','board_folders','board_post_id'],photos:['photo_posts','photo_folders','photo_post_id'],diary:['diary_entries','diary_folders','diary_entry_id']};
const folders={};let groups=0;
const check=async(name,fn)=>{await fn();console.log('PASS '+(++groups)+': '+name);};
const actor=async(uid,fn)=>{await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);await pg.exec('set role '+(uid?'authenticated':'anon'));try{return await fn();}finally{await pg.exec('reset role');}};
const locate=async(kind,n)=>(await pg.query('select public.post_location($1,$2,2) value',[kind,id(n)])).rows[0].value;
const count=async(table)=>(await pg.query('select count(*)::int n from public.'+table)).rows[0].n;
const summary=async()=>{const v=(await pg.query('select public.home_summary() value')).rows[0].value;delete v.as_of;return v;};
try{
 await pg.query('insert into auth.users values($1),($2)',[id(1),id(2)]);
 await pg.query('insert into private.minihompy_admins values($1)',[id(1)]);
 await pg.exec('update private.photo_media_state set ready=true');
 for(const [kind,[table,ft,comment]] of Object.entries(kinds)){
  folders[kind]=(await pg.query('select id from public.'+ft+' limit 1')).rows[0].id;
  for(let n=10;n<=15;n++){
   const cols=kind==='diary'?'entry_date,entry_time,body':'title,body';
   const vals=kind==='diary'?"'2026-09-24','12:00',$5":kind==='photos'?`$5,'[{"type":"image","path":"${id(n)}/${id(77)}.png"}]'`:"$5,'body'";
   await pg.exec('set session_replication_role=replica');
   await pg.query('insert into public.'+table+'(id,folder_id,author_id,author_name,visibility,created_at,'+cols+") values($1,$2,$3,'owner',$4,statement_timestamp()-interval '1 second',"+vals+')',[id(n),folders[kind],id(1),n%2?'private':'public',n%2?'PRIVATE SENTINEL':'public']);
   await pg.exec('set session_replication_role=replica');
   await pg.query('insert into public.post_comments(id,'+comment+",author_id,author_name,body) values(gen_random_uuid(),$1,$2,'owner','comment')",[id(n),id(1)]);
   await pg.exec('set session_replication_role=origin');
  }
 }
 const snapshot=async()=>{const data={};for(const [table]of Object.values(kinds))data[table]=(await pg.query('select to_jsonb(t) v from public.'+table+' t order by id')).rows;return data;};
 const before=await snapshot(),sql=await readFile(new URL('../supabase/migrations/202609240003_visibility_summary.sql',import.meta.url),'utf8');
 await check('upgrade and repeat preserve content; definer summary explicitly excludes private parents',async()=>{
  assert.equal((await actor(null,summary)).counts.board.total,6);await pg.exec(sql);await pg.exec(sql);assert.deepEqual(await snapshot(),before);
  let expected;
  for(const uid of [null,id(2),id(1)]){const v=await actor(uid,summary);for(const kind of Object.keys(kinds))assert.deepEqual(v.counts[kind],{total:3,today:3});assert.equal(v.today_comments,9);assert.equal(v.recent.length,5);assert.ok(!JSON.stringify(v).includes('PRIVATE'));assert.ok(v.recent.every(x=>Number(x.id.slice(-12))%2===0));if(expected)assert.deepEqual(v,expected);else expected=v;}
 });
 for(const [kind,[table]]of Object.entries(kinds))await check(kind+': caller counts and page boundaries; hidden and nonexistent locations identical',async()=>{
  for(const uid of [null,id(2),id(1)])await actor(uid,async()=>{
   const owner=uid===id(1);assert.equal(await count(table),owner?6:3);
   assert.equal((await locate(kind,kind==='diary'?14:10)).page,owner?3:2);
   assert.equal(await locate(kind,99),null);
   if(!owner)assert.equal(await locate(kind,11),null);else assert.ok(await locate(kind,11));
  });
 });
 await check('calendar excludes private-only dates; same-day list count follows caller',async()=>{
  await pg.query("update public.diary_entries set entry_date='2026-09-25' where id=$1",[id(15)]);
  for(const uid of [null,id(2),id(1)])await actor(uid,async()=>{
   const dates=(await pg.query("select public.diary_written_dates($1,'2026-09-01')::text d",[folders.diary])).rows.map(r=>r.d);
   assert.deepEqual(dates,uid===id(1)?['2026-09-24','2026-09-25']:['2026-09-24']);
   assert.equal((await pg.query("select count(*)::int n from public.diary_entries where entry_date='2026-09-24'")).rows[0].n,uid===id(1)?5:3);
  });
 });
 for(const [kind,[table,ft]] of Object.entries(kinds))await check(kind+': hide/move/delete changes location and summary without stale metadata',async()=>{
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id(1)]);
  await pg.query('update public.'+table+" set visibility='private' where id=$1",[id(10)]);
  await actor(null,async()=>{assert.equal(await locate(kind,10),null);assert.equal((await summary()).counts[kind].total,2);assert.equal((await summary()).today_comments, 8-Object.keys(kinds).indexOf(kind)*2);});
  // Keep other kinds intact between checks; separate destination has no predecessors.
  await pg.query('insert into public.'+ft+"(id,label) values($1,'destination')",[id(50)]);
  await actor(id(1),()=>pg.query('update public.'+table+' set folder_id=$1 where id=$2',[id(50),id(12)]));
  await actor(null,async()=>{const v=await locate(kind,12);assert.equal(v.folder_id,id(50));assert.equal(v.page,1);});
  await pg.query('delete from public.'+table+' where id=$1',[id(12)]);
  await actor(null,async()=>{assert.equal(await locate(kind,12),null);assert.equal((await summary()).counts[kind].total,1);});
 });
 console.log('PASS: '+groups+' visibility summary/location/calendar groups');
}finally{await pg.close();}
