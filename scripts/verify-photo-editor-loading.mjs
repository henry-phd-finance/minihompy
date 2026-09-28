import assert from 'node:assert/strict';import {readFile,mkdir,writeFile} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])));const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
const out=process.env.VERIFICATION_DIR||'/tmp/photo-editor-loading';await mkdir(out,{recursive:true});
const deferred=['assets/vendor/quill-2.0.3.js','photo-variant-client.js','photo-editor.js'];
const currentIndex=await readFile('index.html','utf8'),oldIndex=execFileSync('git',['show','033a2bf:index.html'],{encoding:'utf8'});
const oldEditor=execFileSync('git',['show','033a2bf:photo-editor.js'],{encoding:'utf8'});
const records=[];
async function fixture({old=false,fail=null,hold=null,role='admin',delay=false}={}){
 const page=await browser.newPage(),errors=[],requests=[];let release,failed=false;
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
 const kept=new Set(['photo-editor-loader.js',...deferred,'photos-repository.js','photo-media-client.js','views/photos.js']);
 await page.route('**/*',async route=>{const name=new URL(route.request().url()).pathname.slice(1);
  if(name){let body=old&&name==='photo-editor.js'?oldEditor:await readFile(name,'utf8');requests.push({name,bytes:Buffer.byteLength(body)});
   if(name===hold)await new Promise(r=>release=r);
   if(name===fail&&!failed){failed=true;return route.abort();}
   if(delay)await new Promise(r=>setTimeout(r,30+Buffer.byteLength(body)/(2*1024*1024)*1000));
   return route.fulfill({contentType:name.endsWith('.css')?'text/css':'text/javascript',body});
  }
  const scripts=[...(old?oldIndex:currentIndex).matchAll(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g)].filter(m=>kept.has(m[1])).map(m=>m[0]).join('');
  return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><script>
  window.started=performance.now();window.MINIHOMPY_CONFIG={profile:{name:'Owner'}};window.MINIHOMPY_VIEWS={};window.MinihompyAdmin={state:{role:${JSON.stringify(role)},userId:'owner'}};window.MinihompyComments={create:()=>document.createElement('div'),clearKind:()=>{},forget:()=>{}};
  const client={from:()=>({select:()=>({order:()=>({order:async()=>({data:[{id:'f',kind:'folder',label:'사진'}]})})})})};
  window.MinihompyContentAccess={open:async()=>({client,assert:()=>{},verify:async()=>{},authorization:async()=>null}),friendsReady:async()=>false,read:async action=>action==='list'?{data:{items:[],count:0}}:{legacy:true}};
  </script>${scripts}<div id="left"></div><div id="main">홈</div><script>
  window.addEventListener('DOMContentLoaded',()=>{window.homeReady=performance.now()-started;});
  window.enter=()=>{document.querySelector('#left').replaceChildren(MINIHOMPY_VIEWS.photos.createLeft());document.querySelector('#main').replaceChildren(MINIHOMPY_VIEWS.photos.createMain());};
  window.leave=()=>{dispatchEvent(new CustomEvent('minihompy:menu-leave',{detail:{id:'photos'}}));document.querySelector('#main').replaceChildren(document.createTextNode('홈'));};
  </script>`});
 });
 await page.goto('https://editor.test/');await page.waitForFunction(()=>homeReady>0);
 return {page,requests,errors,release:()=>release?.(),held:async()=>{for(let i=0;i<1000&&!release;i++)await page.waitForTimeout(10);assert(release);},enter:async()=>{await page.evaluate(()=>enter());await page.locator('.photo-editor-message').waitFor({state:'attached'});},close:async()=>{assert.deepEqual(errors,[]);await page.close();}};
}
try{
 for(const old of [true,false])for(let sample=0;sample<3;sample++){
  const f=await fixture({old,delay:true});const initial=[...f.requests];
  assert.equal(initial.filter(r=>deferred.includes(r.name)).length,old?3:0);
  await f.enter();const before=f.requests.length,start=Date.now();await f.page.locator('.photo-write').click();await f.page.locator('.ql-editor').waitFor();const firstEditMs=Date.now()-start;
  assert.equal(f.requests.slice(before).filter(r=>deferred.includes(r.name)).length,old?0:3);
  await f.page.locator('.photo-editor-title').fill('discard me');await f.page.evaluate(()=>leave());await f.enter();const count=f.requests.length,t=Date.now();await f.page.locator('.photo-write').click();await f.page.locator('.ql-editor').waitFor();assert.equal(await f.page.locator('.photo-editor-title').inputValue(),'');assert.equal(f.requests.length,count);
  records.push({old,sample,initialBytes:initial.reduce((n,r)=>n+r.bytes,0),initialDeferredRequests:initial.filter(r=>deferred.includes(r.name)).length,homeReadyMs:await f.page.evaluate(()=>homeReady),firstEditMs,reeditMs:Date.now()-t});await f.close();
 }
 console.log('PASS 1: current index home/album reads load no editor; first edit loads three dependencies once; reedit reuses code but discards draft');
 for(const action of ['leave','logout','owner-change']){
  const f=await fixture({hold:'assets/vendor/quill-2.0.3.js'});await f.enter();await f.page.locator('.photo-write').click();await f.held();assert.match(await f.page.locator('.photo-editor-message').innerText(),/불러오고/);
  await f.page.locator('.photo-write').click();assert.equal(f.requests.filter(r=>r.name===deferred[0]).length,1);
  await f.page.evaluate(action=>{if(action==='leave')leave();else {MinihompyAdmin.state={role:action==='logout'?'reader':'admin',userId:'another'};dispatchEvent(new Event('minihompy:content-access-reset'));}},action);
  f.release();await f.page.waitForTimeout(100);assert.equal(await f.page.locator('.photo-editor').count(),0);assert.equal(f.requests.filter(r=>r.name==='photo-editor.js').length,0);
  if(action==='leave'){await f.enter();await f.page.locator('.photo-write').click();await f.page.locator('.ql-editor').waitFor();assert.equal(f.requests.filter(r=>r.name===deferred[0]).length,1);}
  await f.close();
 }
 console.log('PASS 2: duplicate clicks share code download; leave/logout/owner switch cancel opening while static code safely finishes');
 for(const asset of deferred){const f=await fixture({fail:asset});await f.enter();await f.page.locator('.photo-write').click();await f.page.locator('.photo-editor-load-retry').waitFor();assert.equal(await f.page.locator('.photo-editor').count(),0);await f.page.locator('.photo-editor-load-retry').click();await f.page.locator('.ql-editor').waitFor();assert.equal(f.requests.filter(r=>r.name===asset).length,2);await f.close();}
 console.log('PASS 3: each dependency failure has explicit retry; successful dependencies reused');
 const visitor=await fixture({role:'reader'});await visitor.enter();assert.equal(await visitor.page.locator('.photo-write').count(),0);assert.equal(await visitor.page.evaluate(()=>MinihompyPhotoEditor.start(null,'f')),false);assert.equal(visitor.requests.filter(r=>deferred.includes(r.name)).length,0);await visitor.close();
 console.log('PASS 4: visitors cannot initiate editor loading');
 const late=await fixture();await late.enter();await late.page.evaluate(()=>{MinihompyContentAccess.friendsReady=()=>new Promise(r=>window.finishStart=r);});await late.page.locator('.photo-write').click();await late.page.waitForFunction(()=>!!window.finishStart);
 await late.page.evaluate(()=>{leave();finishStart(false);});await late.page.waitForTimeout(80);assert.equal(await late.page.evaluate(()=>MinihompyPhotoEditor.active),false);assert.equal(await late.page.locator('.photo-editor').count(),0);await late.close();
 console.log('PASS 5: cancellation while real editor prepares a draft clears it; no late opening');
 await writeFile(out+'/metrics.json',JSON.stringify({conditions:{network:'30ms + body bytes / 2 MiB/s per script; local routed fixture',baseline:'Step 10 index/editor from 033a2bf',scope:'same isolated photo dependencies and view; not full production homepage',samplesPerMode:3,cache:'new browser page per sample; same page for reedit'},records},null,2)+'\n');
}finally{await browser.close();}
