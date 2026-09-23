import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])));const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
const root=new URL('../',import.meta.url),id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const setup=`
 window.MINIHOMPY_VIEWS={home:{label:'홈',createLeft:()=>document.createDocumentFragment(),createMain:()=>document.createDocumentFragment()}};
 window.MINIHOMPY_CONFIG={profile:{name:'owner'},menus:['home','board','photos','diary','guestbook'].map(id=>({id,label:id,visible:true}))};
 window.MinihompyContent={apply(){},fit(){}};window.MinihompyAdmin={state:{role:'admin',userId:'${id(99)}'}};
 window.MinihompySettings={status:'loading',async load(){await new Promise(r=>setTimeout(r,80));this.status='ready';window.dispatchEvent(new Event('minihompy:settings'));}};
 window.MinihompyComments={create:()=>document.createElement('div'),forget(){}};
 window.MinihompyPhotoEditor={active:false};window.MinihompyMemberWriting={enabled:()=>false};
 if(location.hash.startsWith('#vt='))window.MINIHOMPY_IDENTITY_RETURN_PENDING=true;
 window.calls=[];window.missing=false;window.held=false;window.release=null;
 const folder={id:'${id(98)}',kind:'folder',label:'folder',description:''};
 const item=(n)=>({id:'10000000-0000-4000-8000-'+String(n).padStart(12,'0'),folder_id:folder.id,author_name:'owner',author_id:'${id(99)}',title:'target '+n,body:'body '+n,created_at:'2026-01-01T00:00:00Z',entry_date:'2001-02-03',entry_time:'12:00:00',weather:'',visibility:'public',number:n,revision:1});
 window.MinihompyBackend={getClient:()=>({rpc:async(name,args)=>{window.calls.push(args);if(window.held)await new Promise(r=>window.release=r);return {data:window.missing?null:{id:args.p_id,folder_id:folder.id,entry_date:'2001-02-03',page:3},error:null};}})};
 const base={folders:async()=>[folder],get:async(id)=>{if(window.missing)throw Error('글이 삭제되었거나 조회할 수 없습니다.');return item(Number(id.slice(-12)));},list:async(f,p,size)=>({items:[item(p===3?25:1)],count:25})};
 window.MinihompyBoardRepository={...base,save:async value=>{await new Promise(r=>window.finishWrite=r);return {...value,id:value.id||folder.id};}};
 window.MinihompyPhotosRepository={...base,list:async(f,p,size)=>({items:[{...item(p===3?25:1),body:[{type:'text',text:'photo'}]}],count:6})};
 window.MinihompyDiaryRepository={...base,dates:async()=>['2001-02-03'],list:async(f,date,p,size)=>({items:[item(p===3?25:1)],count:60})};
 window.MinihompyGuestbookRepository={nickname:()=>'',context:async()=>({role:'reader',userId:null}),list:async(ctx,p,size,target)=>{if(target&&window.missing)throw Error('글이 삭제되었거나 조회할 수 없습니다.');return {items:[item(target?Number(target.slice(-12)):1)],count:15,page:target?3:p};}};
 `;
