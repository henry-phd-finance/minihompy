import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
const {pg}=await memberWritingDb(PGlite,{writing:false});const owner='10000000-0000-4000-8000-000000000001',guest='10000000-0000-4000-8000-000000000002',path=owner+'.png';
async function as(uid,fn){await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);await pg.exec('set role '+(uid?'authenticated':'anon'));try{return await fn();}finally{await pg.exec('reset role');}}
try{
 const before=(await pg.query('select payload,revision from minihompy_settings')).rows[0];await pg.exec(await readFile('supabase/migrations/202609260002_home_profile.sql','utf8'));assert.deepEqual((await pg.query('select payload,revision from minihompy_settings')).rows[0],before);
 await pg.query('insert into auth.users values($1),($2)',[owner,guest]);await pg.query('insert into private.minihompy_admins values($1)',[owner]);
 await as(null,async()=>{assert.equal((await pg.query('select * from minihompy_settings')).rows.length,1);await assert.rejects(pg.exec("update minihompy_settings set payload=payload"));});
 await as(guest,async()=>{assert.equal((await pg.query('update minihompy_settings set payload=payload returning id')).rows.length,0);await assert.rejects(pg.query("insert into storage.objects(bucket_id,name) values('minihompy-home-profile',$1)",[path]));});
 await as(owner,async()=>{
  await assert.rejects(pg.query("update minihompy_settings set payload=jsonb_set(payload,'{profile,imagePath}',to_jsonb($1::text))",[path]));
  await pg.query("insert into storage.objects(bucket_id,name) values('minihompy-home-profile',$1)",[path]);
  const data=structuredClone(before.payload);data.profile.imagePath=path;data.profile.introduction='첫 줄\n다음 줄 <script>텍스트</script>';
  assert.equal((await pg.query('update minihompy_settings set payload=$1 where revision=$2 returning revision',[data,before.revision])).rows[0].revision,before.revision+1);
  assert.equal((await pg.query('update minihompy_settings set payload=$1 where revision=$2 returning revision',[data,before.revision])).rows.length,0);
  assert.equal((await pg.query('delete from storage.objects returning id')).rows.length,0);
  assert.equal((await pg.query("update storage.objects set name='overwrite.png' returning id")).rows.length,0);
  for(const bad of ['javascript:alert(1)','../photo.png',null,3])await assert.rejects(pg.query("update minihompy_settings set payload=jsonb_set(payload,'{profile,imagePath}',$1::jsonb)",[JSON.stringify(bad)]));
  data.profile.imagePath='';await pg.query('update minihompy_settings set payload=$1',[data]);assert.equal((await pg.query('delete from storage.objects returning id')).rows.length,1);
 });
 const bucket=(await pg.query("select * from storage.buckets where id='minihompy-home-profile'")).rows[0];assert.equal(Number(bucket.file_size_limit),6291456);assert(bucket.public);assert(!bucket.allowed_mime_types.includes('image/svg+xml'));
 console.log('PASS: migration preserves settings; public read; owner-only settings/storage; image validation; CAS; referenced image protection; image reset; bucket limits.');
}finally{await pg.close();}
