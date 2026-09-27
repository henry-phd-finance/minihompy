// Independent PostgreSQL connections, plus actual PostgREST service RPC timeout.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import pg from '../../minihompy-central/node_modules/pg/lib/index.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {site,owner,visitor,tokenHash,actor,centralSession,post,tables,seed,activate} from './helpers/friend-visibility-fixture.mjs';
import {commentArgs} from './helpers/friend-comment-fixture.mjs';
const container=execFileSync('docker',['run','--rm','-d','-e','POSTGRES_HOST_AUTH_METHOD=trust','-p','127.0.0.1::5432','postgres:16-alpine'],{encoding:'utf8'}).trim();
let pool,fixture,a,b,c,restContainer,groups=0;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ok=r=>{assert.ok(!r.failure,JSON.stringify(r));return r;};
const call=async(client,action='create',args=commentArgs())=>(await client.query('select public.member_content_comments($1,$2) r',[action,args])).rows[0].r;
const visibility=(client,kind,v)=>client.query('update public.'+tables[kind]+' set visibility=$1 where id=$2',[v,post(kind,1)]);
const revoke=client=>client.query("select public.member_writing_session('revoke',$1)",[{site_id:site,token_hash:tokenHash}]);
async function waitLock(client){for(let i=0;i<200;i++){if((await pool.query('select wait_event_type from pg_stat_activity where pid=$1',[client.processID])).rows[0]?.wait_event_type==='Lock')return;await sleep(10);}throw Error('Expected lock wait');}
async function check(name,fn){await pool.query('update private.member_writing_sessions set revoked_at=null;update private.member_writing_families set revoked_at=null;delete from private.member_writing_limits');for(const kind of Object.keys(tables))await visibility(a,kind,'friends');await fn();console.log(`PASS ${++groups}: ${name}`);}
const operation=kind=>({kind,parent_id:post(kind,1),request_id:randomUUID(),id:randomUUID(),body:'friend body'});
const rows=async(op)=>({comments:(await pool.query('select count(*)::int n from public.post_comments where id=$1',[op.id])).rows[0].n,receipts:(await pool.query('select count(*)::int n from private.member_writing_requests where request_id=$1',[op.request_id])).rows[0].n});
try{
 const port=Number(execFileSync('docker',['port',container,'5432'],{encoding:'utf8'}).trim().split(':').at(-1));const cfg={host:'127.0.0.1',port,user:'postgres',database:'postgres'};
 pool=new pg.Pool({...cfg,max:6});for(let i=0;;i++){try{await pool.query('select 1');break;}catch(e){if(i>100)throw e;await sleep(100);}}
 class Adapter{constructor(){this.client=new pg.Client(cfg);this.ready=this.client.connect();}async query(sql,args){await this.ready;return this.client.query(sql,args);}exec(sql){return this.query(sql);}async close(){await this.client.end();}}
 fixture=await memberWritingDb(Adapter,{siteId:site,centralUrl:'https://central.test/api',photoMedia:true});await seed(fixture.pg);
 await pool.query(await readFile(new URL('../supabase/migrations/202609240007_friend_visibility.sql',import.meta.url),'utf8'));
 // Create a pre-upgrade public receipt, then prove the new migration does not rewrite it.
 const oldOp={...operation('board'),parent_id:post('board',0)};
 const oldArgs={...oldOp,mode:'member',site_id:site,token_hash:tokenHash};
 ok((await pool.query("select public.member_comments('create',$1) r",[oldArgs])).rows[0].r);
 const oldReceipt=(await pool.query('select * from private.member_writing_requests where request_id=$1',[oldOp.request_id])).rows[0];
 await pool.query(await readFile(new URL('../supabase/migrations/202609240008_friend_comments.sql',import.meta.url),'utf8'));
 const upgraded=(await pool.query('select * from private.member_writing_requests where request_id=$1',[oldOp.request_id])).rows[0];assert.equal(upgraded.parent_id,null);assert.equal(upgraded.parent_kind,null);delete upgraded.parent_id;delete upgraded.parent_kind;assert.deepEqual(upgraded,oldReceipt);
 for(const file of ['202609240009_friend_photo_media.sql','202609240010_friend_aggregates.sql','202609240011_friend_diary_filters.sql'])await pool.query(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await activate(pool);a=await pool.connect();b=await pool.connect();c=await pool.connect();await a.query('set role authenticated');await a.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);for(const client of [b,c])await client.query("set role service_role;set statement_timeout='6s'");
 await pool.query("select public.member_writing_session('create_v2',$1)",[{site_id:site,member_id:actor,central_session_id:centralSession,proof_id:randomUUID(),token_hash:'f'.repeat(64),central_grant:'y'.repeat(43),display_name:'Member',homepage_url:'https://a.test/home/',expires_at:new Date(Date.now()+600000).toISOString(),renewal_hash:'e'.repeat(64),central_delegation:'z'.repeat(43),renewal_expires_at:new Date(Date.now()+86400000).toISOString()}]);
 await check('RPC and helper ACL, forged selector/context; old receipts preserve retry without guessing parent',async()=>{
  for(const role of ['anon','authenticated','service_role']){
   const d=await pool.connect();try{await d.query('set role '+role);await assert.rejects(d.query("select private.friend_comment_operation('list','{}')"),e=>e.code==='42501');if(role!=='service_role'){await assert.rejects(call(d),e=>e.code==='42501');await assert.rejects(d.query('select public.friend_comments_status()'),e=>e.code==='42501');}}finally{await d.query('reset role');d.release();}
  }
  const wrong=commentArgs();wrong.operation.parent_id=post('board',0);assert.equal((await call(b,'create',wrong)).failure,'TARGET_MISMATCH');
  const wrongActor=commentArgs();wrongActor.access.context.actor_member_id=owner;assert.equal((await call(b,'create',wrongActor)).failure,'TARGET_MISMATCH');
  assert.equal(ok(await call(b,'create',commentArgs('create',oldOp))).replayed,true);
  assert.equal((await call(b,'operations',commentArgs('operations',{kind:'board',parent_id:post('board',0),request_id:oldOp.request_id}))).failure,'NOT_FOUND');
 });
 for(const kind of Object.keys(tables)){
  await check(kind+': privacy change first blocks pending create/retry/result without records',async()=>{
   const op=operation(kind);await a.query('begin');await visibility(a,kind,'private');const wait=call(b,'create',commentArgs('create',op));await waitLock(b);await a.query('commit');assert.equal((await wait).failure,'NOT_FOUND');assert.deepEqual(await rows(op),{comments:0,receipts:0});
  });
  await check(kind+': write first holds parent, hide waits; retries/results require restored parent access',async()=>{
   const op=operation(kind);await b.query('begin');ok(await call(b,'create',commentArgs('create',op)));const wait=visibility(a,kind,'private');await waitLock(a);await b.query('commit');await wait;
   assert.equal((await call(b,'create',commentArgs('create',op))).failure,'NOT_FOUND');assert.equal((await call(b,'operations',commentArgs('operations',{kind,parent_id:op.parent_id,request_id:op.request_id}))).failure,'NOT_FOUND');
   await visibility(a,kind,'friends');assert.equal(ok(await call(b,'create',commentArgs('create',op))).replayed,true);assert.deepEqual(await rows(op),{comments:1,receipts:1});
  });
 }
 await check('same operation across distinct local families creates one row and receipt',async()=>{
  const op=operation('board');await b.query('begin');ok(await call(b,'create',commentArgs('create',op)));const args=commentArgs('create',op);args.access.token_hash='f'.repeat(64);const wait=call(c,'create',args);await waitLock(c);await b.query('commit');assert.equal(ok(await wait).replayed,true);assert.deepEqual(await rows(op),{comments:1,receipts:1});
 });
 await check('logout first blocks write; write first makes logout wait and prevents next receipt lookup',async()=>{
  let op=operation('diary');await c.query('begin');await revoke(c);const wait=call(b,'create',commentArgs('create',op));await waitLock(b);await c.query('commit');assert.equal((await wait).failure,'SESSION_REVOKED');assert.deepEqual(await rows(op),{comments:0,receipts:0});
  await pool.query('update private.member_writing_sessions set revoked_at=null;update private.member_writing_families set revoked_at=null');op=operation('diary');await b.query('begin');ok(await call(b,'create',commentArgs('create',op)));const out=revoke(c);await waitLock(c);await b.query('commit');await out;assert.equal((await call(b,'operations',commentArgs('operations',{kind:'diary',parent_id:op.parent_id,request_id:op.request_id}))).failure,'SESSION_REVOKED');
 });
 await check('deadline crossed during mutation rolls back comment, quota and receipt together',async()=>{
  await pool.query("create function private.slow_comment_fixture() returns trigger language plpgsql as $$begin perform pg_sleep(0.7);return new;end;$$;create trigger slow_comment_fixture after insert on public.post_comments for each row execute function private.slow_comment_fixture()");
  const op=operation('board'),args=commentArgs('create',op);args.access.deadline=new Date(Date.now()+400).toISOString();assert.equal((await call(b,'create',args)).failure,'READ_CONTEXT_EXPIRED');assert.deepEqual(await rows(op),{comments:0,receipts:0});assert.equal((await pool.query('select count(*)::int n from private.member_writing_limits')).rows[0].n,0);
  await pool.query('drop trigger slow_comment_fixture on public.post_comments;drop function private.slow_comment_fixture()');ok(await call(b,'create',commentArgs('create',op)));
 });
 await check('local anonymous author cannot edit friend-parent comment; owner may delete it',async()=>{
  const row=(await pool.query('select id,revision from public.post_comments where board_post_id=$1 and author_id=$2',[post('board',1),visitor])).rows[0];
  const d=await pool.connect();try{await d.query('set role authenticated');await d.query("select set_config('request.jwt.claim.sub',$1,false)",[visitor]);assert.equal((await d.query("update public.post_comments set body='forbidden' where id=$1 returning id",[row.id])).rows.length,0);}finally{await d.query('reset role');d.release();}
  const op={kind:'board',parent_id:post('board',1),id:row.id,revision:row.revision,request_id:randomUUID()};assert.equal(ok(await call(b,'delete',commentArgs('delete',op,'owner'))).deleted,true);
 });
 await pool.query("create role authenticator login;grant service_role to authenticator;alter role authenticator set statement_timeout='8s'");
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const restPort=server.address().port;await new Promise(r=>server.close(r));
 restContainer=execFileSync('docker',['run','--rm','-d','--network','host','-e',`PGRST_DB_URI=postgres://authenticator@127.0.0.1:${port}/postgres`,'-e','PGRST_DB_SCHEMAS=public','-e','PGRST_SERVER_HOST=127.0.0.1','-e','PGRST_DB_ANON_ROLE=service_role','-e',`PGRST_SERVER_PORT=${restPort}`,'public.ecr.aws/supabase/postgrest:v14.5'],{encoding:'utf8'}).trim();
 const base=`http://127.0.0.1:${restPort}`;for(let i=0;;i++){try{if((await fetch(base)).ok)break;}catch{}if(i>100)throw Error('PostgREST startup');await sleep(100);}
 await check('PostgREST three-second statement timeout rolls back delayed write and receipt',async()=>{
  await pool.query("create function private.slow_comment_fixture() returns trigger language plpgsql as $$begin perform pg_sleep(5);return new;end;$$;create trigger slow_comment_fixture after insert on public.post_comments for each row execute function private.slow_comment_fixture()");
  const op=operation('board'),start=performance.now();const response=await fetch(base+'/rpc/member_content_comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_action:'create',p_args:commentArgs('create',op)}),signal:AbortSignal.timeout(10000)}),data=await response.json(),elapsed=performance.now()-start;
  assert.equal(data.code,'57014',JSON.stringify(data));assert.ok(elapsed>=2700&&elapsed<4500,'elapsed '+elapsed);assert.deepEqual(await rows(op),{comments:0,receipts:0});assert.equal((await pool.query('select count(*)::int n from private.member_writing_limits')).rows[0].n,0);console.log('PostgREST timeout ms: '+elapsed);
  await pool.query('drop trigger slow_comment_fixture on public.post_comments;drop function private.slow_comment_fixture()');
 });
 console.log(`All ${groups} independent PostgreSQL/PostgREST friend comment groups passed; no hosted writes.`);
}finally{
 if(restContainer)execFileSync('docker',['rm','-f',restContainer],{stdio:'ignore'});
 for(const client of [a,b,c].filter(Boolean)){await client.query('rollback').catch(()=>{});client.release();}await fixture?.pg.close();await pool?.end();execFileSync('docker',['rm','-f',container],{stdio:'ignore'});
}
