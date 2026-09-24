import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import pg from '../../minihompy-central/node_modules/pg/lib/index.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {site,owner,tokenHash,post,photoPath,seed,activate,request,canonical} from './helpers/friend-visibility-fixture.mjs';
const container=execFileSync('docker',['run','--rm','-d','-e','POSTGRES_HOST_AUTH_METHOD=trust','-p','127.0.0.1::5432','postgres:16-alpine'],{encoding:'utf8'}).trim();
let pool,fixture,a,b,groups=0;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const args=()=>{const x=request('member','read',{post_id:post('photos',1),path:photoPath(1)});x.context.request_hash=createHash('sha256').update(canonical({protocol:1,mode:'member',scope:'visible',action:'photo.read',selectors:x.selectors})).digest('hex');return x;};
const read=async(c,x=args())=>(await c.query("select public.member_photo_read('read',$1) r",[x])).rows[0].r;
const visibility=v=>a.query('update public.photo_posts set visibility=$1 where id=$2',[v,post('photos',1)]);
const waitLock=async c=>{for(let i=0;i<200;i++){if((await pool.query('select wait_event_type from pg_stat_activity where pid=$1',[c.processID])).rows[0]?.wait_event_type==='Lock')return;await sleep(10);}throw Error('Expected lock wait');};
const check=async(name,fn)=>{await fn();console.log(`PASS ${++groups}: ${name}`);};
try{
 const port=Number(execFileSync('docker',['port',container,'5432'],{encoding:'utf8'}).trim().split(':').at(-1)),cfg={host:'127.0.0.1',port,user:'postgres',database:'postgres'};
 pool=new pg.Pool(cfg);for(let i=0;;i++){try{await pool.query('select 1');break;}catch(e){if(i>100)throw e;await sleep(100);}}
 class Adapter{constructor(){this.client=new pg.Client(cfg);this.ready=this.client.connect();}async query(s,args){await this.ready;return this.client.query(s,args);}exec(s){return this.query(s);}close(){return this.client.end();}}
 fixture=await memberWritingDb(Adapter,{siteId:site,centralUrl:'https://central.test/api',photoMedia:true,friendVisibility:true});await seed(pool);await activate(pool);
 a=await pool.connect();b=await pool.connect();await a.query('set role authenticated');await a.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await b.query("set role service_role;set statement_timeout='6s'");
 await check('service-only ACL and hash binding; forged site/path/mode denied',async()=>{
  for(const role of ['anon','authenticated']){await pool.query('set role '+role);await assert.rejects(read(pool),e=>e.code==='42501');await pool.query('reset role');}
  let x=args();x.selectors.path=photoPath(0);assert.equal((await read(b,x)).failure,'BAD_REQUEST');x=args();x.context.site_id=owner;assert.equal((await read(b,x)).failure,'TARGET_MISMATCH');x=args();x.mode='owner';assert.equal((await read(b,x)).failure,'BAD_REQUEST');assert.equal((await read(b)).path,photoPath(1));
 });
 await check('privacy first blocks pending metadata; read first holds parent until transaction ends',async()=>{
  await a.query('begin');await visibility('private');const p=read(b);await waitLock(b);await a.query('commit');assert.equal((await p).failure,'NOT_FOUND');await visibility('friends');
  await b.query('begin');assert.equal((await read(b)).path,photoPath(1));const hide=visibility('private');await waitLock(a);await b.query('commit');await hide;assert.equal((await read(b)).failure,'NOT_FOUND');await visibility('friends');
 });
 await check('asset unlink first removes path entitlement even when file still exists',async()=>{
  await a.query('begin');await a.query('delete from public.photo_posts where id=$1',[post('photos',1)]);const p=read(b);await waitLock(b);await a.query('commit');assert.equal((await p).failure,'NOT_FOUND');
 });
 await check('local logout wins before metadata authorization and stale context expires while waiting',async()=>{
  const c=await pool.connect();try{await c.query('begin');await c.query("select public.member_writing_session('revoke',$1)",[{site_id:site,token_hash:tokenHash}]);const p=read(b);await waitLock(b);await c.query('commit');assert.equal((await p).failure,'SESSION_REVOKED');}finally{c.release();}
  await pool.query('update private.member_writing_sessions set revoked_at=null;update private.member_writing_families set revoked_at=null');await a.query('begin');await a.query('select pg_advisory_xact_lock(240001,2)');const x=args();x.deadline=new Date(Date.now()+200).toISOString();const p=read(b,x);await waitLock(b);await sleep(300);await a.query('commit');assert.equal((await p).failure,'READ_CONTEXT_EXPIRED');
 });
 console.log(`All ${groups} independent PostgreSQL photo authorization groups passed; disposable local DB only.`);
}finally{for(const c of [a,b].filter(Boolean)){await c.query('rollback').catch(()=>{});c.release();}await fixture?.pg.close();await pool?.end();execFileSync('docker',['rm','-f',container],{stdio:'ignore'});}
