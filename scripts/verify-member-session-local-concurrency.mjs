// Disposable PostgreSQL fixture; no hosted credentials or project connection.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
const {default:pg}=await import(pathToFileURL(resolve(process.env.MINIHOMPY_CENTRAL_ROOT||'../minihompy-central','node_modules/pg/lib/index.js')));
const container=execFileSync('docker',['run','--rm','-d','-e','POSTGRES_HOST_AUTH_METHOD=trust','-p','127.0.0.1::5432','postgres:16-alpine'],{encoding:'utf8'}).trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let pool,fixture;const clients=[];
const id=n=>`50000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const site=id(1),member=id(2),sid=id(3),proof=id(4),renewal='f'.repeat(64);
try{
 const port=Number(execFileSync('docker',['port',container,'5432'],{encoding:'utf8'}).trim().split(':').at(-1));
 const config={host:'127.0.0.1',port,user:'postgres',database:'postgres'};pool=new pg.Pool({...config,max:6});
 for(let i=0;;i++){try{await pool.query('select 1');break;}catch(e){if(i>100)throw e;await sleep(100);}}
 class Adapter{
  constructor(){this.client=new pg.Client(config);this.ready=this.client.connect();}
  async query(sql,args){await this.ready;return this.client.query(sql,args);}
  exec(sql){return this.query(sql);}
  async close(){await this.client.end();}
 }
 fixture=await memberWritingDb(Adapter,{siteId:site,centralUrl:'https://central.test/api',renewal:false});
 const args={site_id:site,member_id:member,central_session_id:sid,proof_id:proof,display_name:'Alice',homepage_url:'https://a.test/home/',expires_at:new Date(Date.now()+600000).toISOString()};
 const call=async(c,action,args)=>(await c.query('select public.member_writing_session($1,$2) result',[action,args])).rows[0].result;
 const old=await call(pool,'create',{...args,token_hash:'1'.repeat(64),central_grant:'a'.repeat(43)});assert.ok(old.id);
 await pool.query(await readFile(new URL('../supabase/migrations/202609230009_member_session_renewal.sql',import.meta.url),'utf8'));
 const stored=(await pool.query('select * from private.member_writing_sessions where id=$1',[old.id])).rows[0];delete stored.family_id;
 // pg uses Date objects; compare serialized records at the same representation.
 for(const [key,value]of Object.entries(old))assert.equal(String(stored[key] instanceof Date?stored[key].toISOString():stored[key]),String(key.endsWith('_at')&&value?new Date(value).toISOString():value));
 assert.ok((await call(pool,'current',{site_id:site,token_hash:'1'.repeat(64)})).id);
 console.log('PASS: migration preserves existing v1 session and authorization');
 const created=await call(pool,'create_v2',{...args,proof_id:id(5),token_hash:'2'.repeat(64),central_grant:'b'.repeat(43),renewal_hash:renewal,central_delegation:'d'.repeat(43),renewal_expires_at:new Date(Date.now()+86400000).toISOString()});assert.ok(created.family_id);
 const a=await pool.connect(),b=await pool.connect();clients.push(a,b);
 const renewArgs={...args,proof_id:id(5),renewal_hash:renewal,token_hash:'3'.repeat(64),central_grant:'c'.repeat(43)};
 async function waitLock(pid){for(let i=0;i<100;i++){const r=await pool.query('select wait_event_type from pg_stat_activity where pid=$1',[pid]);if(r.rows[0]?.wait_event_type==='Lock')return;await sleep(10);}throw Error('expected PostgreSQL lock wait');}
 await a.query('begin');await call(a,'revoke',{site_id:site,token_hash:renewal});
 const pending=call(b,'renew_create',renewArgs);await waitLock(b.processID);await a.query('commit');assert.equal((await pending).failure,'SESSION_REVOKED');
 console.log('PASS: late renewal commit waits on local logout and is rejected');
 // Fixture-only reset to test the opposite lock order.
 await pool.query('update private.member_writing_families set revoked_at=null');
 await a.query('begin');const issued=await call(a,'renew_create',renewArgs);assert.ok(issued.id);
 const revoked=call(b,'revoke',{site_id:site,token_hash:renewal});await waitLock(b.processID);await a.query('commit');await revoked;
 assert.equal((await call(pool,'current',{site_id:site,token_hash:'3'.repeat(64)})).failure,'SESSION_REVOKED');
 console.log('PASS: logout after renewal revokes the newly inserted token');
 await pool.query('update private.member_writing_families set revoked_at=null');
 const both=await Promise.all([call(a,'renew_create',{...renewArgs,token_hash:'4'.repeat(64),central_grant:'e'.repeat(43)}),call(b,'renew_create',{...renewArgs,token_hash:'5'.repeat(64),central_grant:'g'.repeat(43)})]);assert.ok(both.every(x=>x.family_id===created.family_id));
 await call(pool,'revoke',{site_id:site,token_hash:renewal});
 assert.equal((await pool.query('select count(*)::int n from private.member_writing_sessions where family_id=$1 and revoked_at is null',[created.family_id])).rows[0].n,0);
 console.log('PASS: concurrent tokens stay in one family and revoke together');
 // Verify no deadlock from session introspection vs family-wide revoke.
 await pool.query('update private.member_writing_families set revoked_at=null;update private.member_writing_sessions set revoked_at=null');
 await a.query('begin');await call(a,'current',{site_id:site,token_hash:'4'.repeat(64)});
 const end=call(b,'revoke',{site_id:site,token_hash:renewal});await waitLock(b.processID);await a.query('commit');await end;
 console.log('PASS: current and revoke use consistent family-before-session lock order');
}finally{
 for(const c of clients){await c.query('rollback').catch(()=>{});c.release();}
 if(fixture)await fixture.pg.close();if(pool)await pool.end();execFileSync('docker',['rm','-f',container],{stdio:'ignore'});
}
