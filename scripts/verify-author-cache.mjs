import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2]))),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
const id=n=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0'),root=new URL('../',import.meta.url);
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://fixture.test/',r=>r.fulfill({contentType:'text/html',body:'<main></main>'}));await page.goto('https://fixture.test/');
 await page.evaluate(()=>{
  window.now=Date.now();Date.now=()=>now;window.calls=[];
  window.MINIHOMPY_VISITOR_IDENTITY_CONFIG={enabled:true,centralApiUrl:'https://central.test'};
  window.fetch=(url,options)=>new Promise((resolve,reject)=>{const call={ids:new URL(url).searchParams.get('member_ids').split(','),signal:options.signal,resolve,reject};calls.push(call);options.signal.addEventListener('abort',()=>reject(Error('aborted')));});
  window.finish=(index=calls.length-1,mode='ready')=>{const c=calls[index];c.resolve({ok:mode!=='error',json:async()=>({items:mode==='empty'?[]:c.ids.map(id=>({id,site_id:id,handle:'alice',display_name:'Alice',homepage_url:'https://homes.test/new/'}))})});};
  window.add=id=>{const e=MinihompyAuthorNavigation.create({author_kind:'member',author_member_id:id,author_name:'Alice'},'name');document.querySelector('main').append(e);return e;};
 });
 await page.addScriptTag({content:await readFile(new URL('member-navigation.js',root),'utf8')});
 // Supply a script URL for the same relative base as the deployed module.
 await page.route('https://fixture.test/author-navigation.js',async r=>r.fulfill({contentType:'text/javascript',body:await readFile(new URL('author-navigation.js',root),'utf8')}));
 await page.addScriptTag({url:'/author-navigation.js'});
 const count=()=>page.evaluate(()=>calls.length),wait=n=>page.waitForFunction(n=>calls.length===n,n);
 const add=n=>page.evaluate(id=>add(id),id(n)),done=()=>page.waitForFunction(()=>!document.querySelector('[data-status=loading]'));
 await add(1);await wait(1);await add(1);await page.waitForTimeout(30);assert.equal(await count(),1);
 await page.evaluate(()=>finish());await done();await add(1);await done();assert.equal(await count(),1);
 await page.evaluate(()=>now+=29999);await add(1);await done();assert.equal(await count(),1);
 await page.evaluate(()=>now++);await add(1);await wait(2);await page.evaluate(()=>finish());await done();
 console.log('PASS staggered in-flight sharing and exact 30-second successful-display TTL');
 await add(2);await wait(3);await page.evaluate(()=>finish(undefined,'empty'));await done();await add(2);await wait(4);await page.evaluate(()=>finish(undefined,'error'));await done();await add(2);await wait(5);await page.evaluate(()=>finish());await done();
 console.log('PASS inactive and error responses are not cached');
 // One member disappearing cannot cancel another member in the same request.
 await page.evaluate(ids=>ids.forEach(add),[id(3),id(4)]);await wait(6);
 await page.evaluate(()=>document.querySelector('main').lastChild.remove());await page.waitForTimeout(10);assert.equal(await page.evaluate(()=>calls.at(-1).signal.aborted),false);
 await page.evaluate(()=>document.querySelector('main').lastChild.remove());await page.waitForFunction(()=>calls.at(-1).signal.aborted);
 await page.evaluate(()=>finish());await add(3);await wait(7);await page.evaluate(()=>finish());await done();
 console.log('PASS partial detach retains shared request, final detach aborts, late result not reused');
 await page.evaluate(()=>{document.querySelector('main').replaceChildren();dispatchEvent(new Event('minihompy:navigation-invalidate'));});
 const before=await count();await page.evaluate(ids=>ids.forEach(add),Array.from({length:201},(_,i)=>id(i+100)));await wait(before+5);
 assert.deepEqual(await page.evaluate(n=>calls.slice(n).map(c=>c.ids.length),before),[50,50,50,50,1]);
 await page.evaluate(n=>{for(let i=n;i<calls.length;i++)finish(i);},before);await done();
 await add(101);await done();assert.equal(await count(),before+5); // Touch member 101, preserving it in LRU.
 await add(100);await wait(before+6);await page.evaluate(()=>finish());await done();
 await add(101);await done();assert.equal(await count(),before+6);
 await add(102);await wait(before+7);await page.evaluate(()=>finish());await done();
 console.log('PASS batches <=50 and 200-member LRU eviction/touch');
 await page.evaluate(()=>{document.querySelector('main').replaceChildren();MINIHOMPY_VISITOR_IDENTITY_CONFIG.centralApiUrl='https://other.test';});await add(101);await wait(before+8);await page.evaluate(()=>finish());await done();
 await page.evaluate(()=>{MINIHOMPY_SUPABASE={url:'https://new-project.test'};});await add(101);await wait(before+9);await page.evaluate(()=>finish());await done();
 await page.evaluate(()=>dispatchEvent(new Event('minihompy:writing-reset')));assert.equal(await page.locator('a[href]').count(),0);await wait(before+10);await page.evaluate(()=>finish());await done();
 assert.deepEqual(errors,[]);console.log('PASS central/project switch and writing invalidation clear cached/in-flight state');
}finally{await browser.close();}
