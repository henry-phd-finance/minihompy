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
let revokeDuringRenew=false,alterRenew=false,lastHeaders,activeRenewal;
let centralSession,offline=false,failRevoke=false,ownerAllowed=true,anonymousOwner=false,revokeDuringCheck=false;
const config={MINIHOMPY_SITE_ORIGIN:'https://bob.github.io',MINIHOMPY_SITE_ID:siteB,MINIHOMPY_CENTRAL_API_URL:centralUrl,SUPABASE_URL:projectUrl,MINIHOMPY_PUBLIC_KEY:'test-public-key'};
const ownerToken='test.owner.jwt';
const fetcher=async(url,init)=>{
 assert.equal(init.redirect,'error');assert.ok(init.signal);
 if(url.startsWith(centralUrl)){
  assert.ok(!JSON.stringify(init).includes(ownerToken),'personal credentials never go to central');
  if(offline||failRevoke&&(url.endsWith('/writing-grants/revoke')||url.endsWith('/writing-delegations/revoke')))throw Error('private internal diagnostic');
  const res=await handleIdentityApiRequest(new Request(url,init),centralOptions);
  if(revokeDuringCheck&&url.endsWith('/writing-grants/check')){await personal.pg.exec('update private.member_writing_sessions set revoked_at=clock_timestamp()');}
  if(url.endsWith('/writing-delegations/renew')&&res.ok){
   if(revokeDuringRenew)await personal.db.rpc('member_writing_session',{p_action:'revoke',p_args:{site_id:siteB,token_hash:await tokenHash(activeRenewal)}});
   if(alterRenew){const data=await res.json();data.member.id=memberB;return Response.json(data);}
  }
  return res;
 }
 assert.ok(url.startsWith(projectUrl+'/'));assert.equal(init.headers.Authorization,'Bearer '+ownerToken);
 if(url.endsWith('/auth/v1/user'))return Response.json({id:owner,is_anonymous:anonymousOwner});
 assert.ok(url.endsWith('/rpc/is_minihompy_admin'));return Response.json(ownerAllowed);
};
const options={config,db:personal.db,fetcher};
async function centralCall(path,body){const r=await handleIdentityApiRequest(new Request(centralUrl+path,{method:'POST',body:JSON.stringify(body)}),centralOptions);assert.equal(r.status,200);return r.json();}
async function proof(target=siteB){const verifier=randomSecret();const p=await centralCall('/writing-proofs/issue',{central_session:centralSession,target_site_id:target,code_challenge:await sha256(verifier),return_path:'/home/',protocol:2,attempt_id:'test-attempt'});return {writing_proof:p.writing_proof,code_verifier:verifier,protocol:2,attempt_id:'test-attempt'};}
async function request(path,{body,token,mode='member',expected=200,overrides={},method}={}){
 const r=await handleMemberWriting(new Request(projectUrl+'/functions/v1/member-writing'+path,{method:method||(body===undefined?'GET':'POST'),headers:{Origin:config.MINIHOMPY_SITE_ORIGIN,'Content-Type':'application/json','X-Minihompy-Auth-Mode':mode,...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{...options,...overrides});
 lastHeaders=r.headers;const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));assert.equal(r.headers.get('Cache-Control'),'no-store');return data;
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
 await personal.pg.query('insert into auth.users(id) values($1)',[owner]);
 await personal.pg.query('insert into private.minihompy_admins values($1)',[owner]);
 const open=async()=>request('/sessions/exchange',{body:await proof()});
 const renew=(token,expected=200,overrides={})=>request('/sessions/renew',{body:{},token,expected,overrides});
 const relax=()=>central.pg.query('update private.identity_writing_delegations set last_renewed_at=null');
 let session,refreshed,postId=id(100);
 await check('v2 exchange stores private family and only browser token hashes',async()=>{
  session=await open();assert.match(session.renewal_token,/^[A-Za-z0-9_-]{43}$/);assert.ok(Date.parse(session.renewal_expires_at)>Date.parse(session.expires_at));
  const f=(await personal.pg.query('select * from private.member_writing_families')).rows[0];assert.equal(f.renewal_hash,await tokenHash(session.renewal_token));assert.equal(f.member_id,member);
  assert.ok(!JSON.stringify(f).includes(session.renewal_token));assert.ok(!JSON.stringify(session).includes(f.central_delegation));
  await request('/sessions/current',{token:session.session_token});
 });
 await check('renewal handle cannot read content, act as owner or replace an access token',async()=>{
  for(const path of ['/sessions/current','/guestbook','/comments?kind=guestbook&parent_id='+postId])await request(path,{token:session.renewal_token,expected:401});
  await request('/sessions/current',{token:session.renewal_token,mode:'owner',expected:401});await renew(session.session_token,401);
  await request('/sessions/renew',{body:{member_id:memberB},token:session.renewal_token,expected:400});
  await request('/sessions/renew',{body:{},token:session.renewal_token,mode:'public',expected:403});
  await request('/sessions/renew',{body:{},token:session.renewal_token,overrides:{config:{...config,MINIHOMPY_SITE_ID:siteA}},expected:503});
 });
 await check('expired access renews without proof, then creates private guestbook and comment',async()=>{
  await personal.pg.query("update private.member_writing_sessions set issued_at=now()-interval '16 minutes',expires_at=now()-interval '1 minute'");
  await request('/sessions/current',{token:session.session_token,expected:401});
  refreshed=await renew(session.renewal_token);assert.equal(refreshed.actor.member_id,member);assert.equal(refreshed.renewal_token,undefined);assert.ok(refreshed.session_token!==session.session_token);
  await request('/guestbook',{body:{request_id:id(101),id:postId,body:'renewal fixture private',visibility:'private'},token:refreshed.session_token});
  await request('/comments',{body:{request_id:id(102),kind:'guestbook',parent_id:postId,id:id(103),body:'renewal fixture comment'},token:refreshed.session_token});
  const publicList=await request('/guestbook',{mode:'public'});assert.ok(!JSON.stringify(publicList).includes('renewal fixture private'));
  const own=await request('/guestbook',{token:refreshed.session_token});assert.ok(JSON.stringify(own).includes('renewal fixture private'));
 });
 await check('concurrent renewals pass through central rate limit and preserve old valid token',async()=>{
  await relax();const res=await Promise.all([0,1].map(()=>handleMemberWriting(new Request(projectUrl+'/functions/v1/member-writing/sessions/renew',{method:'POST',headers:{'Content-Type':'application/json','X-Minihompy-Auth-Mode':'member',Authorization:'Bearer '+session.renewal_token},body:'{}'}),options)));
  assert.deepEqual(res.map(r=>r.status).sort(),[200,429]);assert.equal(res.find(r=>r.status===429).headers.get('Retry-After'),'1');assert.equal(res.find(r=>r.status===429).headers.get('Access-Control-Expose-Headers'),'Retry-After');
  await request('/sessions/current',{token:refreshed.session_token});
 });
 await check('central outage returns 503 and retains the same renewal handle',async()=>{
  offline=true;await renew(session.renewal_token,503);offline=false;await relax();refreshed=await renew(session.renewal_token);
 });
 await check('altered central identity is rejected and its grant revoked',async()=>{
  await relax();alterRenew=true;await renew(session.renewal_token,403);alterRenew=false;
  const latest=(await central.pg.query('select revoked_at from private.identity_writing_grants order by expires_at desc limit 1')).rows[0];assert.ok(latest.revoked_at);
 });
 await check('local logout during central renewal prevents local persistence',async()=>{
  await relax();activeRenewal=session.renewal_token;revokeDuringRenew=true;await renew(session.renewal_token,401);revokeDuringRenew=false;
  await request('/sessions/current',{token:refreshed.session_token,expected:401});
  assert.ok((await personal.pg.query('select cleanup_pending from private.member_writing_families')).rows[0].cleanup_pending);
  await request('/sessions/revoke',{body:{},token:session.renewal_token});
 });
 await check('logout failure disables all tokens locally and cleanup retries with renewal handle',async()=>{
  session=await open();refreshed=await renew(session.renewal_token);failRevoke=true;
  await request('/sessions/revoke',{body:{},token:session.session_token,expected:503});
  await request('/sessions/current',{token:refreshed.session_token,expected:401});await renew(session.renewal_token,401);failRevoke=false;
  await request('/sessions/revoke',{body:{},token:session.renewal_token});await request('/sessions/revoke',{body:{},token:session.renewal_token});
  const f=(await personal.pg.query('select * from private.member_writing_families where renewal_hash=$1',[await tokenHash(session.renewal_token)])).rows[0];assert.equal(f.cleanup_pending,false);
 });
 await check('fresh proof replaces old family and rejects replay',async()=>{
  session=await open();const p=await proof();refreshed=await request('/sessions/exchange',{body:p,token:session.renewal_token});
  await renew(session.renewal_token,401);await request('/sessions/exchange',{body:p,expected:409});session=refreshed;
 });
 await check('renewed identity edits and deletes its existing private content',async()=>{
  const fresh=await renew(session.renewal_token);
  await personal.pg.exec("update private.member_writing_limits set last_write=now()-interval '2 minutes',window_start=now(),writes=0");
  await request('/guestbook/'+postId,{method:'PATCH',token:fresh.session_token,body:{request_id:id(104),revision:1,body:'edited after renewal'}});
  await personal.pg.exec("update private.member_writing_limits set last_write=now()-interval '2 minutes',window_start=now(),writes=0");
  await request('/comments/'+id(103),{method:'PATCH',token:fresh.session_token,body:{request_id:id(105),kind:'guestbook',parent_id:postId,revision:1,body:'edited comment after renewal'}});
  await personal.pg.exec("update private.member_writing_limits set last_write=now()-interval '2 minutes',window_start=now(),writes=0");
  await request('/comments/'+id(103),{method:'DELETE',token:fresh.session_token,body:{request_id:id(106),kind:'guestbook',parent_id:postId,revision:2}});
  await personal.pg.exec("update private.member_writing_limits set last_write=now()-interval '2 minutes',window_start=now(),writes=0");
  await request('/guestbook/'+postId,{method:'DELETE',token:fresh.session_token,body:{request_id:id(107),revision:2}});
 });
 await check('local persistence failure revokes new central delegation and grant',async()=>{
  const before=(await personal.pg.query('select count(*)::int n from private.member_writing_families')).rows[0].n;
  const idsBefore=new Set((await central.pg.query('select delegation_hash from private.identity_writing_delegations')).rows.map(r=>r.delegation_hash));
  await request('/sessions/exchange',{body:await proof(),expected:503,overrides:{db:{rpc(name,args){if(args.p_action==='create_v2')return {error:{code:'XX000'}};return personal.db.rpc(name,args);}}}});
  assert.equal((await personal.pg.query('select count(*)::int n from private.member_writing_families')).rows[0].n,before);
  const added=(await central.pg.query('select delegation_hash,revoked_at from private.identity_writing_delegations')).rows.filter(r=>!idsBefore.has(r.delegation_hash));assert.equal(added.length,1);assert.ok(added[0].revoked_at);
 });
 await check('renewal persistence failure revokes only the new grant; family can retry',async()=>{
  await relax();const prior=new Set((await central.pg.query('select grant_hash from private.identity_writing_grants')).rows.map(r=>r.grant_hash));
  await renew(session.renewal_token,503,{db:{rpc(name,args){if(args.p_action==='renew_create')return {error:{code:'XX000'}};return personal.db.rpc(name,args);}}});
  const added=(await central.pg.query('select grant_hash,revoked_at from private.identity_writing_grants')).rows.filter(r=>!prior.has(r.grant_hash));assert.equal(added.length,1);assert.ok(added[0].revoked_at);
  await relax();await renew(session.renewal_token);
 });
 await check('private tables and old internal RPC cannot be called by browser or service directly',async()=>{
  for(const role of ['anon','authenticated','service_role']){await personal.pg.exec('set role '+role);try{
   await assert.rejects(personal.pg.query('select * from private.member_writing_families'));
   await assert.rejects(personal.pg.query("select public.member_writing_session_v1('site','{}')"));
  }finally{await personal.pg.exec('reset role');}}
 });
 await check('local family expiry rejects even valid access; central logout rejects all remaining renewal',async()=>{
  const f=(await personal.pg.query('select id from private.member_writing_families where renewal_hash=$1',[await tokenHash(session.renewal_token)])).rows[0];
  await personal.pg.query("update private.member_writing_families set issued_at=now()-interval '2 minutes',expires_at=now()-interval '1 minute' where id=$1",[f.id]);
  await renew(session.renewal_token,401);await request('/sessions/current',{token:session.session_token,expected:401});
  session=await open();await centralCall('/sessions/logout',{central_session:centralSession});await renew(session.renewal_token,401);await request('/sessions/current',{token:session.session_token,expected:401});
 });
 console.log(`PASS: ${groups} automatic renewal groups; actual central/personal SQL and API handlers. No hosted changes.`);
}finally{await personal.pg.close();await central.pg.close();}
