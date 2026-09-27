// Real PostgreSQL connections: RLS parent locks vs hide, comments and cascading deletes.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
const {default:pg}=await import(pathToFileURL(resolve('../minihompy-central/node_modules/pg/lib/index.js')));
const container=execFileSync('docker',['run','--rm','-d','-e','POSTGRES_HOST_AUTH_METHOD=trust','-p','127.0.0.1::5432','postgres:16-alpine'],{encoding:'utf8'}).trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),id=n=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),visitor=id(2),site=id(3),member=id(4);let pool,fixture,a,b,c,seq=100,groups=0;
const tables={board:'board_posts',photos:'photo_posts',diary:'diary_entries'},cols={board:'board_post_id',photos:'photo_post_id',diary:'diary_entry_id'};
const check=async(name,fn)=>{await fn();console.log(`PASS ${++groups}: ${name}`);};
async function waitLock(client){for(let i=0;i<200;i++){const r=await pool.query('select wait_event_type from pg_stat_activity where pid=$1',[client.processID]);if(r.rows[0]?.wait_event_type==='Lock')return;await sleep(10);}throw Error('Expected parent lock wait');}
async function seed(kind){
 const p=id(seq++),comment=id(seq++);
 if(kind==='board')await a.query("insert into public.board_posts(id,folder_id,author_name,title,body) select $1,id,'owner','title','body' from public.board_folders",[p]);
 if(kind==='photos')await a.query("insert into public.photo_posts(id,folder_id,author_name,title,body) select $1,id,'owner','title',$2 from public.photo_folders",[p,JSON.stringify([{type:'image',path:p+'/'+id(88)+'.png'}])]);
 if(kind==='diary')await a.query("insert into public.diary_entries(id,folder_id,author_name,entry_date,entry_time,body) select $1,id,'owner','2026-09-24','12:00','body' from public.diary_folders",[p]);
 await pool.query("update private.comment_write_limits set last_write=now()-interval '1 minute'");
 await b.query(`insert into public.post_comments(id,${cols[kind]},author_name,body) values($1,$2,'visitor','original')`,[comment,p]);
 return {p,comment};
}
const hide=(client,kind,p)=>client.query(`update public.${tables[kind]} set visibility='private' where id=$1`,[p]);
const rpc=(client,action,args)=>client.query('select public.member_comments($1,$2) result',[action,{mode:'member',site_id:site,token_hash:'a'.repeat(64),...args}]).then(r=>r.rows[0].result);
try{
 const port=Number(execFileSync('docker',['port',container,'5432'],{encoding:'utf8'}).trim().split(':').at(-1));
 const config={host:'127.0.0.1',port,user:'postgres',database:'postgres'};pool=new pg.Pool({...config,max:6});
 for(let i=0;;i++){try{await pool.query('select 1');break;}catch(e){if(i>100)throw e;await sleep(100);}}
 class Adapter{constructor(){this.client=new pg.Client(config);this.ready=this.client.connect();}async query(sql,args){await this.ready;return this.client.query(sql,args);}exec(sql){return this.query(sql);}async close(){await this.client.end();}}
 fixture=await memberWritingDb(Adapter,{siteId:site,centralUrl:'https://central.test/api'});
 await pool.query('insert into auth.users values($1),($2)',[owner,visitor]);await pool.query('insert into private.minihompy_admins values($1)',[owner]);
 await pool.query('update private.photo_media_state set ready=true');
 await pool.query("select public.member_writing_session('create',$1)",[{site_id:site,member_id:member,central_session_id:id(5),proof_id:id(6),display_name:'member',homepage_url:'https://member.test/',expires_at:new Date(Date.now()+600000).toISOString(),token_hash:'a'.repeat(64),central_grant:'a'.repeat(43)}]);
 a=await pool.connect();b=await pool.connect();c=await pool.connect();
 for(const [client,uid,role]of [[a,owner,'authenticated'],[b,visitor,'authenticated'],[c,null,'service_role']]){
  await client.query("set statement_timeout='8s';set lock_timeout='6s';set role "+role);await client.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);
 }
 for(const kind of Object.keys(tables)){
  await check(kind+': hide wins over pending direct INSERT/UPDATE/DELETE',async()=>{
   for(const action of ['insert','update','delete']){
    const {p,comment}=await seed(kind);await a.query('begin');await hide(a,kind,p);
    const q=action==='insert'?b.query(`insert into public.post_comments(id,${cols[kind]},author_name,body) values($1,$2,'visitor','late')`,[id(seq++),p]):action==='update'?b.query("update public.post_comments set body='late' where id=$1 returning id",[comment]):b.query('delete from public.post_comments where id=$1 returning id',[comment]);
    const pending=q.then(r=>({rows:r.rowCount}),e=>({code:e.code}));await waitLock(b);await a.query('commit');const r=await pending;
    if(action==='insert')assert.equal(r.code,'42501');else assert.equal(r.rows,0,JSON.stringify(r));
    assert.equal((await pool.query('select body from public.post_comments where id=$1',[comment])).rows[0].body,'original');
   }
  });
  await check(kind+': direct update locks parent before comment; hide waits and then removes access',async()=>{
   const {p,comment}=await seed(kind);await b.query('begin');await b.query("update public.post_comments set body='before hide' where id=$1",[comment]);
   const pending=hide(a,kind,p);await waitLock(a);await b.query('commit');await pending;
   assert.equal((await b.query('select * from public.post_comments where id=$1',[comment])).rows.length,0);
  });
  await check(kind+': cascade delete and local edit serialize without reversed parent/comment locks',async()=>{
   const {p,comment}=await seed(kind);await b.query('begin');await b.query("update public.post_comments set body='edit' where id=$1",[comment]);
   const pending=a.query('delete from public.'+tables[kind]+' where id=$1',[p]);await waitLock(a);await b.query('commit');await pending;
   assert.equal((await pool.query('select * from public.post_comments where id=$1',[comment])).rows.length,0);
   const second=await seed(kind);await a.query('begin');await a.query('delete from public.'+tables[kind]+' where id=$1',[second.p]);
   const late=b.query("update public.post_comments set body='late' where id=$1 returning id",[second.comment]);await waitLock(b);await a.query('commit');assert.equal((await late).rowCount,0);
  });
  await check(kind+': hide and member create/replay use current parent state under real locks',async()=>{
   const {p}=await seed(kind),args={kind,parent_id:p,id:id(seq++),request_id:id(seq++),body:'member'};
   await pool.query("update private.member_writing_limits set last_write=now()-interval '1 minute'");
   await a.query('begin');await hide(a,kind,p);const pending=rpc(c,'create',args);await waitLock(c);await a.query('commit');assert.equal((await pending).failure,'NOT_FOUND');
   await a.query('update public.'+tables[kind]+" set visibility='public' where id=$1",[p]);
   await c.query('begin');assert.ok((await rpc(c,'create',args)).id);const hidden=hide(a,kind,p);await waitLock(a);await c.query('commit');await hidden;assert.equal((await rpc(c,'create',args)).failure,'NOT_FOUND');
  });
 }
 await check('Visibility RPC serializes duplicate requests and rejects stale optimistic tokens',async()=>{
  const {p}=await seed('board');const version=(await pool.query('select updated_at::text v from public.board_posts where id=$1',[p])).rows[0].v;
  const args=['board',p,'private',version,id(seq++)];
  const call=(client,values)=>client.query('select public.set_content_visibility($1,$2,$3,$4,$5) r',values).then(r=>r.rows[0].r);
  // Second connection is temporarily a second browser of the same verified administrator.
  await b.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await a.query('begin');const first=await call(a,args);assert.ok(!first.failure);
  const pending=call(b,args);await waitLock(b);await a.query('commit');assert.equal((await pending).replayed,true);
  assert.equal((await call(b,['board',p,'public',version,id(seq++)])).failure,'REVISION_CONFLICT');
  await b.query("select set_config('request.jwt.claim.sub',$1,false)",[visitor]);
 });
 await check('Owner removed while waiting on parent cannot read private comments through service RPC',async()=>{
  const {p}=await seed('board');await a.query('begin');await hide(a,'board',p);
  const pending=c.query("select public.member_comments('list',$1) r",[{mode:'owner',owner_id:owner,site_id:site,kind:'board',parent_id:p,page:1,size:20}]);await waitLock(c);
  await pool.query('delete from private.minihompy_admins where user_id=$1',[owner]);await a.query('commit');assert.equal((await pending).rows[0].r.failure,'FORBIDDEN');
  await pool.query('insert into private.minihompy_admins values($1)',[owner]);
 });
 console.log(`PASS: ${groups} real PostgreSQL visibility concurrency groups; container removed on exit.`);
}finally{
 for(const client of [a,b,c].filter(Boolean)){await client.query('rollback').catch(()=>{});client.release();}
 if(fixture)await fixture.pg.close();if(pool)await pool.end();execFileSync('docker',['rm','-f',container],{stdio:'ignore'});
}
