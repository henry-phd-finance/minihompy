// Explicit v2 production test: only UUIDs created by this run may be removed.
// Credentials are environment-only. Do not save storage, screenshots, URLs or bodies.
import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
const [playwright]=process.argv.slice(2);if(!playwright||process.env.MINIHOMPY_LIVE_SESSIONS!=='1')throw Error('Explicit MINIHOMPY_LIVE_SESSIONS=1 and Playwright path required');
const {chromium}=await import(pathToFileURL(resolve(playwright)));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
const a={home:'https://henry-phd-finance.github.io/minihompy/',handle:'henry91-jung',password:process.env.MINIHOMPY_TEST_A_PASSWORD},b={home:'https://henry-hs-jung.github.io/minihompy/',handle:'henry-hs-jung',password:process.env.MINIHOMPY_TEST_B_PASSWORD};
if(!a.password||!b.password)throw Error('Both private passwords required');
const run=crypto.randomUUID(),prefix='회원연결 검증 '+run,checks=[],contexts=[],created=[],parentsCreated=[];let cleanupOk=false,ownerPage,failed=false,watcher,watch,heartbeat;
const journal=process.env.MINIHOMPY_SESSION_JOURNAL;if(!journal)throw Error('Private cleanup journal required');
const saveJournal=()=>writeFile(journal,JSON.stringify({run,prefix,created,parentsCreated}),{mode:0o600});
const pass=name=>{checks.push(name);console.log('PASS: '+name);};
async function state(page,site,owner){await page.waitForFunction(({home,handle})=>location.origin+location.pathname===home && window.MinihompySharedIdentity?.state.status===(handle?'identified':'anonymous') && (!handle||window.MinihompySharedIdentity.state.visitor?.handle===handle),{home:site.home,handle:owner?.handle});}
async function fresh(owner){
 const context=await browser.newContext({viewport:{width:1280,height:820}});contexts.push(context);const page=await context.newPage();page.setDefaultTimeout(45000);page.on('dialog',d=>d.accept());
 await page.goto(b.home+'#/guestbook');await state(page,b,null);
 await page.locator('#login-auth-toggle').click();await page.waitForURL('**/login.html?**');
 assert.equal(await page.locator('input[type=password]').count(),0);
 await page.locator('#handle').fill(owner.handle);await page.locator('#submit').click();
 await page.waitForURL(url=>url.origin===new URL(owner.home).origin && url.pathname.endsWith('/login/'));
 await page.waitForFunction(()=>document.querySelector('#password')&&!document.querySelector('#password').disabled);
 await page.locator('#password').fill(owner.password);await page.locator('#submit').click();await state(page,b,owner);
 await page.waitForFunction(()=>window.MinihompyMemberWriting?.state.status==='ready');await page.locator('.guestbook-body-input').waitFor();
 await page.waitForFunction(()=>document.querySelector('.guestbook-name')?.readOnly===true);
 return page;
}
async function api(page,path,method='GET',body,mode='member'){
 return page.evaluate(async({path,method,body,mode})=>{const ctx=await window.MinihompyMemberWriting.context();return window.MinihompyMemberWriting.content(path,{method,body,mode},ctx);},{path,method,body,mode});
}
async function list(page){return (await api(page,'/guestbook?page=1&size=20')).items;}
async function addPost(page,secret){
 const text=prefix+(secret?' 비밀':' 공개');const planned=crypto.randomUUID();
 // Persist the cleanup ID before writing, including response-loss cases.
 created.push(planned);await saveJournal();
 await api(page,'/guestbook','POST',{id:planned,request_id:crypto.randomUUID(),body:text,visibility:secret?'private':'public'});
 await page.reload();await state(page,b,a);await page.locator(`[data-post="${planned}"]`).waitFor();return planned;
}
async function raw(page,path,body,method='POST',mode='member',token){return page.evaluate(async({path,body,method,mode,token})=>{
 const base=window.MINIHOMPY_SUPABASE.url+'/functions/v1/member-writing';
 const saved=token||Object.entries(sessionStorage).find(([k])=>k.startsWith('minihompy.member-writing.v1:')&&!k.endsWith(':renewal'))?.[1];
 const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Minihompy-Auth-Mode':mode,...(mode==='member'&&saved?{Authorization:'Bearer '+saved}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};
},{path,body,method,mode,token});}
try{
 watcher=await fresh(a);await watcher.locator('.guestbook-body-input').fill(prefix+' renewal draft');await watcher.locator('.guestbook-body-input').focus();
 const firstSession=await raw(watcher,'/sessions/current',null,'GET');assert.equal(firstSession.status,200);
 watch={originalExpiresAt:firstSession.data.expires_at,startedAt:new Date().toISOString(),renewals:0,navigations:0,popups:0,recounted:0};
 watcher.on('framenavigated',frame=>{if(!watch.finishedAt&&frame===watcher.mainFrame())watch.navigations++;});watcher.on('popup',()=>{if(!watch.finishedAt)watch.popups++;});
 watcher.on('response',async response=>{try{if(watch.finishedAt)return;if(response.url().endsWith('/sessions/renew')&&response.ok())watch.renewals++;if(response.url().endsWith('/visit-counts')&&response.ok()&&(await response.json()).counted===true)watch.recounted++;}catch{}});
 heartbeat=setInterval(()=>console.log('Live expiry check: '+Math.max(0,Math.ceil((Date.parse(watch.originalExpiresAt)-Date.now())/1000))+' seconds remaining; renewals='+watch.renewals),30000);
 pass('Real-time expiry observation started without changing clocks, tokens or database timestamps');
 const first=await fresh(a);assert.equal(await first.evaluate(()=>window.MinihompyAdmin.state.role),'reader');pass('A authenticated on B without local administrator rights');
 await first.goto(a.home+'#/home');await state(first,a,a);await first.waitForFunction(()=>MinihompyMemberWriting.state.status==='ready');assert.equal(await first.evaluate(()=>MinihompyAdmin.state.role),'admin');
 await first.goto(b.home+'#/guestbook');await state(first,b,a);await first.waitForFunction(()=>MinihompyMemberWriting.state.status==='ready');assert.equal(await first.evaluate(()=>MinihompyAdmin.state.role),'reader');pass('A own homepage and B homepage automatically prepare distinct sessions with correct owner separation');
 const publicId=await addPost(first,false);const post=first.locator(`[data-post="${publicId}"]`);
 await post.locator('.comment-body').fill(prefix+' 공개 댓글');await post.locator('.comment-save').click();await post.locator('[data-comment]').filter({hasText:prefix+' 공개 댓글'}).waitFor();
 let comments=(await api(first,`/comments?kind=guestbook&parent_id=${publicId}`)).items;const publicComment=comments.find(r=>r.body===prefix+' 공개 댓글');assert.equal(publicComment.author_kind,'member');
 const publicRows=(await raw(first,'/guestbook?page=1&size=20',null,'GET','public')).data.items;assert.ok(publicRows.some(r=>r.id===publicId));pass('A public guestbook and UI comment use verified member identity');
 const second=await fresh(a);await second.locator(`[data-post="${publicId}"] .guestbook-edit`).click();await second.locator('.guestbook-body-input').fill(prefix+' 새 브라우저 수정');await second.locator('.guestbook-save').click();await second.getByText(prefix+' 새 브라우저 수정',{exact:true}).waitFor();
 const secondPost=second.locator(`[data-post="${publicId}"]`);await secondPost.locator('.comment-edit').click();await secondPost.locator('.comment-body').fill(prefix+' 댓글 수정');await secondPost.locator('.comment-save').click();await secondPost.locator('[data-comment]').filter({hasText:prefix+' 댓글 수정'}).waitFor();pass('Fresh A browser edits original guestbook and comment');
 ownerPage=await fresh(b);assert.equal(await ownerPage.evaluate(()=>window.MinihompyAdmin.state.role),'admin');
 for(const kind of ['board','photos','diary']){
  const parent={kind,id:crypto.randomUUID()};parentsCreated.push(parent);await saveJournal();
  const made=await ownerPage.evaluate(async({kind,id,prefix})=>{
   const client=MinihompyBackend.getClient('admin'),tables={board:['board_folders','board_posts'],photos:['photo_folders','photo_posts'],diary:['diary_folders','diary_entries']},[folders,table]=tables[kind];
   let folderQuery=client.from(folders).select('id');if(kind!=='diary')folderQuery=folderQuery.eq('kind','folder');const f=await folderQuery.limit(1).single();if(f.error)throw Error('Fixture folder unavailable');
   const row={id,folder_id:f.data.id,author_name:'session verification',...(kind==='diary'?{entry_date:new Date().toISOString().slice(0,10),entry_time:'12:00',body:prefix}:{title:prefix,body:kind==='photos'?[{type:'text',text:prefix},{type:'image',path:id+'/'+crypto.randomUUID()+'.png'}]:prefix})};
   const r=await client.from(table).insert(row);return !r.error;
  },{...parent,prefix});assert.ok(made,'fixture parent created');
  await first.evaluate(({kind,id})=>MinihompyApp.renderView(kind+'?post='+id),parent);
  const article=first.locator(`[data-${kind==='diary'?'entry':'post'}="${parent.id}"]`);await article.locator('.comment-body').waitFor();
  await new Promise(r=>setTimeout(r,11000));await article.locator('.comment-body').fill(prefix+' '+kind);await article.locator('.comment-save').click();await article.locator('[data-comment]').filter({hasText:prefix+' '+kind}).waitFor();
  const comment=(await api(first,`/comments?kind=${kind}&parent_id=${parent.id}`)).items.find(r=>r.body===prefix+' '+kind);assert.equal(comment.author_kind,'member');
  await api(first,'/comments/'+comment.id,'PATCH',{request_id:crypto.randomUUID(),revision:comment.revision,kind,parent_id:parent.id,body:prefix+' edited '+kind});
  await api(first,'/comments/'+comment.id,'DELETE',{request_id:crypto.randomUUID(),revision:comment.revision+1,kind,parent_id:parent.id});
  pass('A UI '+kind+' comment creation plus member edit/delete on dedicated B fixture parent');
 }

 const ownerPost=ownerPage.locator(`[data-post="${publicId}"]`);await ownerPost.waitFor();assert.equal(await ownerPost.locator('.guestbook-edit').count(),0);assert.equal(await ownerPost.locator('.comment-edit').count(),0);
 await ownerPost.locator('.guestbook-make-private').click();await ownerPage.locator(`[data-post="${publicId}"].is-private`).waitFor();
 assert.ok(!(await raw(second,'/guestbook?page=1&size=20',null,'GET','public')).data.items.some(r=>r.id===publicId));
 assert.equal((await raw(second,`/comments?kind=guestbook&parent_id=${publicId}`,null,'GET','public')).status,404);pass('B owner hides A post; anonymous parent/comment reads denied; no body edit controls');
 // Wait only the remaining production rate window; never alter rate counters.
 const row=(await list(second)).find(r=>r.id===publicId),remaining=61000-(Date.now()-Date.parse(row.created_at));if(remaining>0){console.log('Waiting for the real member write limit.');await new Promise(r=>setTimeout(r,remaining));}
 const privateId=await addPost(second,true);await api(second,'/comments','POST',{id:crypto.randomUUID(),request_id:crypto.randomUUID(),kind:'guestbook',parent_id:privateId,body:prefix+' 비밀 댓글'});
 assert.ok(!(await raw(second,'/guestbook?page=1&size=20',null,'GET','public')).data.items.some(r=>r.id===privateId));pass('A creates private post/comment; anonymous list and count filter private content');
 await ownerPage.reload();await state(ownerPage,b,b);await ownerPage.locator(`[data-post="${privateId}"]`).waitFor();
 const privateComments=(await api(ownerPage,`/comments?kind=guestbook&parent_id=${privateId}`,'GET',undefined,'owner')).items;
 await api(ownerPage,'/comments/'+privateComments[0].id,'DELETE',{request_id:crypto.randomUUID(),revision:privateComments[0].revision,kind:'guestbook',parent_id:privateId},'owner');pass('B owner deletes A private comment');
 const previousToken=await second.evaluate(()=>Object.entries(sessionStorage).find(([k])=>k.startsWith('minihompy.member-writing.v1:')&&!k.endsWith(':renewal'))[1]);
 await second.locator('#login-auth-toggle').click();await state(second,b,null);
 assert.equal((await raw(second,'/sessions/current',null,'GET','member',previousToken)).status,401);assert.equal(await second.locator('.guestbook-post.is-private').count(),0);pass('Actual logout revokes old token and clears private DOM');
 // Re-login as B in the same browser, using the real account-switch screens.
 await second.locator('#login-auth-toggle').click();await second.waitForURL('**/login.html?**');await second.locator('#handle').fill(b.handle);await second.locator('#submit').click();await second.waitForURL(url=>url.origin===new URL(b.home).origin&&url.pathname.endsWith('/login/'));await second.locator('#password').fill(b.password);await second.locator('#submit').click();await state(second,b,b);await second.waitForFunction(()=>window.MinihompyMemberWriting?.state.status==='ready');await second.locator('.guestbook-body-input').waitFor();assert.equal(await second.locator('.guestbook-body-input').inputValue(),'');pass('A logout → B login on the same browser retains no A draft');
 // Preserve existing anonymous content: direct public read still works, no content edits.
 const old=await first.evaluate(async()=>{const r=await window.MinihompyBackend.getClient('visitor').from('guestbook_posts').select('id,author_kind').eq('author_kind','local');return {ok:!r.error,count:r.data?.length||0};});assert.ok(old.ok);pass('Existing local/anonymous read path remains available');
 const waitMs=Date.parse(watch.originalExpiresAt)+2000-Date.now();if(waitMs>0)await new Promise(r=>setTimeout(r,waitMs));
 await watcher.waitForFunction(()=>MinihompyMemberWriting.state.status==='ready');
 assert.equal(await watcher.locator('.guestbook-body-input').inputValue(),prefix+' renewal draft');assert.equal(await watcher.locator('.guestbook-body-input').evaluate(e=>e===document.activeElement),true);
 const renewed=await raw(watcher,'/sessions/current',null,'GET');assert.equal(renewed.status,200);assert.ok(Date.parse(renewed.data.expires_at)>Date.parse(watch.originalExpiresAt));assert.ok(watch.renewals>=1);assert.equal(watch.navigations,0);assert.equal(watch.popups,0);assert.equal(watch.recounted,0);
 watch.finishedAt=new Date().toISOString();watch.renewedExpiresAt=renewed.data.expires_at;
 pass('Actual original 15-minute expiry crossed: automatic renewal, unchanged input/focus, no navigation/popup/new visit');
 await addPost(watcher,false);pass('A can write after actual expiry through the renewed session');
}catch(error){failed=true;console.log('FAIL: live writing check ('+error.name+'); credential-bearing details suppressed.');}
finally{
 clearInterval(heartbeat);
 try{
  if(created.length){
   if(!ownerPage||ownerPage.isClosed())ownerPage=await fresh(b);
   for(const id of created){
    const rows=(await api(ownerPage,'/guestbook?page=1&size=20','GET',undefined,'owner')).items;const row=rows.find(r=>r.id===id);if(!row)continue;
    assert.ok(row.body.startsWith(prefix));await api(ownerPage,'/guestbook/'+id,'DELETE',{request_id:crypto.randomUUID(),revision:row.revision},'owner');
   }
   const rows=(await api(ownerPage,'/guestbook?page=1&size=20','GET',undefined,'owner')).items;assert.ok(!rows.some(r=>created.includes(r.id)));
  }
  for(const parent of parentsCreated){
   if(!ownerPage||ownerPage.isClosed())ownerPage=await fresh(b);
   const removed=await ownerPage.evaluate(async({kind,id,prefix})=>{const c=MinihompyBackend.getClient('admin'),table={board:'board_posts',photos:'photo_posts',diary:'diary_entries'}[kind];const r=await c.from(table).select('*').eq('id',id).maybeSingle();if(r.error)return false;if(!r.data)return true;if((kind==='diary'?r.data.body:r.data.title)!==prefix)return false;const d=await c.from(table).delete().eq('id',id);if(d.error)return false;const check=await c.from(table).select('id').eq('id',id);return !check.error&&check.data.length===0;},{...parent,prefix});assert.ok(removed,'fixture parent cleanup');
  }
  cleanupOk=true;
 }catch{console.log('Cleanup requires retry for this run: '+run);}
 for(const context of contexts){for(const page of context.pages())try{if(new URL(page.url()).origin===new URL(b.home).origin)await page.evaluate(()=>window.MinihompyMemberWriting?.logout());}catch{}await context.close();}
 await browser.close();
 const report={checkedAt:new Date().toISOString(),run,checks,passed:!failed&&cleanupOk,testContentCleaned:cleanupOk,createdGuestbookIds:created,createdParentIds:parentsCreated,realTimeRenewal:watch};
 await writeFile(new URL('../docs/verification/member-session-step7/live.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 if(failed||!cleanupOk)process.exitCode=1;
}
