// Local integration only: real browser modules and SQL/handlers, fixture Auth and SQL transport.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { memberWritingDb } from './helpers/member-writing-db.mjs';
import { browserBackend, sqlTransport } from './helpers/home-browser-db.mjs';
import { handleMemberWriting } from '../supabase/functions/member-writing/handler.js';
import {prepareVisibilityFixture,routePhotoMedia,checkOwnerVisibility,checkVisitorVisibility} from './helpers/visibility-integration.mjs';
const visibilityIntegration=process.env.MINIHOMPY_VISIBILITY_INTEGRATION==='1';
import { handleVisitCounts } from '../supabase/functions/visit-counts/handler.js';
const { chromium } = await import(pathToFileURL(resolve(process.argv[2])));
const centralRoot = resolve('../minihompy-central');
const { createIdentityDb } = await import(pathToFileURL(centralRoot+'/scripts/helpers/identity-db.mjs'));
const { handleIdentityApiRequest } = await import(pathToFileURL(centralRoot+'/supabase/functions/identity-api/handler.js'));
const { PGlite } = await import(pathToFileURL(centralRoot+'/node_modules/@electric-sql/pglite/dist/index.js'));
const id = n => `60000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const central = 'https://central.test', api = central+'/functions/v1/identity-api';
const width = Number(process.argv[3] || 1280);
const sites = ['alice','bob'].map((name,i)=>({name,member:id(i+1),site:id(i+11),owner:id(i+21),ref:(i?'b':'a').repeat(20),origin:`https://${name}.test`,home:`https://${name}.test/home/`}));
const identity = await createIdentityDb();
let centralOffline=false, personalOffline=false, networkOffline=false;
const centralOptions = {supabaseClient:identity.db,centralSecret:'fixture-session-integration-secret-long-enough',allowedOrigins:new Set([central,...sites.map(s=>s.origin)]),fetcher:async(url,init)=>{
 const s=sites.find(s=>url.startsWith(`https://${s.ref}.supabase.co/`));
 if(!s||init.headers.Authorization!==`Bearer header.${s.name}.signature`)return Response.json({}, {status:401});
 return Response.json(url.endsWith('/auth/v1/user')?{id:s.owner,role:'authenticated',is_anonymous:false}:true);
}};
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
const context=await browser.newContext({viewport:{width,height:900},hasTouch:width===375});
const counts={visits:0,exchange:0,renew:0,popups:0},errors=[];
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
const send=async(route,res)=>route.fulfill({status:res.status,headers:Object.fromEntries(res.headers),body:Buffer.from(await res.arrayBuffer())}).catch(()=>{});
const request=req=>new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}:{})});
try {
 for(const s of sites){
  s.personal=await memberWritingDb(PGlite,{siteId:s.site,centralUrl:api,photoMedia:true});
  s.transport=sqlTransport(s.personal.pg,{owner:s.owner});
  s.config={MINIHOMPY_SITE_ORIGIN:s.origin,MINIHOMPY_SITE_ID:s.site,MINIHOMPY_CENTRAL_API_URL:api,SUPABASE_URL:`https://${s.ref}.supabase.co`,MINIHOMPY_PUBLIC_KEY:'fixture-public'};
  s.options={config:s.config,db:s.personal.db,fetcher:async(url,init)=>{if(centralOffline)throw Error('fixture central offline');if(url.startsWith(api))return handleIdentityApiRequest(new Request(url,init),centralOptions);return centralOptions.fetcher(url,init);}};
  await identity.pg.query('insert into private.identity_members(id,handle,display_name) values($1,$2,$3)',[s.member,s.name,s.name]);
  await identity.pg.query("insert into private.identity_sites(id,member_id,origin,base_path,homepage_url,login_url,supabase_project_ref,supabase_publishable_key,verification_status) values($1,$2,$3,'/home/',$4,$5,$6,$7,'verified')",[s.site,s.member,s.origin,s.home,s.home+'login/',s.ref,'sb_publishable_fixture123456789']);
  await identity.pg.query('insert into private.identity_bindings(site_id,member_id,local_user_id) values($1,$2,$3)',[s.site,s.member,s.owner]);
  await s.personal.pg.query('insert into auth.users values($1)',[s.owner]);await s.personal.pg.query('insert into private.minihompy_admins values($1)',[s.owner]);
  await s.personal.pg.query("select set_config('request.jwt.claim.sub',$1,false)",[s.owner]);
  s.parents={};
  s.parents.board=(await s.personal.pg.query("insert into board_posts(folder_id,author_name,title,body) select id,'owner','fixture board','body' from board_folders returning id")).rows[0].id;
  s.parents.photos=id(s.name==='alice'?31:32);
  await prepareVisibilityFixture(s,centralOptions.fetcher,id(33));
  await s.personal.pg.query("insert into photo_posts(id,folder_id,author_name,title,body) select $1,id,'owner','fixture photo',$2 from photo_folders",[s.parents.photos,JSON.stringify([{type:'image',path:`${s.parents.photos}/${id(33)}.jpg`}])]);
  s.parents.diary=(await s.personal.pg.query("insert into diary_entries(id,folder_id,author_name,entry_date,entry_time,body) select gen_random_uuid(),id,'owner',current_date,'12:00','fixture diary' from diary_folders returning id")).rows[0].id;
  await s.personal.pg.exec("select set_config('request.jwt.claim.sub','',false)");
 }
 const routeHandler=async route=>{
  const req=route.request(),u=new URL(req.url());
  if(req.url().startsWith(api)){
   if(u.pathname.endsWith('/visits/issue'))counts.visits++;
   if(centralOffline)return send(route,Response.json({error:'Unavailable'},{status:503}));
   return send(route,await handleIdentityApiRequest(request(req),centralOptions));
  }
  if(u.origin===central){const name=u.pathname.slice(1);if(name==='config.js')return route.fulfill({contentType:'text/javascript',body:`window.MINIHOMPY_CENTRAL_CONFIG=${JSON.stringify({apiBaseUrl:api,pageBaseUrl:central})};`});return route.fulfill({body:await readFile(resolve(centralRoot,'public',name)),contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});}
  const auth=sites.find(s=>u.origin===s.config.SUPABASE_URL);
  if(auth){
   if(u.pathname.includes('/photo-media/'))return send(route,await routePhotoMedia(auth,request(req)));
   if(u.pathname.includes('/member-writing')){
    if(u.pathname.endsWith('/exchange'))counts.exchange++;if(u.pathname.endsWith('/renew'))counts.renew++;
    if(networkOffline)return route.abort('internetdisconnected');
    if(personalOffline)return send(route,Response.json({error:{code:'IDENTITY_UNAVAILABLE'}},{status:503}));
    return send(route,await auth.transport.run(()=>handleMemberWriting(request(req),auth.options)));
   }
   if(u.pathname.endsWith('/visit-counts'))return send(route,await handleVisitCounts(request(req),{env:{...auth.config,SUPABASE_SERVICE_ROLE_KEY:'fixture-service',MINIHOMPY_VISIT_SECRET:'fixture-visits-secret-'.repeat(3)},rpc:async(name,args)=>auth.transport.run(async()=>{const q=await auth.personal.pg.query(name==='visit_stats'?'select public.visit_stats() as data':'select public.visit_record($1,$2) as data',name==='visit_stats'?[]:[args.p_day,args.p_digest]);return q.rows[0].data;})}));
   assert.ok(u.pathname.endsWith('/owner-login'));assert.equal(req.postDataJSON().password,'fixture-password');return route.fulfill({json:{access_token:`header.${auth.name}.signature`,refresh_token:'fixture-refresh'}});
  }
  const s=sites.find(s=>s.origin===u.origin);assert.ok(s,'Unexpected external request');
  let name=u.pathname.slice('/home/'.length)||'index.html';if(name==='login/')name='login/index.html';
  if(name==='fixture-db')return route.fulfill({json:await s.transport.handle(req.postDataJSON())});
  const configs={
   'supabase-config.js':`window.MINIHOMPY_SUPABASE={url:'${s.config.SUPABASE_URL}',publishableKey:'fixture-public'};`,
   'visitor-identity-config.js':`window.MINIHOMPY_VISITOR_IDENTITY_CONFIG=${JSON.stringify({enabled:true,siteId:s.site,centralApiUrl:api,centralPageUrl:central})};`,
   'member-writing-config.js':'window.MINIHOMPY_MEMBER_WRITING_CONFIG={enabled:true};',
   'home-data-config.js':`window.MINIHOMPY_HOME_DATA_CONFIG={enabled:true,supabaseUrl:'${s.config.SUPABASE_URL}',homepage:'${s.home}'};`,
  };
  if(configs[name])return route.fulfill({contentType:'text/javascript',body:configs[name]});
  const backend=browserBackend+`
client.auth={getSession:async()=>({data:{session:localStorage.getItem('fixture-owner')?{access_token:'header.${s.name}.signature',user:{id:'${s.owner}'}}:null}}),setSession:async value=>{localStorage.setItem('fixture-owner','yes');return {data:{session:value}};},getUser:async()=>({data:{user:localStorage.getItem('fixture-owner')?{id:'${s.owner}'}:null}}),signOut:async()=>{localStorage.removeItem('fixture-owner');return {};},onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})};
const originalRpc=client.rpc;client.rpc=(name,args)=>name==='is_minihompy_admin'?Promise.resolve({data:Boolean(localStorage.getItem('fixture-owner'))}):originalRpc(name,args);
addEventListener('minihompy:identity',()=>fixtureActor=MinihompyAdmin.state.role==='admin'?'owner':'anon');`;
  if(name==='index.html'||name==='login/index.html'){
   let html=await readFile(resolve(name),'utf8');html=html.replace(/<script\b[^>]*src="(?:\.\.\/)?(?:assets\/vendor\/supabase[^\"]*|supabase-client.js|visitor-session.js)"[^>]*><\/script>/g,'').replace('<head>',`<head><script>${backend}</script>`);
   return route.fulfill({contentType:'text/html',body:html});
  }
  return route.fulfill({body:await readFile(resolve(name)),contentType:{'.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'}[extname(name)]});
 };
 await context.route('**/*',routeHandler);
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('popup',()=>counts.popups++);
 const ready=async(p=page)=>p.waitForFunction(()=>window.MinihompyMemberWriting?.state?.status==='ready').catch(async e=>{throw Error(JSON.stringify({path:new URL(p.url()).pathname,errors,body:(await p.locator('body').innerText()).slice(0,1600)})+' '+e.message);});
 const menu=async(kind,p=page)=>{await p.locator(`[data-menu=${kind}]`).dispatchEvent('click');};
 const relax=async()=>sites[1].transport.run(()=>sites[1].personal.pg.exec("update private.member_writing_limits set last_write=now()-interval '2 minutes',window_start=now(),writes=0"));
 await page.goto(sites[0].home);await page.waitForFunction(()=>MinihompyNavigation?.state.status==='anonymous');
 await page.locator('#my-home-login').click();await page.waitForURL(central+'/login.html**');await page.locator('#handle').fill('alice');await page.locator('#submit').click();await page.waitForURL(sites[0].home+'login/**');await page.locator('#password').fill('fixture-password');await page.locator('#submit').click();await ready();
 assert.equal(await page.evaluate(()=>MinihompyAdmin.state.role),'admin');
 if(visibilityIntegration)await checkOwnerVisibility(page,sites[0],id);
 await page.locator('[data-surf-open]').click();await page.locator('#surf-results a').filter({hasText:'@bob'}).click();await ready();
 assert.equal(await page.evaluate(()=>MinihompySharedIdentity.state.visitor.id),sites[0].member);assert.equal(await page.evaluate(()=>MinihompyAdmin.state.role),'reader');assert.equal(await page.locator('[data-menu=settings]').count(),0);
 console.log(`PASS ${width}: real central PKCE login → A owner → B member, separate origins/DBs and no B admin`);
 const before={...counts};await menu('guestbook');await page.locator('.guestbook-body-input').fill('integration guestbook');await page.locator('.guestbook-save').click();await page.locator('.guestbook-post').waitFor();
 sites[1].parents.guestbook=(await sites[1].personal.pg.query('select id from guestbook_posts limit 1')).rows[0].id;
 for(const kind of ['board','photos','diary','guestbook']){
  await menu(kind);if(kind==='board')await page.locator('.board-post-link').first().click();
  const input=page.locator('.comment-body').first();await input.waitFor();await input.fill('discard');await menu('home');await menu(kind);if(kind==='board')await page.locator('.board-post-link').first().click();assert.equal(await input.inputValue(),'');
  await relax();await input.fill('integration '+kind);await page.locator('.comment-save').first().click();await page.locator('[data-comment]').first().waitFor();
 }
 assert.equal(counts.exchange,before.exchange);assert.equal(counts.visits,before.visits);
 assert.equal((await sites[1].personal.pg.query('select count(*)::int as n from post_comments where author_member_id=$1',[sites[0].member])).rows[0].n,4);
 assert.equal((await sites[0].personal.pg.query('select count(*)::int as n from post_comments')).rows[0].n,0);
 if(visibilityIntegration)await checkVisitorVisibility(page,sites,id,context,routeHandler);
 console.log(`PASS ${width}: A writes B guestbook and all four comment types; menu discard, no new proofs or cross-site data`);
 await menu('guestbook');const draft=page.locator('.guestbook-body-input');await draft.fill('keep across renewal');await draft.focus();
 const stat=async()=>sites[1].transport.run(async()=>(await sites[1].personal.pg.query('select public.visit_stats() as value')).rows[0].value.total);
 await mkdir(`docs/verification/${visibilityIntegration?'folder-visibility-step9':'member-session-step6'}`,{recursive:true});
 await page.screenshot({path:`docs/verification/${visibilityIntegration?'folder-visibility-step9':'member-session-step6'}/ready-${width}.png`});
 const total=await stat();const priorRenew=counts.renew,priorVisits=counts.visits;let navigations=0;page.on('framenavigated',()=>navigations++);
 await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'}));
 await sites[1].transport.run(()=>sites[1].personal.pg.exec("update private.member_writing_sessions set issued_at=now()-interval '20 minutes',expires_at=now()-interval '5 minutes'"));
 await page.evaluate(()=>dispatchEvent(new Event('focus')));await page.waitForTimeout(100);assert.equal(counts.renew,priorRenew);
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});await page.waitForFunction(()=>MinihompyMemberWriting.state.status==='ready');
 await page.waitForTimeout(100);assert.equal(counts.renew,priorRenew+1);assert.equal(navigations,0);assert.equal(await draft.inputValue(),'keep across renewal');assert.equal(await draft.evaluate(e=>e===document.activeElement),true);assert.equal(await stat(),total);assert.equal(counts.visits,priorVisits);
 console.log(`PASS ${width}: 20-minute inactive fixture defers renewal until visible, then preserves input/focus and visit total`);
 for(const failure of ['central','personal','network']){
  centralOffline=failure==='central';personalOffline=failure==='personal';networkOffline=failure==='network';
  await page.evaluate(()=>dispatchEvent(new Event('focus')));await page.locator('#member-session-retry').waitFor();
  assert.equal(await page.evaluate(()=>MinihompyMemberWriting.state.status),'error');assert.equal(await draft.inputValue(),'keep across renewal');assert.equal(await page.locator('.guestbook-save').isDisabled(),true);
  if(failure==='central')await page.screenshot({path:`docs/verification/${visibilityIntegration?'folder-visibility-step9':'member-session-step6'}/error-${width}.png`});
  centralOffline=personalOffline=networkOffline=false;
  await page.locator('#member-session-retry').focus();
  await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'member-session-retry');
  const retryBox=await page.locator('#member-session-retry').boundingBox();assert.ok(retryBox.x>=-1&&retryBox.x+retryBox.width<=width+1,'Focused common retry is within viewport');
  if(failure==='central')await page.screenshot({path:`docs/verification/${visibilityIntegration?'folder-visibility-step9':'member-session-step6'}/retry-focus-${width}.png`});
  await page.keyboard.press('Enter');await ready();await draft.waitFor();assert.equal(await draft.inputValue(),'keep across renewal');assert.equal(navigations,0);
 }
 console.log(`PASS ${width}: central/personal outage and transport offline recover via keyboard common retry without anonymous fallback or input loss`);
 const peer=await context.newPage();await peer.goto(sites[1].home+'#/guestbook');await ready(peer);await peer.reload();await ready(peer);assert.equal(await draft.inputValue(),'keep across renewal');await peer.close();
 console.log(`PASS ${width}: new tab and reload get independent sessions without clearing original draft`);
 // Separate contexts enforce explicit storage failures; no production credentials involved.
 const third=await browser.newContext({storageState:await context.storageState()});
 await third.route('**/*',routeHandler);
 await third.addInitScript(()=>{if(window.top!==window){for(const key of ['localStorage','sessionStorage'])Object.defineProperty(window,key,{get(){throw new DOMException('Blocked third-party storage','SecurityError');}});}});
 const thirdPage=await third.newPage();thirdPage.on('pageerror',e=>errors.push(e.message));await thirdPage.goto(sites[1].home+'#/guestbook');await ready(thirdPage);assert.equal(await thirdPage.locator('iframe').count(),0);
 const thirdRenew=counts.renew,thirdVisits=counts.visits;await sites[1].transport.run(()=>sites[1].personal.pg.exec("update private.member_writing_sessions set issued_at=now()-interval '16 minutes',expires_at=now()-interval '1 minute'"));await thirdPage.evaluate(()=>dispatchEvent(new Event('focus')));await ready(thirdPage);await thirdPage.waitForTimeout(100);assert.equal(counts.renew,thirdRenew+1);assert.equal(counts.visits,thirdVisits);await third.close();
 console.log(`PASS ${width}: top-level login/renewal path works with third-party frame storage denied and no iframe dependency`);
 const blocked=await browser.newContext();await blocked.route('**/*',routeHandler);
 await blocked.addInitScript(()=>{if(location.origin!=='https://central.test')Object.defineProperty(window,'sessionStorage',{get(){throw new DOMException('Blocked session storage','SecurityError');}});});
 const blockedPage=await blocked.newPage();blockedPage.on('pageerror',e=>errors.push(e.message));const visitCount=counts.visits;
 await blockedPage.goto(sites[1].home);await blockedPage.waitForFunction(()=>window.MinihompySharedIdentity?.state.status==='error');
 assert.equal(await blockedPage.evaluate(()=>MinihompyMemberWriting.state.status),'error');
 await blockedPage.locator('#member-session-retry').waitFor();await blockedPage.waitForTimeout(200);assert.equal(counts.visits,visitCount);assert.equal(await blockedPage.locator('.guestbook-save:not([disabled])').count(),0);await blocked.close();
 console.log(`PASS ${width}: first-party session storage denial stops before redirect with common error, never anonymous or looping`);
 const centralBlocked=await browser.newContext();await centralBlocked.route('**/*',routeHandler);
 await centralBlocked.addInitScript(()=>{if(location.origin==='https://central.test')Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Blocked central storage','SecurityError');}});});
 const centralPage=await centralBlocked.newPage();centralPage.on('pageerror',e=>errors.push(e.message));await centralPage.goto(sites[1].home);await centralPage.locator('#message').filter({hasText:'저장소'}).waitFor();await centralPage.locator('#retry').waitFor();const stopped=counts.visits;await centralPage.waitForTimeout(200);assert.equal(counts.visits,stopped);assert.equal(new URL(centralPage.url()).origin,central);await centralBlocked.close();
 console.log(`PASS ${width}: central storage denial remains a visible retryable storage error, no anonymous downgrade or redirect loop`);
 await identity.pg.exec("update private.identity_sessions set expires_at=now()-interval '1 minute'");
 await page.evaluate(()=>dispatchEvent(new Event('focus')));await page.waitForFunction(()=>MinihompyMemberWriting.state.status==='loginRequired');assert.equal(await page.locator('.guestbook-save').isDisabled(),true);assert.equal(await draft.inputValue(),'keep across renewal');assert.equal(navigations,0);assert.equal(counts.popups,0);
 assert.deepEqual(errors,[]);
 console.log(`PASS ${width}: central absolute expiry blocks writing with common login state; no automatic navigation/popups or page errors`);
} finally {await context.close();await browser.close();await identity.pg.close();for(const s of sites)await s.personal?.pg.close();}
