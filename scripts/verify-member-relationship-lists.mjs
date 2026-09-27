// Real browser UI/repository/navigation links; identity transport and server responses are fixtures.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])));
const root=new URL('../',import.meta.url),out=resolve(process.env.MINIHOMPY_RELATIONSHIP_LISTS_OUTPUT||'docs/verification/member-relationship-step5');await mkdir(out,{recursive:true});
const html=(await readFile(new URL('index.html',root),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
const id=n=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const profile=n=>({member_id:id(n),display_name:'같은 이름',handle:'member'+n,destination:{site_id:id(n+100),homepage_url:'https://old.test/'}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});let groups=0;
try{for(const width of [1280,375]){
 const page=await browser.newPage({viewport:{width,height:850}}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='personal.test')return route.fulfill({json:{relationship_protocol:1,relationship_relay_ready:true}});
  if(u.pathname.endsWith('/relationships/friends')){assert.equal(u.searchParams.get('member_id'),id(2));assert.equal(route.request().headers().authorization,undefined);return route.fulfill({json:{items:u.searchParams.has('cursor')?[profile(25)]:[profile(3)],next_cursor:u.searchParams.has('cursor')?null:'friends-page2'}});}
  if(u.pathname.endsWith('/navigation/members'))return route.fulfill({json:{items:u.searchParams.get('member_ids').split(',').map(member=>({id:member,site_id:id(103),display_name:'최신 이름',handle:'latest',homepage_url:'https://latest.test/home/'}))}});
  const path=u.pathname.replace(/^\/home\//,'')||'index.html';if(path==='index.html')return route.fulfill({contentType:'text/html',body:html});
  try{return route.fulfill({body:await readFile(new URL(path,root)),contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':undefined});}catch{return route.abort();}
 });
 await page.goto('https://b.test/home/');
 await page.evaluate(({idA,idB,items})=>{
  window.MINIHOMPY_VISITOR_IDENTITY_CONFIG={enabled:true,centralApiUrl:'https://central.test/api'};window.MINIHOMPY_SUPABASE={url:'https://personal.test'};
  window.MinihompySharedIdentity={state:{status:'identified',visitor:{id:idA,display_name:'A',handle:'alice'}}};
  window.MinihompyNavigation={state:{owner:{id:idB,display_name:'B',handle:'bob'}}};
  window.parseMinihompyNavigationProfile=p=>p;
  window.fixture={incoming:items,outgoing:[{...items[0],target:{...items[0].target,member_id:idB},state:'outgoing'}],calls:[],generation:1,hold:false,lose:false,receipts:{},refresh:0};
  window.MinihompyRelationshipUI={refresh:()=>fixture.refresh++};
  window.MinihompyMemberWriting={enabled:()=>true,snapshot:()=>fixture.generation,check:s=>{if(s!==fixture.generation)throw Error('IDENTITY_CHANGED');},state:{status:'ready'},retry:async()=>{},relationship:async(path,b)=>{
   fixture.calls.push({path,b});
   if(path.endsWith('/requests')){if(fixture.readError)throw Object.assign(Error('quota'),{status:429,retryAfter:20});const start=b.cursor?20:0,result={items:fixture[b.direction].slice(start,start+20),next_cursor:fixture[b.direction].length>start+20?'page2':null};if(fixture.hold)await new Promise(r=>fixture.release=r);return result;}
   if(path.endsWith('/operations'))return fixture.receipts[b.operation_id];
   if(path.endsWith('/actions')){for(const key of ['incoming','outgoing'])fixture[key]=fixture[key].filter(i=>i.target.member_id!==b.target_member_id);const result={relationship:{state:b.action==='accept'?'accepted':'none'}};fixture.receipts[b.operation_id]=result;if(fixture.lose){fixture.lose=false;throw Error('Lost ACK');}return result;}
   throw Error('Unexpected request');
  }};
 },{idA:id(1),idB:id(2),items:Array.from({length:21},(_,i)=>({state:'incoming',revision:1,request_id:id(300+i),target:i===0?{member_id:id(3),unavailable:true}:profile(i+3)}))});
 for(const script of ['member-relationships-repository.js','author-navigation.js','member-relationship-lists.js'])await page.addScriptTag({url:script});
 const action=k=>page.locator(`[data-list-action="${k}"]`),rows=page.locator('.relationship-list > li'),message=page.locator('#relationship-lists-dialog [role="status"]');
 const wait=async n=>{await page.waitForFunction(n=>document.querySelectorAll('.relationship-list > li').length===n&&!document.querySelector('[data-list-action="refresh"]')?.disabled,n);};
 const open=async mode=>page.evaluate(mode=>{document.querySelector('#relationship-dialog').showModal();document.querySelector(`[data-relationship-list="${mode}"]`).click();},mode);
 await open('incoming');await wait(20);assert.match(await page.locator('#relationship-list-scope').innerText(),/alice/);assert.equal(await rows.first().locator('[data-list-action="accept"]').count(),0);assert.equal(await rows.first().locator('[data-list-action="reject"]').count(),1);
 await action('next').click();await wait(1);await action('accept').click();await wait(20);assert.equal(await action('next').count(),0);assert.equal(await page.evaluate(()=>fixture.refresh),1);
 console.log(`PASS ${++groups}: ${width}px own incoming pagination, inactive peer, accept final page resets and synchronizes widget`);
 await rows.first().locator('[data-list-action="reject"]').click();await action('confirm').click();await wait(19);
 await action('outgoing').click();await wait(1);await action('cancel').click();await action('confirm').click();await wait(0);assert.match(await message.innerText(),/표시할 항목/);
 assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.path.endsWith('/requests')).some(c=>'member_id' in c.b)),false);
 console.log(`PASS ${++groups}: ${width}px reject/cancel confirmations, empty lists, actor never supplied by UI`);
 await action('friends').click();await wait(1);assert.match(await page.locator('#relationship-list-scope').innerText(),/bob/);await page.waitForFunction(()=>document.querySelector('.relationship-member-name')?.href==='https://latest.test/home/');await action('next').click();await wait(1);assert.equal(await rows.first().getAttribute('data-member-id'),id(25));await action('previous').click();await wait(1);
 await page.screenshot({path:resolve(out,`lists-${width}.png`)});assert.equal(await page.evaluate(()=>document.querySelector('#relationship-lists-dialog').getBoundingClientRect().width<=innerWidth),true);
 console.log(`PASS ${++groups}: ${width}px current-home public friends pagination and latest member-ID home URL`);
 await action('incoming').click();await wait(19);await page.evaluate(()=>fixture.readError=true);await action('refresh').click();await wait(0);assert.match(await message.innerText(),/20초/);await page.evaluate(()=>fixture.readError=false);await action('refresh').click();await wait(19);await page.evaluate(()=>fixture.lose=true);await rows.first().locator('[data-list-action="accept"]').click();await page.waitForFunction(()=>!document.querySelector('[data-list-action="recover"]')?.disabled);const before=await page.evaluate(()=>fixture.calls.filter(c=>c.path.endsWith('/actions')).length);await action('recover').click();await wait(18);assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.path.endsWith('/actions')).length),before);
 console.log(`PASS ${++groups}: ${width}px lost mutation result recovers without resending`);
 await page.evaluate(()=>{fixture.hold=true;document.querySelector('[data-list-action="refresh"]').click();});await page.waitForFunction(()=>!!fixture.release);
 await page.evaluate(()=>{fixture.generation++;MinihompySharedIdentity.state={status:'anonymous'};dispatchEvent(new CustomEvent('minihompy:visitor-identity'));fixture.release();fixture.hold=false;});await wait(0);await action('refresh').click();assert.match(await message.innerText(),/로그인/);await action('friends').click();await wait(1);
 await page.evaluate(()=>dispatchEvent(new PopStateEvent('popstate')));assert.equal(await page.locator('#relationship-lists-dialog').evaluate(d=>d.open),false);await wait(0);assert.equal(await page.evaluate(()=>document.activeElement.id),'relationship-open');
 await open('friends');await wait(1);await page.keyboard.press('Escape');assert.equal(await page.locator('#relationship-lists-dialog').evaluate(d=>d.open),false);
 assert.deepEqual(errors,[]);console.log(`PASS ${++groups}: ${width}px logout clears private items and delayed response, anonymous public list, back/Escape focus`);
 await page.close();
}}finally{await browser.close();}
console.log(`PASS: ${groups} relationship list browser groups`);
