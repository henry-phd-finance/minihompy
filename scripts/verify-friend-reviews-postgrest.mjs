// Isolated PostgREST 14.5 boundary with actual relationship permits and personal RPC. No hosted writes.
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
const load=p=>import(pathToFileURL(resolve('../minihompy-central',p)));
const {default:pg}=await load('node_modules/pg/lib/index.js');
const {member,site,session,seedRelationships,grantFor,rpc,command}=await load('scripts/helpers/relationship-fixture.mjs');
const container=execFileSync('docker',['run','--rm','-d','-e','POSTGRES_HOST_AUTH_METHOD=trust','-p','127.0.0.1::5432','postgres:16-alpine'],{encoding:'utf8'}).trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),hash=s=>createHash('sha256').update(s).digest('hex');
let restContainer;
let cp,pp,fixture,ca,cb,pa,pb,grants={},groups=0,relation;
const ok=r=>{assert.ok(!r.failure,JSON.stringify(r));return r;};
const central=(c,n,action,args={})=>rpc(c,action,{...grants[n],...args});
const local=async(c,action,args)=>(await c.query('select public.member_friend_reviews($1,$2) result',[action,{site_id:site(2),mode:'member',token_hash:hash('token'),checked_at:new Date().toISOString(),...args}])).rows[0].result;
const revoke=c=>c.query("select public.member_writing_session('revoke',$1)",[{site_id:site(2),token_hash:hash('token')}]);
async function waitLock(pool,c){for(let i=0;i<200;i++){if((await pool.query('select wait_event_type from pg_stat_activity where pid=$1',[c.processID])).rows[0]?.wait_event_type==='Lock')return;await sleep(10);}throw Error('Expected observed lock wait');}
async function reset(){
 await cp.query('truncate private.identity_relationships,private.identity_relationship_operations,private.identity_review_permits,private.identity_relationship_limits,private.identity_relationship_cooldowns');
 await pp.query('truncate private.friend_reviews,private.friend_review_operations,private.friend_review_limits');
 await pp.query("update private.member_writing_sessions set revoked_at=null,expires_at=clock_timestamp()+interval '10 minutes';update private.member_writing_families set revoked_at=null,expires_at=clock_timestamp()+interval '1 day'");
 const pending=ok(await central(ca,1,'actions',command(2,'request',0))).relationship;
 relation=ok(await central(cb,2,'actions',command(1,'accept',pending.revision,pending.request_id))).relationship;
}
const disconnect=c=>central(c,2,'actions',command(1,'disconnect',relation.revision,relation.request_id));
const permit=(c=ca,b={operation_id:randomUUID(),body:'경합 평'})=>central(c,1,'review-permits',{operation_id:b.operation_id,body_sha256:hash(b.body)}).then(p=>({...b,permit:ok(p)}));
async function check(name,fn){await reset();await fn();console.log(`PASS ${++groups}: ${name}`);}
try{
 const port=Number(execFileSync('docker',['port',container,'5432'],{encoding:'utf8'}).trim().split(':').at(-1));const config={host:'127.0.0.1',port,user:'postgres',database:'postgres'};
 cp=new pg.Pool({...config,max:6});for(let i=0;;i++){try{await cp.query('select 1');break;}catch(e){if(i>=100)throw e;await sleep(100);}}
 await cp.query('create role anon;create role authenticated;create role service_role bypassrls');
 for(const file of ['202609180001_identity.sql','202609190001_fix_private_schema_permissions.sql','202609230001_verified_identity.sql','202609230002_member_writing.sql','202609230003_member_navigation.sql','202609230004_member_sessions.sql','202609240001_member_relationships.sql'])await cp.query(await readFile(resolve('../minihompy-central/supabase/migrations',file),'utf8'));
 await seedRelationships(cp,3);for(let n=1;n<=3;n++)grants[n]=await grantFor(cp,n);
 await cp.query('create database personal');const personalConfig={...config,database:'personal'};pp=new pg.Pool({...personalConfig,max:6});
 class Adapter{constructor(){this.client=new pg.Client(personalConfig);this.ready=this.client.connect();}async query(sql,args){await this.ready;return this.client.query(sql,args);}exec(sql){return this.query(sql.replace('create role anon;create role authenticated;create role service_role bypassrls;',''));}async close(){await this.client.end();}}
 fixture=await memberWritingDb(Adapter,{siteId:site(2),centralUrl:'https://central.test/api',folders:false});
 await pp.query(await readFile(new URL('../supabase/migrations/202609240006_friend_reviews.sql',import.meta.url),'utf8'));
 await pp.query("select public.member_writing_session('create_v2',$1)",[{site_id:site(2),member_id:member(1),central_session_id:session(1),proof_id:randomUUID(),token_hash:hash('token'),central_grant:'g'.repeat(43),display_name:'Writer',homepage_url:'https://m1.test/home/',expires_at:new Date(Date.now()+600000).toISOString(),renewal_hash:hash('renewal'),central_delegation:'d'.repeat(43),renewal_expires_at:new Date(Date.now()+86400000).toISOString()}]);
 await pp.query("select public.member_writing_session('create_v2',$1)",[{site_id:site(2),member_id:member(1),central_session_id:session(1),proof_id:randomUUID(),token_hash:hash('token2'),central_grant:'h'.repeat(43),display_name:'Writer',homepage_url:'https://m1.test/home/',expires_at:new Date(Date.now()+600000).toISOString(),renewal_hash:hash('renewal2'),central_delegation:'e'.repeat(43),renewal_expires_at:new Date(Date.now()+86400000).toISOString()}]);
 ca=await cp.connect();cb=await cp.connect();pa=await pp.connect();pb=await pp.connect();
 for(const c of [ca,cb,pa,pb])await c.query("set role service_role;set statement_timeout='5s';set lock_timeout='5s'");
 // Match hosted authenticator defaults. PostgREST must hoist the RPC's 5s
 // proconfig; relying only on a fetch AbortController is insufficient.
 await pp.query("create role authenticator login;grant service_role to authenticator;alter role authenticator set statement_timeout='8s';alter role authenticator set lock_timeout='8s'");
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const restPort=server.address().port;await new Promise(r=>server.close(r));
 restContainer=execFileSync('docker',['run','--rm','-d','--network','host','-e',`PGRST_DB_URI=postgres://authenticator@127.0.0.1:${port}/personal`,'-e','PGRST_DB_SCHEMAS=public','-e','PGRST_SERVER_HOST=127.0.0.1','-e','PGRST_DB_ANON_ROLE=service_role','-e',`PGRST_SERVER_PORT=${restPort}`,'public.ecr.aws/supabase/postgrest:v14.5'],{encoding:'utf8'}).trim();
 const base=`http://127.0.0.1:${restPort}`;
 for(let i=0;;i++){try{const r=await fetch(base);if(r.ok)break;}catch{}if(i>100)throw Error('PostgREST startup');await sleep(100);}
 async function httpSave(b){const r=await fetch(base+'/rpc/member_friend_reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_action:'create',p_args:{site_id:site(2),mode:'member',token_hash:hash('token'),checked_at:new Date().toISOString(),...b}}),signal:AbortSignal.timeout(12000)});return {status:r.status,data:await r.json()};}
 await check('PostgREST completes actual review RPC with service_role',async()=>{const b=await permit();const r=await httpSave(b);assert.equal(r.status,200);assert.ok(r.data.id);});
 await check('PostgREST lock wait fails near five seconds, with no delayed write after release',async()=>{
 const b=await permit();await pa.query('begin');await pa.query("select public.member_writing_session('current',$1)",[{site_id:site(2),token_hash:hash('token')}]);
 const start=Date.now(),r=await httpSave(b),elapsed=Date.now()-start;assert.ok([500,503].includes(r.status));assert.ok(['57014','55P03'].includes(r.data.code));assert.ok(elapsed>=4500&&elapsed<7000,'elapsed '+elapsed);await pa.query('rollback');await sleep(700);assert.equal((await pp.query('select count(*)::int n from private.friend_reviews')).rows[0].n,0);console.log('HTTP lock bound ms: '+elapsed);
 });
 await check('PostgREST statement timeout hoists five seconds and rolls back content/receipt',async()=>{
 const b=await permit();await pp.query("create function private.slow_review_fixture() returns trigger language plpgsql as $$begin perform pg_sleep(7);return new;end;$$;create trigger slow_review_fixture after insert on private.friend_reviews for each row execute function private.slow_review_fixture()");
 const start=Date.now(),r=await httpSave(b),elapsed=Date.now()-start;assert.equal(r.data.code,'57014');assert.ok(elapsed>=4500&&elapsed<6500,'elapsed '+elapsed);await sleep(2500);assert.equal((await pp.query('select count(*)::int n from private.friend_reviews')).rows[0].n,0);assert.equal((await pp.query('select count(*)::int n from private.friend_review_operations')).rows[0].n,0);await pp.query('drop trigger slow_review_fixture on private.friend_reviews;drop function private.slow_review_fixture()');console.log('HTTP statement bound ms: '+elapsed);
 });
 console.log(`All ${groups} isolated PostgREST 14.5 groups passed.`);
}finally{
 if(restContainer)execFileSync('docker',['rm','-f',restContainer],{stdio:'ignore'});
 for(const c of [ca,cb,pa,pb])if(c){await c.query('rollback').catch(()=>{});c.release();}
 await fixture?.pg.close();await cp?.end();await pp?.end();execFileSync('docker',['rm','-f',container],{stdio:'ignore'});
}
