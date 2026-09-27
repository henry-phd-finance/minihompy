import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const visits=await readFile(new URL('../visit-counts.js',import.meta.url),'utf8');
const markup=html.match(/<div class="visit-count"[\s\S]*?<\/div>/)[0];
let date='2026-09-23',fail=false,slow=false,rate=false,total=new Map(),keys=new Set(),calls=[];
const context=await browser.newContext();
await context.addInitScript(()=>{const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timer(fn,ms===10000?100:ms,...args);});
await context.route('https://fixture.test/**',route=>{
 const url=new URL(route.request().url()),path=url.pathname.split('/')[1],login=url.pathname.includes('/login/');
 const enabled=!url.searchParams.has('disabled');
 return route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html><body>${login?'':markup}<button id="content">글 읽기</button><script>window.MINIHOMPY_SUPABASE={url:'https://${path}.supabase.co'};window.MINIHOMPY_HOME_DATA_CONFIG={enabled:${enabled},supabaseUrl:MINIHOMPY_SUPABASE.url,homepage:'https://fixture.test/${path}/'};</script><script>${visits}</script></body></html>`});
});
await context.route('https://*.supabase.co/**',async route=>{
 const req=route.request(),site=new URL(req.url()).hostname;
 if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'https://fixture.test','access-control-allow-methods':'GET,POST','access-control-allow-headers':'content-type'}});
 const key=req.method()==='POST'?req.postDataJSON().browser_key:null;calls.push({site,key,date});
 if(slow)await new Promise(r=>setTimeout(r,200));
 const identity=site+date+key;const counted=Boolean(key&&!keys.has(identity));
 if(counted){keys.add(identity);total.set(site,(total.get(site)||0)+1);}
 const today=[...keys].filter(k=>k.startsWith(site+date)).length;
 await route.fulfill({status:fail?503:rate?429:200,json:{version:1,date,timezone:'Asia/Seoul',today,total:total.get(site)||0,counted},headers:{'access-control-allow-origin':'https://fixture.test','retry-after':'60'}}).catch(()=>{});
});
const ready=page=>page.waitForFunction(()=>document.querySelector('.visit-count')?.dataset.status==='ready');
try{
 const a=await context.newPage();await a.goto('https://fixture.test/a/#/board');await ready(a);assert.equal(await a.locator('[data-visit=today]').textContent(),'1');const first=calls.at(-1).key;
 await a.reload();await ready(a);assert.equal(calls.at(-1).key,first);assert.equal(total.get('a.supabase.co'),1);
 const tab=await context.newPage();await tab.goto('https://fixture.test/a/');await ready(tab);assert.equal(calls.at(-1).key,first);assert.equal(total.get('a.supabase.co'),1);
 await tab.evaluate(()=>{location.hash='#/diary';dispatchEvent(new Event('minihompy:identity'));dispatchEvent(new Event('minihompy:visitor-identity'));});assert.equal(total.get('a.supabase.co'),1);
 await tab.goto('https://fixture.test/a/login/');const count=calls.length;await tab.waitForTimeout(100);assert.equal(calls.length,count);await tab.goto('https://fixture.test/a/');await ready(tab);assert.equal(calls.at(-1).key,first);
 await tab.goto('https://fixture.test/b/');await ready(tab);assert.notEqual(calls.at(-1).key,first);assert.equal(total.get('b.supabase.co'),1);
 console.log('PASS: direct content entry, reload, tabs, account/menu changes, login return preserve key; separate sites use separate keys');
 date='2026-09-24';await a.reload();await ready(a);assert.equal(total.get('a.supabase.co'),2);assert.equal(await a.locator('[data-visit=today]').textContent(),'1');
 const blocked=await context.newPage();await blocked.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw Error('Blocked');}}));await blocked.goto('https://fixture.test/a/');await ready(blocked);assert.equal(calls.at(-1).key,null);assert.equal(await blocked.locator('[data-visit=status]').textContent(),'조회만');
 const hidden=await context.newPage();await hidden.addInitScript(()=>Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'}));const before=calls.length;await hidden.goto('https://fixture.test/a/');await hidden.waitForTimeout(100);assert.equal(calls.length,before);
 await hidden.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});await ready(hidden);assert.equal(calls.at(-1).key,first);
 console.log('PASS: server date change, storage blocked read-only and hidden/visible tab');
 fail=true;await a.reload();await a.locator('[data-status=error]').waitFor();assert.equal(await a.locator('[data-visit=today]').textContent(),'—');await a.locator('#content').click();fail=false;await a.getByRole('button',{name:'방문 통계 다시 시도'}).click();await ready(a);assert.equal(calls.at(-1).key,first);
 slow=true;await a.reload();await a.locator('[data-status=error]').waitFor();slow=false;await a.getByRole('button',{name:'방문 통계 다시 시도'}).click();await ready(a);
 rate=true;await a.reload();await a.locator('[data-status=error]').waitFor();const limited=calls.length;await a.getByRole('button',{name:'방문 통계 다시 시도'}).click();await a.waitForTimeout(150);assert.equal(calls.length,limited);rate=false;
 await a.goto('https://fixture.test/a/?disabled');const disabled=calls.length;await a.waitForTimeout(100);assert.equal(calls.length,disabled);assert.equal(await a.locator('.visit-count').getAttribute('data-status'),'disabled');
 await a.goto('https://fixture.test/a/?login_intent=fixture');const intent=calls.length;await a.waitForTimeout(100);assert.equal(calls.length,intent);
 console.log('PASS: failure/retry/timeout do not block content; rate-limit cooldown, disabled readiness and login intent prevent recording');
 // Two initially empty tabs race on the same localStorage key: Web Locks creates one key.
 const fresh=await browser.newContext();await fresh.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<html><body>${markup}<script>window.MINIHOMPY_SUPABASE={url:'https://fresh.supabase.co'};window.MINIHOMPY_HOME_DATA_CONFIG={enabled:true,supabaseUrl:MINIHOMPY_SUPABASE.url,homepage:'https://fresh.test/'};window.testKeys=[];window.fetch=async(u,o)=>{testKeys.push(JSON.parse(o.body).browser_key);return Response.json({version:1,date:'2026-09-24',timezone:'Asia/Seoul',today:1,total:1,counted:true});};</script><script>${visits}</script></body></html>`}));
 const [one,two]=await Promise.all([fresh.newPage(),fresh.newPage()]);await Promise.all([one.goto('https://fresh.test/'),two.goto('https://fresh.test/')]);await Promise.all([ready(one),ready(two)]);const k1=await one.evaluate(()=>testKeys[0]),k2=await two.evaluate(()=>testKeys[0]);assert.equal(k1,k2);assert.notEqual(k1,first);await fresh.close();
 console.log('PASS: simultaneous first tabs create one durable key; separate browser context creates another');
}finally{await context.close();await browser.close();}
