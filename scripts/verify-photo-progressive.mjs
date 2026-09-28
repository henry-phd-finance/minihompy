import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {readFile,mkdir} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])));const out=process.env.VERIFICATION_DIR||'/tmp/photo-progressive';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});const original=await readFile('assets/photos/lake.jpg');
const variantMode=process.env.MINIHOMPY_TEST_VARIANT_READ==='1';
let picture=original,dimensions;
if(variantMode){const p=await browser.newPage();const result=await p.evaluate(async base64=>{
 const input=await(await fetch('data:image/jpeg;base64,'+base64)).blob(),bitmap=await createImageBitmap(input);
 const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;c.getContext('2d').drawImage(bitmap,0,0);
 const blob=await new Promise(r=>c.toBlob(r,'image/webp',.82));return {bytes:[...new Uint8Array(await blob.arrayBuffer())],width:c.width,height:c.height};
},original.toString('base64'));picture=Buffer.from(result.bytes);dimensions=result;await p.close();}
const digest=b=>createHash('sha256').update(b).digest('hex');
try{for(const width of [1280,375]){
 const page=await browser.newPage({viewport:{width,height:820}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 let holdSelection=false;let selectionReadMark=0;let variantGone=false,tamper=false,manyPhotos=false,checkBodies=[],readBodies=[];
 let holds=new Map(),waiting=new Map(),failPaths=new Set(),reads=[],checks=0,holdCheck=false,checkRelease,checkedWaiting=false,checkPosts=[],invalidIds=new Set(),deny=false,legacy=false;
 const files=['photos-repository.js','photo-media-client.js','views/photos.js'];
 await page.route('**/*',async route=>{const url=new URL(route.request().url());const name=url.pathname.slice(1);
  if(files.includes(name))return route.fulfill({contentType:'text/javascript',body:await readFile(name,'utf8')});
  if(name==='styles.css')return route.fulfill({contentType:'text/css',body:await readFile(name,'utf8')});
  if(name==='check'){checks++;const body=route.request().postDataJSON(),posts=body.posts;checkBodies.push(body);checkPosts.push(posts);
   const items=posts.map(p=>({id:p.id,valid:!invalidIds.has(p.id),...(body.variant?{photos:invalidIds.has(p.id)?[]:Array.from({length:p.id==='p1'?(manyPhotos?8:2):1},(_,i)=>({post_id:p.id,revision:p.revision,path:p.id+'/'+i+'.jpg',source_sha256:digest(original),representation:variantGone?null:{kind:'display-v1',sha256:digest(picture),width:dimensions.width,height:dimensions.height,size:picture.length}}))}:{})}));if(holdSelection||holdCheck&&(!variantMode||reads.length>selectionReadMark)){holdSelection=false;holdCheck=false;checkedWaiting=true;await new Promise(r=>checkRelease=r);checkedWaiting=false;}return route.fulfill({status:deny?401:200,json:deny?{error:'SESSION_REVOKED'}:{items}}).catch(()=>{});}
  if(name==='readiness')return route.fulfill({json:legacy?{}:{photo_check_protocol:1,...(variantMode?{photo_variant_read_protocol:1}:{})}});
  if(url.pathname.endsWith('/photo-media/read')){const body=route.request().postDataJSON(),p=body.path;readBodies.push(body);reads.push(p);if(holds.has(p)){waiting.set(p,true);await new Promise(r=>holds.set(p,r));waiting.delete(p);}return route.fulfill({status:failPaths.has(p)?404:200,contentType:failPaths.has(p)?'application/json':(body.representation?'image/webp':'image/jpeg'),body:failPaths.has(p)?JSON.stringify({error:{code:'NOT_FOUND'}}):body.representation?(tamper?Buffer.from([1,2,3]):picture):original}).catch(()=>{});}
  if(name!=='')throw Error('Unexpected URL '+url);
  return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css"><style>#left{width:120px}#main{width:calc(100% - 130px);max-width:640px;position:relative}.photos-scroll{height:700px;overflow:auto}#shell{display:flex}</style><div id="shell"><div id="left"></div><div id="main"></div></div><script>
  window.MINIHOMPY_VIEWS={};window.MINIHOMPY_CONFIG={profile:{name:'Fixture'}};window.MinihompyAdmin={state:{role:'visitor'}};window.MINIHOMPY_SUPABASE={url:'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',publishableKey:'fixture'};
  window.MinihompyPhotoEditor={active:false,busy:false};window.MINIHOMPY_POSTS=[1,2].map(n=>({id:'p'+n,revision:1,folder_id:'f',title:'사진글 '+n,author_name:'Fixture',visibility:'public',created_at:'2026-09-27T00:00:00Z',body:[{type:'text',text:'본문 '+n},...Array.from({length:n===1?2:1},(_,i)=>({type:'image',path:'p'+n+'/'+i+'.jpg'}))]}));
  window.mounts={};window.MinihompyComments={create:(kind,id)=>{mounts[id]=(mounts[id]||0)+1;const el=document.createElement('div');el.className='fixture-comments';el.textContent='댓글 '+id;return el;},clearKind:()=>{},forget:()=>{}};
  const client={from:()=>({select:()=>({order:()=>({order:async()=>({data:[{id:'f',kind:'folder',label:'일상',description:'사진첩'}]})})})})};window.verifyCount=0;window.listCount=0;
  window.MinihompyContentAccess={open:async()=>({client,assert:()=>{},verify:async()=>{verifyCount++},authorization:async()=>null}),read:async(action,body)=>{
   if(action==='photo'){
    if(!body.representation)return {legacy:true};
    const r=await fetch(MINIHOMPY_SUPABASE.url+'/functions/v1/photo-media/read',{method:'POST',body:JSON.stringify(body)});
    if(!r.ok)throw Object.assign(Error('사진 오류'),{code:String(r.status)});return {response:r,verify:async()=>{verifyCount++}};
   }if(action==='readiness')return {capabilities:await(await fetch('/readiness')).json()};
   if(action==='list'){listCount++;return {data:{items:structuredClone(MINIHOMPY_POSTS),count:MINIHOMPY_POSTS.length}};}
   if(action==='photo-check'){const r=await fetch('/check',{method:'POST',body:JSON.stringify(body)});if(!r.ok)throw Object.assign(Error('세션 만료'),{code:'SESSION_REVOKED'});return {data:await r.json()};}
  },retry:async()=>{}};
  window.created=[];window.revoked=[];const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=b=>{const u=create(b);created.push(u);return u;};URL.revokeObjectURL=u=>{revoked.push(u);revoke(u);};
  </script>${files.map(f=>'<script src="/'+f+'"></script>').join('')}<script>window.enter=()=>{document.querySelector('#left').replaceChildren(MINIHOMPY_VIEWS.photos.createLeft());document.querySelector('#main').replaceChildren(MINIHOMPY_VIEWS.photos.createMain());};window.leave=()=>{dispatchEvent(new CustomEvent('minihompy:menu-leave',{detail:{id:'photos'}}));document.querySelector('#main').replaceChildren();};enter();</script>`});
 });
 const wait=async predicate=>{for(let i=0;i<1000;i++){if(predicate())return;await page.waitForTimeout(10);}throw Error('Expected gate '+JSON.stringify({errors,reads,checks,text:await page.locator('body').innerText()}));};
 const release=p=>{const r=holds.get(p);holds.delete(p);r();};const loaded=()=>page.waitForFunction(()=>document.querySelectorAll('.photo-image').length===3&&document.querySelectorAll('.photo-image-slot[data-state=ready]').length===3);
 const fresh=async()=>{selectionReadMark=reads.length;await page.evaluate(()=>{leave();enter();});};
 holds.set('p1/1.jpg',null);await page.goto('https://fixture.test/');await wait(()=>waiting.has('p1/1.jpg'));
 await page.waitForFunction(()=>document.querySelectorAll('.photo-image').length===2);assert.equal(await page.locator('.photo-post').count(),2);assert.equal(await page.locator('.fixture-comments').count(),2);assert.equal(await page.locator('[data-post=p1] .photo-image').count(),1);assert.equal(await page.locator('[data-post=p2] .photo-image').count(),1);assert.equal(await page.locator('.photo-image-slot[data-state=loading]').count(),1);
 await page.screenshot({path:out+'/progressive-'+width+'.png'});assert.deepEqual(await page.evaluate(()=>mounts),{p1:1,p2:1});const firstChecks=checks;release('p1/1.jpg');await loaded();assert.ok(checks>firstChecks);assert.ok(checkPosts.every(ps=>ps.length<=2));console.log('PASS '+width+': first photo in same post and next post visible before held photo; later photo gets fresh check; comments once');
 // A photo arriving during a check cannot consume that already-started authorization.
 holds.set('p1/1.jpg',null);holdCheck=true;await fresh();await wait(()=>checkedWaiting&&waiting.has('p1/1.jpg'));release('p1/1.jpg');await page.waitForTimeout(80);const before=checks;assert.equal(await page.locator('.photo-image').count(),0);checkRelease();await loaded();assert.ok(checks>before);console.log('PASS '+width+': download finishing during pending check waits for a subsequent check');
 failPaths.add('p1/0.jpg');await fresh();await page.locator('.photo-image-retry').waitFor();await page.waitForFunction(()=>document.querySelectorAll('.photo-image').length===2);const beforeReads=reads.length;failPaths.clear();await page.locator('.photo-image-retry').click();await loaded();assert.equal(reads.length,beforeReads+1);console.log('PASS '+width+': failed file stays local and retry downloads just that image');
 holds.set('p1/1.jpg',null);await fresh();await wait(()=>waiting.has('p1/1.jpg'));await page.waitForFunction(()=>document.querySelectorAll('.photo-image').length===2);invalidIds.add('p1');release('p1/1.jpg');await page.locator('.photo-post-retry').waitFor();assert.equal(await page.locator('[data-post=p1]').count(),0);assert.equal(await page.locator('[data-post=p2] .photo-image').count(),1);invalidIds.clear();await page.locator('.photo-post-retry').click();await loaded();console.log('PASS '+width+': changed public post and comments removed; unaffected post remains');
 holds.set('p1/1.jpg',null);await fresh();await wait(()=>waiting.has('p1/1.jpg'));await page.waitForFunction(()=>document.querySelectorAll('.photo-image').length===2);deny=true;release('p1/1.jpg');await page.locator('.photo-retry').waitFor();assert.equal(await page.locator('.photo-post,.photo-image,.fixture-comments').count(),0);assert.equal(await page.evaluate(()=>created.filter(u=>!revoked.includes(u)).length),0);deny=false;await page.locator('.photo-retry').click();await loaded();console.log('PASS '+width+': final authorization denial clears all protected content and URLs');
 holds.set('p1/1.jpg',null);await fresh();await wait(()=>waiting.has('p1/1.jpg'));await page.waitForFunction(()=>document.querySelectorAll('.photo-image').length===2);await page.evaluate(()=>leave());release('p1/1.jpg');await page.waitForTimeout(80);assert.equal(await page.locator('.photo-image,.photo-post').count(),0);assert.equal(await page.evaluate(()=>created.filter(u=>!revoked.includes(u)).length),0);console.log('PASS '+width+': menu leave cancels unfinished work, rejects late bytes and releases all URLs');
 legacy=true;await page.evaluate(()=>enter());await loaded();assert.ok(await page.evaluate(()=>listCount)>1);await page.screenshot({path:out+'/complete-'+width+'.png'});await page.evaluate(()=>leave());console.log('PASS '+width+': old capability fallback and completed layout');
 if(variantMode){
  legacy=false;tamper=true;await fresh();await page.waitForFunction(()=>document.querySelectorAll('.photo-image-retry').length===3);
  assert.equal(await page.locator('.photo-image').count(),0);assert.ok(readBodies.slice(-3).every(b=>b.representation));
  tamper=false;await page.locator('.photo-image-retry').first().click();await page.waitForFunction(()=>document.querySelectorAll('.photo-image').length===1);
  console.log('PASS '+width+': tampered derivative rejected without original fallback; explicit retry obtains fresh descriptor');
  holds.set('p1/1.jpg',null);await fresh();await wait(()=>waiting.has('p1/1.jpg'));await page.waitForFunction(()=>document.querySelectorAll('.photo-image').length===2);
  variantGone=true;release('p1/1.jpg');await page.locator('.photo-image-retry').waitFor();assert.equal(await page.locator('.photo-image').count(),2);
  const beforeRetry=readBodies.length;await page.locator('.photo-image-retry').click();await loaded();assert.equal(readBodies.length,beforeRetry+1);assert.equal(readBodies.at(-1).representation,undefined);
  console.log('PASS '+width+': descriptor removal after download rejects stale Blob; explicit retry may select protected original');
  variantGone=false;await page.evaluate(()=>leave());assert.equal(await page.evaluate(()=>created.filter(u=>!revoked.includes(u)).length),0);
  assert.ok(checkBodies.filter(b=>b.variant).every(b=>b.posts.length<=2));
  const selectionReads=reads.length;holdSelection=true;await fresh();await wait(()=>checkedWaiting);
  await page.evaluate(()=>leave());checkRelease();await page.waitForTimeout(80);assert.equal(reads.length,selectionReads);assert.equal(await page.evaluate(()=>created.filter(u=>!revoked.includes(u)).length),0);
  console.log('PASS '+width+': leaving during descriptor selection starts no media request or late Blob');
 }
 legacy=false;manyPhotos=true;selectionReadMark=reads.length;const initialReads=reads.length;for(let i=0;i<8;i++)holds.set('p1/'+i+'.jpg',null);
 await page.evaluate(()=>{MINIHOMPY_POSTS=[{...MINIHOMPY_POSTS[0],body:Array.from({length:8},(_,i)=>({type:'image',path:'p1/'+i+'.jpg'}))}];enter();requestAnimationFrame(()=>document.querySelector('.photos-scroll').scrollTop=100000);});
 await wait(()=>waiting.size===4);assert.equal(reads.length-initialReads,4);assert.notEqual(reads[initialReads],'p1/0.jpg');
 for(const [path,releaseFn] of holds){holds.delete(path);if(releaseFn)releaseFn();}
 await page.waitForFunction(()=>document.querySelectorAll('.photo-image-slot[data-state=ready]').length===8);assert.equal(reads.length-initialReads,8);
 await page.evaluate(()=>leave());assert.equal(await page.evaluate(()=>created.filter(u=>!revoked.includes(u)).length),0);assert.deepEqual(errors,[]);await page.close();console.log('PASS '+width+': nearby images submitted first and four-download global limit preserved');
 }}finally{await browser.close();}
