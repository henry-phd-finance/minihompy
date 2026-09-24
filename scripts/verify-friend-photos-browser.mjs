import {handlePhotoMedia} from '../supabase/functions/photo-media/handler.js';
import {digest,BUCKET,fail} from '../supabase/functions/photo-media/io.js';
import {browserBackend,sqlTransport} from './helpers/home-browser-db.mjs';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
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
  if(name==='member_content_read'||name==='member_content_aggregate'){if(afterRead){const f=afterRead;afterRead=null;await f();}if(dbTransform)value=dbTransform(value);}
  return value;
 }}});const data=await r.json();assert.equal(r.status,expected,path+' '+JSON.stringify(data));assert.equal(r.headers.get('Cache-Control'),(path.startsWith('/content/')||path.startsWith('/comments'))?'private, no-store':'no-store');
 if(path.startsWith('/content/'))assert.equal(r.headers.get('Vary'),'Origin, Authorization, X-Minihompy-Auth-Mode');return {data,r};
}
async function login(n,home){const now=Math.floor(Date.now()/1000),verifier=randomSecret(),attempt=randomUUID(),token=await signToken({kind:'central_session',sub:member(n),central_session_id:session(n),session_version:1,iat:now,exp:now+86400},secret);
 const p=await centralCall('/writing-proofs/issue',{central_session:token,target_site_id:site(home),code_challenge:await sha256(verifier),protocol:2,attempt_id:attempt,return_path:'/home/'});
 const data=(await call(home,'/sessions/exchange',{writing_proof:p.writing_proof,code_verifier:verifier,protocol:2,attempt_id:attempt})).data;sessions[n+':'+home]=data;return data.session_token;
}
const post=(kind,n)=>id(({board:1000,photos:2000,diary:3000})[kind]+n),tables={board:'board_posts',photos:'photo_posts',diary:'diary_entries'};
const state=async(h,t,n)=>(await call(h,'/relationships/state',{target_member_id:member(n)},t)).data;
const act=async(h,t,n,verb)=>{const s=await state(h,t,n);return (await call(h,'/relationships/actions',{operation_id:randomUUID(),target_member_id:member(n),action:verb,expected_revision:s.revision,...(verb==='request'?{}:{request_id:s.request_id})},t)).data;};
const list=(t,mode='member',home=2,body={kind:'board'},status=200)=>call(home,'/content/list',body,t,status,mode);
const detail=(t,kind='board',n=1,status=200,mode='member')=>call(2,'/content/detail',{kind,id:post(kind,n)},t,status,mode);
const check=async(name,fn)=>{await fn();console.log(`PASS ${++groups}: ${name}`);};
let ab,aa,ba,cb;const sessions={};
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



 await act(2,ab,2,'request');await act(1,ba,1,'accept');

 const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
 for(const h of Object.values(homes))await h.pg.query('update private.photo_assets set size=$1,sha256=$2',[png.length,await digest(png)]);
 const {chromium}=await import(pathToFileURL(resolve(process.argv[2])));const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
 const out=process.env.VERIFICATION_DIR||'docs/verification/friend-visibility-step10';await mkdir(out,{recursive:true});
 try{for(const width of [1280,375]){
 await central.pg.exec("reset role; delete from private.identity_relationship_limits; update private.identity_relationship_cooldowns set requested_at=clock_timestamp()-interval '2 minutes'; set role service_role");
 const page=await browser.newPage({viewport:{width,height:820}}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const h=homes[2],transport=sqlTransport(h.pg,{owner:h.owner});let hold=false,holdReply=false,release=null,mediaReads=0,failImage=false;const modes=[];
 const files=['member-writing-client.js','member-writing-runtime.js','content-access.js','post-routes.js','post-location-repository.js','photo-media-client.js','photos-repository.js','photo-editor.js','comments-repository.js','comments.js','views/photos.js','assets/vendor/quill-2.0.3.js'];
 // Quill must exist before the user opens the real editor.
 files.unshift(files.pop());
 const assets=new Map();for(const row of (await h.pg.query('select path from private.photo_assets')).rows)assets.set(row.path,png.slice());
 const db={rpc:(name,args)=>transport.run(()=>h.db.rpc(name,args))};
 const rpc=(action,args)=>transport.run(async()=>{await h.pg.exec('set role service_role');try{return (await h.pg.query('select public.photo_media($1,$2) r',[action,args])).rows[0].r;}finally{await h.pg.exec('reset role');}});
 const storage={get:async(bucket,p)=>{assert.equal(bucket,BUCKET);if(hold){hold=false;await new Promise(r=>release=r);}if(failImage)fail('NOT_FOUND');const b=assets.get(p);if(!b)fail('NOT_FOUND');return b.slice();},put:async(bucket,p,b)=>{assert.equal(bucket,BUCKET);assets.set(p,b.slice());},remove:async(bucket,paths)=>{assert.equal(bucket,BUCKET);for(const p of paths)assets.delete(p);}};
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/fixture-db')return route.fulfill({json:await transport.handle(req.postDataJSON())});
  if(req.url().startsWith(h.config.SUPABASE_URL)){
   const r=new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postDataBuffer()?{body:req.postDataBuffer()}:{})});
   const media=url.pathname.includes('/photo-media/');
   if(media&&url.pathname.endsWith('/read')){mediaReads++;modes.push(req.headers()['x-minihompy-auth-mode']);}
   const res=media?await handlePhotoMedia(r,{env:{...h.config,SUPABASE_SERVICE_ROLE_KEY:'fixture'},fetcher,db,rpc,storage}):await handleMemberWriting(r,{config:h.config,fetcher,db});
   const payload={status:res.status,headers:Object.fromEntries(res.headers),body:Buffer.from(await res.arrayBuffer())};
   if(media&&res.ok&&holdReply){holdReply=false;await new Promise(r=>release=r);}
   return route.fulfill(payload).catch(()=>{});
  }
  const name=url.pathname.slice(1);
  if(files.includes(name))return route.fulfill({contentType:'text/javascript',body:await readFile(name,'utf8')});
  if(name==='styles.css')return route.fulfill({contentType:'text/css',body:await readFile(name,'utf8')});
  const setup=browserBackend+`window.fixtureIds={owner:${JSON.stringify(h.owner)}};window.MINIHOMPY_VIEWS={home:{createLeft:()=>document.createDocumentFragment(),createMain:()=>document.createDocumentFragment()}};window.MINIHOMPY_CONFIG={profile:{name:'Owner'}};window.MINIHOMPY_SUPABASE={url:${JSON.stringify(h.config.SUPABASE_URL)},publishableKey:'fixture'};window.MINIHOMPY_VISITOR_IDENTITY_CONFIG={enabled:true,siteId:${JSON.stringify(site(2))}};window.MINIHOMPY_MEMBER_WRITING_CONFIG={enabled:true};window.MinihompySharedIdentity={state:{status:'identified',visitor:{id:${JSON.stringify(member(1))}}}};MinihompyBackend.getClient().auth={getSession:async()=>({data:{session:{access_token:'owner.valid.jwt',user:{id:fixtureIds.owner}}}})};window.setUser=data=>{const key='minihompy.member-writing.v1:'+MINIHOMPY_VISITOR_IDENTITY_CONFIG.siteId+':'+MINIHOMPY_SUPABASE.url;sessionStorage.setItem(key,data.session_token);sessionStorage.setItem(key+':renewal',data.renewal_token);sessionStorage.setItem('minihompy.writing.pending:'+MINIHOMPY_VISITOR_IDENTITY_CONFIG.siteId+':member',data.actor.member_id);MinihompySharedIdentity.state={status:'identified',visitor:{id:data.actor.member_id}};dispatchEvent(new Event('minihompy:identity'));dispatchEvent(new Event('minihompy:visitor-identity'));};setUser(${JSON.stringify(sessions['1:2'])});window.createdBlobs=[];window.revokedBlobs=[];const make=URL.createObjectURL.bind(URL),drop=URL.revokeObjectURL.bind(URL);URL.createObjectURL=b=>{const u=make(b);createdBlobs.push(u);return u;};URL.revokeObjectURL=u=>{revokedBlobs.push(u);drop(u);};`;
  const navigation=`let previous=null;window.navigate=()=>{const r=MinihompyPostRoutes.parse(location.hash);if(!MINIHOMPY_VIEWS[r.id])return;MinihompyPostRoutes.leave(previous);previous=r.id;document.querySelector('#left').replaceChildren(MINIHOMPY_VIEWS[r.id].createLeft());document.querySelector('#main').replaceChildren(MINIHOMPY_VIEWS[r.id].createMain(r));};window.addEventListener('hashchange',navigate);navigate();`;
  return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css"><style>#layout{display:grid;grid-template-columns:150px minmax(0,1fr);max-width:850px;height:650px}#main{min-width:0;position:relative}.photos-scroll{height:600px;overflow:auto}@media(max-width:500px){#layout{grid-template-columns:90px minmax(0,1fr)}}</style><span id="member-session-status"></span><button id="member-session-retry" hidden>인증 재시도</button><nav><a href="#/photos">사진첩</a><a href="#/home">홈</a></nav><div id="layout"><div id="left"></div><div id="main"></div></div><script>'+setup+'</script>'+files.map(f=>'<script src="'+f+'"></script>').join('')+'<script>'+navigation+'</script>'});
 });
 const target='[data-post="'+post('photos',1)+'"]',go=async(n=1)=>page.evaluate(hash=>{location.hash=hash;},'#/photos?post='+post('photos',n));
 const loaded=()=>page.waitForFunction(()=>{const imgs=[...document.querySelectorAll('.photo-image')];return imgs.length&&imgs.every(i=>i.complete&&i.naturalWidth&&i.src.startsWith('blob:'));}).catch(async e=>{console.log('LOAD FAILURE',await page.locator('#main').innerText());throw e;});
 const invisible=async()=>{assert.equal(await page.locator('.photo-post,.photo-count,.photo-comment,.photo-image').count(),0);};
 const held=async()=>{for(let i=0;!release&&i<300;i++)await page.waitForTimeout(10);assert.ok(release);};
 const finish=()=>{const f=release;release=null;f();};
 const focus=()=>page.evaluate(()=>dispatchEvent(new Event('focus')));
 const visibility=async value=>transport.run(async()=>{await h.pg.query("select set_config('request.jwt.claim.sub',$1,false)",[h.owner]);try{await h.pg.query('update public.photo_posts set visibility=$1 where id=$2',[value,post('photos',1)]);}finally{await h.pg.query("select set_config('request.jwt.claim.sub','',false)");}});
 await page.goto('https://m2.test/#/photos?post='+post('photos',1));await loaded();assert.ok(modes.includes('member'));assert.equal(await page.locator(target+' .photo-privacy').innerText(),'공개설정 : 일촌 공개');
 const url=await page.locator(target+' img').getAttribute('src');assert.deepEqual(await page.evaluate(async u=>[...new Uint8Array(await (await fetch(u)).arrayBuffer())],url),[...png]);
 await transport.run(()=>h.pg.query("update private.member_writing_limits set last_write=clock_timestamp()-interval '1 minute'"));
 await page.locator(target+' .comment-body').fill('friend photo comment '+width);await page.locator(target+' .comment-save').click();await page.locator('.photo-comment').filter({hasText:'friend photo comment '+width}).first().waitFor();
 await page.reload();await loaded();await page.getByRole('link',{name:'홈',exact:true}).click();await page.goBack();await loaded();await page.goForward();await page.goBack();await loaded();
 await page.screenshot({path:out+'/photos-'+width+'.png'});console.log('PASS '+width+': actual friend PNG bytes, comments, direct address and history');
 const currentUrl=await page.locator(target+' img').getAttribute('src');hold=true;await focus();await held();await invisible();await page.evaluate(data=>setUser(data),sessions['3:2']);await page.locator('.photo-retry').waitFor();finish();await page.waitForTimeout(50);await invisible();assert.ok(await page.evaluate(u=>revokedBlobs.includes(u),currentUrl));
 await page.evaluate(data=>setUser(data),sessions['1:2']);await loaded();hold=true;await focus();await held();await page.getByRole('link',{name:'홈',exact:true}).click();finish();await page.waitForTimeout(50);await invisible();assert.equal(await page.evaluate(()=>createdBlobs.filter(u=>!revokedBlobs.includes(u)).length),0);await go();await loaded();
 console.log('PASS '+width+': account and menu changes discard held bytes, metadata, comments and blob URLs');
 holdReply=true;await focus();await held();await visibility('private');finish();await page.locator('.photo-retry').waitFor();await invisible();assert.equal(await page.evaluate(()=>createdBlobs.filter(u=>!revokedBlobs.includes(u)).length),0);await visibility('friends');await page.locator('.photo-retry').click();await loaded();
 hold=true;await focus();await held();await visibility('private');finish();await page.locator('.photo-retry').waitFor();await invisible();await visibility('friends');await page.locator('.photo-retry').click();await loaded();
 hold=true;await focus();await held();await act(1,ba,1,'disconnect');finish();await page.locator('.photo-retry').waitFor();await invisible();await act(1,ba,1,'request');await act(2,ab,2,'accept');await page.locator('.photo-retry').click();await loaded();
 failImage=true;await focus();await page.locator('.photo-retry').waitFor();await invisible();const reads=mediaReads;failImage=false;await page.locator('.photo-retry').click();await loaded();assert.ok(mediaReads>reads);
 centralDown=true;await focus();await page.locator('.photo-retry').waitFor();await invisible();centralDown=false;await page.locator('.photo-retry').click();await loaded();
 console.log('PASS '+width+': private change/disconnect during storage, image and central failure clear entire page; fresh retry recovers');
 await page.evaluate(()=>{MinihompySharedIdentity.state={status:'anonymous'};dispatchEvent(new Event('minihompy:visitor-identity'));});await page.locator('.photo-retry').waitFor();await invisible();await go(0);await loaded();assert.ok(modes.includes('public'));assert.equal(await page.locator('[data-post="'+post('photos',1)+'"]').count(),0);await go(2);await page.locator('.photo-retry').waitFor();await invisible();
 await page.evaluate(()=>setActor('owner'));await loaded();assert.ok(modes.includes('owner'));await go();await loaded();await page.locator(target+' .photo-edit').focus();await page.keyboard.press('Enter');await page.locator('.photo-editor-visibility').selectOption('friends');await page.locator('.photo-editor-title').fill('friend photo edited');await page.locator('.photo-save').click();await loaded();assert.equal(await page.locator(target+' .photo-post-title').innerText(),'friend photo edited');
 await page.locator(target+' .photo-visibility').click();await loaded();assert.ok((await page.locator(target+' .photo-privacy').innerText()).includes('나만보기'));await page.locator(target+' .photo-visibility').click();await loaded();await page.locator(target+' .photo-friends').click();await loaded();
 console.log('PASS '+width+': anonymous public/private separation; owner private/member read, keyboard editor and all visibility modes');
 await page.locator('.photo-write').click();await page.locator('.photo-editor-title').fill('new friend upload');await page.locator('.photo-editor-visibility').selectOption('friends');await page.locator('.photo-editor-file').setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from(png)});await page.waitForFunction(()=>!MinihompyPhotoEditor.busy&&document.querySelector('.ql-editor img')?.naturalWidth>0);await page.locator('.photo-save').click();await loaded();
 const newPost=page.locator('.photo-post').filter({has:page.getByText('new friend upload',{exact:true})});await newPost.waitFor();const newId=await newPost.getAttribute('data-post');const newPaths=[...assets.keys()].filter(p=>p.startsWith(newId+'/'));assert.equal(newPaths.length,1);await newPost.locator('.photo-delete').click();await page.getByText('글을 삭제했습니다.',{exact:true}).waitFor();assert.equal(assets.has(newPaths[0]),false);
 await page.locator('.photo-write').click();await page.locator('.photo-editor-title').fill('discard draft');await page.getByRole('link',{name:'홈',exact:true}).click();await go();await loaded();assert.equal(await page.locator('.photo-editor').count(),0);
 await transport.run(()=>h.pg.query('update private.friend_visibility_state set ready=false'));await focus();await loaded();await page.locator('.photo-write').click();assert.equal(await page.locator('.photo-editor-visibility option[value=friends]').count(),0);await page.getByRole('link',{name:'홈',exact:true}).click();await transport.run(()=>h.pg.query('update private.friend_visibility_state set ready=true'));
 console.log('PASS '+width+': new friend upload/save/delete/cleanup; menu draft discard and readiness gate');
 assert.deepEqual(errors,[]);await page.close();ab=await login(1,2);cb=await login(3,2);
 }}finally{await browser.close();}
 console.log('All 10 photo browser scenarios passed; actual views/runtime/handlers/SQL, fixture Auth/Storage and route shell.');
}finally{for(const h of Object.values(homes))await h.pg.close();await central.pg.close();}
