import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {memberWritingDb} from './helpers/member-writing-db.mjs';
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2]||'../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js')));
const {pg}=await memberWritingDb(PGlite,{siteId:'10000000-0000-4000-8000-000000000099',centralUrl:'https://central.test/functions/v1/identity-api'});
const sql=(await readFile(new URL('../supabase/migrations/202609230005_home_summary.sql',import.meta.url),'utf8'))+(await readFile(new URL('../supabase/migrations/202609240003_visibility_summary.sql',import.meta.url),'utf8'));
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,all=['board','photos','diary','guestbook'];
const at='2026-09-23T15:00:00Z',before='2026-09-23T14:59:59.999Z';let groups=0;
const check=async(name,fn)=>{await fn();console.log(`PASS ${++groups}: ${name}`);};
const summary=async(menus=all,time=at)=>(await pg.query('select private.home_summary_at($1,$2) value',[menus,time])).rows[0].value;
const snapshot=async()=>{const result={};for(const t of ['board_posts','photo_posts','diary_entries','guestbook_posts','post_comments','minihompy_settings'])result[t]=(await pg.query(`select to_jsonb(t) value from public.${t} t order by id`)).rows;return result;};
try{
 await pg.exec(sql);
 await check('empty success, all hidden, invalid arguments, missing settings distinct from zero',async()=>{
  const v=await summary();assert.deepEqual(v.recent,[]);assert.equal(v.today_comments,0);assert.ok(Object.values(v.counts).every(c=>c.total===0&&c.today===0));
  assert.deepEqual((await summary([])).counts,{});
  for(const menus of [null,['board','board'],['unknown'],[null],[['board','photos']],[id(9)],['board','photos','diary','guestbook','board']])await assert.rejects(()=>summary(menus),e=>e.code==='22023');
  await pg.exec('begin;delete from public.minihompy_settings');await assert.rejects(()=>summary(),e=>e.code==='55000');await pg.exec('rollback');
 });
 // Fixture insertion bypasses write guards only to control clocks and create all
 // roles/visibility cases. Read functions and their actual grants remain active.
 await pg.exec('set session_replication_role=replica');
 await pg.query('insert into auth.users(id) values($1),($2)',[id(1),id(2)]);
 await pg.query('insert into private.minihompy_admins values($1)',[id(1)]);
 const folder=(await pg.query('select id from public.board_folders limit 1')).rows[0].id;
 const photoFolder=(await pg.query('select id from public.photo_folders limit 1')).rows[0].id;
 const diaryFolder=(await pg.query('select id from public.diary_folders limit 1')).rows[0].id;
 await pg.query("insert into public.guestbook_posts(id,author_id,author_name,body,visibility,created_at) values($1,$2,'owner','PRIVATE SENTINEL','private',$3)",[id(20),id(1),at]);
 await pg.exec('set session_replication_role=origin');
 await check('private-only site remains empty with no metadata',async()=>{const v=await summary();assert.equal(v.counts.guestbook.total,0);assert.deepEqual(v.recent,[]);assert.ok(!JSON.stringify(v).includes('PRIVATE'));});
 await pg.exec('set session_replication_role=replica');
 for(const n of [10,11,12])await pg.query("insert into public.board_posts(id,folder_id,author_id,author_name,title,body,created_at) values($1,$2,$3,'owner',$4,'FULL BODY SECRET TO SUMMARY',$5)",[id(n),folder,id(1),'board '+n,n===10?before:at]);
 await pg.query("insert into public.photo_posts(id,folder_id,author_name,title,body,created_at) values($1,$2,'owner','photo','[]',$3)",[id(13),photoFolder,at]);
 await pg.query("insert into public.diary_entries(id,folder_id,author_name,entry_date,entry_time,body,created_at) values($1,$2,'owner','2000-01-01','12:00',$3,$4)",[id(14),diaryFolder,'<b>일기</b> **hello** [label](https://secret.example) '+ '가'.repeat(200),at]);
 await pg.query("insert into public.guestbook_posts(id,author_id,author_name,body,visibility,created_at) values($1,$2,'owner','public guestbook','public',$3)",[id(15),id(1),at]);
 for(const [n,field,parent,time] of [[30,'board_post_id',10,at],[31,'guestbook_post_id',20,at],[32,'guestbook_post_id',15,at],[33,'board_post_id',12,before],[34,'diary_entry_id',14,at]])await pg.query(`insert into public.post_comments(id,${field},author_id,author_name,body,created_at) values($1,$2,$3,'owner','COMMENT BODY NEVER RETURNED',$4)`,[id(n),id(parent),id(1),time]);
 await pg.exec('set session_replication_role=origin');
 await check('four kinds, deterministic top five, bounded plain text, no full bodies or private IDs',async()=>{
  const v=await summary();assert.deepEqual(v.recent.map(x=>x.id),[12,11,14,15,13].map(id));
  assert.equal(v.recent.length,5);assert.deepEqual(v.counts.board,{total:3,today:2});assert.equal(v.counts.guestbook.total,1);assert.equal(v.today_comments,3);
  assert.equal(v.recent.find(x=>x.kind==='diary').today_comments,1);assert.equal(v.recent.find(x=>x.kind==='guestbook').today_comments,1);
  const diary=v.recent.find(x=>x.kind==='diary').label;assert.ok(diary.startsWith('일기 hello label '));assert.equal([...diary].length,120);
  for(const secret of ['PRIVATE',id(20),id(31),'FULL BODY','COMMENT BODY','secret.example'])assert.ok(!JSON.stringify(v).includes(secret));
  assert.deepEqual(Object.keys(v.recent[0]).sort(),['created_at','id','kind','label','today_comments']);
 });
 await check('central-member and local authors share public-only rules without author metadata',async()=>{
  const expected=await summary();await pg.exec('begin;set local session_replication_role=replica');
  await pg.query("update public.guestbook_posts set author_id=null,author_kind='member',author_member_id=$1,author_homepage_url='https://member.example/home/' where id=any($2)",[id(2),[id(15),id(20)]]);
  await pg.query("update public.post_comments set author_id=null,author_kind='member',author_member_id=$1,author_homepage_url='https://member.example/home/' where id=any($2)",[id(2),[id(31),id(32)]]);
  await pg.exec('set local session_replication_role=origin');assert.deepEqual(await summary(),expected);await pg.exec('rollback');
 });
 await check('Korean midnight boundary, entry date ignored, new comments on old posts included',async()=>{
  const old=await summary(all,before);assert.equal(old.date,'2026-09-23');assert.equal(old.counts.board.today,1);assert.equal(old.counts.diary.total,0);
  const next=await summary();assert.equal(next.date,'2026-09-24');assert.equal(next.counts.diary.today,1);assert.equal(next.today_comments,3);
  assert.equal((await summary(all,'2026-09-24T15:00:00Z')).today_comments,0);
 });
 await check('server settings exclude hidden menus from recent, counts and comments even when requested',async()=>{
  await pg.exec('begin');await pg.exec("update public.minihompy_settings set payload=jsonb_set(payload,'{menus}',(select jsonb_agg(case when e->>'id'='guestbook' then jsonb_set(e,'{visible}','false') else e end) from jsonb_array_elements(payload->'menus') e))");
  const v=await summary();assert.ok(!v.menus.includes('guestbook'));assert.equal(v.counts.guestbook,undefined);assert.equal(v.today_comments,2);assert.ok(!v.recent.some(x=>x.kind==='guestbook'));assert.deepEqual((await summary(['guestbook'])).recent,[]);
  await pg.exec("update public.minihompy_settings set payload=jsonb_set(payload,'{menus}','[]')");assert.deepEqual((await summary()).counts,{});await pg.exec('rollback');
 });
 await check('delete, make private, edit preserve correct counts; no stale summary; migration repeat preserves rows',async()=>{
  const saved=await snapshot();await pg.exec(sql);assert.deepEqual(await snapshot(),saved);
  await pg.exec('begin');await pg.query('delete from public.board_posts where id=$1',[id(12)]);assert.equal((await summary()).counts.board.total,2);
  await pg.query("update public.guestbook_posts set visibility='private' where id=$1",[id(15)]);const v=await summary();assert.equal(v.counts.guestbook.total,0);assert.equal(v.today_comments,2);assert.ok(!JSON.stringify(v).includes(id(15)));
  await pg.query("update public.board_posts set title='edited' where id=$1",[id(10)]);assert.equal((await summary()).counts.board.today,1);await pg.exec('rollback');
  assert.deepEqual(await snapshot(),saved);
 });
 await check('anonymous, member, owner RPC agree; private clock/text helpers and writes not accessible',async()=>{
  // Use populated past fixtures for the production clock wrapper, not an
  // accidentally empty result when the deterministic fixtures are in the future.
  await pg.exec('set session_replication_role=replica');
  for(const table of ['board_posts','photo_posts','diary_entries','guestbook_posts','post_comments'])await pg.exec(`update public.${table} set created_at=statement_timestamp()-interval '1 hour'`);
  await pg.exec('set session_replication_role=origin');
  const saved=await snapshot();
  let expected;
  for(const [role,sub]of [['anon',''],['authenticated',id(2)],['authenticated',id(1)]]){
   await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[sub]);await pg.exec('set role '+role);
   const v=(await pg.query('select public.home_summary() value')).rows[0].value;delete v.as_of;assert.equal(v.recent.length,5);assert.equal(v.counts.board.total,3);assert.equal(v.counts.guestbook.total,1);assert.ok(!JSON.stringify(v).includes('PRIVATE'));
   if(expected)assert.deepEqual(v,expected);else expected=v;
   await assert.rejects(()=>pg.query('select private.home_summary_at($1,$2)',[all,at]),e=>e.code==='42501');
   await assert.rejects(()=>pg.query("select private.home_summary_text('x')"),e=>e.code==='42501');
   if(role==='anon')await assert.rejects(()=>pg.exec('update public.board_posts set title=\'bad\''),e=>e.code==='42501');
   await pg.exec('reset role');
  }
  assert.deepEqual(await snapshot(),saved);
  await pg.exec('set role service_role');await assert.rejects(()=>pg.query('select public.home_summary()'),e=>e.code==='42501');await assert.rejects(()=>pg.query('select private.home_summary_at($1,$2)',[all,at]),e=>e.code==='42501');await pg.exec('reset role');
  await pg.exec('create role home_outsider;grant usage on schema public to home_outsider;set role home_outsider');await assert.rejects(()=>pg.query('select public.home_summary()'),e=>e.code==='42501');await pg.exec('reset role');
 });
 console.log(`PASS: ${groups} home summary groups (actual PostgreSQL/PGlite, no deployment)`);
}finally{await pg.close();}
