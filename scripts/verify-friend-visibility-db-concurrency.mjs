import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHmac} from 'node:crypto';
import {createServer} from 'node:net';
import pg from '../../minihompy-central/node_modules/pg/lib/index.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {site,owner,visitor,tokenHash,tables,post,request,seed,activate} from './helpers/friend-visibility-fixture.mjs';
const container=execFileSync('docker',['run','--rm','-d','-e','POSTGRES_HOST_AUTH_METHOD=trust','-p','127.0.0.1::5432','postgres:16-alpine'],{encoding:'utf8'}).trim();
let pool,fixture,a,b,c,restContainer,groups=0;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ok=r=>{assert.ok(!r.failure,JSON.stringify(r));return r;};
const read=async(client,kind='board',args=request('member','detail',{kind,id:post(kind,1)}))=>(await client.query("select public.member_content_read('detail',$1) r",[args])).rows[0].r;
const revoke=client=>client.query("select public.member_writing_session('revoke',$1)",[{site_id:site,token_hash:tokenHash}]);
const visibility=(client,kind,v)=>client.query('update public.'+tables[kind]+' set visibility=$1 where id=$2',[v,post(kind,1)]);
async function waitLock(client){for(let i=0;i<200;i++){if((await pool.query('select wait_event_type from pg_stat_activity where pid=$1',[client.processID])).rows[0]?.wait_event_type==='Lock')return;await sleep(10);}throw Error('Expected lock wait');}
async function check(name,fn){await pool.query('update private.friend_visibility_state set ready=true');await pool.query('update private.member_writing_sessions set revoked_at=null;update private.member_writing_families set revoked_at=null');for(const kind of Object.keys(tables))await visibility(a,kind,'friends');await fn();console.log(`PASS ${++groups}: ${name}`);}
try{
 const port=Number(execFileSync('docker',['port',container,'5432'],{encoding:'utf8'}).trim().split(':').at(-1));const cfg={host:'127.0.0.1',port,user:'postgres',database:'postgres'};
 pool=new pg.Pool({...cfg,max:6});for(let i=0;;i++){try{await pool.query('select 1');break;}catch(e){if(i>100)throw e;await sleep(100);}}
 class Adapter{constructor(){this.client=new pg.Client(cfg);this.ready=this.client.connect();}async query(sql,args){await this.ready;return this.client.query(sql,args);}exec(sql){return this.query(sql);}async close(){await this.client.end();}}
 fixture=await memberWritingDb(Adapter,{siteId:site,centralUrl:'https://central.test/api',photoMedia:true});await seed(fixture.pg);await pool.query(await readFile(new URL('../supabase/migrations/202609240007_friend_visibility.sql',import.meta.url),'utf8'));for(const file of ['202609240008_friend_comments.sql','202609240009_friend_photo_media.sql','202609240010_friend_aggregates.sql','202609240011_friend_diary_filters.sql'])await pool.query(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));await activate(pool);
 a=await pool.connect();b=await pool.connect();c=await pool.connect();await a.query('set role authenticated');await a.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);for(const client of [b,c])await client.query("set role service_role;set statement_timeout='6s'");
 for(const kind of Object.keys(tables)){
  await check(kind+': committed private transition wins over blocked friend detail',async()=>{
   await a.query('begin');await visibility(a,kind,'private');const wait=read(b,kind);await waitLock(b);await a.query('commit');assert.equal((await wait).failure,'NOT_FOUND');
  });
  await check(kind+': detail first makes visibility change wait; next detail denies',async()=>{
   await b.query('begin');ok(await read(b,kind));const wait=visibility(a,kind,'private');await waitLock(a);await b.query('commit');await wait;assert.equal((await read(b,kind)).failure,'NOT_FOUND');
  });
 }
 await check('family logout before read denies; read before logout serializes without inverted locks',async()=>{
  await c.query('begin');await revoke(c);const wait=read(b);await waitLock(b);await c.query('commit');assert.equal((await wait).failure,'SESSION_REVOKED');
  await pool.query('update private.member_writing_sessions set revoked_at=null;update private.member_writing_families set revoked_at=null');
  await b.query('begin');ok(await read(b));const out=revoke(c);await waitLock(c);await b.query('commit');await out;assert.equal((await read(b)).failure,'SESSION_REVOKED');
 });
 await check('request expires while waiting for parent: late result discarded',async()=>{
  await a.query('begin');await visibility(a,'board','friends');const args=request('member','detail',{kind:'board',id:post('board',1)});args.deadline=new Date(Date.now()+400).toISOString();
  const wait=read(b,'board',args);await waitLock(b);await sleep(500);await a.query('commit');assert.equal((await wait).failure,'READ_CONTEXT_EXPIRED');
 });
 await check('readiness shutdown wins over waiting save and member read; owner cleanup remains',async()=>{
  const admin=await pool.connect();try{
   await admin.query('begin');await admin.query('update private.friend_visibility_state set ready=false');
   const save=visibility(a,'board','friends').then(()=>({}),e=>({code:e.code,message:e.message}));await waitLock(a);await admin.query('commit');assert.match((await save).message,/NOT_CONFIGURED/);
   assert.equal((await read(b)).failure,'NOT_CONFIGURED');await visibility(a,'board','private');ok(await read(b,'board',request('owner','detail',{kind:'board',id:post('board',1)})));
  }finally{await admin.query('rollback');admin.release();}
 });
 await check('concurrent admin metadata changes use version checks and retry receipts',async()=>{
  const d=await pool.connect();try{await d.query('set role authenticated');await d.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
   const rev=(await a.query('select updated_at::text v from public.board_posts where id=$1',[post('board',1)])).rows[0].v;
   const args=[post('board',1),rev,randomUUID()];const set=(client,v,op=args[2])=>client.query("select public.set_content_visibility('board',$1,$2,$3,$4) r",[args[0],v,args[1],op]).then(r=>r.rows[0].r);
   await a.query('begin');ok(await set(a,'private'));const wait=set(d,'public',randomUUID());await waitLock(d);await a.query('commit');assert.equal((await wait).failure,'REVISION_CONFLICT');assert.equal((await set(d,'private')).replayed,true);
  }finally{await d.query('rollback');await d.query('reset role');d.release();}
 });
 await check('revoked local admin cannot pass owner mode after waiting',async()=>{
  const d=await pool.connect();try{await d.query('begin');await d.query('delete from private.minihompy_admins where user_id=$1',[owner]);const wait=read(b,'board',request('owner','detail',{kind:'board',id:post('board',1)}));await waitLock(b);await d.query('commit');assert.equal((await wait).failure,'FORBIDDEN');}finally{await d.query('rollback');await d.query('reset role');d.release();}
 });
 const jwtSecret='fixture-only-friend-visibility-secret-at-least-32';
 await pool.query("create role authenticator login;grant anon,authenticated,service_role to authenticator");
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const restPort=server.address().port;await new Promise(r=>server.close(r));
 restContainer=execFileSync('docker',['run','--rm','-d','--network','host','-e',`PGRST_DB_URI=postgres://authenticator@127.0.0.1:${port}/postgres`,'-e','PGRST_DB_SCHEMAS=public','-e','PGRST_SERVER_HOST=127.0.0.1','-e','PGRST_DB_ANON_ROLE=anon','-e',`PGRST_JWT_SECRET=${jwtSecret}`,'-e',`PGRST_SERVER_PORT=${restPort}`,'public.ecr.aws/supabase/postgrest:v14.5'],{encoding:'utf8'}).trim();
 const base=`http://127.0.0.1:${restPort}`;for(let i=0;;i++){try{if((await fetch(base)).ok)break;}catch{}if(i>100)throw Error('PostgREST startup');await sleep(100);}
 const head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),payload=Buffer.from(JSON.stringify({role:'service_role',exp:Math.floor(Date.now()/1000)+300})).toString('base64url'),message=head+'.'+payload;
 const serviceJwt=message+'.'+createHmac('sha256',jwtSecret).update(message).digest('base64url');
 const http=async(path,body,service=false)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(service?{Authorization:'Bearer '+serviceJwt}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});return {status:r.status,body:await r.json()};};
 // Prior owner-revocation scenario intentionally leaves admin absent; these checks use public/member only.
 await check('actual PostgREST denies browser RPC forgery and direct protected rows; service RPC returns filtered page',async()=>{
  for(const table of Object.values(tables)){const r=await http('/'+table+'?select=id');assert.equal(r.status,200);assert.equal(r.body.length,1);}
  for(const rpcName of ['member_content_read','friend_visibility_status']){
   const r=await http('/rpc/'+rpcName,rpcName==='member_content_read'?{p_action:'list',p_args:request()}:{});assert.ok([401,403,404].includes(r.status),JSON.stringify(r));
  }
  const allowed=await http('/rpc/member_content_read',{p_action:'list',p_args:request()},true);assert.equal(allowed.status,200);assert.equal(allowed.body.data.count,2);assert.equal(allowed.body.data.items.length,2);
  const detail=await http('/board_posts?id=eq.'+post('board',1)+'&select=*');assert.deepEqual(detail.body,[]);
  const comments=await http('/post_comments?board_post_id=eq.'+post('board',1)+'&select=*');assert.deepEqual(comments.body,[]);
 });
 console.log(`All ${groups} independent personal PostgreSQL concurrency groups passed; no hosted changes.`);
}finally{
 if(restContainer)execFileSync('docker',['rm','-f',restContainer],{stdio:'ignore'});
 for(const client of [a,b,c].filter(Boolean)){await client.query('rollback').catch(()=>{});client.release();}await fixture?.pg.close();await pool?.end();execFileSync('docker',['rm','-f',container],{stdio:'ignore'});
}
