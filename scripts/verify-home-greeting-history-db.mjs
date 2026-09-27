import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
const {pg}=await memberWritingDb(PGlite,{writing:false}),owner='11000000-0000-4000-8000-000000000001',guest='11000000-0000-4000-8000-000000000002';
const rows=async()=> (await pg.query('select * from public.home_greeting_history order by recorded_at,id')).rows;
async function as(uid,fn){await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);await pg.exec('set role '+(uid?'authenticated':'anon'));try{return await fn();}finally{await pg.exec('reset role');}}
try{
 const before=(await pg.query('select * from public.minihompy_settings')).rows;
 await pg.exec(await readFile('supabase/migrations/202609270004_home_greeting_history.sql','utf8'));
 assert.deepEqual((await pg.query('select * from public.minihompy_settings')).rows,before);
 assert.equal((await rows()).length,1);assert.equal((await rows())[0].body,before[0].payload.profile.introduction);assert.equal((await rows())[0].is_initial,true);
 await pg.query('insert into auth.users values($1),($2)',[owner,guest]);await pg.query('insert into private.minihompy_admins values($1)',[owner]);
 for(const uid of [null,guest])await as(uid,async()=>{assert.equal((await rows()).length,1);await assert.rejects(pg.query("insert into public.home_greeting_history(body) values('forged')"));await assert.rejects(pg.query("update public.home_greeting_history set body='forged'"));if(uid)assert.equal((await pg.query('delete from public.home_greeting_history returning id')).rows.length,0);else await assert.rejects(pg.query('delete from public.home_greeting_history'));});
 await as(owner,async()=>{
  await pg.query("update public.minihompy_settings set payload=jsonb_set(payload,'{profile,introduction}',to_jsonb($1::text))",['인사말\n<script>text</script>']);assert.equal((await rows()).length,2);
  await pg.query('update public.minihompy_settings set payload=payload');assert.equal((await rows()).length,2);
  await pg.query("update public.minihompy_settings set payload=jsonb_set(payload,'{page,title}','\"다른 제목\"')");assert.equal((await rows()).length,2);
  assert.equal((await pg.query('update public.minihompy_settings set payload=payload where revision=1 returning id')).rows.length,0);assert.equal((await rows()).length,2);
  await assert.rejects(pg.query("update public.minihompy_settings set payload=jsonb_set(payload,'{profile,introduction}','null')"));assert.equal((await rows()).length,2);
  const saved=(await pg.query('select * from public.minihompy_settings')).rows,current=(await rows()).at(-1);
  assert.equal((await pg.query('delete from public.home_greeting_history where id=$1 returning id',[current.id])).rows.length,1);assert.deepEqual((await pg.query('select * from public.minihompy_settings')).rows,saved);
  await pg.query('update public.minihompy_settings set payload=payload');assert.equal((await rows()).length,1,'deleted history stays deleted on unrelated settings changes');
  await pg.query("update public.minihompy_settings set payload=jsonb_set(payload,'{profile,introduction}',to_jsonb($1::text))",['']);assert.equal((await rows()).length,2);assert.equal((await rows()).at(-1).body,'');
 });
 console.log('PASS: truthful baseline; automatic greeting-only history; public read; no browser insert/update; owner-only delete; unchanged current greeting; CAS/failed-save isolation and blank greetings.');
}finally{await pg.close();}
