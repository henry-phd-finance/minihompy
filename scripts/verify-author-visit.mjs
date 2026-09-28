import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2]))),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
const member='20000000-0000-4000-8000-000000000001',root=new URL('../',import.meta.url);
const server=createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');const send=({contentType,body})=>{res.setHeader('Content-Type',contentType);res.end(body);};
 try{
  if(u.pathname==='/visitor-identity-config.js')return send({contentType:'text/javascript',body:"window.MINIHOMPY_VISITOR_IDENTITY_CONFIG={enabled:true,centralApiUrl:'https://central.test',navigationTimeoutMs:2000};"});
  if(u.pathname==='/')return send({contentType:'text/html',body:`<!doctype html><meta name="referrer" content="no-referrer"><script src="visitor-identity-config.js"></script><script src="member-navigation.js"></script><script src="author-navigation.js"></script><main></main><script>document.querySelector('main').append(MinihompyAuthorNavigation.create({author_kind:'member',author_member_id:'${member}',author_name:'Alice'},'author'));</script>`});
  return send({contentType:u.pathname.endsWith('.html')?'text/html':'text/javascript',body:await readFile(new URL(u.pathname.slice(1),root),'utf8')});
 }catch{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
try{
 const context=await browser.newContext();let mode='ready',version=1,reads=0,hold=false,release;const visits=[],errors=[];
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='central.test'){
   reads++;const requested=u.searchParams.get('member_ids');if(hold)await new Promise(r=>release=r);
   return route.fulfill({status:mode==='offline'?503:200,json:{items:mode==='inactive'?[]:[{id:mode==='wrong'?'20000000-0000-4000-8000-000000000002':requested,site_id:member,handle:'alice',display_name:'Alice',homepage_url:mode==='bad'?'javascript:alert(1)':`https://homes.test/v${version}/`}]}}).catch(()=>{});
  }
  if(u.hostname==='homes.test'){visits.push({url:u.href,headers:route.request().headers()});return route.fulfill({contentType:'text/html',body:'visited'});}
  return route.continue();
 });
 const page=await context.newPage(),relay=`${origin}/author-visit.html?member_id=${member}`;
 for(const action of ['click','enter','ctrl','middle','copied-link']){
  console.log('Checking '+action);version=1;await page.goto(origin+'/');await page.waitForSelector('.author-navigation[data-status=ready]');
  assert.equal(await page.locator('.author').getAttribute('href'),relay);version=2;const before=reads;
  let target=page;
  if(action==='ctrl'||action==='middle'){
   const popup=context.waitForEvent('page');await page.locator('.author').click(action==='ctrl'?{modifiers:['Control']}:{button:'middle'});target=await popup;
  }else if(action==='copied-link'){target=await context.newPage();await target.goto(await page.locator('.author').getAttribute('href'));}
  else if(action==='enter'){await page.locator('.author').focus();await page.keyboard.press('Enter');}
  else await page.locator('.author').click();
  await target.waitForURL('https://homes.test/v2/');assert.equal(reads,before+1);assert.equal(visits.at(-1).headers.referer,undefined);
  if(target!==page){assert.equal(await target.evaluate(()=>window.opener),null);await target.close();}
 }
 console.log('PASS click/Enter/Ctrl-click/middle-click/copied href all revalidate changed destination, no referrer/opener');
 for(const failure of ['inactive','offline','bad','wrong']){
  mode=failure;const before=visits.length;await page.goto(relay);await page.waitForSelector('#visit-retry:visible');assert.equal(visits.length,before);assert.equal(page.url(),relay);
  mode='ready';await page.locator('#visit-retry').click();await page.waitForURL('https://homes.test/v2/');
 }
 console.log('PASS inactive/HTTP error/unsafe URL/wrong member never redirect, explicit fresh retry recovers');
 mode='ready';hold=true;release=null;await page.goto(relay);while(!release)await page.waitForTimeout(10);const before=reads;
 await page.evaluate(()=>{document.querySelector('#visit-retry').click();document.querySelector('#visit-retry').click();});assert.equal(reads,before);
 await page.goto('https://homes.test/left/');hold=false;release();await page.waitForTimeout(50);assert.equal(page.url(),'https://homes.test/left/');
 const badBefore=reads;await page.goto(origin+'/author-visit.html?member_id=invalid&url=https://evil.test');await page.waitForSelector('#visit-retry:visible');assert.equal(reads,badBefore);
 assert.deepEqual(errors,[]);console.log('PASS pending duplicate retry joins, departure fences late redirect, invalid ID/destination query cannot redirect');
 await context.close();
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
