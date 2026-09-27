import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {handleMemberWriting,tokenHash} from '../supabase/functions/member-writing/handler.js';
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const site=id(1),member=id(2),sid=id(3),proof=id(4),token='a'.repeat(43),centralUrl='https://central.test',origin='https://a.test',project='https://aaaaaaaaaaaaaaaaaaaa.supabase.co';
const {pg,db}=await memberWritingDb(PGlite,{siteId:site,centralUrl});
const migration=await readFile(new URL('../supabase/migrations/202609260001_guestbook_rate_limits.sql',import.meta.url),'utf8');
let serial=10;
try {
 await pg.exec(migration);
 const expiry=new Date(Date.now()+600000).toISOString();
 const session=await db.rpc('member_writing_session',{p_action:'create',p_args:{site_id:site,member_id:member,central_session_id:sid,proof_id:proof,token_hash:await tokenHash(token),central_grant:'g'.repeat(43),display_name:'Alice',homepage_url:origin,expires_at:expiry}});
 assert.equal(session.error,null);
 const config={MINIHOMPY_SITE_ORIGIN:origin,MINIHOMPY_SITE_ID:site,MINIHOMPY_CENTRAL_API_URL:centralUrl,SUPABASE_URL:project};
 const fetcher=async()=>Response.json({active:true,site_id:site,member:{id:member,display_name:'Alice',homepage_url:origin},central_session_id:sid,proof_id:proof,expires_at:expiry});
 const fresh=()=>({id:id(++serial),request_id:id(++serial),body:'test',visibility:'public'});
 async function send(body){return handleMemberWriting(new Request(project+'/functions/v1/member-writing/guestbook',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token,'X-Minihompy-Auth-Mode':'member','Content-Type':'application/json'},body:JSON.stringify(body)}),{db,config,fetcher});}
 const first=fresh();assert.equal((await send(first)).status,200);
 const blocked=await send(fresh());assert.equal(blocked.status,429);assert.equal(blocked.headers.get('Retry-After'),'10');assert.equal((await blocked.json()).error.limit_reason,'guestbook_cooldown');
 assert.equal((await (await send(first)).json()).replayed,true);
 await pg.exec("update private.member_writing_limits set last_write=clock_timestamp()-interval '10 seconds'");
 assert.equal((await send(fresh())).status,200); // No remaining one-minute restriction.
 await pg.exec("update private.member_writing_limits set writes=20,window_start=clock_timestamp()-interval '22 hours 58 minutes 59 seconds'");
 const daily=await send(fresh());assert.equal(daily.status,429);const dailyError=(await daily.json()).error;
 assert.equal(dailyError.limit_reason,'guestbook_daily');assert.ok(dailyError.retry_after>=3660&&dailyError.retry_after<=3661);assert.equal(Number(daily.headers.get('Retry-After')),dailyError.retry_after);
 await pg.exec('delete from public.guestbook_posts');assert.equal((await send(fresh())).status,429);
 assert.equal((await pg.query("select writes from private.member_writing_limits where kind='guestbook'")).rows[0].writes,20);
 await pg.exec("update private.member_writing_limits set window_start=clock_timestamp()-interval '24 hours',last_write=clock_timestamp()-interval '10 seconds'");
 assert.equal((await send(fresh())).status,200);assert.equal((await pg.query("select writes from private.member_writing_limits where kind='guestbook'")).rows[0].writes,1);
 console.log('PASS member SQL + HTTP: 10-second boundary, idempotency, daily precedence, Retry-After, deletion resistance, window reset');
 // Legacy anonymous writes use the same policy through the database trigger.
 const local=id(99);await pg.query('insert into auth.users values($1)',[local]);
 async function localWrite(){await pg.exec('set role authenticated');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[local]);try{return await pg.exec("insert into public.guestbook_posts(id,author_name,body) values(gen_random_uuid(),'visitor','test')");}finally{await pg.exec('reset role');}}
 await localWrite();await assert.rejects(localWrite(),/10초에 1개.*초 후/);
 await pg.exec("update private.guestbook_write_limits set last_write=clock_timestamp()-interval '10 seconds'");await localWrite();
 await pg.exec("update private.guestbook_write_limits set writes=20,window_start=clock_timestamp()-interval '22 hours 58 minutes 59 seconds'");await assert.rejects(localWrite(),/24시간.*20개.*1시간 2분/);
 console.log('PASS legacy SQL: 10-second cooldown and daily hours/minutes message');
 const sandbox={URL,crypto,btoa,TextEncoder,AbortSignal};vm.runInNewContext(await readFile(new URL('../member-writing-client.js',import.meta.url),'utf8'),sandbox);
 for(const [reason,seconds,pattern] of [['guestbook_cooldown',7,/10초에 1개.*7초 후/],['guestbook_daily',3661,/24시간.*20개.*1시간 2분/],['guestbook_daily',1,/0시간 1분/],['guestbook_daily',86400,/24시간 0분/],[undefined,5,/작성 횟수 제한/]]){
  const client=sandbox.createMinihompyMemberWriting({apiUrl:project+'/functions/v1/member-writing',siteId:site,storage:{getItem:()=>token},fetcher:async()=>Response.json({error:{code:'RATE_LIMITED',limit_reason:reason,retry_after:seconds}},{status:429,headers:{'Retry-After':String(seconds)}})});
  await assert.rejects(client.content('/guestbook',{method:'POST',body:fresh()}),e=>e.status===429&&e.retryAfter===seconds&&pattern.test(e.message));
 }
 console.log('PASS client: seconds, rounded hours/minutes, 24-hour maximum, generic limit fallback');
} finally {await pg.close();}
