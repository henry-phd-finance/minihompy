import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])));
const centralRoot=resolve('../minihompy-central'),root=resolve('.');
const {createIdentityDb}=await import(pathToFileURL(centralRoot+'/scripts/helpers/identity-db.mjs'));
const {handleIdentityApiRequest}=await import(pathToFileURL(centralRoot+'/supabase/functions/identity-api/handler.js'));
const {pg,db}=await createIdentityDb();
const id=n=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sites=[{name:'alice',member:id(1),site:id(11),owner:id(21),ref:'a'.repeat(20)},{name:'bob',member:id(2),site:id(12),owner:id(22),ref:'b'.repeat(20)}];
for(const s of sites){s.origin=`https://${s.name}.test`;s.home=s.origin+'/home/';}
const central='https://central.test',api=central+'/functions/v1/identity-api';
const options={supabaseClient:db,centralSecret:'test-only-navigation-secret-at-least-32-bytes',allowedOrigins:new Set([central,...sites.map(s=>s.origin)]),fetcher:async(url,init)=>{
 const s=sites.find(s=>url.startsWith(`https://${s.ref}.supabase.co/`));
 if(!s||init.headers.Authorization!==`Bearer header.${s.name}.signature`)return Response.json({error:'invalid'},{status:401});
 return Response.json(url.endsWith('/auth/v1/user')?{id:s.owner,role:'authenticated',is_anonymous:false}:true);
}};
let offline=false,hold=false,held=false,release;
const errors=[],issued=[];
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
const width=Number(process.argv[3]||1280);
const context=await browser.newContext({viewport:{width,height:820},hasTouch:width===375});
const retained=new Set(['visitor-identity-config.js','visitor-identity-login.js','visitor-identity.js','member-navigation.js','author-navigation.js','surf-navigation.js','views/home.js','admin-auth.js']);
try{
 for(const s of sites){
  await pg.query('insert into private.identity_members(id,handle,display_name) values($1,$2,$3)',[s.member,s.name,'동명']);
  await pg.query("insert into private.identity_sites(id,member_id,origin,base_path,homepage_url,login_url,supabase_project_ref,supabase_publishable_key,verification_status) values($1,$2,$3,'/home/',$4,$5,$6,$7,'verified')",[s.site,s.member,s.origin,s.home,s.home+'login/',s.ref,'sb_publishable_fixture123456789']);
  await pg.query('insert into private.identity_bindings(site_id,member_id,local_user_id) values($1,$2,$3)',[s.site,s.member,s.owner]);
 }
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  if(req.url().startsWith(api)){
   if(offline)return route.fulfill({status:503,json:{error:'fixture offline'}});
   const response=await handleIdentityApiRequest(new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}:{})}),options);
   if(u.pathname.endsWith('/visits/issue'))issued.push(req.postDataJSON().target_site_id);
   const body=await response.text();
   if(hold&&u.pathname.endsWith('/navigation/members')){hold=false;held=true;await new Promise(r=>release=r);}
   return route.fulfill({status:response.status,body,headers:Object.fromEntries(response.headers)}).catch(()=>{});
  }
  if(u.origin===central){
   const name=u.pathname.slice(1);
   if(name==='config.js')return route.fulfill({contentType:'text/javascript',body:`window.MINIHOMPY_CENTRAL_CONFIG=${JSON.stringify({apiBaseUrl:api,pageBaseUrl:central})};`});
   return route.fulfill({body:await readFile(resolve(centralRoot,'public',name)),contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});
  }
  const auth=sites.find(s=>u.hostname===s.ref+'.supabase.co');
  if(auth){assert.ok(u.pathname.endsWith('/owner-login'));assert.equal(req.postDataJSON().password,'fixture-password');return route.fulfill({json:{access_token:'header.'+auth.name+'.signature',refresh_token:'fixture-refresh'}});}
  const s=sites.find(s=>s.origin===u.origin);if(!s)throw Error('Unexpected origin');
  let name=u.pathname.slice('/home/'.length)||'index.html';if(name==='login/')name='login/index.html';
  if(name==='visitor-identity-config.js')return route.fulfill({contentType:'text/javascript',body:`window.MINIHOMPY_VISITOR_IDENTITY_CONFIG=${JSON.stringify({enabled:true,siteId:s.site,centralApiUrl:api,centralPageUrl:central,healthTimeoutMs:1000,navigationTimeoutMs:1000})};`});
  if(name==='supabase-config.js')return route.fulfill({contentType:'text/javascript',body:`window.MINIHOMPY_SUPABASE={url:'https://${s.ref}.supabase.co'};`});
  const backend=`window.MINIHOMPY_VIEWS={};window.MinihompyBackend={getClient:()=>({auth:{getSession:async()=>({data:{session:localStorage.getItem('fixture-owner')?{access_token:'header.${s.name}.signature'}:null}}),setSession:async value=>{localStorage.setItem('fixture-owner','yes');return {data:{session:value}};},getUser:async()=>({data:{user:localStorage.getItem('fixture-owner')?{id:'${s.owner}'}:null}}),signOut:async()=>{localStorage.removeItem('fixture-owner');return {};},onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},rpc:async()=>({data:Boolean(localStorage.getItem('fixture-owner'))})})};`;
  if(name==='index.html'){
   let html=await readFile(resolve(root,name),'utf8');html=html.replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g,(all,src)=>retained.has(src)?all:'');
   html=html.replace('<head>',`<head><script>${backend}</script>`).replace('</body>',`<script>addEventListener('DOMContentLoaded',()=>{document.querySelector('[data-view-slot="left"]').append(MINIHOMPY_VIEWS.home.createLeft());document.querySelector('[data-view-slot="main"]').append(MINIHOMPY_VIEWS.home.createMain());const a=MinihompyAuthorNavigation.create({author_kind:'member',author_member_id:'${sites[1].member}',author_name:'동명'},'fixture-author');document.querySelector('[data-view-slot="main"]').append(a);});</script></body>`);
   return route.fulfill({contentType:'text/html',body:html});
  }
  if(name==='login/index.html'){
   let html=await readFile(resolve(root,name),'utf8');html=html.replace(/<script src="\.\.\/(?:assets\/vendor\/[^\"]+|supabase-client.js)" defer><\/script>/g,'').replace('<head>',`<head><script>${backend}</script>`);return route.fulfill({contentType:'text/html',body:html});
  }
  return route.fulfill({body:await readFile(resolve(root,name)),contentType:{'.js':'text/javascript','.css':'text/css','.png':'image/png'}[extname(name)]});
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 const wait=async(p,status)=>{await p.waitForFunction(status=>window.MinihompyNavigation?.state.status===status,status).catch(async error=>{throw Error(JSON.stringify({expected:status,url:new URL(p.url()).origin+new URL(p.url()).pathname,body:await p.locator('body').innerText(),errors})+' '+error.message);});assert.ok(!p.url().includes('vt='));};
 async function login(p,s){const expected=new URL(p.url()).origin===s.origin?'self':'other';await p.locator('#my-home-login').click();await p.waitForURL(central+'/login.html**');await p.locator('#handle').fill(s.name);await p.locator('#submit').click();await p.waitForURL(s.home+'login/**');if(await p.locator('#password').isVisible()){await p.locator('#password').fill('fixture-password');await p.locator('#submit').click();}await wait(p,expected);}
 await page.goto(sites[0].home+'#/home');await wait(page,'anonymous');await login(page,sites[0]);
 assert.equal(await page.evaluate(()=>MinihompyAdmin.state.role),'admin');
 await page.locator('[data-surf-open]').click();await page.locator('#surf-results a').filter({hasText:'@bob'}).click();await wait(page,'other');assert.equal(page.url(),sites[1].home+'#/home');assert.equal(await page.evaluate(()=>MinihompyAdmin.state.role),'reader');
 assert.equal(await page.locator('#my-home-link').getAttribute('href'),sites[0].home);await page.locator('#my-home-link').click();await wait(page,'self');
 await page.locator('.fixture-author[href]').click();await wait(page,'other');
 await page.reload();await wait(page,'other');await page.goBack();await page.waitForTimeout(50);if(await page.locator('#navigation-retry:visible').count())await page.locator('#navigation-retry').click();await wait(page,'self');
 await page.goForward();await wait(page,'other');
 await page.locator('#random-visit').click();await wait(page,'self');await page.locator('.fixture-author[href]').click();await wait(page,'other');
 const opened=context.waitForEvent('page');await page.locator('#my-home-link').evaluate(a=>a.target='_blank');await page.locator('#my-home-link').click();const extra=await opened;await wait(extra,'self');await extra.close();
 if(await page.locator('#navigation-retry:visible').count()){await page.locator('#navigation-retry').click();await wait(page,'other');}
 console.log('PASS real central login/PKCE and A → B → own home, author link, reload/history and separate administrator');
 // A separate tab has separate sessionStorage but shares only the central session origin.
 const peer=await context.newPage();peer.setDefaultTimeout(15000);await peer.goto(sites[0].home);await wait(peer,'self');
 await page.bringToFront();await page.locator('#login-auth-toggle').click();await wait(page,'anonymous');
 await peer.bringToFront();await peer.evaluate(()=>dispatchEvent(new Event('focus')));
 await peer.waitForFunction(()=>window.MinihompyNavigation.state.status==='error');
 assert.equal(await peer.locator('#my-home-link').getAttribute('href'),null);
 await peer.locator('#navigation-retry').click();await wait(peer,'anonymous');
 await login(page,sites[1]);await wait(page,'self'); // Login returns to B, which B owns.
 await peer.locator('#my-home-login').click();await peer.locator('#handle').fill('bob');await peer.locator('#submit').click();await wait(peer,'other');
 assert.match(await peer.locator('#visitor-name').innerText(),/@bob/);
 console.log('PASS cross-origin logout, stale-tab invalidation, same-browser A → B');
 // A cancelled re-verification must not begin a redirect or clear pending input.
 await peer.evaluate(()=>{window.fixtureDraft='draft';window.cancelCheck=e=>e.preventDefault();addEventListener('minihompy:writing-authorize',window.cancelCheck);});
 await peer.evaluate(()=>dispatchEvent(new Event('focus')));const beforeUrl=peer.url();await peer.locator('#navigation-retry').click();assert.equal(peer.url(),beforeUrl);assert.equal(await peer.evaluate(()=>window.fixtureDraft),'draft');
 await peer.evaluate(()=>removeEventListener('minihompy:writing-authorize',window.cancelCheck));await peer.locator('#navigation-retry').click();await wait(peer,'other');
 // A held, formerly successful lookup cannot restore a link after invalidation.
 hold=true;held=false;await peer.evaluate(()=>{void MinihompyNavigation.refresh(MinihompySharedIdentity.state);});
 const deadline=Date.now()+5000;while(!held){if(Date.now()>deadline)throw Error('No held lookup');await new Promise(r=>setTimeout(r,10));}
 await peer.evaluate(()=>dispatchEvent(new Event('focus')));release();release=null;await peer.waitForTimeout(100);assert.equal(await peer.locator('#my-home-link').getAttribute('href'),null);
 await peer.locator('#navigation-retry').click();await wait(peer,'other');
 // Accelerate the display lease; do not modify signed central credentials.
 await peer.evaluate(()=>{MINIHOMPY_VISITOR_IDENTITY_CONFIG.displayTtlMs=1000;return MinihompyNavigation.refresh(MinihompySharedIdentity.state);});
 await peer.waitForFunction(()=>MinihompyNavigation.state.status==='error');assert.equal(await peer.locator('#my-home-link').getAttribute('href'),null);
 await peer.evaluate(()=>{MINIHOMPY_VISITOR_IDENTITY_CONFIG.displayTtlMs=300000;});await peer.locator('#navigation-retry').click();await wait(peer,'other');
 await peer.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await wait(peer,'other');
 console.log('PASS late profile, cancelled recheck, display lease and restored-page revalidation');

 offline=true;await peer.reload();await wait(peer,'error');assert.equal(await peer.locator('#my-home-link').getAttribute('href'),null);offline=false;await peer.locator('#navigation-retry').click();await wait(peer,'other');
 await pg.exec("update private.identity_sessions set expires_at=now()-interval '1 second'");
 await peer.reload();await wait(peer,'anonymous');assert.equal(await peer.locator('#my-home-link').getAttribute('href'),null);
 assert.ok(issued.includes(sites[0].site)&&issued.includes(sites[1].site));assert.deepEqual(errors,[]);
 console.log('PASS central outage/retry, SQL session expiration and no credential-bearing final URLs');
}finally{release?.();await context.close();await browser.close();await pg.close();}
