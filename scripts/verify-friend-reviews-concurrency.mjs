// Two disposable PostgreSQL databases, actual central permits and personal storage, independent connections.
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
 await check('permit commits first, disconnect waits; personal store after disconnect succeeds within original deadline',async()=>{
  await ca.query('begin');const b=await permit(ca);const pending=disconnect(cb);await waitLock(cp,cb);await ca.query('commit');ok(await pending);assert.ok(ok(await local(pa,'create',b)).id);
  assert.equal((await central(cb,1,'review-permits',{operation_id:randomUUID(),body_sha256:hash('new')})).failure,'NOT_FRIENDS');
 });
 await check('disconnect commits first, waiting permit fails and personal DB remains empty',async()=>{
  await ca.query('begin');ok(await disconnect(ca));const waiting=central(cb,1,'review-permits',{operation_id:randomUUID(),body_sha256:hash('new')});await waitLock(cp,cb);await ca.query('commit');assert.equal((await waiting).failure,'NOT_FRIENDS');assert.equal((await pp.query('select count(*)::int n from private.friend_reviews')).rows[0].n,0);
 });
 await check('parallel retries across separate local families serialize to one content row and receipt',async()=>{
  const b=await permit();await pa.query('begin');const first=ok(await local(pa,'create',b));const waiting=local(pb,'create',{...b,token_hash:hash('token2')});await waitLock(pp,pb);await pa.query('commit');const second=ok(await waiting);assert.equal(second.id,first.id);assert.equal(second.replayed,true);assert.equal((await pp.query('select count(*)::int n from private.friend_reviews')).rows[0].n,1);
 });
 await check('same permit cannot authorize another operation even on competing connection',async()=>{
  const b=await permit();await pa.query('begin');ok(await local(pa,'create',b));const id=randomUUID();const waiting=local(pb,'create',{...b,operation_id:id,permit:{...b.permit,operation_id:id}});await waitLock(pp,pb);await pa.query('commit');assert.equal((await waiting).failure,'REQUEST_CONFLICT');
 });
 await check('logout first blocks final save after local family lock wait',async()=>{
  const b=await permit();await pa.query('begin');await revoke(pa);const waiting=local(pb,'create',b);await waitLock(pp,pb);await pa.query('commit');assert.equal((await waiting).failure,'SESSION_REVOKED');
 });
 await check('save first commits before logout; revoke keeps saved public history',async()=>{
  const b=await permit();await pa.query('begin');ok(await local(pa,'create',b));const waiting=revoke(pb);await waitLock(pp,pb);await pa.query('commit');await waiting;assert.equal((await pp.query('select count(*)::int n from private.friend_reviews')).rows[0].n,1);
 });
 await check('permit expires during family lock wait; deadline is checked after lock acquisition',async()=>{
  const b=await permit();b.permit.expires_at=new Date(Date.now()+700).toISOString();await pa.query('begin');await pa.query("select public.member_writing_session('current',$1)",[{site_id:site(2),token_hash:hash('token')}]);const waiting=local(pb,'create',b);await waitLock(pp,pb);await sleep(850);await pa.query('commit');assert.equal((await waiting).failure,'PERMIT_EXPIRED');
 });
 await check('delete commits before retry; retry returns tombstone and never resurrects content',async()=>{
  const b=await permit(),stored=ok(await local(pa,'create',b));await pa.query('begin');ok(await local(pa,'delete',{operation_id:randomUUID(),review_id:stored.id}));const waiting=local(pb,'create',b);await waitLock(pp,pb);await pa.query('commit');assert.equal(ok(await waiting).deleted,true);assert.equal((await pp.query('select count(*)::int n from private.friend_reviews')).rows[0].n,0);
 });
 await check('SQL failure after permit rolls back both content and receipt; same permit can retry',async()=>{
  const b=await permit();await pp.query("create function private.reject_review_fixture() returns trigger language plpgsql as $$begin raise exception 'fixture failure';end;$$;create trigger reject_review_fixture after insert on private.friend_reviews for each row execute function private.reject_review_fixture()");
  await assert.rejects(local(pa,'create',b));assert.equal((await pp.query('select count(*)::int n from private.friend_reviews')).rows[0].n,0);assert.equal((await pp.query('select count(*)::int n from private.friend_review_operations')).rows[0].n,0);await pp.query('drop trigger reject_review_fixture on private.friend_reviews;drop function private.reject_review_fixture()');assert.ok(ok(await local(pb,'create',b)).id);
 });
 await check('a blocked save is bounded by five-second database timeout and leaves no partial write',async()=>{
  const b=await permit();await pa.query('begin');await pa.query("select public.member_writing_session('current',$1)",[{site_id:site(2),token_hash:hash('token')}]);const start=Date.now();const waiting=local(pb,'create',b).then(()=>null,e=>e.code);await waitLock(pp,pb);assert.ok(['57014','55P03'].includes(await waiting));assert.ok(Date.now()-start<6500);await pa.query('rollback');assert.equal((await pp.query('select count(*)::int n from private.friend_reviews')).rows[0].n,0);
 });
 console.log(`All ${groups} independent PostgreSQL friend-review concurrency groups passed.`);
}finally{
 for(const c of [ca,cb,pa,pb])if(c){await c.query('rollback').catch(()=>{});c.release();}
 await fixture?.pg.close();await cp?.end();await pp?.end();execFileSync('docker',['rm','-f',container],{stdio:'ignore'});
}
