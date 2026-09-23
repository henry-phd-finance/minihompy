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
async function request(path,{body,token,mode='member',expected=200,overrides={}}={}){
 const r=await handleMemberWriting(new Request(projectUrl+'/functions/v1/member-writing'+path,{method:body===undefined?'GET':'POST',headers:{Origin:config.MINIHOMPY_SITE_ORIGIN,'Content-Type':'application/json','X-Minihompy-Auth-Mode':mode,...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{...options,...overrides});
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
 let session;
 await check('real central proof exchanges for personal opaque session; DB stores hash only',async()=>{
  session=await request('/sessions/exchange',{body:await proof()});assert.equal(session.actor.member_id,member);assert.equal(session.actor.role,'writer');
  const row=(await personal.pg.query('select * from private.member_writing_sessions')).rows[0];assert.equal(row.token_hash,await tokenHash(session.session_token));assert.ok(!JSON.stringify(row).includes(session.session_token));
  assert.ok(!JSON.stringify(session).includes(row.central_grant));assert.equal((await request('/sessions/current',{token:session.session_token})).actor.member_id,member);
 });
 await check('wrong target, altered proof, PKCE and caller-supplied identity are denied',async()=>{
  await request('/sessions/exchange',{body:await proof(siteA),expected:403});
  const p=await proof();await request('/sessions/exchange',{body:{...p,writing_proof:p.writing_proof+'x'},expected:401});
  await request('/sessions/exchange',{body:{...p,code_verifier:randomSecret()},expected:403});
  await request('/sessions/exchange',{body:{...p,member_id:memberB},expected:400});
  await request('/sessions/current',{token:randomSecret(),expected:401});
  await request('/sessions/current',{token:ownerToken,expected:401});
  await request('/sessions/current',{token:session.session_token,overrides:{config:{...config,MINIHOMPY_SITE_ID:siteA}},expected:503});
 });
 await check('renewal revokes the old session and consumes a fresh proof',async()=>{
  const old=session,p=await proof();session=await request('/sessions/exchange',{body:p,token:old.session_token});
  await request('/sessions/current',{token:old.session_token,expected:401});
  await request('/sessions/exchange',{body:p,expected:409});
 });
 await check('central outage has no anonymous fallback; local logout race wins',async()=>{
  offline=true;const failure=await request('/sessions/current',{token:session.session_token,expected:503});assert.ok(!JSON.stringify(failure).includes('diagnostic'));offline=false;
  revokeDuringCheck=true;await request('/sessions/current',{token:session.session_token,expected:401});revokeDuringCheck=false;
  session=await request('/sessions/exchange',{body:await proof()});
 });
 await check('revocation fails closed locally, retries central cleanup, and is idempotent',async()=>{
  failRevoke=true;await request('/sessions/revoke',{body:{},token:session.session_token,expected:503});
  await request('/sessions/current',{token:session.session_token,expected:401});failRevoke=false;
  await request('/sessions/revoke',{body:{},token:session.session_token});await request('/sessions/revoke',{body:{},token:session.session_token});
  session=await request('/sessions/exchange',{body:await proof()});
 });
 await check('owner mode requires personal Auth and admin RPC, never central member authority',async()=>{
  await request('/sessions/current',{mode:'owner',token:session.session_token,expected:401});
  assert.equal((await request('/sessions/current',{mode:'owner',token:ownerToken})).actor.role,'admin');
  ownerAllowed=false;await request('/sessions/current',{mode:'owner',token:ownerToken,expected:403});ownerAllowed=true;
  anonymousOwner=true;await request('/sessions/current',{mode:'owner',token:ownerToken,expected:403});anonymousOwner=false;
  await request('/sessions/current',{mode:'public',expected:403});await request('/sessions/current',{mode:'unknown',expected:400});
 });
 await check('browser roles cannot invoke session RPC or inspect private state',async()=>{
  for(const role of ['anon','authenticated']){
   await personal.pg.exec('set role '+role);try{await assert.rejects(personal.pg.query("select public.member_writing_session('site','{}')"));await assert.rejects(personal.pg.query('select * from private.member_writing_sessions'));}finally{await personal.pg.exec('reset role');}
  }
  await personal.pg.exec('set role service_role');try{await assert.rejects(personal.pg.query('select * from private.member_writing_sessions'));}finally{await personal.pg.exec('reset role');}
 });
 await check('mismatched central identity, forbidden origin and oversized bodies fail closed',async()=>{
  await request('/sessions/current',{token:session.session_token,expected:403,overrides:{fetcher:async(url,init)=>{
   const r=await fetcher(url,init);if(url.endsWith('/writing-grants/check')){const d=await r.json();d.member.id=memberB;return Response.json(d);}return r;
  }}});
  const cors=await handleMemberWriting(new Request(projectUrl+'/functions/v1/member-writing/sessions/current',{headers:{Origin:'https://evil.test'}}),options);assert.equal(cors.status,403);
  const big=await handleMemberWriting(new Request(projectUrl+'/functions/v1/member-writing/sessions/exchange',{method:'POST',headers:{'Content-Type':'application/json','X-Minihompy-Auth-Mode':'member'},body:JSON.stringify({writing_proof:'x'.repeat(17000)})}),options);assert.equal(big.status,400);
 });
 await check('failed local persistence revokes the consumed central grant and returns no token',async()=>{
  const before=(await personal.pg.query('select count(*)::int as n from private.member_writing_sessions')).rows[0].n;
  const result=await request('/sessions/exchange',{body:await proof(),expected:503,overrides:{db:{rpc:async(name,args)=>args.p_action==='create'?{error:{code:'XX000'}}:personal.db.rpc(name,args)}}});
  assert.equal(result.session_token,undefined);
  assert.equal((await personal.pg.query('select count(*)::int as n from private.member_writing_sessions')).rows[0].n,before);
  const rows=(await central.pg.query('select revoked_at from private.identity_writing_grants order by expires_at desc limit 1')).rows;assert.ok(rows[0].revoked_at);
 });
 await check('expired local sessions and centrally revoked login are rejected',async()=>{
  await personal.pg.query("update private.member_writing_sessions set issued_at=now()-interval '16 minutes',expires_at=now()-interval '1 minute' where token_hash=$1",[await tokenHash(session.session_token)]);
  await request('/sessions/current',{token:session.session_token,expected:401});
  session=await request('/sessions/exchange',{body:await proof()});await centralCall('/sessions/logout',{central_session:centralSession});
  await request('/sessions/current',{token:session.session_token,expected:401});
 });
 const gateway=await handleMemberWriting(new Request(projectUrl+'/member-writing/sessions/current',{headers:{Authorization:'Bearer '+ownerToken,'X-Minihompy-Auth-Mode':'owner'}}),options);assert.equal(gateway.status,200);
 console.log(`PASS: ${groups} personal session integration groups; actual central/personal SQL and handlers, no hosted changes.`);
}finally{await personal.pg.close();await central.pg.close();}
