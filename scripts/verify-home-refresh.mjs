// Deterministic lifecycle checks against the real home summary renderer.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://fixture.test/',r=>r.fulfill({contentType:'text/html',body:'<input id="draft"><div id="summary"></div>'}));
 await page.goto('https://fixture.test/');
 await page.evaluate(()=>{
  window.clock=Date.parse('2026-09-28T10:00:00Z');Date.now=()=>clock;
  let seq=0;const timers=new Map();window.setTimeout=(fn,ms)=>{timers.set(++seq,{at:clock+ms,fn});return seq;};window.clearTimeout=id=>timers.delete(id);
  window.tick=async ms=>{const end=clock+ms;for(;;){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;clock=due[1].at;timers.delete(due[0]);due[1].fn();for(let i=0;i<8;i++)await Promise.resolve();}clock=end;};
  window.MINIHOMPY_CONFIG={menus:[{id:'board',visible:true}]};window.MINIHOMPY_SUPABASE={url:'https://db.test'};window.MINIHOMPY_HOME_DATA_CONFIG={enabled:true,supabaseUrl:'https://db.test',homepage:'https://fixture.test/'};
  window.MinihompyAdmin={state:{role:'reader'}};window.MinihompyPostRoutes={href:()=> '#/board?post=1'};
  window.calls=[];window.MinihompyHomeRepository={summary:(_,{signal})=>new Promise((resolve,reject)=>calls.push({signal,resolve,reject}))};
  window.data=()=>({date:new Date(clock+9*3600000).toISOString().slice(0,10),as_of:new Date(clock).toISOString(),menus:['board'],recent:[{kind:'board',id:'1',label:'Protected',created_at:'2026-09-28T00:00:00Z',today_comments:0}],counts:{board:{today:1,total:1}},today_comments:0});
  window.finish=async(index=calls.length-1,label)=>{const d=data();if(label)d.recent[0].label=label;calls[index].resolve(d);for(let i=0;i<8;i++)await Promise.resolve();};
  window.root=document.querySelector('#summary');window.burst=()=>{dispatchEvent(new Event('focus'));dispatchEvent(new Event('pageshow'));document.dispatchEvent(new Event('visibilitychange'));};
  window.hidden=value=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:value?'hidden':'visible'});document.dispatchEvent(new Event('visibilitychange'));};
 });
 await page.addScriptTag({content:await readFile(new URL('../home-activity.js',import.meta.url),'utf8')});
 const run=fn=>page.evaluate(fn);
 await run(async()=>{MinihompyHomeActivity.attach(root);burst();await tick(49);});assert.equal(await run(()=>calls.length),0);
 await run(()=>tick(1));assert.equal(await run(()=>calls.length),1);
 await run(async()=>{burst();await tick(100);});assert.equal(await run(()=>calls.length),1);assert.equal(await run(()=>calls[0].signal.aborted),false);
 await run(()=>finish());assert.equal(await run(()=>root.dataset.status),'ready');
 await run(async()=>{window.original=root.firstChild;document.querySelector('#draft').value='untouched';burst();});assert.equal(await run(()=>root.querySelector('a')),null);
 await run(async()=>{await tick(50);await finish();});assert.equal(await run(()=>root.firstChild===original),true);assert.equal(await page.locator('#draft').inputValue(),'untouched');
 await run(async()=>{window.original=root.firstChild;dispatchEvent(new Event('minihompy:writing-reset'));await tick(50);await finish();});assert.equal(await run(()=>root.firstChild===original),false);
 console.log('PASS burst=1, in-flight join without abort, detached DOM reused only after fresh success, unrelated draft preserved');
 for(const event of ['minihompy:visitor-identity','minihompy:writing-reset','minihompy:content-changed','minihompy:content-access-reset','minihompy:settings','minihompy:relationship-pending','minihompy:relationship-change']){
  await run(async()=>{burst();await tick(50);window.old=calls.length-1;window.previous=root.firstChild;});
  await page.evaluate(event=>dispatchEvent(new Event(event)),event);
  assert.equal(await run(()=>calls[old].signal.aborted),true);assert.equal(await page.locator('#summary a').count(),0);
  await run(async()=>{await tick(50);await finish(undefined,'Fresh');await finish(old,'STALE');});assert.equal(await page.locator('.home-post-label').textContent(),'Fresh');
 }
 console.log('PASS identity/writing/content/access/settings/relationship changes abort old reads and reject late responses');
 await run(()=>{window.before=calls.length;hidden(true);dispatchEvent(new Event('minihompy:content-changed'));burst();});
 await run(()=>tick(120000));assert.equal(await run(()=>calls.length===before),true);assert.equal(await page.locator('#summary a').count(),0);
 await run(async()=>{hidden(false);burst();await tick(50);await finish();});assert.equal(await run(()=>calls.length),await run(()=>before+1));
 await run(async()=>{window.before=calls.length;await tick(60000);});assert.equal(await run(()=>calls.length),await run(()=>before+1));await run(()=>finish());
 await run(async()=>{clock=Date.parse('2026-09-28T14:59:59.900Z');dispatchEvent(new Event('minihompy:content-changed'));await tick(50);await finish();window.before=calls.length;await tick(49);});assert.equal(await run(()=>calls.length),await run(()=>before));
 await run(()=>tick(1));assert.equal(await run(()=>calls.length),await run(()=>before+1));await run(()=>finish());
 // Crossing midnight while an old-day response is pending must schedule a new-day read.
 await run(async()=>{clock=Date.parse('2026-09-29T14:59:59.900Z');dispatchEvent(new Event('minihompy:content-changed'));await tick(50);window.before=calls.length;await tick(100);await finish();await tick(50);});assert.equal(await run(()=>calls.length),await run(()=>before+1));await run(()=>finish());
 console.log('PASS hidden suppression/return, minute expiry, KST midnight and old-day pending response');
 await run(async()=>{burst();await tick(50);await tick(25000);});assert.equal(await run(()=>root.dataset.status),'error');
 await run(()=>{MinihompyContentAccess={retry:async()=>{throw Error('offline');}};root.querySelector('button').click();});assert.equal(await run(()=>root.dataset.status),'error');
 await run(async()=>{MinihompyContentAccess.retry=async()=>{};root.querySelector('button').click();await Promise.resolve();await tick(50);await finish();});assert.equal(await run(()=>root.dataset.status),'ready');
 await run(async()=>{burst();await tick(50);window.old=calls.length-1;dispatchEvent(new CustomEvent('minihompy:menu-leave',{detail:{id:'home'}}));await finish(old,'STALE');});assert.equal(await run(()=>calls[old].signal.aborted),true);assert.equal(await page.locator('.home-post-label').count(),0);
 // Views attach before insertion: initial scheduling must survive this lifecycle.
 await run(async()=>{const next=document.createElement('div');MinihompyHomeActivity.attach(next);root.replaceWith(next);window.root=next;await tick(50);await finish();});assert.equal(await run(()=>root.dataset.status),'ready');
 await run(async()=>{dispatchEvent(new Event('pagehide'));window.before=calls.length;dispatchEvent(new Event('pageshow'));await tick(50);await finish();});assert.equal(await run(()=>calls.length),await run(()=>before+1));
 assert.deepEqual(errors,[]);console.log('PASS timeout/retry failure/recovery, menu leave, attach before insertion, pagehide/pageshow');
}finally{await browser.close();}
