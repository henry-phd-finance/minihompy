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
 const {chromium}=await import(pathToFileURL(resolve(process.argv[2])));const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
 const out=process.env.VERIFICATION_DIR||'docs/verification/friend-visibility-step9';await mkdir(out,{recursive:true});
 try{for(const width of [1280,375]){
 const page=await browser.newPage({viewport:{width,height:820}}),errors=[];page.setDefaultTimeout(7000);page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message);});let renews=0,hold=false,release,offline=false;
 const h=homes[2],transport=sqlTransport(homes[2].pg,{owner:homes[2].owner}),files=['member-writing-client.js','member-writing-runtime.js','content-access.js','post-routes.js','post-location-repository.js','board-repository.js','diary-repository.js','comments-repository.js','comments.js','views/board.js','views/diary.js'];
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/fixture-db')return route.fulfill({json:await transport.handle(JSON.parse(req.postData()))});
  if(req.url().startsWith(h.config.SUPABASE_URL)){
   if(url.pathname.endsWith('/renew'))renews++;
   if(offline&&url.pathname.includes('/content/')&&!url.pathname.endsWith('/health'))return route.fulfill({status:503,json:{error:{code:'IDENTITY_UNAVAILABLE'}}});
   const res=await transport.run(()=>handleMemberWriting(new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}:{})}),{config:h.config,fetcher,db:h.db}));
   const payload={status:res.status,headers:Object.fromEntries(res.headers),body:await res.text()};
   if(hold&&url.pathname.endsWith('/detail')){hold=false;await new Promise(r=>release=r);}return route.fulfill(payload).catch(()=>{});
  }
  const name=url.pathname.slice(1);
  if(files.includes(name))return route.fulfill({contentType:'text/javascript',body:await readFile(name,'utf8')});
  if(name==='styles.css')return route.fulfill({contentType:'text/css',body:await readFile(name,'utf8')});
  const setup=browserBackend+`window.fixtureIds={owner:${JSON.stringify(h.owner)}};window.MINIHOMPY_VIEWS={};window.MINIHOMPY_CONFIG={profile:{name:'Owner'}};window.MINIHOMPY_SUPABASE={url:${JSON.stringify(h.config.SUPABASE_URL)}};window.MINIHOMPY_VISITOR_IDENTITY_CONFIG={enabled:true,siteId:${JSON.stringify(site(2))}};window.MINIHOMPY_MEMBER_WRITING_CONFIG={enabled:true};window.MinihompySharedIdentity={state:{status:'identified',visitor:{id:${JSON.stringify(member(1))}}}};MinihompyBackend.getClient().auth={getSession:async()=>({data:{session:{access_token:'owner.valid.jwt',user:{id:fixtureIds.owner}}}})};window.setUser=data=>{const key='minihompy.member-writing.v1:'+MINIHOMPY_VISITOR_IDENTITY_CONFIG.siteId+':'+MINIHOMPY_SUPABASE.url;sessionStorage.setItem(key,data.session_token);sessionStorage.setItem(key+':renewal',data.renewal_token);sessionStorage.setItem('minihompy.writing.pending:'+MINIHOMPY_VISITOR_IDENTITY_CONFIG.siteId+':member',data.actor.member_id);MinihompySharedIdentity.state={status:'identified',visitor:{id:data.actor.member_id}};dispatchEvent(new Event('minihompy:identity'));dispatchEvent(new Event('minihompy:visitor-identity'));};setUser(${JSON.stringify(sessions['1:2'])});`;
  const navigation=`let previous=null;window.navigate=()=>{const r=MinihompyPostRoutes.parse(location.hash);if(!MINIHOMPY_VIEWS[r.id])return;MinihompyPostRoutes.leave(previous);previous=r.id;document.querySelector('#left').replaceChildren(MINIHOMPY_VIEWS[r.id].createLeft());document.querySelector('#main').replaceChildren(MINIHOMPY_VIEWS[r.id].createMain(r));};window.addEventListener('hashchange',navigate);navigate();`;
  return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css"><style>#layout{display:grid;grid-template-columns:150px minmax(0,1fr);max-width:850px;height:650px}#main{min-width:0;position:relative}.board-scroll,.diary-scroll{height:500px}@media(max-width:500px){#layout{grid-template-columns:100px minmax(0,1fr)}}</style><span id="member-session-status"></span><button id="member-session-retry" hidden>인증 재시도</button><nav><a href="#/board">게시판</a><a href="#/diary">다이어리</a></nav><div id="layout"><div id="left"></div><div id="main"></div></div><script>'+setup+'</script>'+files.map(f=>'<script src="'+f+'"></script>').join('')+'<script>'+navigation+'</script>'});
 });
 const go=async(kind,n=1)=>{await page.evaluate(hash=>{location.hash=hash;},'#/'+kind+'?post='+post(kind,n));};
 await page.goto('https://m2.test/#/board?post='+post('board',1));await page.locator('.board-body').waitFor();assert.equal(await page.locator('.board-privacy').innerText(),'공개설정 : 일촌 공개');await page.locator('.comment-body').waitFor({timeout:5000});
 await page.locator('.comment-body').fill('friend board comment');await page.locator('.comment-save').click();await page.locator('.photo-comment').filter({hasText:'friend board comment'}).first().waitFor();
 await h.pg.query("update private.member_writing_limits set last_write=clock_timestamp()-interval '1 minute'");await go('diary');await page.locator('.diary-entry-body').first().waitFor();assert.equal(await page.locator('.diary-entry-body').count(),2);
 await page.locator('[data-entry="'+post('diary',1)+'"] .comment-body').fill('friend diary comment');await page.locator('[data-entry="'+post('diary',1)+'"] .comment-save').click();await page.locator('.photo-comment').filter({hasText:'friend diary comment'}).first().waitFor();
 await page.reload();await page.locator('.diary-entry-body').first().waitFor();await page.goBack();await page.locator('.board-body').waitFor();await page.goForward();await page.locator('.diary-entry-body').first().waitFor();
 await page.screenshot({path:out+'/diary-'+width+'.png'});console.log('PASS '+width+': direct board/diary addresses use member reads and real protected comment writes');
 await go('board');await page.locator('.board-body').waitFor();hold=true;await page.evaluate(()=>dispatchEvent(new Event('focus')));for(let i=0;!release&&i<100;i++)await page.waitForTimeout(20);assert.ok(release);
 await page.evaluate(data=>setUser(data),sessions['3:2']);await page.getByRole('button',{name:'다시 조회',exact:true}).waitFor();release();release=null;await page.waitForTimeout(30);assert.equal(await page.locator('.board-body').count(),0);assert.equal(await page.locator('.photo-comment').filter({hasText:'friend board comment'}).first().count(),0);
 await page.evaluate(data=>setUser(data),sessions['1:2']);await page.locator('.board-body').waitFor();offline=true;await page.evaluate(()=>dispatchEvent(new Event('focus')));await page.getByRole('button',{name:'다시 조회',exact:true}).waitFor();assert.equal(await page.locator('.board-body').count(),0);offline=false;await page.getByRole('button',{name:'다시 조회',exact:true}).click();await page.locator('.board-body').waitFor();
 console.log('PASS '+width+': nonfriend guessed ID and late previous-account detail stay hidden; central failure clears content and common retry recovers');
 await page.evaluate(()=>setActor('owner'));await page.locator('.board-edit').waitFor();await page.locator('.board-edit').focus();await page.keyboard.press('Enter');await page.locator('#board-edit-visibility').selectOption('friends');assert.equal(await page.locator('#board-edit-visibility option[value=friends]').count(),1);
 await page.locator('#board-edit-title').fill('friend edited');await page.locator('.board-save').click();await page.locator('.board-body').waitFor();await page.screenshot({path:out+'/board-'+width+'.png'});
 await go('diary');await page.locator('.diary-edit').first().waitFor();await page.locator('[data-entry="'+post('diary',1)+'"] .diary-edit').click();assert.equal(await page.locator('.diary-field-visibility option[value=friends]').count(),1);await page.locator('.diary-field-visibility').selectOption('friends');await page.locator('.diary-field-body').fill('friend diary edited');await page.locator('.diary-save').click();await page.locator('[data-entry="'+post('diary',1)+'"] .diary-entry-body').filter({hasText:'friend diary edited'}).waitFor();await page.locator('[data-entry="'+post('diary',1)+'"] .diary-edit').click();
 await page.locator('textarea').first().fill('discard this draft');await page.getByRole('link',{name:'게시판',exact:true}).click();await page.locator('.board-post-link').first().waitFor();await page.getByRole('link',{name:'다이어리',exact:true}).click();await page.waitForTimeout(100);assert.equal(await page.locator('textarea').evaluateAll(es=>es.filter(e=>e.value==='discard this draft').length),0);
 await go('board');await page.locator('.board-body').waitFor();await page.locator('.board-visibility').click();await page.locator('.board-privacy').filter({hasText:'나만보기'}).waitFor();await page.locator('.board-visibility').click();await page.locator('.board-privacy').filter({hasText:'공개설정 : 공개'}).waitFor();await page.locator('.board-friends').click();await page.locator('.board-privacy').filter({hasText:'일촌 공개'}).waitFor();await h.pg.query('update private.friend_visibility_state set ready=false');await page.evaluate(()=>dispatchEvent(new Event('focus')));await page.locator('.board-edit').click();assert.equal(await page.locator('#board-edit-visibility option[value=friends]').count(),0);
 const denied=await page.evaluate(async()=>{try{await MinihompyBoardRepository.save({folder_id:'00000000-0000-4000-8000-000000000001',title:'denied',body:'denied',visibility:'friends'});return false;}catch{return true;}});assert.equal(denied,true);await h.pg.query('update private.friend_visibility_state set ready=true');
 console.log('PASS '+width+': administrator friend option/write and menu-leave draft disposal');
 assert.deepEqual(errors,[]);await page.close();
 // Fresh independent browser sessions for the next viewport.
 sessions['1:2']=undefined;ab=await login(1,2);cb=await login(3,2);
 }}finally{await browser.close();}
 console.log('All 6 board/diary browser scenarios passed; actual view/repository/runtime/handlers/SQL, fixture Auth and route shell.');
}finally{for(const h of Object.values(homes))await h.pg.close();await central.pg.close();}
