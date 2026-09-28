// Real views/repositories/content-access/photo-media, synthetic read-only transport and Auth.
// This performance fixture is not a substitute for SQL/central authorization tests.
import assert from 'node:assert/strict';import {readFile,mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {collect} from './helpers/additional-performance-metrics.mjs';
import {measureMenu} from './helpers/menu-loading-metrics.mjs';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2]))),out=process.env.VERIFICATION_DIR||'docs/verification/menu-loading-step1';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
const files=['visitor-identity.js','content-access.js','photo-media-client.js','photos-repository.js','diary-repository.js','views/photos.js','views/diary.js'];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const largePhoto=process.env.FIXTURE_LARGE_PHOTO_PATH?await readFile(process.env.FIXTURE_LARGE_PHOTO_PATH):null;
const capabilities=process.env.FIXTURE_CAPABILITIES!=='legacy';
const delay={auth:20,folder:40,health:100,calendar:250,list:100,fastPhoto:80,slowPhoto:600};const results=[];
try{for(const scenario of ['public','owner','friend','nonfriend','empty']){
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.name));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;let data,ms;
  if(path.startsWith('/api/')){
   const action=path.split('/').at(-1),body=route.request().postDataJSON()||{};ms=delay.list;
   if(action==='user'||action==='is_minihompy_admin'){data=action==='user'?{id:'owner'}:true;ms=delay.auth;}
   else if(action.endsWith('_folders')){data=[{id:'folder',label:'Fixture',description:'',kind:'folder',sort_order:0}];ms=delay.folder;}
   else if(action==='health'){data={friend_visibility_protocol:1,friend_visibility_ready:true,friend_media_ready:true,friend_summary_ready:true,friend_pages_ready:true,...(capabilities?{photo_check_protocol:1,diary_latest_protocol:1}:{})};ms=delay.health;}
   else if(action==='read') {ms=body.path==='slow.png'?delay.slowPhoto:delay.fastPhoto;await new Promise(r=>setTimeout(r,ms));return route.fulfill({body:largePhoto&&body.path==='slow.png'?largePhoto:png,contentType:largePhoto&&body.path==='slow.png'?'image/jpeg':'image/png'});}
   else {const mode=scenario==='owner'?'owner':['friend','nonfriend'].includes(scenario)?'member':'public';const allowed=v=>v==='public'||scenario==='owner'||v==='friends'&&scenario==='friend';
    let value;if(action==='photo-check'){value={items:body.posts.map(p=>({id:p.id,valid:true}))};}
    else if(action==='calendar'){ms=delay.calendar;value={dates:scenario==='empty'?[]:[new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'})]};}
    else if(action==='list'){
     const date=body.date||new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
     let items=['public','friends','private'].filter(allowed).map((visibility,i)=>({id:'post-'+i,folder_id:'folder',author_id:'owner',author_name:'Fixture',title:'Fixture',visibility,revision:1,created_at:'2026-09-01T00:00:00Z',entry_date:date,entry_time:'12:00:00',weather:'',body:body.kind==='diary'?'Fixture body':[{type:'image',path:'fast.png'},{type:'image',path:'slow.png'}]}));if(scenario==='empty')items=[];const count=items.length;items=items.slice(0,body.size);value={items,count,page:1,size:body.size,...(body.latest?{selected_date:items.length?date:null,target_id:items.at(-1)?.id??null}:{})};
    }else throw Error('Unknown fixture action '+action);
    data={protocol:1,view:{mode,scope:mode==='public'?'public':'visible',includes_friends:scenario==='friend'||scenario==='owner'},data:value};
   }
   await new Promise(r=>setTimeout(r,ms));return route.fulfill({json:data});
  }
  const file=path.slice(1);if(files.includes(file)||file==='styles.css')return route.fulfill({body:file==='visitor-identity.js'?'(function(document){'+await readFile(file,'utf8')+'})(undefined);':await readFile(file),contentType:file.endsWith('.css')?'text/css':'text/javascript'});
  if(path!=='/')return route.fulfill({status:404,body:''});
  const setup=`const role=${JSON.stringify(scenario)};const call=async(path,body)=>{const r=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});return r.json();};
   window.MINIHOMPY_VIEWS={};window.MINIHOMPY_CONFIG={profile:{name:'Fixture'}};window.MINIHOMPY_VISITOR_IDENTITY_CONFIG={enabled:true};window.MINIHOMPY_MEMBER_WRITING_CONFIG={enabled:true};
   window.MinihompyAdmin={state:{role:role==='owner'?'admin':'reader',userId:role==='owner'?'owner':null}};window.MinihompySharedIdentity={state:{status:['friend','nonfriend'].includes(role)?'identified':'anonymous',visitor:{id:'member'}}};
   const raw={rpc:async()=>({data:await call('rest/v1/rpc/is_minihompy_admin')}),from:table=>{const q={select:()=>q,order:()=>q,then:(ok,bad)=>call('rest/v1/'+table).then(data=>({data})).then(ok,bad)};return q;},auth:{getSession:async()=>({data:{session:{access_token:'h.'+btoa(JSON.stringify({session_id:'fixture-session'}))+'.s',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'owner'}}}})}};
   raw.auth.getUser=async()=>({data:{user:await call('auth/v1/user')}});window.MinihompyBackend={getClient:()=>raw};window.createMinihompyIdentity=()=>({current:async()=>{await call('auth/v1/user');await call('rest/v1/rpc/is_minihompy_admin');return {role:'admin',userId:'owner'};}});
   window.MinihompyMemberWriting={snapshot:()=>({}),check(){},read:(a,o)=>call('functions/v1/member-writing/content/'+a,o.body),media:async body=>fetch('/api/functions/v1/photo-media/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})};
   window.MinihompyComments={create:()=>document.createElement('div'),clearKind(){}};window.MinihompyPhotoEditor={active:false,busy:false};
   let previous=null;window.go=menu=>{dispatchEvent(new CustomEvent('minihompy:menu-leave',{detail:{id:previous}}));document.querySelector('#left').replaceChildren();document.querySelector('#main').replaceChildren();previous=menu;if(MINIHOMPY_VIEWS[menu]){document.querySelector('#left').append(MINIHOMPY_VIEWS[menu].createLeft());document.querySelector('#main').append(MINIHOMPY_VIEWS[menu].createMain());}};`;
  return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset=utf-8><link rel=stylesheet href=/styles.css><style>body{zoom:1}body>nav{position:relative;z-index:100}#main{position:relative;min-width:0}#layout{display:grid;grid-template-columns:150px 650px}.photo-image{width:80px;height:50px}.photos-scroll,.diary-scroll{height:650px;overflow:auto}</style><nav>${['home','diary','photos'].map(m=>`<button data-menu="${m}" onclick="go('${m}')">${m}</button>`).join('')}</nav><div id=layout><div id=left></div><div id=main></div></div><script>${setup}</script>${files.map(f=>`<script src=/${f}></script>`).join('')}<script>window.fixtureReady=(async()=>{if(role==='owner'){const identity=createMinihompyIdentity(raw);if(${process.env.OWNER_CACHE!=='0'})identity.enableSessionReuse?.(()=>{});await identity.current();}})();</script>`});
 });
 await page.goto('https://fixture.test/');await page.evaluate(()=>window.fixtureReady);for(let round=1;round<=2;round++)for(const menu of ['diary','photos']){await page.locator('[data-menu=home]').click();const collector=collect(page);const result=await measureMenu(page,menu,{timeout:15000});result.network=await collector.finish();assert(!result.error);assert(result.firstBodyMs>0);const count=await page.locator(menu==='diary'?'.diary-entry':'.photo-post').count();assert.equal(count,scenario==='empty'?0:Math.min(menu==='photos'?2:20,scenario==='owner'?3:scenario==='friend'?2:1));if(menu==='photos'&&scenario!=='empty'){assert(result.firstPhotoMs>0);assert(result.firstPhotoMs>result.firstBodyMs);assert(result.allPhotosMs-result.firstPhotoMs>=300,'Slow photo must finish later than the first decoded photo');assert(result.allPhotosMs>=delay.slowPhoto);}results.push({scenario,round,...result});console.log(`PASS ${scenario} ${round} ${menu}: ${result.firstBodyMs}ms, ${result.requestCount} requests`);}assert.deepEqual(errors,[]);await page.close();
}}finally{await browser.close();await writeFile(out+'/fixture-baseline.json',JSON.stringify({photoBytes:{fast:png.length,slow:largePhoto?.length||png.length},capabilities,ownerCache:process.env.OWNER_CACHE!=='0',delaysMs:delay,transport:'synthetic, real UI and repositories; comments stubbed; not an authorization proof',samples:results},null,2)+'\n');}