try{
 for(const width of [1280,375]){
 const page=await browser.newPage({viewport:{width,height:820}}),errors=[];page.on('pageerror',e=>errors.push(e.message));let accept=true,dialogs=0;page.on('dialog',async d=>{dialogs++;await(accept?d.accept():d.dismiss());});
 await page.route('https://home.test/**',async route=>{
 const path=new URL(route.request().url()).pathname.slice(1);
 if(!path){const scripts=['post-routes.js','post-location-repository.js','views/board.js','views/photos.js','views/diary.js','views/guestbook.js','app.js'];return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><style>[data-view-slot=main],.board-scroll,.photo-scroll,.diary-scroll,.guestbook-scroll{height:450px;overflow:auto}article{min-height:200px}</style><nav class="page-tabs"></nav><div data-view-slot="left"></div><main data-view-slot="main"></main><div class="home-scrollbar"></div><script>${setup}</script>${scripts.map(s=>`<script src="${s}"></script>`).join('')}`});}
 try{return route.fulfill({contentType:'text/javascript',body:await readFile(new URL(path,root),'utf8')});}catch{return route.fulfill({status:404,body:''});}
 });
 const target=id(25),hash=kind=>'#/'+kind+'?post='+target;
 for(const kind of ['board','photos','diary','guestbook']){
  await page.goto('https://home.test/'+hash(kind));await page.locator(`[data-${kind==='diary'?'entry':'post'}="${target}"]`).waitFor();assert.equal(new URL(page.url()).hash,hash(kind));
  if(kind!=='board')await page.waitForFunction(id=>(document.activeElement.dataset.post||document.activeElement.dataset.entry)===id,target);
  if(kind==='diary')assert.equal(await page.locator('[data-date="2001-02-03"]').getAttribute('aria-pressed'),'true');
  await page.reload();await page.locator(`[data-${kind==='diary'?'entry':'post'}="${target}"]`).waitFor();
 }
 await page.goto('about:blank');await page.goto('https://home.test/#vt=fixture');await page.waitForFunction(()=>MinihompySettings.status==='ready');assert.equal(new URL(page.url()).hash,'#vt=fixture');await page.evaluate(hash=>{history.replaceState(null,'',hash);MINIHOMPY_IDENTITY_RETURN_PENDING=false;dispatchEvent(new Event('hashchange'));},hash('board'));await page.locator('.board-post-title').waitFor();assert.equal(new URL(page.url()).hash,hash('board'));
 console.log('PASS '+width+': four real views direct entry/reload, target beyond first page and diary date');
 await page.evaluate(()=>MinihompyApp.renderView('board?post='+ '10000000-0000-4000-8000-000000000025'));await page.locator('.board-post-title').waitFor();await page.evaluate(()=>MinihompyApp.renderView('photos?post='+ '10000000-0000-4000-8000-000000000025'));await page.locator('.photo-post').waitFor();await page.goBack();await page.locator('.board-post-title').waitFor();await page.goForward();await page.locator('.photo-post').waitFor();
 await page.waitForFunction(id=>document.activeElement.dataset.post===id,target);
 await page.evaluate(()=>{const a=document.createElement('a');a.id='fixture-post-link';a.href='#/board?post=10000000-0000-4000-8000-000000000025';a.textContent='open post';document.body.append(a);});await page.locator('#fixture-post-link').focus();await page.keyboard.press('Enter');await page.locator('.board-post-title').waitFor();await page.locator('#fixture-post-link').evaluate(e=>e.remove());
 await page.evaluate(()=>MinihompyApp.renderView('board'));await page.locator('.board-write').waitFor();await page.locator('.board-write').click();await page.locator('#board-edit-title').fill('UNSAVED');accept=false;
 const before=page.url();await page.evaluate(()=>MinihompyApp.renderView('board?post=10000000-0000-4000-8000-000000000025'));assert.equal(page.url(),before);assert.equal(await page.locator('#board-edit-title').inputValue(),'UNSAVED');
 const priorDialogs=dialogs;await page.locator('[data-menu=photos]').click();await page.locator('.photo-post').waitFor();assert.equal(dialogs,priorDialogs);
 await page.goBack();await page.locator('.board-write').waitFor();assert.equal(await page.locator('#board-edit-title').count(),0);await page.locator('.board-write').click();assert.equal(await page.locator('#board-edit-title').inputValue(),'');
 await page.locator('#board-edit-title').fill('BF-CACHE DRAFT');await page.evaluate(()=>{dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});await page.locator('.board-write').waitFor();assert.equal(await page.locator('#board-edit-title').count(),0);accept=true;
 console.log('PASS '+width+': same-menu guard, cross-menu discard without confirmation, history and page restoration');
 await page.locator('.board-write').click();await page.locator('#board-edit-title').fill('PENDING WRITE');await page.locator('#board-edit-body').fill('submitted body');await page.locator('.board-save').click();await page.waitForFunction(()=>!!window.finishWrite);
 const busyDialogs=dialogs;await page.locator('[data-menu=home]').click();await page.locator('[data-menu=board]').click();await page.locator('.board-write').click();await page.locator('#board-edit-title').fill('NEW INPUT');await page.evaluate(()=>finishWrite());await page.waitForTimeout(50);assert.equal(await page.locator('#board-edit-title').inputValue(),'NEW INPUT');assert.equal(dialogs,busyDialogs);
 await page.locator('[data-menu=home]').click();
 console.log('PASS '+width+': navigation during save clears old draft; late save cannot replace new editor');
 await page.locator('[data-menu=board]').click();await page.locator('.board-write').click();await page.locator('#board-edit-title').fill('DOCUMENT DEPARTURE');const departureDialogs=dialogs;
 await page.goto('about:blank');await page.goBack();await page.locator('.board-write').waitFor();assert.equal(await page.locator('#board-edit-title').count(),0);assert.equal(dialogs,departureDialogs);
 console.log('PASS '+width+': actual document departure and browser back do not restore input or show a leave prompt');


 await page.evaluate(()=>{window.held=true;MinihompyApp.renderView('board?post=10000000-0000-4000-8000-000000000025');});await page.waitForFunction(()=>!!window.release);await page.locator('[data-menu=home]').click();await page.evaluate(()=>{held=false;release();});await page.waitForTimeout(80);assert.equal(await page.locator('[data-view-slot=main]').getAttribute('data-view'),'home');assert.equal(await page.locator('.board-post-title').count(),0);
 await page.evaluate(()=>{held=true;release=null;MinihompyApp.renderView('board?post=10000000-0000-4000-8000-000000000025');});await page.waitForFunction(()=>!!release);await page.evaluate(()=>{held=false;MinihompyApp.renderView('board?post=10000000-0000-4000-8000-000000000001');});await page.getByRole('heading',{name:'target 1',exact:true}).waitFor();await page.evaluate(()=>release());await page.waitForTimeout(60);assert.equal(await page.locator('.board-post-title').textContent(),'target 1');
 await page.evaluate(()=>{missing=true;MinihompyApp.renderView('board?post=10000000-0000-4000-8000-000000000025');});await page.getByText('글이 삭제되었거나 조회할 수 없습니다.',{exact:true}).waitFor();assert.equal(await page.locator('.board-post-title').count(),0);
 await page.goto('https://home.test/#/board?post=bad');await page.getByText('글 주소가 잘못되었거나 표시할 수 없는 메뉴입니다.').waitFor();
 await page.goto('https://home.test/#/home');await page.waitForFunction(()=>MinihompySettings.status==='ready');await page.evaluate(()=>{MINIHOMPY_CONFIG.menus.find(m=>m.id==='board').visible=false;window.dispatchEvent(new Event('minihompy:settings'));location.hash='#/board?post=10000000-0000-4000-8000-000000000025';});await page.getByText('글 주소가 잘못되었거나 표시할 수 없는 메뉴입니다.').waitFor();assert.equal(await page.locator('.board-post-title').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS '+width+': late response, deleted target, invalid ID and hidden menu fail safely');await page.close();
 }
}finally{await browser.close();}
