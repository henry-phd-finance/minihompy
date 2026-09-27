import assert from 'node:assert/strict';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {readFile} from 'node:fs/promises';import {memberWritingDb} from './helpers/member-writing-db.mjs';
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2]||'../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js')));
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,site=id(999),owner=id(998),member=id(997);
const {pg}=await memberWritingDb(PGlite,{siteId:site,centralUrl:'https://central.test/functions/v1/identity-api'});
try{
 await pg.exec('set session_replication_role=replica');await pg.query('insert into auth.users(id) values($1)',[owner]);await pg.query('insert into private.minihompy_admins values($1)',[owner]);
 const folders={};for(const [kind,t]of Object.entries({board:'board_folders',photos:'photo_folders',diary:'diary_folders'}))folders[kind]=(await pg.query('select id from public.'+t+' limit 1')).rows[0].id;
 for(let n=1;n<=25;n++){
  await pg.query("insert into public.board_posts(id,folder_id,author_name,title,body,created_at) values($1,$2,'owner','title','body','2026-01-01')",[id(n),folders.board]);
  await pg.query("insert into public.photo_posts(id,folder_id,author_name,title,body,created_at) values($1,$2,'owner','title','[]','2026-01-01')",[id(n),folders.photos]);
  await pg.query("insert into public.diary_entries(id,folder_id,author_name,entry_date,entry_time,body) values($1,$2,'owner','2001-02-03','12:00','body')",[id(n),folders.diary]);
  await pg.query("insert into public.guestbook_posts(id,author_id,author_name,body,visibility,created_at) values($1,$2,'owner','private sentinel',$3,'2026-01-01')",[id(n),owner,n%2?'public':'private']);
 }
 await pg.exec('set session_replication_role=origin;set role anon');
 const locate=async(kind,n,size)=>(await pg.query('select public.post_location($1,$2,$3) value',[kind,id(n),size])).rows[0].value;
 assert.equal((await locate('board',1,10)).page,3);assert.equal((await locate('photos',1,2)).page,13);const diary=await locate('diary',25,20);assert.equal(diary.page,2);assert.equal(diary.entry_date,'2001-02-03');
 assert.equal((await locate('guestbook',1,5)).page,3);assert.equal(await locate('guestbook',2,5),null);assert.equal(await locate('board',99,10),null);
 for(const args of [['evil',id(1),5],['board',null,5],['board',id(1),0],['board',id(1),21]])await assert.rejects(()=>pg.query('select public.post_location($1,$2,$3)',args),e=>e.code==='22023');
 await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await pg.exec('set role authenticated');assert.equal((await locate('guestbook',2,5)).page,5);await pg.exec('reset role');
 const list=async(mode,n,extra={})=>(await pg.query("select public.member_guestbook('list',$1) value",[JSON.stringify({site_id:site,mode,page:1,size:5,post:id(n),...extra})])).rows[0].value;
 await pg.exec('set role service_role');assert.equal((await list('public',1)).page,3);assert.equal((await list('public',2)).failure,'NOT_FOUND');const own=await list('owner',2,{owner_id:owner});assert.equal(own.page,5);assert.ok(own.items.some(x=>x.id===id(2)));assert.equal((await list('member',2,{token_hash:'missing'})).failure,'SESSION_REVOKED');await pg.exec('reset role');
 await pg.query('delete from public.guestbook_posts where id=$1',[id(1)]);assert.equal((await list('public',1)).failure,'NOT_FOUND');
 const snapshot=async()=>{const rows={};for(const t of ['board_posts','photo_posts','diary_entries','guestbook_posts','post_comments','minihompy_settings'])rows[t]=(await pg.query(`select to_jsonb(t) value from public.${t} t order by id`)).rows;return rows;};const before=await snapshot();for(const file of ['202609230006_post_location.sql','202609230007_guestbook_post_location.sql'])await pg.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));assert.deepEqual(await snapshot(),before);
 console.log('PASS: actual SQL four-kind positions beyond first page, ties, diary date, private/missing IDs, invalid input, owner vs public page, revoked member, migration repeat');
}finally{await pg.close();}
