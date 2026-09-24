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
 const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));assert.equal(r.headers.get('Cache-Control'),'no-store');return data;
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
 const parents={};
 await personal.pg.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
 parents.board=(await personal.pg.query("insert into public.board_posts(folder_id,author_name,title,body) select id,'주인','게시판','본문' from public.board_folders returning id")).rows[0].id;
 parents.photos=id(60);
 await personal.pg.query("insert into public.photo_posts(id,folder_id,author_name,title,body) select $1,id,'주인','사진',$2 from public.photo_folders",[parents.photos,JSON.stringify([{type:'image',path:`${parents.photos}/${id(61)}.jpg`}])]);
 parents.diary=(await personal.pg.query("insert into public.diary_entries(id,folder_id,author_name,entry_date,entry_time,body) select gen_random_uuid(),id,'주인','2026-09-23','12:00','일기' from public.diary_folders returning id")).rows[0].id;
 await personal.pg.exec("select set_config('request.jwt.claim.sub','',false)");
 parents.guestbook=id(62);
 await request('/guestbook',{token:a,body:{request_id:id(63),id:parents.guestbook,body:'회원 부모',visibility:'public'}});
 const body=(n,kind='board')=>({id:id(n),request_id:id(n+1000),kind,parent_id:parents[kind],body:'회원 댓글 '+n});
 const create=(value,token=a,expected=200)=>request('/comments',{body:value,token,expected});
 const list=(kind,token=a,mode='member',expected=200)=>request(`/comments?kind=${kind}&parent_id=${parents[kind]}`,{token,mode,expected});
 const change=(n,kind,op,revision=1,token=a,mode='member',expected=200,req=n+(op==='update'?2000:4000))=>request('/comments/'+id(n),{method:op==='update'?'PATCH':'DELETE',token,mode,expected,body:{kind,parent_id:parents[kind],request_id:id(req),revision,...(op==='update'?{body:'수정 '+n}:{})}});
 const unlock=()=>personal.pg.exec("update private.member_writing_limits set last_write=now()-interval '2 minutes' where kind='comment'");
 let n=100;
 for(const kind of Object.keys(parents))await check(kind+': verified author, fresh session edit, stranger denied, owner delete only, replay',async()=>{
  await unlock();const v=body(n,kind);await create(v);assert.equal((await create(v,aFresh)).replayed,true);
  const row=(await list(kind)).items.find(r=>r.id===v.id);assert.equal(row.can_edit,true);assert.equal(row.author_name,'Alice');assert.equal(row.author_member_id,member);assert.equal(row.author_id,null);assert.equal(row.author_homepage_url,'https://alice.github.io/home/');
  assert.equal((await list(kind,null,'public')).count,1);
  await change(n,kind,'update',1,b,'member',404);await change(n,kind,'delete',1,b,'member',404);
  await change(n,kind,'update',1,ownerToken,'owner',403);
  await change(n,kind,'update',1,aFresh);await change(n,kind,'update',1,a,'member',409,n+3000);
  await change(n,kind,'delete',2,ownerToken,'owner');assert.equal((await change(n,kind,'delete',2,ownerToken,'owner')).replayed,true);
  await create(v);assert.equal((await list(kind)).count,0);n++;
 });
 await check('member quota shared across parents/sessions; rollback, replay and tombstones',async()=>{
  await unlock();await create(body(120));await create(body(121,'diary'),aFresh,429);
  await change(120,'board','delete');await create(body(121,'diary'),aFresh,429);
  await unlock();await personal.pg.exec("update private.member_writing_limits set writes=100 where kind='comment'");await create(body(121),a,429);
  await personal.pg.exec("update private.member_writing_limits set window_start=now()-interval '25 hours' where kind='comment'");await create(body(121));
  await create({...body(122),body:' '},a,400);await create({...body(122),body:'x'.repeat(1001)},a,400);
  await create({...body(122),author_member_id:memberB},a,400);await create({...body(121),body:'different'},a,409);
  assert.equal((await personal.pg.query("select writes from private.member_writing_limits where kind='comment'")).rows[0].writes,1);
 });
 await check('private parent authorization precedes even retries by former comment author',async()=>{
  await unlock();await create(body(130,'guestbook'),b);
  await request('/guestbook/'+parents.guestbook+'/private',{token:a,body:{request_id:id(1500),revision:1}});
  for(const [token,mode] of [[b,'member'],[null,'public']])await list('guestbook',token,mode,404);
  await create(body(130,'guestbook'),b,404);await change(130,'guestbook','update',1,b,'member',404);await change(130,'guestbook','delete',1,b,'member',404);
  assert.equal((await list('guestbook')).count,1);assert.equal((await list('guestbook',ownerToken,'owner')).count,1);
  await unlock();await create(body(131,'guestbook'));await change(131,'guestbook','update',1,aFresh);
  await change(131,'board','delete',2,a,'member',404);
  await change(130,'guestbook','delete',1,ownerToken,'owner');
 });
 await check('browser RLS preserves old local ownership, rejects member injection and private parent access',async()=>{
  await personal.pg.exec('set role authenticated');await personal.pg.query("select set_config('request.jwt.claim.sub',$1,false)",[member]);
  try {
   await personal.pg.query("insert into public.post_comments(id,board_post_id,author_name,body) values($1,$2,'로컬','옛 댓글')",[id(140),parents.board]);
   await assert.rejects(personal.pg.query("select public.member_comments('list','{}')"));
   await assert.rejects(personal.pg.query("update public.post_comments set author_member_id=$1 where id=$2",[member,id(140)]));
   assert.equal((await personal.pg.query('select * from public.post_comments where guestbook_post_id=$1',[parents.guestbook])).rows.length,0);
   assert.equal((await personal.pg.query("update public.post_comments set body='로컬 수정' where id=$1 returning revision",[id(140)])).rows[0].revision,2);
  } finally {await personal.pg.exec('reset role');await personal.pg.exec("select set_config('request.jwt.claim.sub','',false)");}
  await change(140,'board','update',2,a,'member',404);await change(140,'board','delete',2,a,'member',404);
  await change(140,'board','delete',2,ownerToken,'owner');
 });
 for(const [kind,table] of Object.entries({board:'board_posts',photos:'photo_posts',diary:'diary_entries'}))await check(kind+': private general parent rejects member/public and old replays; owner can moderate',async()=>{
  const index=n++;await unlock();const created=body(index,kind);await create(created);await change(index,kind,'update',1);
  if(kind==='photos')await personal.pg.exec('update private.photo_media_state set ready=true'); // trusted fixture, not a browser activation
  await personal.pg.query('update public.'+table+" set visibility='private' where id=$1",[parents[kind]]);
  await list(kind,a,'member',404);await list(kind,null,'public',404);await list(kind,b,'member',404);
  await create(created,a,404);await change(index,kind,'update',1,a,'member',404);await change(index,kind,'delete',2,a,'member',404);
  assert.ok((await list(kind,ownerToken,'owner')).items.some(x=>x.id===id(index)));
  await change(index,kind,'delete',2,ownerToken,'owner');
  await personal.pg.query('update public.'+table+" set visibility='public' where id=$1",[parents[kind]]);
  if(kind==='photos')await personal.pg.exec('update private.photo_media_state set ready=false');
 });
 if(process.env.PLAYWRIGHT_PATH){const {verifyAutomaticSessionBrowser}=await import('./helpers/automatic-session-browser.mjs');await verifyAutomaticSessionBrowser({playwrightPath:process.env.PLAYWRIGHT_PATH,centralRoot,centralHandler:handleIdentityApiRequest,centralOptions,centralSession,ownerCentralSession,personal,options,member,memberB,parents});}
 await check('parent delete cascades; stale requests cannot recreate or read any of four parents',async()=>{
  for(const [kind,table] of Object.entries({board:'board_posts',photos:'photo_posts',diary:'diary_entries',guestbook:'guestbook_posts'})){
   await unlock();await create(body(n,kind));await personal.pg.query('delete from public.'+table+' where id=$1',[parents[kind]]);
   await list(kind,a,'member',404);await create(body(n,kind),a,404);await change(n,kind,'delete',1,a,'member',404);
   assert.equal((await personal.pg.query('select * from public.post_comments where id=$1',[id(n)])).rows.length,0);n++;
  }
 });
 await check('central outage and revoked sessions never write anonymously',async()=>{
  offline=true;await create(body(160),a,503);offline=false;
  await request('/sessions/revoke',{body:{},token:aFresh});await list('board',aFresh,'member',401);
 });
 console.log(`PASS: ${groups} member comment integration groups; actual central/personal SQL and handlers.`);
}finally{await personal.pg.close();await central.pg.close();}
