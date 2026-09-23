// Explicit live check. Passwords remain in environment; no browser state is saved.
import {cleanupNavigationLive} from './cleanup-navigation-live.mjs';
import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';
if(process.env.MINIHOMPY_LIVE_NAVIGATION!=='1'||!process.env.MINIHOMPY_TEST_B_MANAGEMENT_TOKEN||!process.env.MINIHOMPY_NAVIGATION_JOURNAL)throw Error('Explicit live navigation opt-in required');
const {chromium}=await import(pathToFileURL(process.argv[2]));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
const a={home:'https://henry-phd-finance.github.io/minihompy/',handle:'henry91-jung',password:process.env.MINIHOMPY_TEST_A_PASSWORD},b={home:'https://henry-hs-jung.github.io/minihompy/',handle:'henry-hs-jung',password:process.env.MINIHOMPY_TEST_B_PASSWORD};
let context=await browser.newContext({viewport:{width:1280,height:820}}),page=await context.newPage();page.setDefaultTimeout(45000);page.on('dialog',d=>d.accept());
const checks=[];let phase='start',failed=false,created=false,aAdminId;const pass=s=>{checks.push(s);console.log('PASS: '+s);};
async function state(site,owner){await page.waitForFunction(({home,handle})=>location.origin+location.pathname===home&&window.MinihompySharedIdentity?.state.status===(handle?'identified':'anonymous')&&(!handle||MinihompySharedIdentity.state.visitor?.handle===handle),{home:site.home,handle:owner?.handle});await page.waitForFunction(({handle})=>window.MinihompyNavigation?.state.status===(handle?(MinihompyNavigation.state.owner?.handle===handle?'self':'other'):'anonymous'),{handle:owner?.handle});await verifyVisits();}
async function verifyVisits(){
 if(process.env.MINIHOMPY_HOME_LIVE!=='1')return;
 await page.waitForFunction(()=>document.querySelector('.visit-count')?.dataset.status==='ready');
 const value=await page.evaluate(async()=>{const c=MINIHOMPY_HOME_DATA_CONFIG,key=localStorage.getItem('minihompy:visit:v1:'+c.supabaseUrl+':'+c.homepage);const r=await fetch(c.supabaseUrl+'/functions/v1/visit-counts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({browser_key:key})});return {ok:r.ok,...await r.json()};});
 assert.equal(value.ok,true);assert.equal(value.counted,false);
 if(await page.locator('.home-activity').count())await page.waitForFunction(()=>document.querySelector('.home-activity')?.dataset.status==='ready');
}
async function login(owner,site){await page.locator('#login-auth-toggle').click();await page.waitForURL('**/login.html?**');assert.equal(await page.locator('input[type=password]').count(),0);await page.locator('#handle').fill(owner.handle);await page.locator('#submit').click();await page.waitForURL(url=>url.origin===new URL(owner.home).origin&&url.pathname.endsWith('/login/'));await page.waitForFunction(()=>document.querySelector('#password')&&!document.querySelector('#password').disabled);await page.locator('#password').fill(owner.password);await page.locator('#submit').click();await state(site,owner);}
try{
 phase='anonymous A';await page.goto(a.home);await state(a,null);pass('Anonymous A shows owner and login prompt');
 phase='A login on A';await login(a,a);aAdminId=await page.evaluate(()=>MinihompyAdmin.state.userId);assert.equal(await page.evaluate(()=>MinihompyNavigation.state.status),'self');pass('A login uses central ID then private password and shows own home');
 phase='surf A to B';await page.locator('[data-surf-open]').first().click();await page.locator('#surf-results a[href="'+b.home+'"]').click();await state(b,a);assert.equal(await page.evaluate(()=>MinihompyAdmin.state.role),'reader');pass('Surf A → B retains A identity without B administrator rights');
 phase='own home';const own=page.locator('#my-home-link');await own.click();await state(a,a);pass('My home from B returns to registered A');
 phase='random';await page.locator('#random-visit').click();await state(b,a);pass('Random excludes A and navigates to B with A identity');
 phase='reload';await page.reload();await state(b,a);pass('Reload on B retains verified A identity');
 phase='existing author link';await page.goto(b.home+'#/guestbook');await state(b,a);
 await page.locator('.guestbook-authorize').click();await page.locator('.guestbook-body-input').waitFor();
 const id=crypto.randomUUID(),body='이동 검증 '+id;
 await writeFile(process.env.MINIHOMPY_NAVIGATION_JOURNAL,JSON.stringify({id,body}),{mode:0o600,flag:'wx'});
 created=true;await page.evaluate(async({id,body})=>{const ctx=await MinihompyMemberWriting.context();await MinihompyMemberWriting.content('/guestbook',{method:'POST',body:{id,request_id:crypto.randomUUID(),body,visibility:'public'},mode:'member'},ctx);},{id,body});
 await page.reload();await state(b,a);const post=page.locator(`[data-post="${id}"]`);
 const links=post.locator('a[href="'+a.home+'"]');await links.first().waitFor();assert.equal(await links.count(),2);await links.first().click();await state(a,a);pass('A member guestbook name and house on B link to registered A; name click arrives at A');
 phase='logout';await page.goto(b.home);await state(b,a);await page.locator('#login-auth-toggle').click();await state(b,null);assert.equal(await page.locator('#my-home-link').getAttribute('href'),null);pass('A logout clears identity and own-home link');
 phase='switch B';await login(b,b);assert.equal(await page.evaluate(()=>MinihompyNavigation.state.status),'self');pass('Same browser switches to B and shows B own home');
 phase='B visits A';await page.locator('#random-visit').click();await state(a,b);assert.equal(await page.evaluate(()=>MinihompyNavigation.state.status),'other');assert.equal(await page.evaluate(()=>MinihompyAdmin.state.userId),aAdminId);pass('B visitor on A is other; existing local A administrator remains separate');
 phase='B logout';await page.locator('#login-auth-toggle').click();await state(a,null);pass('B logout returns to anonymous');
 phase='fresh B session';await context.close();context=await browser.newContext();page=await context.newPage();page.setDefaultTimeout(45000);page.on('dialog',d=>d.accept());await page.goto(b.home);await state(b,null);await login(b,b);await page.locator('#random-visit').click();await state(a,b);assert.equal(await page.evaluate(()=>MinihompyAdmin.state.role),'reader');pass('Fresh B login visits A without A administrator rights');await page.locator('#login-auth-toggle').click();await state(a,null);
}catch(error){failed=true;console.log('FAIL at '+phase+' ('+error.name+'); private browser details suppressed.');}
finally{await context.close();await browser.close();let cleaned=false;try{await cleanupNavigationLive({journal:process.env.MINIHOMPY_NAVIGATION_JOURNAL,managementToken:process.env.MINIHOMPY_TEST_B_MANAGEMENT_TOKEN});cleaned=true;}catch{failed=true;console.log('FAIL: temporary content cleanup needs retry using private journal');}await writeFile(process.env.MINIHOMPY_NAVIGATION_REPORT||new URL('../docs/verification/member-navigation-step6/live.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),passed:!failed,phase,checks,testContentCreated:created,testContentCleaned:cleaned,homeVisitsChecked:process.env.MINIHOMPY_HOME_LIVE==='1'},null,2)+'\n');if(failed)process.exitCode=1;}
