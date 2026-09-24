// Real UI/SQL/Edge handler. Auth and Storage are local doubles.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {browserBackend,sqlTransport} from './helpers/home-browser-db.mjs';
import {handlePhotoMedia} from '../supabase/functions/photo-media/handler.js';
import {digest,BUCKET,fail} from '../supabase/functions/photo-media/io.js';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])));
const {PGlite}=await import(pathToFileURL(resolve('../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js')));
await mkdir('docs/verification/folder-visibility-step8',{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
const retained=new Set(['views/home.js','config.js','content.js','views/index.js','post-routes.js','content-access.js','post-location-repository.js','photo-media-client.js','photos-repository.js','comments-repository.js','comments.js','views/photos.js','app.js','content-folders.js','content-folders-repository.js','photo-editor.js','assets/vendor/quill-2.0.3.js']);
const id=n=>'a0000000-0000-4000-8000-'+String(n).padStart(12,'0'),ids={owner:id(1),A:id(2)},path=(n,i=77)=>id(n)+'/'+id(i)+'.jpg';
const picture=new Uint8Array(await readFile(resolve('assets/photos/lake.jpg'))),sha=await digest(picture),results=[];
const env={SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_ANON_KEY:'public-fixture',SUPABASE_SERVICE_ROLE_KEY:'service-fixture',MINIHOMPY_SITE_ORIGIN:'https://photos.test'};
try{for(const width of [1280,375]){
 const {pg}=await memberWritingDb(PGlite,{siteId:id(99),centralUrl:'https://central.test/api',photoMedia:true}),{handle,run}=sqlTransport(pg,ids);
 const context=await browser.newContext({viewport:{width,height:850}});
 const files=new Map(),errors=[],external=[];let release=null,holdRead=false,holdUpload=false,holdSave=false,loseSave=false,loseUpload=false,denySave=false,validAuth=true,activeReads=0,maxReads=0,mediaReads=0,failCleanup=false;
 const rpc=(action,args={})=>run(async()=>{
  await pg.exec('set role service_role');
  try{const v=(await pg.query('select public.photo_media($1,$2) v',[action,args])).rows[0].v;if(v.failure)fail(v.failure);return v;}finally{await pg.exec('reset role');}
 });
 const storage={
  async get(bucket,p){assert.equal(bucket,BUCKET);activeReads++;maxReads=Math.max(maxReads,activeReads);
   try{if(holdRead){holdRead=false;await new Promise(r=>release=r);}await new Promise(r=>setTimeout(r,20));const b=files.get(p);if(!b)fail('NOT_FOUND');return b.slice();}finally{activeReads--;}
  },
  async put(bucket,p,b){assert.equal(bucket,BUCKET);if(files.has(p))fail('EXISTS');files.set(p,b.slice());},
  async remove(bucket,paths){assert.equal(bucket,BUCKET);if(failCleanup)throw Error('fixture offline');for(const p of paths)files.delete(p);}
 };
 const fetcher=async(url,options)=>{
  if(options.headers.Authorization!=='Bearer a.b.c'||!validAuth)return Response.json({},{status:401});
  if(url.endsWith('/auth/v1/user'))return Response.json({id:ids.owner,is_anonymous:false});
  if(url.endsWith('/is_minihompy_admin'))return new Response('true');
  throw Error('Unexpected auth URL');
 };
 await pg.query('insert into auth.users values($1),($2)',Object.values(ids));await pg.query('insert into private.minihompy_admins values($1)',[ids.owner]);
 const folder=(await pg.query('select id from public.photo_folders limit 1')).rows[0].id;
 await rpc('freeze');await rpc('protect');await pg.exec('update private.photo_media_state set ready=true');
 async function seed(n,visibility='public',number=1){
  const body=[];
  for(let i=0;i<number;i++){
   const p=path(n,77+i),args={owner_id:ids.owner,path:p,post_id:id(n),size:picture.length,mime:'image/jpeg',sha256:sha};
   await rpc('reserve',args);files.set(p,picture.slice());await rpc('complete',args);body.push({type:'image',path:p});
  }
  body.push({type:'text',text:'PHOTO BODY '+n});
  await run(async()=>{
   await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[ids.owner]);await pg.exec('set role authenticated');
   try{await pg.query("insert into public.photo_posts(id,folder_id,author_name,title,body,visibility) values($1,$2,'owner',$3,$4,$5)",[id(n),folder,'PHOTO TITLE '+n,body,visibility]);}
   finally{await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub','',false)");}
  });
 }
 await seed(10);await seed(11,'private');await seed(12,'public',6);
 const boot='window.fixtureIds='+JSON.stringify(ids)+';'+browserBackend+`
 window.MINIHOMPY_SUPABASE={url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'public-fixture'};
 const baseClient=MinihompyBackend.getClient;
 MinihompyBackend={getClient:kind=>({...baseClient(kind),auth:{getSession:async()=>({data:{session:fixtureActor==='owner'?{user:{id:fixtureIds.owner},access_token:'a.b.c'}:null}})}})};
 window.createdBlobs=[];window.revokedBlobs=[];
 const createBlob=URL.createObjectURL.bind(URL),revokeBlob=URL.revokeObjectURL.bind(URL);
 URL.createObjectURL=b=>{const u=createBlob(b);createdBlobs.push(u);return u;};URL.revokeObjectURL=u=>{revokedBlobs.push(u);revokeBlob(u);};
 `;
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin===env.SUPABASE_URL){
   if(!url.pathname.startsWith('/functions/v1/photo-media/')){external.push(url.href);return route.fulfill({status:403,body:'forbidden'});}
   const action=url.pathname.split('/').at(-1);if(action==='read')mediaReads++;
   const response=await handlePhotoMedia(new Request(req.url(),{method:req.method(),headers:req.headers(),body:req.postDataBuffer()}),{env,fetcher,rpc,storage});
   if(action==='upload'&&holdUpload){holdUpload=false;await new Promise(r=>release=r);}
   if(action==='upload'&&loseUpload){loseUpload=false;return route.abort('failed').catch(()=>{});}
   return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())}).catch(()=>{});
  }
  if(url.origin!=='https://photos.test'){external.push(url.href);return route.abort();}
  if(url.pathname==='/fixture-db'){
   const q=req.postDataJSON(),saving=q.table==='photo_posts'&&['insert','update'].includes(q.op);
   if(saving&&denySave)return route.fulfill({json:{data:null,error:{message:'fixture denied'}}});
   const response=await handle(q);
   if(saving&&holdSave){holdSave=false;await new Promise(r=>release=r);}
   if(saving&&loseSave){loseSave=false;return route.abort('failed').catch(()=>{});}
   return route.fulfill({json:response}).catch(()=>{});
  }
  const file=url.pathname.slice(1)||'index.html';let body=await readFile(resolve(file));
  if(file==='index.html')body=body.toString().replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g,(all,src)=>retained.has(src)?all:'').replace('<head>','<head><script>'+boot+'</script>');
  return route.fulfill({body,contentType:({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const navigate=n=>page.evaluate(n=>MinihompyApp.renderView(n?{id:'photos',post:n}:'photos'),n);
 const check=async(name,fn)=>{try{await fn();}catch(e){console.log(await page.locator('[data-view-slot=main]').innerText());throw e;}results.push({width,name});console.log('PASS '+width+': '+name);};
 const loaded=async()=>{await page.waitForFunction(()=>{const imgs=[...document.querySelectorAll('.photo-image')];return !MinihompyPhotoEditor.active&&!document.querySelector('.photo-empty')&&imgs.length&&imgs.every(i=>i.src.startsWith('blob:')&&i.complete&&i.naturalWidth>0);});};
 const goHome=async()=>{await page.evaluate(()=>MinihompyApp.renderView('home'));assert.equal(await page.evaluate(()=>MinihompyApp.currentView),'home');};
 const compose=async title=>{
  await page.locator('.photo-write').click();await page.locator('.photo-editor-title').fill(title);
  await page.locator('.photo-editor-file').setInputFiles({name:'fixture.jpg',mimeType:'image/jpeg',buffer:Buffer.from(picture)});
  await page.waitForFunction(()=>!MinihompyPhotoEditor.busy&&document.querySelector('.ql-editor img')?.src.startsWith('blob:'));
 };
 try{
 await page.goto('https://photos.test/#/photos?post='+id(10));
 await check('public anonymous Blob images, private address denied, bounded concurrency and no storage URLs',async()=>{
  await loaded();assert.ok((await page.locator('body').innerText()).includes('PHOTO TITLE 10'));
  await navigate(id(11));await page.getByText('글이 삭제되었거나 조회할 수 없습니다.',{exact:false}).waitFor();assert.equal(await page.locator('.photo-image').count(),0);
  await navigate(id(12));await loaded();assert.ok(maxReads>=2&&maxReads<=4);assert.equal(external.length,0);
 });
 await goHome();
 await page.evaluate(()=>setActor('owner'));
 await check('same-scope repeated image read shares a Blob; disposal prevents URL reuse',async()=>{
  const before=mediaReads;
  const same=await page.evaluate(async({post,p})=>{
   const s=MinihompyPhotoMedia.scope(),urls=await Promise.all([s.read(post,p),s.read(post,p)]);
   s.dispose();return urls;
  },{post:id(10),p:path(10)});
  assert.equal(same[0],same[1]);assert.equal(mediaReads-before,1);
  assert.ok(await page.evaluate(async url=>{try{await fetch(url);return false;}catch{return true;}},same[0]));
 });
 await check('admin private view/editor Blob preview, visibility in both directions and public home',async()=>{
  await navigate(id(11));await loaded();await page.locator('[data-post="'+id(11)+'"] .photo-edit').click();
  await page.locator('.photo-editor-visibility').selectOption('public');
  await page.waitForFunction(()=>document.querySelector('.ql-editor img')?.naturalWidth>0);
  await page.locator('.photo-save').click();await loaded();assert.equal((await run(()=>pg.query('select visibility from public.photo_posts where id=$1',[id(11)]))).rows[0].visibility,'public');
  await page.locator('[data-post="'+id(11)+'"] .photo-visibility').click();await loaded();
  assert.equal((await run(()=>pg.query('select visibility from public.photo_posts where id=$1',[id(11)]))).rows[0].visibility,'private');
  const summary=(await run(()=>pg.query('select public.home_summary() v'))).rows[0].v;assert.equal(summary.counts.photos.total,2);
 });
 await check('logout revokes all image URLs, removes private content and drops held image response',async()=>{
  await loaded();const oldUrl=await page.locator('.photo-image').first().getAttribute('src');assert.ok(oldUrl?.startsWith('blob:'));
  await goHome();holdRead=true;await navigate(id(11));
  while(!release)await new Promise(r=>setTimeout(r,10));
  await page.evaluate(()=>setActor('anon'));release();release=null;
  await page.getByText('글이 삭제되었거나 조회할 수 없습니다.',{exact:false}).waitFor();
  assert.equal(await page.locator('.photo-image').count(),0);
  assert.ok(await page.evaluate(()=>createdBlobs.every(u=>revokedBlobs.includes(u))));
  assert.ok(await page.evaluate(async url=>{try{await fetch(url);return false;}catch{return true;}},oldUrl));
  assert.ok(!(await page.locator('body').innerText()).includes('PHOTO TITLE 11'));
  await page.evaluate(()=>setActor('owner'));await loaded();
 });
 await check('expired server auth clears existing images and can recover after reauthentication',async()=>{
  await goHome();validAuth=false;await navigate(id(11));
  await page.getByText('사용자 상태가 변경되었습니다.',{exact:false}).waitFor();assert.equal(await page.locator('.photo-image').count(),0);
  validAuth=true;await page.evaluate(()=>setActor('owner'));await loaded();
 });
 await check('menu leave during upload cleans unattached file without creating post',async()=>{
  await navigate();await loaded();await compose('LEAVE UPLOAD');
  const original=new Set(files.keys());holdUpload=true;await page.locator('.photo-save').click();
  while(!release)await new Promise(r=>setTimeout(r,10));
  const added=[...files.keys()].filter(p=>!original.has(p));assert.equal(added.length,1);
  await goHome();release();release=null;
  await page.waitForFunction(()=>!MinihompyPhotoEditor.active);
  for(let n=0;n<100&&files.has(added[0]);n++)await new Promise(r=>setTimeout(r,20));
  assert.ok(!files.has(added[0]));assert.equal((await run(()=>pg.query("select count(*)::int n from public.photo_posts where title='LEAVE UPLOAD'"))).rows[0].n,0);
 });
 await check('menu leave after committed save preserves attached file and discards late UI',async()=>{
  await navigate();await loaded();await compose('LEAVE SAVE');const original=new Set(files.keys());holdSave=true;await page.locator('.photo-save').click();
  while(!release)await new Promise(r=>setTimeout(r,10));
  const added=[...files.keys()].filter(p=>!original.has(p));await goHome();release();release=null;
  assert.equal(await page.locator('.photo-editor').count(),0);
  assert.ok(files.has(added[0]));assert.equal((await run(()=>pg.query("select count(*)::int n from public.photo_posts where title='LEAVE SAVE'"))).rows[0].n,1);
 });
 await check('lost upload and save responses retry same path/post without duplicates',async()=>{
  await navigate();await loaded();await compose('RETRY');loseUpload=true;await page.locator('.photo-save').click();
  await page.getByText('작성 내용은 유지됩니다.',{exact:false}).waitFor();
  loseSave=true;await page.locator('.photo-save').click();await page.getByText('작성 내용은 유지됩니다.',{exact:false}).waitFor();
  await page.waitForFunction(()=>!MinihompyPhotoEditor.busy);await page.locator('.photo-save').click();await loaded();
  assert.equal((await run(()=>pg.query("select count(*)::int n from public.photo_posts where title='RETRY'"))).rows[0].n,1);
 });
 await check('denied write retains uploaded draft; stale visibility edit cannot overwrite newer row',async()=>{
  await compose('DENIED');denySave=true;await page.locator('.photo-save').click();await page.getByText('fixture denied',{exact:false}).waitFor();
  assert.equal(await page.locator('.photo-editor-title').inputValue(),'DENIED');denySave=false;
  await page.locator('.photo-save').click();await loaded();assert.equal((await run(()=>pg.query("select count(*)::int n from public.photo_posts where title='DENIED'"))).rows[0].n,1);
  await navigate(id(11));await loaded();await page.locator('[data-post="'+id(11)+'"] .photo-edit').click();
  await page.locator('.photo-editor-visibility').selectOption('public');
  await run(()=>pg.query("update public.photo_posts set title='CONCURRENT CHANGE' where id=$1",[id(11)]));
  await page.locator('.photo-save').click();await page.getByText('다른 곳에서 변경된 글',{exact:false}).waitFor();
  assert.equal(await page.locator('.photo-editor-visibility').inputValue(),'public');
  assert.equal((await run(()=>pg.query('select visibility from public.photo_posts where id=$1',[id(11)]))).rows[0].visibility,'private');
  await page.locator('.photo-cancel').click();await loaded();
 });
 await check('cancel after lost upload response cleans server-staged image even without client acknowledgement',async()=>{
  await navigate();await loaded();await compose('CANCEL UPLOAD');const before=new Set(files.keys());loseUpload=true;
  await page.locator('.photo-save').click();await page.getByText('작성 내용은 유지됩니다.',{exact:false}).waitFor();
  const added=[...files.keys()].filter(p=>!before.has(p));assert.equal(added.length,1);
  await page.locator('.photo-cancel').click();await loaded();assert.ok(!files.has(added[0]));
 });
 await check('cancel after lost committed save never cleans referenced attachment',async()=>{
  await navigate();await loaded();await compose('CANCEL UNKNOWN');const before=new Set(files.keys());loseSave=true;await page.locator('.photo-save').click();
  await page.getByText('작성 내용은 유지됩니다.',{exact:false}).waitFor();await page.locator('.photo-cancel').click();await loaded();
  const added=[...files.keys()].filter(p=>!before.has(p));assert.equal(added.length,1);
  assert.equal((await run(()=>pg.query("select count(*)::int n from public.photo_posts where title='CANCEL UNKNOWN'"))).rows[0].n,1);
  const a=(await rpc('inventory')).assets.find(a=>a.path===added[0]);assert.equal(a.state,'attached');
 });
 await check('private endpoint direct read and GET fail; bfcache clears URLs and reloads fresh images',async()=>{
  const post=id(11),asset=path(11);
  const status=await page.evaluate(async({url,post,asset})=>(await fetch(url+'/functions/v1/photo-media/read',{method:'POST',headers:{'Content-Type':'application/json',apikey:'public-fixture'},body:JSON.stringify({post_id:post,path:asset})})).status,{url:env.SUPABASE_URL,post,asset});
  assert.equal(status,404);
  assert.equal((await handlePhotoMedia(new Request(env.SUPABASE_URL+'/functions/v1/photo-media/read'),{env,fetcher,rpc,storage})).status,405);
  await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));assert.equal(await page.locator('.photo-image').count(),0);
  assert.ok(await page.evaluate(()=>createdBlobs.every(u=>revokedBlobs.includes(u))));
  await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await loaded();
 });
 await check('same-account refresh keeps editor; account switch and history discard/revoke',async()=>{
  await page.locator('.photo-edit').first().click();await page.locator('.photo-editor-title').fill('DRAFT');
  await page.evaluate(()=>dispatchEvent(new Event('minihompy:identity')));assert.equal(await page.locator('.photo-editor-title').inputValue(),'DRAFT');
  await page.evaluate(()=>setActor('A'));await page.waitForFunction(()=>!MinihompyPhotoEditor.active);assert.equal(await page.locator('.photo-editor').count(),0);
  await goHome();await page.goBack();await loaded();assert.equal(await page.locator('.photo-editor').count(),0);
 });
 await check('logout during local image decoding immediately revokes preview and late decode cannot restore editor',async()=>{
  await page.evaluate(()=>setActor('owner'));await navigate();await loaded();
  await page.locator('.photo-write').click();await page.locator('.photo-editor-title').fill('DECODING');
  await page.evaluate(()=>{window.originalDecode=Image.prototype.decode;Image.prototype.decode=function(){const result=originalDecode.call(this);return new Promise(resolve=>window.finishDecode=()=>resolve(result));};});
  await page.locator('.photo-editor-file').setInputFiles({name:'decode.jpg',mimeType:'image/jpeg',buffer:Buffer.from(picture)});
  await page.waitForFunction(()=>!!window.finishDecode);const pending=await page.evaluate(()=>createdBlobs.at(-1));
  await page.evaluate(()=>setActor('anon'));
  assert.ok(await page.evaluate(u=>revokedBlobs.includes(u),pending));
  await page.evaluate(()=>{Image.prototype.decode=originalDecode;finishDecode();});
  assert.equal(await page.locator('.photo-editor').count(),0);
 });
 await check('delete clears image immediately; failed cleanup remains unreadable and retry preserves other attachments',async()=>{
  await page.evaluate(()=>setActor('owner'));await navigate(id(10));await loaded();
  const originalOther=files.get(path(11));failCleanup=true;
  await page.locator('[data-post="'+id(10)+'"] .photo-delete').click();
  await page.getByText('글은 삭제했지만 이미지 파일 정리는 완료하지 못했습니다.',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-post="'+id(10)+'"]').count(),0);
  await assert.rejects(()=>rpc('read',{owner_id:ids.owner,post_id:id(10),path:path(10)}),e=>e.code==='NOT_FOUND');
  failCleanup=false;await page.evaluate(p=>MinihompyPhotosRepository.cleanup([p]),path(10));
  assert.ok(!files.has(path(10)));assert.deepEqual(files.get(path(11)),originalOther);
 });
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 }finally{if(release)release();await context.close();await pg.close();}
}
 console.log('PASS: '+results.length+' photo visibility browser/SQL/handler groups');
}finally{await browser.close();}
