// Disposable PostgreSQL 16, independent connections and observed lock waits. No hosted access.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
const {default:pg}=await import(pathToFileURL(resolve('../minihompy-central/node_modules/pg/lib/index.js')));
const container=execFileSync('docker',['run','--rm','-d','-e','POSTGRES_HOST_AUTH_METHOD=trust','-p','127.0.0.1::5432','postgres:16-alpine'],{encoding:'utf8'}).trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),id=n=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const admin=id(1);let pool,fixture,a,b,seq=100,passed=0;
const tables={board:['board_folders','board_posts'],photos:['photo_folders','photo_posts'],diary:['diary_folders','diary_entries']};
const rpc=async(c,action,args)=>(await c.query('select public.manage_content_folders($1,$2) result',[action,args])).rows[0].result;
const snapshot=(c,menu)=>rpc(c,'snapshot',{menu});
async function check(name,fn){await fn();passed++;console.log('PASS: '+name);}
async function waitLock(client){for(let i=0;i<200;i++){const r=await pool.query('select wait_event_type from pg_stat_activity where pid=$1',[client.processID]);if(r.rows[0]?.wait_event_type==='Lock')return;await sleep(10);}throw Error('Expected real PostgreSQL lock wait');}
async function request(c,menu,action,extra={}){const args={menu,expected_revision:(await snapshot(c,menu)).menu_revision,request_id:id(seq++),...extra};return {args,result:await rpc(c,action,args)};}
async function folders(menu){const source=(await snapshot(a,menu)).items.find(x=>!x.kind||x.kind==='folder').id,target=id(seq++);assert.ok(!(await request(a,menu,'create',{id:target,kind:'folder',label:'target'})).result.failure);return {source,target};}
async function insert(c,menu,folder){
 const key=id(seq++);
 if(menu==='board')await c.query("insert into public.board_posts(id,folder_id,author_name,title,body) values($1,$2,'owner','post','body')",[key,folder]);
 if(menu==='photos')await c.query("insert into public.photo_posts(id,folder_id,author_name,title,body) values($1,$2,'owner','post',$3)",[key,folder,JSON.stringify([{type:'image',path:`${key}/${id(99)}.png`}])]);
 if(menu==='diary')await c.query("insert into public.diary_entries(id,folder_id,author_name,entry_date,entry_time,body) values($1,$2,'owner','2026-09-24','12:30','body')",[key,folder]);
 return key;
}
try{
 const port=Number(execFileSync('docker',['port',container,'5432'],{encoding:'utf8'}).trim().split(':').at(-1));
 const config={host:'127.0.0.1',port,user:'postgres',database:'postgres'};pool=new pg.Pool({...config,max:5});
 for(let i=0;;i++){try{await pool.query('select 1');break;}catch(e){if(i>100)throw e;await sleep(100);}}
 class Adapter{constructor(){this.client=new pg.Client(config);this.ready=this.client.connect();}async query(sql,args){await this.ready;return this.client.query(sql,args);}exec(sql){return this.query(sql);}async close(){await this.client.end();}}
 fixture=await memberWritingDb(Adapter,{siteId:id(2),centralUrl:'https://central.test/api',folders:false});
 await pool.query('insert into auth.users values($1)',[admin]);await pool.query('insert into private.minihompy_admins values($1)',[admin]);
 await pool.query(await readFile(new URL('../supabase/migrations/202609240001_content_folders.sql',import.meta.url),'utf8'));
 a=await pool.connect();b=await pool.connect();
 for(const c of [a,b]){await c.query("set statement_timeout='8s';set lock_timeout='6s';set role authenticated");await c.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);}
 for(const menu of Object.keys(tables)){
  await check(`${menu}: concurrent last-folder deletion serializes and retains one real folder`,async()=>{
   const {source,target}=await folders(menu),revision=(await snapshot(a,menu)).menu_revision;
   await a.query('begin');const first=await rpc(a,'delete',{menu,id:source,expected_revision:revision,request_id:id(seq++)});assert.ok(!first.failure);
   const secondArgs={menu,id:target,expected_revision:revision,request_id:id(seq++)};const pending=rpc(b,'delete',secondArgs);await waitLock(b);await a.query('commit');assert.equal((await pending).failure,'CONFLICT');
   assert.equal((await request(b,menu,'delete',{id:target})).result.failure,'LAST_FOLDER');assert.equal((await snapshot(a,menu)).items.length,1);
  });
  await check(`${menu}: a new post invalidates pending folder-delete confirmation`,async()=>{
   const {source,target}=await folders(menu),revision=(await snapshot(a,menu)).menu_revision;
   await a.query('begin');const key=await insert(a,menu,source);
   const pending=rpc(b,'delete',{menu,id:source,destination_id:target,expected_revision:revision,request_id:id(seq++)});await waitLock(b);await a.query('commit');assert.equal((await pending).failure,'CONFLICT');
   assert.equal((await pool.query(`select folder_id from public.${tables[menu][1]} where id=$1`,[key])).rows[0].folder_id,source);
   assert.equal((await request(a,menu,'delete',{id:source,destination_id:target})).result.moved_count,1);
  });
  await check(`${menu}: delete first, late direct post save fails without an orphan`,async()=>{
   const {source,target}=await folders(menu),oldCount=(await pool.query(`select count(*) n from public.${tables[menu][1]}`)).rows[0].n;
   await a.query('begin');assert.ok(!(await request(a,menu,'delete',{id:source,destination_id:target})).result.failure);
   const pending=insert(b,menu,source).then(()=>({ok:true}),e=>({code:e.code}));await waitLock(b);await a.query('commit');assert.equal((await pending).code,'23503');
   assert.equal((await pool.query(`select count(*) n from public.${tables[menu][1]}`)).rows[0].n,oldCount);
  });
 }
 await check('Concurrent identical requests return one receipt and one created folder',async()=>{
  const menu='board',key=id(seq++),args={menu,id:key,kind:'folder',label:'once',request_id:id(seq++),expected_revision:(await snapshot(a,menu)).menu_revision};
  await a.query('begin');const first=await rpc(a,'create',args),pending=rpc(b,'create',args);await waitLock(b);await a.query('commit');assert.deepEqual(await pending,first);
  assert.equal((await pool.query('select count(*)::int n from public.board_folders where id=$1',[key])).rows[0].n,1);
 });
 await check('Concurrent reorder/create rejects stale order without losing new folder',async()=>{
  const menu='photos',before=await snapshot(a,menu);await a.query('begin');const key=id(seq++);assert.ok(!(await request(a,menu,'create',{id:key,kind:'folder',label:'new'})).result.failure);
  const pending=rpc(b,'reorder',{menu,ids:before.items.map(x=>x.id),expected_revision:before.menu_revision,request_id:id(seq++)});await waitLock(b);await a.query('commit');assert.equal((await pending).failure,'CONFLICT');assert.ok((await snapshot(a,menu)).items.some(x=>x.id===key));
 });
 await check('Move/delete waits before rows; concurrent body edit survives with no deadlock',async()=>{
  const menu='diary',{source,target}=await folders(menu),key=await insert(a,menu,source);
  await a.query('begin');await a.query("update public.diary_entries set body='concurrent edit' where id=$1",[key]);
  const revision=(await snapshot(a,menu)).menu_revision,pending=rpc(b,'delete',{menu,id:source,destination_id:target,expected_revision:revision,request_id:id(seq++)});await waitLock(b);await a.query('commit');assert.ok(!(await pending).failure);
  const row=(await pool.query('select * from public.diary_entries where id=$1',[key])).rows[0];assert.equal(row.body,'concurrent edit');assert.equal(row.folder_id,target);assert.equal(row.revision,3);
 });
 await check('Bulk move invalidates an editor optimistic revision before its blocked UPDATE resumes',async()=>{
  const menu='photos',{source,target}=await folders(menu),key=await insert(a,menu,source);
  await a.query('begin');assert.ok(!(await request(a,menu,'delete',{id:source,destination_id:target})).result.failure);
  const pending=b.query("update public.photo_posts set title='stale editor' where id=$1 and revision=1 returning id",[key]);await waitLock(b);await a.query('commit');assert.equal((await pending).rowCount,0);
  const row=(await pool.query('select * from public.photo_posts where id=$1',[key])).rows[0];assert.equal(row.title,'post');assert.equal(row.folder_id,target);
 });
 await check('Administrator revoked during menu lock wait cannot execute queued mutation',async()=>{
  const args={menu:'board',id:id(seq++),kind:'folder',label:'revoked',request_id:id(seq++),expected_revision:(await snapshot(a,'board')).menu_revision};
  await a.query('begin');await snapshot(a,'board');const pending=rpc(b,'create',args);await waitLock(b);
  await pool.query('delete from private.minihompy_admins where user_id=$1',[admin]);await a.query('commit');assert.equal((await pending).failure,'FORBIDDEN');
  assert.equal((await pool.query('select count(*)::int n from public.board_folders where id=$1',[args.id])).rows[0].n,0);
  await pool.query('insert into private.minihompy_admins values($1)',[admin]);
 });
 await check('Different menus do not block each other',async()=>{
  await a.query('begin');await snapshot(a,'board');const started=Date.now();await snapshot(b,'photos');assert.ok(Date.now()-started<3000);await a.query('commit');
 });
 console.log(`PASS: ${passed} PostgreSQL concurrency groups; container removed on exit.`);
}finally{
 for(const c of [a,b].filter(Boolean)){await c.query('rollback').catch(()=>{});c.release();}
 if(fixture)await fixture.pg.close();if(pool)await pool.end();execFileSync('docker',['rm','-f',container],{stdio:'ignore'});
}
