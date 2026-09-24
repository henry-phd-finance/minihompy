import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {id,site,owner,visitor,actor,centralOwner,tokenHash,tables,post,photoPath,request,seed,activate} from './helpers/friend-visibility-fixture.mjs';
const {pg}=await memberWritingDb(PGlite,{siteId:site,centralUrl:'https://central.test/api',photoMedia:true});let groups=0;
const check=async(name,fn)=>{await fn();console.log(`PASS ${++groups}: ${name}`);};
async function as(role,uid,fn){await pg.exec('set role '+role);await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);try{return await fn();}finally{await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub','',false)");}}
const read=(args=request(),action='list')=>as('service_role',null,async()=>(await pg.query('select public.member_content_read($1,$2) r',[action,args])).rows[0].r);
const ok=r=>{assert.ok(!r.failure,JSON.stringify(r));return r;};
const version=async(kind,p)=>(await pg.query(`select ${kind==='board'?'updated_at::text':'revision::text'} v from public.${tables[kind]} where id=$1`,[p])).rows[0].v;
const set=async(kind,v,{p=post(kind,1),rev,op=randomUUID()}={})=>as('authenticated',owner,async()=>(await pg.query('select public.set_content_visibility($1,$2,$3,$4,$5) r',[kind,p,v,rev??await version(kind,p),op])).rows[0].r);
try{
 await seed(pg);const before={};for(const t of [...Object.values(tables),'post_comments'])before[t]=(await pg.query('select * from public.'+t+' order by id')).rows;
 const preserved={};for(const t of ['photo_assets','member_writing_sessions','member_writing_families'])preserved[t]=(await pg.query('select * from private.'+t)).rows;
 await pg.exec('alter default privileges in schema private grant all on tables to anon,authenticated,service_role');
 await pg.exec(await readFile(new URL('../supabase/migrations/202609240007_friend_visibility.sql',import.meta.url),'utf8'));
 await check('additive migration preserves rows, comments, assets and existing visibility; defaults disabled',async()=>{
  for(const t of Object.keys(preserved))assert.deepEqual((await pg.query('select * from private.'+t)).rows,preserved[t]);
  for(const t of Object.keys(before))assert.deepEqual((await pg.query('select * from public.'+t+' order by id')).rows,before[t]);
  const state=(await as('service_role',null,()=>pg.query('select public.friend_visibility_status() s'))).rows[0].s;assert.equal(state.friend_visibility_ready,false);assert.equal(state.friend_visibility_protocol,1);
  for(const kind of Object.keys(tables)){
   assert.equal((await set(kind,'friends')).failure,'NOT_CONFIGURED');
   await assert.rejects(pg.query('update public.'+tables[kind]+" set visibility='friends' where id=$1",[post(kind,1)]),/NOT_CONFIGURED/);
  }
  await assert.rejects(as('authenticated',owner,()=>pg.query("insert into public.board_posts(id,folder_id,author_name,title,body,visibility) select $1,id,'owner','new','new body','friends' from public.board_folders limit 1",[id(444)])),/NOT_CONFIGURED/);
  assert.equal((await read()).failure,'NOT_CONFIGURED');assert.equal(ok(await read(request('public'))).data.count,2);
  await assert.rejects(pg.query('update private.friend_visibility_state set ready=true'),e=>e.code==='23514');
 });
 await check('service-only read/status; no browser or service direct readiness/context helpers',async()=>{
  for(const role of ['anon','authenticated','service_role'])await as(role,owner,async()=>{
   await assert.rejects(pg.query('select * from private.friend_visibility_state'),e=>e.code==='42501');
   await assert.rejects(pg.query('update private.friend_visibility_state set ready=true'),e=>e.code==='42501');
   await assert.rejects(pg.query("select private.friend_content_visible('friends','member','visible',true)"),e=>e.code==='42501');
   if(role!=='service_role'){await assert.rejects(pg.query('select public.member_content_read($1,$2)',['list',request()]),e=>e.code==='42501');await assert.rejects(pg.query('select public.friend_visibility_status()'),e=>e.code==='42501');}
  });
 });
 await activate(pg);
 await pg.query("create policy fixture_storage_allow on storage.objects for all to anon,authenticated using(true) with check(true)");
 await pg.query("insert into storage.objects(bucket_id,name) values('minihompy-photos-private',$1),('minihompy-photos',$1)",[photoPath(1)]);
 for(const kind of Object.keys(tables))await check(kind+': public/nonfriend/friend/owner role matrix, scope, page/count and detail',async()=>{
  const selectors={kind,page:1,size:1};
  for(const [mode,friend,scope,count] of [['public',false,'public',1],['member',false,'visible',1],['member',true,'visible',2],['owner',false,'visible',3],['owner',false,'public',1],['member',true,'public',1]]){
   const a=request(mode,'list',selectors,{scope});if(mode==='member'&&!friend){a.context.relationship='pending';a.context.can_read_friends=false;}
   const r=ok(await read(a));assert.equal(r.data.count,count);assert.equal(r.data.items.length,1);
   assert.equal('context' in r,false);assert.equal('deadline' in r.view,false);
   for(const n of [0,1,2]){
    const x=request(mode,'detail',{kind,id:post(kind,n)},{scope});if(mode==='member'&&!friend){x.context.relationship='none';x.context.can_read_friends=false;}
    const d=await read(x,'detail');const allowed=n===0||scope==='visible'&&(mode==='owner'||n===1&&friend);
    if(allowed)assert.equal(ok(d).data.item.id,post(kind,n));else assert.equal(d.failure,'NOT_FOUND');
   }
  }
  assert.equal((await read(request('member','detail',{kind,id:id(998)}),'detail')).failure,'NOT_FOUND');
  const beyond=ok(await read(request('member','list',{kind,page:3,size:1})));assert.equal(beyond.data.count,2);assert.deepEqual(beyond.data.items,[]);
 });
 await check('strict selectors, site/session/owner/request/hash/deadline binding reject tampering',async()=>{
  for(const patch of [{page:0},{size:21},{page:'1'},{select:'*'},{kind:'guestbook'},{month:'2026-09'}])assert.equal((await read(request('member','list',{kind:'board',page:1,size:20,...patch}))).failure,'BAD_REQUEST');
  for(const field of ['site_id','actor_member_id','owner_member_id','central_session_id','request_id','request_hash']){
   const a=request();a.context[field]=field==='request_hash'?'c'.repeat(64):id(888);assert.equal((await read(a)).failure,'TARGET_MISMATCH');
  }
  const changed=request();changed.selectors.page=2;assert.equal((await read(changed)).failure,'TARGET_MISMATCH');
  const foreign=request();foreign.site_id=id(98);assert.equal((await read(foreign)).failure,'TARGET_MISMATCH');
  const wrongBoolean=request();wrongBoolean.context.relationship='none';assert.equal((await read(wrongBoolean)).failure,'TARGET_MISMATCH');
  const wrongSelf=request();wrongSelf.context.relationship='self';wrongSelf.context.can_read_friends=false;assert.equal((await read(wrongSelf)).failure,'TARGET_MISMATCH');
  const badToken=request();badToken.token_hash='f'.repeat(64);assert.equal((await read(badToken)).failure,'AUTH_REQUIRED');
  for(const mutate of [a=>a.deadline=new Date(Date.now()-10).toISOString(),a=>a.deadline=new Date(Date.now()+6000).toISOString(),a=>a.context.authorized_at=new Date(Date.now()+2000).toISOString(),a=>a.context.expires_at=new Date(Date.now()+6000).toISOString()]){const a=request();mutate(a);assert.equal((await read(a)).failure,'READ_CONTEXT_EXPIRED');}
  const publicBad=request('public');publicBad.context=request().context;assert.equal((await read(publicBad)).failure,'BAD_REQUEST');
  const fakeOwner=request('owner');fakeOwner.owner_id=visitor;assert.equal((await read(fakeOwner)).failure,'FORBIDDEN');
 });
 await check('direct RLS/comments/legacy media/calendar/location/summary never expose friends to local visitors',async()=>{
  for(const uid of [null,visitor,owner])await as(uid?'authenticated':'anon',uid,async()=>{
   assert.equal((await pg.query('select * from storage.objects')).rows.length,0);
   for(const kind of Object.keys(tables))assert.equal((await pg.query('select count(*)::int n from public.'+tables[kind])).rows[0].n,uid===owner?3:1);
   assert.equal((await pg.query('select count(*)::int n from public.post_comments')).rows[0].n,uid===owner?9:3);
   if(uid!==owner){for(const kind of Object.keys(tables))assert.equal((await pg.query('select public.post_location($1,$2,20) r',[kind,post(kind,1)])).rows[0].r,null);const dates=(await pg.query("select * from public.diary_written_dates((select id from public.diary_folders limit 1),'2026-09-01')")).rows;assert.equal(dates.length,1);}
  });
  for(const kind of Object.keys(tables)){
   const args={site_id:site,mode:'member',token_hash:tokenHash,kind,parent_id:post(kind,1),page:1,size:20};
   for(const action of ['list','create','update','delete'])assert.equal((await as('service_role',null,async()=>(await pg.query('select public.member_comments($1,$2) r',[action,args])).rows[0].r)).failure,'NOT_FOUND');
   await as('authenticated',visitor,async()=>{
    const column={board:'board_post_id',photos:'photo_post_id',diary:'diary_entry_id'}[kind];
    await assert.rejects(pg.query(`insert into public.post_comments(${column},author_name,body) values($1,'visitor','blocked')`,[post(kind,1)]),e=>e.code==='42501');
    assert.equal((await pg.query(`update public.post_comments set body='bad' where ${column}=$1 returning id`,[post(kind,1)])).rows.length,0);
    assert.equal((await pg.query(`delete from public.post_comments where ${column}=$1 returning id`,[post(kind,1)])).rows.length,0);
   });
  }
  const media=await as('service_role',null,async()=>(await pg.query("select public.photo_media('read',$1) r",[{post_id:post('photos',1),path:photoPath(1)}])).rows[0].r);assert.equal(media.failure,'NOT_FOUND');
  await as('anon',null,async()=>{assert.equal((await pg.query('select * from storage.objects')).rows.length,0);const s=(await pg.query("select public.home_summary(array['board','photos','diary']) s")).rows[0].s;for(const kind of Object.keys(tables))assert.equal(s.counts[kind].total,1);});
 });
 await check('admin visibility retries/conflicts/readiness-off cleanup and folder move preserve rows',async()=>{
  const rev=await version('board',post('board',1)),op=randomUUID();ok(await set('board','private',{rev,op}));assert.equal((await set('board','private',{rev,op})).replayed,true);assert.equal((await set('board','friends',{rev,op})).failure,'REQUEST_CONFLICT');assert.equal((await set('board','friends',{rev})).failure,'REVISION_CONFLICT');ok(await set('board','friends'));
  await pg.query('update private.friend_visibility_state set ready=false');assert.equal((await set('board','friends')).failure,'NOT_CONFIGURED');assert.equal((await read()).failure,'NOT_CONFIGURED');
  assert.equal(ok(await read(request('owner'))).data.count,3);ok(await set('board','private'));ok(await set('board','public'));
  await pg.query('update private.friend_visibility_state set ready=true');ok(await set('board','friends'));
  const before=(await pg.query('select author_id,body,visibility from public.board_posts where id=$1',[post('board',1)])).rows[0];
  const folders=async(action,args)=>as('authenticated',owner,async()=>(await pg.query('select public.manage_content_folders($1,$2) r',[action,args])).rows[0].r);
  let snap=ok(await folders('snapshot',{menu:'board'}));const source=snap.items[0].id,target=id(777);
  ok(await folders('create',{menu:'board',request_id:randomUUID(),expected_revision:snap.menu_revision,id:target,kind:'folder',label:'Moved'}));snap=ok(await folders('snapshot',{menu:'board'}));ok(await folders('delete',{menu:'board',request_id:randomUUID(),expected_revision:snap.menu_revision,id:source,destination_id:target}));
  assert.deepEqual((await pg.query('select author_id,body,visibility from public.board_posts where id=$1',[post('board',1)])).rows[0],before);
 });
 await check('month/folder filters, summary stays public for owner, and unknown visibility cannot be stored',async()=>{
  const folder=(await pg.query('select id from public.diary_folders limit 1')).rows[0].id;
  assert.equal(ok(await read(request('member','list',{kind:'diary',folder_id:folder,month:'2026-09',page:1,size:20}))).data.count,2);
  assert.equal(ok(await read(request('member','list',{kind:'diary',month:'2026-10',page:1,size:20}))).data.count,0);
  for(const month of ['2026-13','2026-9','0000-01'])assert.equal((await read(request('member','list',{kind:'diary',month,page:1,size:20}))).failure,'BAD_REQUEST');
  for(const kind of Object.keys(tables))await assert.rejects(pg.query('update public.'+tables[kind]+" set visibility='unknown' where id=$1",[post(kind,0)]),e=>e.code==='23514');
  const summary=(await as('authenticated',owner,()=>pg.query("select public.home_summary(array['board','photos','diary']) r"))).rows[0].r;for(const kind of Object.keys(tables))assert.equal(summary.counts[kind].total,1);
 });
 await check('local family revoke blocks old context; existing secret guestbook rules remain',async()=>{
  const args=request();await pg.query("select public.member_writing_session('revoke',$1)",[{site_id:site,token_hash:tokenHash}]);assert.equal((await read(args)).failure,'SESSION_REVOKED');
  const g=id(555);await as('authenticated',visitor,()=>pg.query("insert into public.guestbook_posts(id,author_name,body,visibility) values($1,'visitor','secret','private')",[g]));
  for(const uid of [null,visitor,owner])assert.equal((await as(uid?'authenticated':'anon',uid,()=>pg.query('select * from public.guestbook_posts where id=$1',[g]))).rows.length,uid?1:0);
 });
 console.log(`All ${groups} personal friend visibility SQL groups passed; no hosted changes.`);
}finally{await pg.close();}
