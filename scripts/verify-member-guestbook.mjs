import assert from 'node:assert/strict';
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {handleMemberWriting,tokenHash} from '../supabase/functions/member-writing/handler.js';
const centralRoot=resolve(process.env.MINIHOMPY_CENTRAL_ROOT||'../minihompy-central');
const {createIdentityDb}=await import(pathToFileURL(centralRoot+'/scripts/helpers/identity-db.mjs'));
const {handleIdentityApiRequest}=await import(pathToFileURL(centralRoot+'/supabase/functions/identity-api/handler.js'));
const {signToken}=await import(pathToFileURL(centralRoot+'/supabase/functions/_shared/tokens.js'));
const {sha256,randomSecret}=await import(pathToFileURL(centralRoot+'/supabase/functions/_shared/auth-proof.js'));
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2]||centralRoot+'/node_modules/@electric-sql/pglite/dist/index.js')));
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const member=id(1),memberB=id(2),siteA=id(3),siteB=id(4),owner=id(5),sid=id(6);
const centralUrl='https://central.test/functions/v1/identity-api',projectUrl='https://bbbbbbbbbbbbbbbbbbbb.supabase.co';
const secret='test-only-central-signing-secret-at-least-32';
const central=await createIdentityDb();const personal=await memberWritingDb(PGlite,{siteId:siteB,centralUrl});
const centralOptions={supabaseClient:central.db,centralSecret:secret,allowedOrigins:new Set()};
let centralSession,offline=false,failRevoke=false,ownerAllowed=true,anonymousOwner=false,revokeDuringCheck=false;
const config={MINIHOMPY_SITE_ORIGIN:'https://bob.github.io',MINIHOMPY_SITE_ID:siteB,MINIHOMPY_CENTRAL_API_URL:centralUrl,SUPABASE_URL:projectUrl,MINIHOMPY_PUBLIC_KEY:'test-public-key'};
const ownerToken='test.owner.jwt';
const fetcher=async(url,init)=>{
 assert.equal(init.redirect,'error');assert.ok(init.signal);
 if(url.startsWith(centralUrl)){
  assert.ok(!JSON.stringify(init).includes(ownerToken),'personal credentials never go to central');
  if(offline||failRevoke&&url.endsWith('/writing-grants/revoke'))throw Error('private internal diagnostic');
  const res=await handleIdentityApiRequest(new Request(url,init),centralOptions);
  if(revokeDuringCheck&&url.endsWith('/writing-grants/check')){await personal.pg.exec('update private.member_writing_sessions set revoked_at=clock_timestamp()');}
  return res;
 }
 assert.ok(url.startsWith(projectUrl+'/'));assert.equal(init.headers.Authorization,'Bearer '+ownerToken);
 if(url.endsWith('/auth/v1/user'))return Response.json({id:owner,is_anonymous:anonymousOwner});
 assert.ok(url.endsWith('/rpc/is_minihompy_admin'));return Response.json(ownerAllowed);
};
const options={config,db:personal.db,fetcher};
async function centralCall(path,body){const r=await handleIdentityApiRequest(new Request(centralUrl+path,{method:'POST',body:JSON.stringify(body)}),centralOptions);assert.equal(r.status,200);return r.json();}
async function proof(target=siteB){const verifier=randomSecret();const p=await centralCall('/writing-proofs/issue',{central_session:centralSession,target_site_id:target,code_challenge:await sha256(verifier),return_path:'/home/'});return {writing_proof:p.writing_proof,code_verifier:verifier};}
async function request(path,{body,token,mode='member',expected=200,overrides={},method}={}){
 const r=await handleMemberWriting(new Request(projectUrl+'/functions/v1/member-writing'+path,{method:method||(body===undefined?'GET':'POST'),headers:{Origin:config.MINIHOMPY_SITE_ORIGIN,'Content-Type':'application/json','X-Minihompy-Auth-Mode':mode,...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{...options,...overrides});
 const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));assert.equal(r.headers.get('Cache-Control'),path.startsWith('/comments')?'private, no-store':'no-store');return data;
}
let groups=0;const check=async(name,fn)=>{await fn();console.log(`PASS ${++groups}: ${name}`);};
try{
 await central.pg.query("insert into private.identity_members(id,handle,display_name) values($1,'alice','Alice'),($2,'bob','Bob')",[member,memberB]);
 for(const [s,m,name,o] of [[siteA,member,'alice',owner],[siteB,memberB,'bob',id(7)]]){
  await central.pg.query("insert into private.identity_sites(id,member_id,origin,base_path,homepage_url,login_url,supabase_project_ref,verification_status) values($1,$2,$3,'/home/',$4,$5,$6,'verified')",[s,m,`https://${name}.github.io`,`https://${name}.github.io/home/`,`https://${name}.github.io/home/login/`,name.repeat(4)]);
  await central.pg.query('insert into private.identity_bindings(site_id,member_id,local_user_id) values($1,$2,$3)',[s,m,o]);
 }
 await central.pg.query("insert into private.identity_sessions(id,member_id,site_id,session_version,owner_user_id,expires_at) values($1,$2,$3,1,$4,now()+interval '1 day')",[sid,member,siteA,owner]);
 const now=Math.floor(Date.now()/1000);centralSession=await signToken({kind:'central_session',sub:member,central_session_id:sid,session_version:1,iat:now,exp:now+86400},secret);
 await personal.pg.query('insert into auth.users(id) values($1),($2)',[owner,member]);
 await personal.pg.query('insert into private.minihompy_admins values($1)',[owner]);
 const a=(await request('/sessions/exchange',{body:await proof()})).session_token;
 const aFresh=(await request('/sessions/exchange',{body:await proof()})).session_token;
 const originalSession=centralSession;
 await central.pg.query("insert into private.identity_sessions(id,member_id,site_id,session_version,owner_user_id,expires_at) values($1,$2,$3,1,$4,now()+interval '1 day')",[id(8),memberB,siteB,id(7)]);
 centralSession=await signToken({kind:'central_session',sub:memberB,central_session_id:id(8),session_version:1,iat:now,exp:now+86400},secret);
 const ownerCentralSession=centralSession;
 const b=(await request('/sessions/exchange',{body:await proof()})).session_token;centralSession=originalSession;
 const body=(n,visibility='public')=>({id:id(n),request_id:id(n+100),body:'회원 방명록 '+n,visibility});
 const create=(value,token=a,expected=200)=>request('/guestbook',{body:value,token,expected});
 const list=(token=a,mode='member')=>request('/guestbook?page=1&size=5',{token,mode});
 const change=(n,action,payload,token=a,mode='member',expected=200)=>request(`/guestbook/${id(n)}${action==='private'?'/private':''}`,{body:payload,token,mode,expected,method:action==='update'?'PATCH':action==='delete'?'DELETE':'POST'});
 const unlock=()=>personal.pg.exec("update private.member_writing_limits set last_write=now()-interval '2 minutes',window_start=now(),writes=0");
 await check('member writes use verified name and identity; replay does not duplicate or charge twice',async()=>{
  const first=await create(body(20));assert.equal(first.revision,1);
  const retry=await create(body(20));assert.equal(retry.replayed,true);
  assert.equal((await personal.pg.query('select writes from private.member_writing_limits')).rows[0].writes,1);
  await create({...body(20),body:'different'},a,409);
  await create({...body(21),author_name:'forged'},a,400);
  const row=(await list()).items[0];assert.equal(row.author_id,null);assert.equal(row.author_member_id,member);assert.equal(row.author_name,'Alice');assert.equal(row.can_edit,true);
 });
 await check('private posts and count only visible to member author on a fresh session or local owner',async()=>{
  await unlock();await create(body(21,'private'));
  assert.equal((await list(aFresh)).count,2);assert.equal((await list(b)).count,1);
  assert.equal((await list(null,'public')).count,1);assert.equal((await list(ownerToken,'owner')).count,2);
  assert.equal(JSON.stringify(await list(b)).includes('회원 방명록 21'),false);
  await change(21,'update',{request_id:id(201),revision:1,body:'attack'},b,'member',404);
  await change(21,'delete',{request_id:id(202),revision:999},b,'member',404);
 });
 await check('post address uses the same public/member/owner authorization and rejects invalid IDs',async()=>{
  const path='/guestbook?size=1&post='+id(21);
  assert.ok((await request(path,{token:aFresh})).items.some(x=>x.id===id(21)));
  assert.ok((await request(path,{token:ownerToken,mode:'owner'})).items.some(x=>x.id===id(21)));
  await request(path,{mode:'public',expected:404});await request(path,{token:b,expected:404});
  await request('/guestbook?post=bad',{mode:'public',expected:400});
  await request('/guestbook?post='+id(20)+'&post='+id(21),{mode:'public',expected:400});
  const publicPost=await request('/guestbook?size=1&post='+id(20),{mode:'public'});assert.equal(publicPost.items[0].id,id(20));
 });
 await check('author edits with revision checks; owner cannot edit another member body',async()=>{
  const payload={request_id:id(203),revision:1,body:'수정한 본문'};
  assert.equal((await change(21,'update',payload,aFresh)).revision,2);
  assert.equal((await change(21,'update',payload,aFresh)).replayed,true);
  await change(21,'update',{...payload,request_id:id(204)},a,'member',409);
  await change(21,'update',{...payload,revision:2,request_id:id(205)},ownerToken,'owner',403);
  await change(21,'update',{...payload,visibility:'public'},a,'member',400);
 });
 await check('owner may hide/delete; deleted posts never resurrect through an old retry',async()=>{
  assert.equal((await change(20,'private',{request_id:id(206),revision:1},ownerToken,'owner')).revision,2);
  assert.equal((await list(b)).count,0);
  await change(20,'delete',{request_id:id(207),revision:2},ownerToken,'owner');
  assert.equal((await create(body(20))).replayed,true);
  assert.equal((await list()).count,1);
  await change(21,'delete',{request_id:id(208),revision:2},aFresh);
 });
 await check('minute and daily quotas survive session changes/deletion; failed inserts rollback',async()=>{
  await unlock();await create(body(22));await create(body(23),aFresh,429);
  await change(22,'delete',{request_id:id(209),revision:1});await create(body(23),aFresh,429);
  await personal.pg.exec("update private.member_writing_limits set last_write=now()-interval '2 minutes',writes=20");await create(body(23),a,429);
  await personal.pg.exec("update private.member_writing_limits set window_start=now()-interval '25 hours'");await create(body(23));
  await create({...body(24),body:' '},a,400);await create({...body(24),body:'x'.repeat(5001)},a,400);
  assert.equal((await personal.pg.query('select writes from private.member_writing_limits')).rows[0].writes,1);
 });
 await check('old anonymous authors retain private ownership and cannot become a member by UUID collision',async()=>{
  await personal.pg.exec('set role authenticated');
  await personal.pg.query("select set_config('request.jwt.claim.sub',$1,false)",[member]);
  try{
   await personal.pg.query("insert into public.guestbook_posts(id,author_name,body,visibility) values($1,'옛 방문자','로컬 비밀글','private')",[id(30)]);
   assert.equal((await personal.pg.query('select count(*)::int as n from public.guestbook_posts where id=$1',[id(30)])).rows[0].n,1);
   await assert.rejects(personal.pg.query("select public.member_guestbook('list','{}')"));

   await assert.rejects(personal.pg.query("update public.guestbook_posts set author_member_id=$1 where id=$2",[member,id(30)]));
  }finally{await personal.pg.exec('reset role');await personal.pg.exec("select set_config('request.jwt.claim.sub','',false)");}
  assert.equal((await list(a)).items.some(r=>r.id===id(30)),false);
  assert.equal((await list(ownerToken,'owner')).items.some(r=>r.id===id(30)),true);
  await change(30,'private',{request_id:id(210),revision:1},ownerToken,'owner');
  await change(30,'delete',{request_id:id(211),revision:2},ownerToken,'owner');
 });
 await check('member private parent comments remain hidden to legacy readers',async()=>{
  await unlock();await create(body(31,'private'));
  await personal.pg.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await personal.pg.query("insert into public.post_comments(id,guestbook_post_id,author_name,body) values($1,$2,'주인','비밀댓글')",[id(32),id(31)]);
  await personal.pg.exec("select set_config('request.jwt.claim.sub','',false)");
  await personal.pg.exec('set role anon');try{assert.equal((await personal.pg.query('select * from public.post_comments where id=$1',[id(32)])).rows.length,0);}finally{await personal.pg.exec('reset role');}
  await change(31,'delete',{request_id:id(212),revision:1});assert.equal((await personal.pg.query('select * from public.post_comments where id=$1',[id(32)])).rows.length,0);
 });
 await check('expired or centrally revoked sessions cannot read member private posts or write',async()=>{
  await request('/sessions/revoke',{body:{},token:aFresh});await request('/guestbook',{token:aFresh,expected:401});
  offline=true;await create(body(40),a,503);offline=false;
 });
 if(process.env.PLAYWRIGHT_PATH){const {verifyGuestbookBrowser}=await import('./helpers/guestbook-browser.mjs');await verifyGuestbookBrowser({playwrightPath:process.env.PLAYWRIGHT_PATH,centralRoot,centralHandler:handleIdentityApiRequest,centralOptions,centralSession,ownerCentralSession,personal,options,member,memberB,owner,ownerToken});}
 await personal.pg.exec('set session authorization authenticated');
 await assert.rejects(personal.pg.exec('set role service_role'));
 console.log(`PASS: ${groups} guestbook integration groups; actual local central/personal SQL and handlers.`);
}finally{await personal.pg.close();await central.pg.close();}
