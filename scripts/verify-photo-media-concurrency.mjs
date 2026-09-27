// Independent PostgreSQL transactions, not simulated Promise ordering.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import pg from '../../minihompy-central/node_modules/pg/lib/index.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
const container=execFileSync('docker',['run','--rm','-d','-e','POSTGRES_HOST_AUTH_METHOD=trust','-p','127.0.0.1::5432','postgres:16-alpine'],{encoding:'utf8'}).trim();
const id=n=>'90000000-0000-4000-8000-'+String(n).padStart(12,'0'),owner=id(1),path=n=>id(n)+'/'+id(77)+'.png',sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pool,a,b,fixture,folder,groups=0;
const check=async(name,fn)=>{await fn();console.log('PASS '+(++groups)+': '+name);};
const rpc=(client,action,args={})=>client.query('select public.photo_media($1,$2) v',[action,args]).then(r=>r.rows[0].v);
const seed=async n=>{const args={owner_id:owner,path:path(n),post_id:id(n),mime:'image/png',size:68,sha256:'a'.repeat(64)};await rpc(b,'reserve',args);await rpc(b,'complete',args);};
const save=(client,n)=>client.query("insert into public.photo_posts(id,folder_id,author_name,title,body) values($1,$2,'owner','photo',$3)",[id(n),folder,JSON.stringify([{type:'image',path:path(n)}])]);
const waitLock=async client=>{for(let i=0;i<200;i++){if((await pool.query('select wait_event_type from pg_stat_activity where pid=$1',[client.processID])).rows[0]?.wait_event_type==='Lock')return;await sleep(10);}throw Error('Expected lock wait');};
try{
 const port=Number(execFileSync('docker',['port',container,'5432'],{encoding:'utf8'}).trim().split(':').at(-1)),config={host:'127.0.0.1',port,user:'postgres',database:'postgres'};
 pool=new pg.Pool(config);for(let i=0;;i++){try{await pool.query('select 1');break;}catch(e){if(i>100)throw e;await sleep(100);}}
 class Adapter{constructor(){this.client=new pg.Client(config);this.ready=this.client.connect();}async query(s,args){await this.ready;return this.client.query(s,args);}exec(s){return this.query(s);}close(){return this.client.end();}}
 fixture=await memberWritingDb(Adapter,{siteId:id(99),centralUrl:'https://central.test/api'});
 await pool.query(await readFile(new URL('../supabase/migrations/202609240004_photo_media.sql',import.meta.url),'utf8'));
 await pool.query('insert into auth.users values($1)',[owner]);await pool.query('insert into private.minihompy_admins values($1)',[owner]);
 folder=(await pool.query('select id from public.photo_folders limit 1')).rows[0].id;
 await pool.query("update private.photo_media_state set mode='protected',ready=true");
 a=await pool.connect();b=await pool.connect();
 await a.query("set role authenticated;set statement_timeout='8s'");await a.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
 await b.query("set role service_role;set statement_timeout='8s'");
 await check('save wins: cleanup waits and preserves attached asset',async()=>{
  await seed(10);await a.query('begin');await save(a,10);
  const pending=rpc(b,'cleanup_begin',{owner_id:owner,path:path(10)});await waitLock(b);
  await a.query('commit');assert.equal((await pending).failure,'IN_USE');
 });
 await check('cleanup wins: late save waits then fails; no partial post',async()=>{
  await seed(11);await b.query('begin');await rpc(b,'cleanup_begin',{owner_id:owner,path:path(11)});
  const pending=save(a,11).then(()=>null,e=>e);await waitLock(a);await b.query('commit');assert.equal((await pending).code,'23514');
  assert.equal((await pool.query('select * from public.photo_posts where id=$1',[id(11)])).rows.length,0);
 });
 await check('freeze waits for active save, snapshots committed content and rejects next write',async()=>{
  await seed(12);await a.query('begin');await save(a,12);
  const pending=rpc(b,'freeze');await waitLock(b);await a.query('commit');await pending;
  assert.ok((await rpc(b,'inventory')).posts.some(p=>p.id===id(12)));
  await assert.rejects(()=>a.query('delete from public.photo_posts where id=$1',[id(12)]),e=>e.message.includes('MEDIA_FROZEN'));
  await pool.query("update private.photo_media_state set mode='protected',ready=true");
 });
 await check('read after waiting for hide sees current visibility; revoked owner fails',async()=>{
  await a.query('begin');await a.query("update public.photo_posts set visibility='private' where id=$1",[id(10)]);
  const pending=rpc(b,'read',{post_id:id(10),path:path(10)});await waitLock(b);await a.query('commit');assert.equal((await pending).failure,'NOT_FOUND');
  await a.query('begin');await a.query("update public.photo_posts set title='held' where id=$1",[id(10)]);
  const own=rpc(b,'read',{owner_id:owner,post_id:id(10),path:path(10)});await waitLock(b);
  await pool.query('delete from private.minihompy_admins where user_id=$1',[owner]);await a.query('commit');assert.equal((await own).failure,'FORBIDDEN');
 });
 console.log('PASS: '+groups+' independent PostgreSQL media race groups');
}finally{a?.release();b?.release();await fixture?.pg.close();await pool?.end();execFileSync('docker',['rm','-f',container],{stdio:'ignore'});}
