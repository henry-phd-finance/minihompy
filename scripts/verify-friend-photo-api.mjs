import {createServer} from 'node:http';
import {handlePhotoMedia} from '../supabase/functions/photo-media/handler.js';
import {digest,BUCKET} from '../supabase/functions/photo-media/io.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {createIdentityDb} from '../../minihompy-central/scripts/helpers/identity-db.mjs';
import {seedRelationships,member,site,session,id} from '../../minihompy-central/scripts/helpers/relationship-fixture.mjs';
import {handleIdentityApiRequest} from '../../minihompy-central/supabase/functions/identity-api/handler.js';
import {sha256,randomSecret} from '../../minihompy-central/supabase/functions/_shared/auth-proof.js';
import {signToken} from '../../minihompy-central/supabase/functions/_shared/tokens.js';
import {handleMemberWriting,tokenHash} from '../supabase/functions/member-writing/handler.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
const centralUrl='https://central.test/functions/v1/identity-api',secret='integration-fixture-only-secret-at-least-32-characters';
const central=await createIdentityDb(),homes={};let groups=0,centralDown=false,centralCalls=0,readChecks=0,mutateContext=null,afterContext=null,afterRead=null,dbTransform=null,oldDb=false,centralReply=null;
const options={supabaseClient:central.db,centralSecret:secret,allowedOrigins:new Set(['https://m1.test','https://m2.test']),transportPeerIp:'127.0.0.1'};
const request=(url,body,token,extra={})=>new Request(url,{method:extra.method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function centralCall(path,body,token){const r=await handleIdentityApiRequest(request(centralUrl+path,body,token),options),d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d;}
const fetcher=async(url,init={})=>{
 if(!url.startsWith(centralUrl)){
  const h=Object.values(homes).find(h=>url.startsWith(h.config.SUPABASE_URL));assert.ok(h,'Unknown HTTP destination');assert.equal(init.headers.Authorization,'Bearer owner.valid.jwt');
  if(url.endsWith('/auth/v1/user'))return Response.json({id:h.owner,is_anonymous:false});
  if(url.endsWith('/is_minihompy_admin'))return new Response(String((await h.pg.query('select exists(select 1 from private.minihompy_admins where user_id=$1) b',[h.owner])).rows[0].b));
  throw Error('Unexpected owner request');
 }
 centralCalls++;if(centralDown)throw Error('Central unavailable');assert.equal(init.headers?.Origin,undefined);assert.equal(init.credentials,'omit');
 if(url.endsWith('/read-context')){readChecks++;if(centralReply)return centralReply();}
 const r=await handleIdentityApiRequest(new Request(url,init),options);
 if(url.endsWith('/read-context')&&r.ok){let d=await r.json();if(mutateContext)d=mutateContext(d);if(afterContext){const f=afterContext;afterContext=null;await f();}return Response.json(d);}
 return r;
};
async function call(home,path,body,credential,expected=200,mode='member',extra={}){
 const h=homes[home],req=request(h.config.SUPABASE_URL+'/functions/v1/member-writing'+path,body,credential,{Origin:h.config.MINIHOMPY_SITE_ORIGIN,'X-Minihompy-Auth-Mode':mode,...extra});
 const r=await handleMemberWriting(req,{config:h.config,fetcher,db:{rpc:async(name,args)=>{
  if(oldDb&&name==='friend_visibility_status')return {error:{code:'42883'}};
  let value=await h.db.rpc(name,args);
  if(name==='member_content_read'||name==='member_content_comments'){if(afterRead){const f=afterRead;afterRead=null;await f();}if(dbTransform)value=dbTransform(value);}
  return value;
 }}});const data=await r.json();assert.equal(r.status,expected,path+' '+JSON.stringify(data));assert.equal(r.headers.get('Cache-Control'),(path.startsWith('/content/')||path.startsWith('/comments'))?'private, no-store':'no-store');
 if(path.startsWith('/content/'))assert.equal(r.headers.get('Vary'),'Origin, Authorization, X-Minihompy-Auth-Mode');return {data,r};
}
async function login(n,home){const now=Math.floor(Date.now()/1000),verifier=randomSecret(),attempt=randomUUID(),token=await signToken({kind:'central_session',sub:member(n),central_session_id:session(n),session_version:1,iat:now,exp:now+86400},secret);
 const p=await centralCall('/writing-proofs/issue',{central_session:token,target_site_id:site(home),code_challenge:await sha256(verifier),protocol:2,attempt_id:attempt,return_path:'/home/'});
 return (await call(home,'/sessions/exchange',{writing_proof:p.writing_proof,code_verifier:verifier,protocol:2,attempt_id:attempt})).data.session_token;
}
const post=(kind,n)=>id(({board:1000,photos:2000,diary:3000})[kind]+n),tables={board:'board_posts',photos:'photo_posts',diary:'diary_entries'};
const state=async(h,t,n)=>(await call(h,'/relationships/state',{target_member_id:member(n)},t)).data;
const act=async(h,t,n,verb)=>{const s=await state(h,t,n);return (await call(h,'/relationships/actions',{operation_id:randomUUID(),target_member_id:member(n),action:verb,expected_revision:s.revision,...(verb==='request'?{}:{request_id:s.request_id})},t)).data;};
const list=(t,mode='member',home=2,body={kind:'board'},status=200)=>call(home,'/content/list',body,t,status,mode);
const detail=(t,kind='board',n=1,status=200,mode='member')=>call(2,'/content/detail',{kind,id:post(kind,n)},t,status,mode);
const check=async(name,fn)=>{await fn();console.log(`PASS ${++groups}: ${name}`);};
let ab,aa,ba,cb;
try{
 await central.pg.exec('reset role');await seedRelationships(central.pg,3);await central.pg.exec('set role service_role');
 for(const n of [1,2]){
  const h=await memberWritingDb(PGlite,{siteId:site(n),centralUrl,photoMedia:true,friendVisibility:true});h.owner=id(300+n);h.config={MINIHOMPY_SITE_ORIGIN:`https://m${n}.test`,MINIHOMPY_SITE_ID:site(n),MINIHOMPY_CENTRAL_API_URL:centralUrl,SUPABASE_URL:`https://${String.fromCharCode(96+n).repeat(20)}.supabase.co`,MINIHOMPY_PUBLIC_KEY:'fixture'};homes[n]=h;
  await h.pg.query('insert into auth.users values($1)',[h.owner]);await h.pg.query('insert into private.minihompy_admins values($1)',[h.owner]);
  await h.pg.query('update private.friend_visibility_state set owner_member_id=$1,media_ready=true,summary_ready=true,pages_ready=true,ready=true',[member(n)]);await h.pg.query("update private.photo_media_state set mode='protected',ready=true");await h.pg.query("select set_config('request.jwt.claim.sub',$1,false)",[h.owner]);
  for(const kind of Object.keys(tables))for(const i of [0,1,2]){
   const p=post(kind,i),v=['public','friends','private'][i];
   if(kind==='board')await h.pg.query("insert into public.board_posts(id,folder_id,author_id,author_name,title,body,visibility) select $1,id,$2,'owner','title','body',$3 from public.board_folders limit 1",[p,h.owner,v]);
   if(kind==='diary')await h.pg.query("insert into public.diary_entries(id,folder_id,author_id,author_name,entry_date,entry_time,body,visibility) select $1,id,$2,'owner','2026-09-24','12:30','diary',$3 from public.diary_folders limit 1",[p,h.owner,v]);
   if(kind==='photos'){const path=p+'/'+id(999)+'.png';await h.pg.query("insert into private.photo_assets(path,post_id,uploaded_by,complete,size,mime,sha256) values($1,$2,$3,true,1,'image/png',$4)",[path,p,h.owner,'b'.repeat(64)]);await h.pg.query("insert into public.photo_posts(id,folder_id,author_id,author_name,title,body,visibility) select $1,id,$2,'owner','photo',$3,$4 from public.photo_folders limit 1",[p,h.owner,JSON.stringify([{type:'image',path}]),v]);}
  }
  await h.pg.query("select set_config('request.jwt.claim.sub','',false)");
 }
 ab=await login(1,2);aa=await login(1,1);ba=await login(2,1);cb=await login(3,2);


 const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
 for(const h of Object.values(homes))await h.pg.query('update private.photo_assets set size=$1,sha256=$2',[png.length,await digest(png)]);
 const path=n=>post('photos',n)+'/'+id(999)+'.png';let afterGet,reads=0,badBytes=false,lastRpc;
 const storage={get:async(bucket,p,signal)=>{assert.equal(bucket,BUCKET);assert.ok(signal);reads++;if(afterGet){const f=afterGet;afterGet=null;await f(signal);}return badBytes?new Uint8Array([1,2]):png.slice();}};
 const photo=async(n=1,{token=ab,mode='member',status=200,body,home=2,action='read',extra={},override={}}={})=>{
  const h=homes[home],headers={Origin:h.config.MINIHOMPY_SITE_ORIGIN,'X-Minihompy-Auth-Mode':mode,...extra};
  const req=request(h.config.SUPABASE_URL+'/functions/v1/photo-media/'+action,body||{post_id:post('photos',n),path:path(n)},token,headers);
  const response=await handlePhotoMedia(req,{env:{...h.config,SUPABASE_SERVICE_ROLE_KEY:'fixture'},fetcher,storage,db:{rpc:async(name,args)=>{const r=await h.db.rpc(name,args);if(lastRpc&&name==='member_photo_read'){const f=lastRpc;lastRpc=null;await f();}return r;}},rpc:async(action,args)=>(await h.pg.query('select public.photo_media($1,$2) r',[action,args])).rows[0].r,...override});
  assert.equal(response.status,status,status===200?await response.clone().text():JSON.stringify(await response.clone().json()));
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Vary'),'Origin, Authorization, X-Minihompy-Auth-Mode');
  if(status===200){assert.deepEqual(new Uint8Array(await response.arrayBuffer()),png);assert.equal(response.headers.get('Content-Type'),'image/png');}return response;
 };
 await check('nonfriend/pending/public denied before file fetch; accepted request verifies twice and sends actual PNG bytes',async()=>{
  await photo(1,{status:404});await photo(1,{token:null,mode:'public',status:404});assert.equal(reads,0);
  await act(2,ab,2,'request');await photo(1,{status:404});await act(1,ba,1,'accept');const before=readChecks;await photo();assert.equal(readChecks,before+2);
 });
 await check('public, owner and private boundaries; no member upload or cleanup, no credential downgrade',async()=>{
  await photo(0,{token:null,mode:'public'});await photo(2,{status:404});await photo(2,{token:'owner.valid.jwt',mode:'owner'});
  await photo(1,{action:'upload',status:403});await photo(1,{action:'cleanup',status:403});await photo(1,{token:'owner.valid.jwt',status:401});await photo(1,{mode:'owner',status:401});await photo(1,{mode:'public',status:400});
 });
 await check('post/path, site token, browser context injection, range and wrong origin fail closed',async()=>{
  await photo(1,{body:{post_id:post('photos',1),path:path(0)},status:400});await photo(1,{body:{post_id:post('photos',1),path:path(1),context:{}},status:400});
  await photo(1,{token:aa,status:401});await photo(1,{extra:{Range:'bytes=0-1'},status:400});await photo(1,{extra:{Origin:'https://wrong.test'},status:403});
 });
 await check('disconnect during file read discards buffered bytes; reconnect restores access',async()=>{
  afterGet=()=>act(2,ab,2,'disconnect');await photo(1,{status:404});await act(1,ba,1,'request');await act(2,ab,2,'accept');await photo();
 });
 const visibility=v=>homes[2].pg.query("select set_config('request.jwt.claim.sub',$1,false)",[homes[2].owner]).then(()=>homes[2].pg.query('update public.photo_posts set visibility=$1 where id=$2',[v,post('photos',1)]));
 await check('private transition during file read and after first SQL refuses bytes',async()=>{
  afterGet=()=>visibility('private');await photo(1,{status:404});await visibility('friends');lastRpc=()=>visibility('private');await photo(1,{status:404});await visibility('friends');
 });
 await check('metadata/file tampering and central outage or altered context do not return bytes',async()=>{
  badBytes=true;await photo(1,{status:503});badBytes=false;centralDown=true;await photo(1,{status:503});await photo(0,{token:null,mode:'public'});centralDown=false;
  mutateContext=d=>({...d,site_id:site(1)});await photo(1,{status:403});mutateContext=null;
  afterGet=()=>homes[2].pg.query("update private.photo_assets set sha256=$1 where path=$2",['c'.repeat(64),path(1)]);await photo(1,{status:404});await homes[2].pg.query('update private.photo_assets set sha256=$1 where path=$2',[await digest(png),path(1)]);
 });
 await check('local logout while buffering wins; independent new login reads successfully',async()=>{
  afterGet=async()=>homes[2].db.rpc('member_writing_session',{p_action:'revoke',p_args:{site_id:site(2),token_hash:await tokenHash(ab)}});await photo(1,{status:401});ab=await login(1,2);await photo();
 });
 await check('central 429 preserved and late final SQL cannot send successful response',async()=>{
  centralReply=()=>Response.json({}, {status:429,headers:{'Retry-After':'3'}});const r=await photo(1,{status:429});assert.equal(r.headers.get('Retry-After'),'3');centralReply=null;
  let count=0;const h=homes[2];await photo(1,{status:503,override:{db:{rpc:async(name,args)=>{const r=await h.db.rpc(name,args);if(name==='member_photo_read'&&++count===2)await new Promise(r=>setTimeout(r,4100));return r;}}}});
 });
 await check('logout after final metadata denies response; request abort reaches pending Storage fetch',async()=>{
  const h=homes[2];let count=0;
  await photo(1,{status:401,override:{db:{rpc:async(name,args)=>{const r=await h.db.rpc(name,args);if(name==='member_photo_read'&&++count===2)await h.db.rpc('member_writing_session',{p_action:'revoke',p_args:{site_id:site(2),token_hash:await tokenHash(ab)}});return r;}}}});ab=await login(1,2);
  const controller=new AbortController();let seen;
  const req=new Request(h.config.SUPABASE_URL+'/functions/v1/photo-media/read',{method:'POST',signal:controller.signal,headers:{Origin:h.config.MINIHOMPY_SITE_ORIGIN,'Content-Type':'application/json',Authorization:'Bearer '+ab,'X-Minihompy-Auth-Mode':'member'},body:JSON.stringify({post_id:post('photos',1),path:path(1)})});
  const r=await handlePhotoMedia(req,{env:{...h.config,SUPABASE_SERVICE_ROLE_KEY:'fixture'},fetcher,db:h.db,storage:{get:async(bucket,path,signal)=>{seen=signal;controller.abort();return new Promise(()=>{});}}});assert.equal(r.status,503);assert.equal(seen.aborted,true);
 });
 await check('production service RPC and Storage adapters over loopback HTTP return real bytes without URL/sign/transform',async()=>{
  const seen=[],h=homes[2];
  const server=createServer(async(req,res)=>{try{
   assert.equal(req.headers.authorization,'Bearer fixture');seen.push(req.url);
   if(req.url.startsWith('/rest/v1/rpc/')){let text='';for await(const chunk of req)text+=chunk;const value=await h.db.rpc(req.url.split('/').at(-1),JSON.parse(text));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value.data));}
   else{assert.equal(req.url,'/storage/v1/object/authenticated/'+BUCKET+'/'+path(1));res.setHeader('Content-Type','image/png');res.end(png);}
  }catch(e){res.statusCode=500;res.end('{}');}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{const bridge=(url,init)=>url.startsWith(h.config.SUPABASE_URL)?fetch('http://127.0.0.1:'+server.address().port+url.slice(h.config.SUPABASE_URL.length),init):fetcher(url,init);
   await photo(1,{override:{db:undefined,rpc:undefined,storage:undefined,fetcher:bridge}});
   assert.equal(seen.filter(x=>x.endsWith('/member_photo_read')).length,2);assert.equal(seen.filter(x=>x.startsWith('/storage/')).length,1);assert.ok(seen.every(x=>!x.includes('/sign/')&&!x.includes('/public/')&&!x.includes('/render/')&&!x.includes('/list/')));
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 });
 console.log(`All ${groups} friend photo central/personal API groups passed; actual PNG bytes, local Storage and Auth fixtures, no hosted writes.`);
}finally{for(const h of Object.values(homes))await h.pg.close();await central.pg.close();}
