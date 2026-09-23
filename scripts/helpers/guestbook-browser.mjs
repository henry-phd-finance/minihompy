import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {handleMemberWriting} from '../../supabase/functions/member-writing/handler.js';
export async function verifyGuestbookBrowser({playwrightPath,centralRoot,centralHandler,centralOptions,centralSession,ownerCentralSession,personal,options,member,memberB,owner,ownerToken}){
 const {chromium}=await import(pathToFileURL(resolve(playwrightPath)));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
 const site='https://bob.github.io/home/',centralPage='https://central.test/pages/',centralApi='https://central.test/functions/v1/identity-api';
 const contexts=[];const errors=[];
 async function tab(identity,session,admin=false){
  const context=await browser.newContext({viewport:{width:1280,height:820}});contexts.push(context);
  await context.addInitScript(({session})=>{if(location.origin==='https://central.test')localStorage.setItem('minihompy.identity.session.v1',session);},{session});
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   async function api(response){await route.fulfill({status:response.status,body:await response.text(),headers:Object.fromEntries(response.headers)});}
   if(req.url().startsWith(options.config.SUPABASE_URL+'/functions/v1/member-writing'))return api(await handleMemberWriting(new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}:{})}),options));
   if(req.url().startsWith(centralApi))return api(await centralHandler(new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}:{})}),centralOptions));
   if(u.origin==='https://central.test'&&u.pathname.startsWith('/pages/')){
    const name=u.pathname.slice('/pages/'.length);
    if(name==='config.js')return route.fulfill({contentType:'text/javascript',body:`window.MINIHOMPY_CENTRAL_CONFIG=${JSON.stringify({apiBaseUrl:centralApi,pageBaseUrl:centralPage.slice(0,-1)})};`});
    if(!['writing.html','writing-flow.js','login-flow.js','login.css'].includes(name))throw Error('Unexpected central browser resource');
    return route.fulfill({contentType:name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript',body:await readFile(resolve(centralRoot,'public',name))});
   }
   if(u.origin!=='https://bob.github.io'||!u.pathname.startsWith('/home/'))throw Error('Unexpected external request');
   const name=u.pathname.slice('/home/'.length);
   if(!name){
    const setup=`window.MINIHOMPY_VIEWS={home:{createLeft:()=>document.createDocumentFragment()}};
      window.MINIHOMPY_CONFIG={profile:{name:'Bob'}};
      window.MinihompyAdmin={state:{role:${JSON.stringify(admin?'admin':'reader')},userId:${JSON.stringify(admin?owner:null)}}};
      window.MinihompySharedIdentity={state:{status:'identified',visitor:{id:${JSON.stringify(identity)}}}};
      const localContext=${JSON.stringify({role:admin?'admin':'reader',userId:admin?owner:null})};
      localContext.client={auth:{getSession:async()=>(${JSON.stringify({data:{session:{access_token:ownerToken}}})})}};
      window.MinihompyVisitorSession={nickname:()=>'',context:async()=>localContext};
      window.MinihompyComments={create:()=>document.createElement('div'),forget:()=>{}};`;
    return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="styles.css"><script>${setup}</script>
      ${['supabase-config.js','visitor-identity-config.js','member-writing-config.js','member-writing-client.js','member-writing-runtime.js','guestbook-repository.js','views/guestbook.js'].map(src=>`<script src="${src}"></script>`).join('')}
      <main id="host" style="position:relative;width:750px;height:700px;font-size:14px"></main><script>document.querySelector('#host').append(window.MINIHOMPY_VIEWS.guestbook.createMain());</script>`});
   }
   const custom={
    'supabase-config.js':`window.MINIHOMPY_SUPABASE=${JSON.stringify({url:options.config.SUPABASE_URL})};`,
    'visitor-identity-config.js':`window.MINIHOMPY_VISITOR_IDENTITY_CONFIG=${JSON.stringify({siteId:options.config.MINIHOMPY_SITE_ID,centralApiUrl:centralApi,centralPageUrl:centralPage.slice(0,-1)})};`,
    'member-writing-config.js':'window.MINIHOMPY_MEMBER_WRITING_CONFIG={enabled:true};',
   };
   if(custom[name])return route.fulfill({contentType:'text/javascript',body:custom[name]});
   if(!/^(?:[a-z-]+\.js|styles\.css|views\/guestbook\.js|login\/writing\.html|assets\/[^.][A-Za-z0-9_./-]+)$/.test(name)||name.includes('..'))throw Error('Unexpected browser resource');
   const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'}[extname(name)]||'application/octet-stream';
   return route.fulfill({contentType:type,body:await readFile(resolve(name))});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(site+'#/guestbook');await page.locator('.guestbook-authorize').click({timeout:5000}).catch(async e=>{throw Error(JSON.stringify({errors,body:await page.locator('body').innerText()})+' '+e.message)});
  await page.waitForURL(site+'#/guestbook');await page.locator('.guestbook-body-input').waitFor();
  return page;
 }
 try{
  await personal.pg.exec("update private.member_writing_limits set last_write=now()-interval '2 minutes',window_start=now(),writes=0");
  const page=await tab(member,centralSession);
  assert.equal(await page.locator('.guestbook-name').inputValue(),'Alice');assert.equal(await page.locator('.guestbook-name').evaluate(e=>e.readOnly),true);
  await page.locator('.guestbook-body-input').fill('브라우저 비밀 방명록');await page.locator('.guestbook-visibility').check();await page.locator('.guestbook-save').click();
  await page.getByText('브라우저 비밀 방명록',{exact:true}).waitFor();
  const row=(await personal.pg.query("select id from public.guestbook_posts where body='브라우저 비밀 방명록'")).rows[0];
  const second=await tab(member,centralSession);const post=second.locator(`[data-post="${row.id}"]`);
  await post.locator('.guestbook-edit').click();await second.locator('.guestbook-body-input').fill('새 브라우저에서 수정');await second.locator('.guestbook-save').click();await second.getByText('새 브라우저에서 수정',{exact:true}).waitFor();
  assert.equal(await post.locator('.guestbook-author').getAttribute('href'),'https://alice.github.io/home/');
  const ownerPage=await tab(memberB,ownerCentralSession,true);const ownerPost=ownerPage.locator(`[data-post="${row.id}"]`);
  await ownerPost.waitFor();assert.equal(await ownerPost.locator('.guestbook-edit').count(),0);await ownerPost.locator('.guestbook-delete').click();await ownerPost.waitFor({state:'detached'});
  assert.equal((await personal.pg.query('select * from public.guestbook_posts where id=$1',[row.id])).rows.length,0);
  assert.deepEqual(errors,[]);
  console.log('PASS: Chromium central proof round-trip, fixed member name, private post, fresh-browser edit, homepage link and owner delete without body edit.');
 }finally{for(const context of contexts)await context.close();await browser.close();}
}
