// Actual browser markup, navigation, runtime, member client, repository and UI. HTTP is a deterministic fixture.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])));
const root=new URL('../',import.meta.url),out=resolve(process.env.MINIHOMPY_RELATIONSHIP_UI_OUTPUT || 'docs/verification/member-relationship-step4');await mkdir(out,{recursive:true});
const html=(await readFile(new URL('index.html',root),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
const id=n=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A={id:id(1),site_id:id(11),handle:'alice',display_name:'같은 이름',homepage_url:'https://a.test/home/'},B={...A,id:id(2),site_id:id(12),handle:'bob',homepage_url:'https://b.test/home/'};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});let groups=0;
try{for(const width of [1280,375]){
 const page=await browser.newPage({viewport:{width,height:850}}),errors=[],changes=[];page.on('pageerror',e=>errors.push(e.message));
 let owner=B,viewer=A,relation='none',revision=0,requestId=null,offline=false,ready=true,lose=false,held=false,release,quota=false;const receipts=new Map();
 const state=()=>({state:relation,revision,request_id:requestId,target:{member_id:owner.id,handle:owner.handle,display_name:owner.display_name,destination:{site_id:owner.site_id,homepage_url:owner.homepage_url}}});
 await page.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.hostname==='central.test')return route.fulfill({json:u.pathname.endsWith('/site')?{item:owner}:{items:viewer?[viewer]:[]}});
  if(u.hostname==='personal.test'){
   const path=u.pathname.replace('/functions/v1/member-writing',''),b=req.postDataJSON();
   if(path==='/relationships/health')return route.fulfill({json:{relationship_protocol:ready?1:0,relationship_relay_ready:ready}});
   if(path==='/sessions/current')return route.fulfill({json:{actor:{kind:'member',member_id:viewer?.id||A.id},expires_at:new Date(Date.now()+900000).toISOString()}});
   if(path==='/sessions/exchange')return route.fulfill({json:{actor:{kind:'member',member_id:viewer.id},session_token:'t'.repeat(43),renewal_token:'r'.repeat(43),expires_at:new Date(Date.now()+900000).toISOString()}});
   if(path==='/sessions/revoke')return route.fulfill({json:{revoked:true}});
   if(path==='/relationships/state'){
    const result=state();if(held)await new Promise(r=>release=r);
    return route.fulfill({status:offline?503:200,json:offline?{error:{code:'IDENTITY_UNAVAILABLE'}}:result});
   }
   if(path==='/relationships/operations')return route.fulfill({status:receipts.has(b.operation_id)?200:404,json:receipts.get(b.operation_id)||{error:{code:'NOT_FOUND'}}});
   if(path==='/relationships/actions'){
    changes.push(b);assert.equal(req.headers()['x-minihompy-auth-mode'],'member');assert.equal(req.headers().authorization,'Bearer '+'t'.repeat(43));
    if(quota)return route.fulfill({status:429,headers:{'Retry-After':'20','Access-Control-Expose-Headers':'Retry-After'},json:{error:{code:'RATE_LIMITED'}}});
    if(b.expected_revision!==revision)return route.fulfill({status:409,json:{error:{code:'REVISION_CONFLICT'}}});
    revision++;relation={request:'outgoing',accept:'accepted',reject:'none',cancel:'none',disconnect:'none'}[b.action];requestId=relation==='none'?null:id(88);
    const result={relationship:state(),operation_result:{action:b.action,operation_id:b.operation_id,relationship:state()}};receipts.set(b.operation_id,result);
    if(lose){lose=false;return route.abort();}return route.fulfill({json:result});
   }
   throw Error('Unexpected personal path '+path);
  }
  const path=u.pathname.replace(/^\/home\//,'')||'index.html';if(path==='index.html')return route.fulfill({contentType:'text/html',body:html});
  try{return route.fulfill({body:await readFile(new URL(path,root)),contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':undefined});}catch{return route.abort();}
 });
 await page.goto('https://b.test/home/');
 await page.evaluate(({A,B})=>{
  window.MINIHOMPY_VISITOR_IDENTITY_CONFIG={enabled:true,siteId:B.site_id,centralApiUrl:'https://central.test/api'};window.MINIHOMPY_SUPABASE={url:'https://personal.test'};window.MINIHOMPY_MEMBER_WRITING_CONFIG={enabled:true};
  window.MinihompyAdmin={state:{role:'admin',userId:'unrelated-local-admin'}};window.MinihompyVisitorSession={context:async()=>{throw Error('Owner context must not be selected');}};
  window.MinihompySharedIdentity={state:{status:'identified',visitor:A},getLoginUrl:async()=>{window.loginRequested=true;return '#central-login';},retry:async()=>{}};
  window.reseed=()=>sessionStorage.setItem('minihompy.member-writing.v1:'+B.site_id+':https://personal.test','t'.repeat(43));window.reseed();
  window.changeIdentity=p=>{window.MinihompySharedIdentity.state=p?{status:'identified',visitor:p}:{status:'anonymous'};window.dispatchEvent(new CustomEvent('minihompy:visitor-identity',{detail:window.MinihompySharedIdentity.state}));};
 },{A,B});
 for(const script of ['member-writing-client.js','member-writing-runtime.js','member-relationships-repository.js','member-navigation.js','member-relationships.js'])await page.addScriptTag({url:script});
 const wait=async status=>page.waitForFunction(s=>window.MinihompyRelationshipUI.state.status===s&&!window.MinihompyRelationshipUI.state.busy,status);
 const click=key=>page.locator('[data-relationship-action="'+key+'"]').click();
 const reload=()=>page.evaluate(()=>window.MinihompyRelationshipUI.refresh());
 await wait('none');assert.match(await page.locator('#visitor-name').innerText(),/@alice/);assert.match(await page.locator('#home-owner-name').innerText(),/@bob/);
 await page.locator('#relationship-open').click();await wait('none');await page.evaluate(()=>{const b=document.querySelector('[data-relationship-action="request"]');b.click();b.click();});await wait('outgoing');
 await click('cancel');assert.match(await page.locator('#relationship-message').innerText(),/취소하시겠습니까/);await click('back');assert.equal(changes.length,1);
 await click('cancel');await click('confirm');await wait('none');console.log(`PASS ${++groups}: ${width}px request/cancel, confirmation and separate member/admin identity`);
 relation='incoming';revision++;requestId=id(88);await reload();await wait('incoming');await click('reject');await click('confirm');await wait('none');
 relation='incoming';revision++;requestId=id(88);await reload();await wait('incoming');await click('accept');await wait('accepted');
 await click('disconnect');assert.match(await page.locator('#relationship-message').innerText(),/기존 일촌평은 유지/);await click('confirm');await wait('none');console.log(`PASS ${++groups}: ${width}px accept/reject/disconnect and retention explanation`);
 revision++;await click('request');await wait('error');assert.match(await page.locator('#relationship-message').innerText(),/관계가 변경/);await click('retry');await wait('none');
 quota=true;await click('request');await wait('error');assert.match(await page.locator('#relationship-message').innerText(),/20초/);quota=false;await click('retry');await wait('none');
 lose=true;const before=changes.length;await click('request');await wait('error');assert.equal(changes.length,before+1);await click('recover');await wait('outgoing');assert.equal(changes.length,before+1);console.log(`PASS ${++groups}: ${width}px rate limit and lost ACK recovery without another mutation`);
 offline=true;await reload();await wait('error');assert.equal(await page.locator('[data-relationship-action="request"]').count(),0);offline=false;await click('retry');await wait('outgoing');
 ready=false;await reload();await wait('unavailable');ready=true;await click('retry');await wait('outgoing');console.log(`PASS ${++groups}: ${width}px unavailable backend and failure never become non-friend state`);
 // Foreign-account response must never restore the old relationship.
 held=true;const refresh=reload();await page.waitForTimeout(50);viewer=null;await page.evaluate(()=>window.changeIdentity(null));held=false;release();await refresh;await wait('anonymous');
 await click('login');await page.waitForFunction(()=>window.loginRequested===true);assert.equal(await page.locator('[data-relationship-action="accept"]').count(),0);
 viewer=B;owner=B;await page.evaluate(B=>{window.changeIdentity(B);window.reseed();},B);await wait('self');assert.equal(await page.locator('#relationship-actions button').count(),0);console.log(`PASS ${++groups}: ${width}px late response, logout, shared login and self-request prevention`);
 viewer=A;await page.evaluate(async A=>{await window.MinihompyMemberWriting.prepareVisit();window.MinihompySharedIdentity.state={status:'identified',visitor:A};await window.MinihompyMemberWriting.acceptVisit('fixture',{code_verifier:'fixture'},'fixture-attempt',A.id);window.changeIdentity(A);},A);await wait('outgoing');
 relation='accepted';revision++;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await wait('accepted');
 await page.keyboard.press('Escape');assert.equal(await page.locator('#relationship-dialog').evaluate(d=>d.open),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'relationship-open');
 await page.keyboard.press('Enter');await wait('accepted');assert.equal(await page.locator('#relationship-dialog').evaluate(d=>d.open),true);
 const box=await page.locator('#relationship-dialog').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);
 assert.equal(await page.locator('.fan-label').count(),0);assert.ok(!(await page.locator('.utility-heading').innerText()).includes('친구추천'));
 await page.screenshot({path:resolve(out,`relationship-${width}.png`)});assert.deepEqual(errors,[]);console.log(`PASS ${++groups}: ${width}px focus refresh, Escape/Enter focus return, viewport and placeholder cleanup`);
 await page.close();
 }
 console.log(`All ${groups} Chromium relationship UI groups passed.`);
}finally{await browser.close();}
