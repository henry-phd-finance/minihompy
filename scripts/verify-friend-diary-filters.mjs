import assert from 'node:assert/strict';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {site,owner,post,seed,activate,request,id} from './helpers/friend-visibility-fixture.mjs';
const fixture=await memberWritingDb(PGlite,{siteId:site,centralUrl:'https://central.test/api',photoMedia:true,friendVisibility:true}),{pg}=fixture;
let groups=0;const check=async(name,fn)=>{await fn();console.log(`PASS ${++groups}: ${name}`);};
const call=async(action,selectors,mode='member',extra={})=>{const r=await fixture.db.rpc('member_content_aggregate',{p_action:action,p_args:request(mode,action,selectors,extra)});assert.equal(r.error,null);return r.data;};
try{
 await seed(pg);await activate(pg);
 await check('Korean midnight, future exclusions, labels and private helper ACL preserve summary v1',async()=>{
  await pg.exec('set session_replication_role=replica');
  for(const kind of ['board','photos','diary']){const table={board:'board_posts',photos:'photo_posts',diary:'diary_entries'}[kind];for(let n=0;n<3;n++)await pg.query('update public.'+table+' set created_at=$1 where id=$2',[n===0?'2026-09-23T14:59:59.999Z':n===1?'2026-09-23T15:00:00Z':'2026-09-23T15:00:00.001Z',post(kind,n)]);}
  await pg.query("update public.board_posts set title='<b>label</b> **text**' where id=$1",[post('board',1)]);
  await pg.exec('set session_replication_role=origin');
  const menus=['board','diary','photos'],at='2026-09-23T15:00:00Z';
  const summary=async(mode,friend)=>(await pg.query('select private.friend_home_summary_at($1,$2,$3,$4,$5) r',[menus,at,mode,mode==='public'?'public':'visible',friend])).rows[0].r;
  const pub=await summary('public',false),member=await summary('member',true),admin=await summary('owner',true);assert.equal(member.date,'2026-09-24');assert.deepEqual(member.counts.board,{today:1,total:2});assert.deepEqual(admin.counts,member.counts);assert.equal(member.recent.find(r=>r.kind==='board'&&r.id===post('board',1)).label,'label text');
  assert.deepEqual(pub,(await pg.query('select private.home_summary_at($1,$2) r',[menus,at])).rows[0].r);
  for(const role of ['anon','authenticated','service_role']){await pg.exec('set role '+role);await assert.rejects(pg.query('select private.friend_home_summary_at($1,$2,$3,$4,$5)',[menus,at,'owner','visible',true]),e=>e.code==='42501');await pg.exec('reset role');}
 });
 await check('diary location partitions by folder/date, ascending time/id; calendar deduplicates dates',async()=>{
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await pg.query("update public.diary_entries set entry_date='2026-09-24',entry_time='12:30' where id in ($1,$2,$3)",[post('diary',0),post('diary',1),post('diary',2)]);
  assert.deepEqual((await call('calendar',{month:'2026-09'})).data,{dates:['2026-09-24']});
  assert.equal((await call('location',{kind:'diary',id:post('diary',1),size:1})).data.page,2);
  assert.equal((await call('location',{kind:'diary',id:post('diary',2),size:1},'owner')).data.page,3);
  assert.equal((await call('location',{kind:'diary',id:post('diary',1),size:1},'public')).failure,'NOT_FOUND');
  assert.deepEqual((await call('calendar',{month:'2026-10'})).data,{dates:[]});
 });
 await check('mixed visibility multi-page board positions exactly match filtered list, including timestamp ties',async()=>{
  for(let n=0;n<25;n++)await pg.query("insert into public.board_posts(id,folder_id,author_name,title,body,visibility,created_at) select $1,id,'owner','rank','body',$2,'2026-09-24' from public.board_folders limit 1",[id(500+n),['public','friends','private'][n%3]]);
  for(const mode of ['public','member','owner']){
   let all=[];for(let page=1;page<=5;page++){const r=await fixture.db.rpc('member_content_read',{p_action:'list',p_args:request(mode,'list',{kind:'board',page,size:7})});assert.equal(r.error,null);all.push(...r.data.data.items);if(all.length===r.data.data.count)break;}
   assert.equal(new Set(all.map(x=>x.id)).size,all.length);
   for(let i=0;i<all.length;i++){const location=await call('location',{kind:'board',id:all[i].id,size:7},mode);assert.equal(location.data.page,Math.floor(i/7)+1);assert.equal(location.data.folder_id,all[i].folder_id);}
  }
 });
 await check('SQL rejects duplicate/unsorted selectors, forged hashes, wrong site and hidden IDs without metadata',async()=>{
  for(const menus of [['board','board'],['photos','board'],[null],[['board']]])assert.equal((await call('summary',{menus})).failure,'BAD_REQUEST');
  assert.equal((await call('calendar',{month:'0000-01'})).failure,'BAD_REQUEST');assert.equal((await call('location',{kind:'guestbook',id:id(12),size:1})).failure,'BAD_REQUEST');
  const args=request('member','location',{kind:'board',id:post('board',1),size:1});args.selectors.id=post('board',0);const result=await fixture.db.rpc('member_content_aggregate',{p_action:'location',p_args:args});assert.equal(result.data.failure,'TARGET_MISMATCH');
  const hidden=await call('location',{kind:'board',id:post('board',2),size:1});assert.deepEqual(hidden,{failure:'NOT_FOUND'});
  assert.equal((await call('summary',{menus:['board']},'member',{site_id:id(42)})).failure,'TARGET_MISMATCH');
 });
 await check('diary day and calendar folder filters are applied before count/page and bound into context',async()=>{
  const folder=(await pg.query('select folder_id from public.diary_entries where id=$1',[post('diary',0)])).rows[0].folder_id;
  const list=async date=>fixture.db.rpc('member_content_read',{p_action:'list',p_args:request('member','list',{kind:'diary',folder_id:folder,date,page:1,size:1})});
  let r=await list('2026-09-24');assert.equal(r.error,null);assert.equal(r.data.data.count,2);assert.equal(r.data.data.items.length,1);r=await list('2026-09-25');assert.equal(r.data.data.count,0);
  assert.deepEqual((await call('calendar',{month:'2026-09',folder_id:id(12345)})).data,{dates:[]});assert.deepEqual((await call('calendar',{month:'2026-09',folder_id:folder})).data,{dates:['2026-09-24']});
  assert.equal((await list('2026-02-30')).data.failure,'BAD_REQUEST');
  const args=request('member','list',{kind:'diary',date:'2026-09-24',page:1,size:20});args.selectors.date='2026-09-25';assert.equal((await fixture.db.rpc('member_content_read',{p_action:'list',p_args:args})).data.failure,'TARGET_MISMATCH');
 });
 console.log(`All ${groups} aggregate SQL boundary groups passed; fixture clocks only, real permission/filter/rank SQL.`);
}finally{await pg.close();}
