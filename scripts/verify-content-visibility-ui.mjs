// Real views/repositories/router + personal SQL/RPC/RLS. Auth and HTTP transport are local fixtures.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {browserBackend,sqlTransport} from './helpers/home-browser-db.mjs';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])));
const {PGlite}=await import(pathToFileURL(resolve('../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js')));
const out=resolve('docs/verification/folder-visibility-step7');await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
const retained=new Set(['views/home.js','content-access.js','config.js','content.js','views/index.js','post-routes.js','post-location-repository.js','board-repository.js','photos-repository.js','diary-repository.js','comments-repository.js','comments.js','views/board.js','views/photos.js','views/diary.js','app.js','content-folders.js','content-folders-repository.js','photo-editor.js','assets/vendor/quill-2.0.3.js']);
const id=n=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ids={owner:id(1),A:id(2)},tables={board:['board_folders','board_posts'],photos:['photo_folders','photo_posts'],diary:['diary_folders','diary_entries']};
const allResults=[];
try{for(const width of [1280,375]){
 const {pg}=await memberWritingDb(PGlite,{siteId:id(99),centralUrl:'https://central.test/api',photoMedia:true}),{handle,run}=sqlTransport(pg,ids);
 const context=await browser.newContext({viewport:{width,height:850},hasTouch:width===375});
 const errors=[];let sequence=100,hold=false,holdWrite=false,release=null;
 const originals={},postIds={};
 await pg.query('insert into auth.users values($1),($2)',Object.values(ids));await pg.query('insert into private.minihompy_admins values($1)',[ids.owner]);
 for(const [menu,[folderTable,postTable]]of Object.entries(tables)){
  originals[menu]=(await pg.query(`select * from public.${folderTable} limit 1`)).rows[0];postIds[menu]=id(sequence++);
  const p=postIds[menu],f=originals[menu].id;
  if(menu==='board')await pg.query("insert into public.board_posts(id,folder_id,author_id,author_name,title,body) values($1,$2,$3,'owner','Keep board','keep body')",[p,f,ids.owner]);
  if(menu==='photos')await pg.query("insert into public.photo_posts(id,folder_id,author_id,author_name,title,body) values($1,$2,$3,'owner','Keep photo',$4)",[p,f,ids.owner,JSON.stringify([{type:'image',path:p+'/'+id(77)+'.png'}])]);
  if(menu==='diary')await pg.query("insert into public.diary_entries(id,folder_id,author_id,author_name,entry_date,entry_time,body) values($1,$2,$3,'owner','2026-09-24','12:30','keep diary')",[p,f,ids.owner]);
 }

 for(const menu of ['board','diary']){
  await pg.exec('set session_replication_role=replica');
  await pg.query('insert into public.post_comments(id,'+(menu==='board'?'board_post_id':'diary_entry_id')+",author_id,author_name,body) values($1,$2,$3,'owner',$4)",[id(sequence++),postIds[menu],ids.owner,'COMMENT SENTINEL '+menu]);
  await pg.exec('set session_replication_role=origin');
 }
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!=='https://folders.test')throw Error('External URL: '+url.origin);
  if(url.pathname==='/fixture-db'){
   const q=req.postDataJSON();const response=await handle(q);
   if((hold&&q.table==='board_posts'&&q.op==='select')||(holdWrite&&q.table==='board_posts'&&q.op==='update')){hold=false;holdWrite=false;await new Promise(r=>release=r);}
   return route.fulfill({json:response}).catch(()=>{});
  }
  const file=url.pathname.slice(1)||'index.html';let body=await readFile(resolve(file));
  if(file==='index.html'){
   body=body.toString().replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g,(all,src)=>retained.has(src)?all:'');
   body=body.replace('<head>',`<head><script>window.fixtureIds=${JSON.stringify(ids)};${browserBackend.replace('current:async()=>MinihompyAdmin.state',"current:async()=>window.fixtureExpired?{role:'reader',userId:null}:MinihompyAdmin.state")}
window.MinihompyPhotoMedia={scope:()=>({read:async()=>'',dispose(){}})};</script>`);
  }
  return route.fulfill({body,contentType:({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});
 });
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());


 try{
 await page.goto('https://folders.test/');await page.waitForFunction(()=>window.MinihompyApp?.currentView);
 const navigate=(menu,p)=>page.evaluate(({menu,p})=>MinihompyApp.renderView({id:menu,post:p}),{menu,p});
 const check=async(name,fn)=>{try{await fn();}catch(e){console.log(await page.locator('form input,form select,form textarea').evaluateAll(es=>es.map(e=>({name:e.className,value:e.value,valid:e.validity.valid,message:e.validationMessage}))));throw e;}allResults.push({width,name});console.log('PASS '+width+': '+name);};
 await page.evaluate(()=>setActor('owner'));
 for(const menu of ['board','diary']){
  const p=postIds[menu],table=tables[menu][1],target=page.locator('[data-post="'+p+'"],[data-entry="'+p+'"]');
  const edit=page.locator(menu==='board'?'.board-edit':'.diary-edit'),field=page.locator(menu==='board'?'#board-edit-visibility':'.diary-field-visibility'),save=page.locator(menu==='board'?'.board-save':'.diary-save');
  await check(menu+': private/public editor, owner reload, public-only home and visitor direct denial',async()=>{
   await navigate(menu,p);await target.waitFor();await edit.click();await field.selectOption('private');await save.click();
   await target.getByText('공개설정 : 나만보기',{exact:true}).waitFor();
   assert.equal((await run(()=>pg.query('select visibility from public.'+table+' where id=$1',[p]))).rows[0].visibility,'private');
   const home=await run(()=>pg.query('select public.home_summary() v'));assert.equal(home.rows[0].v.counts[menu].total,0);
   await page.evaluate(()=>setActor('anon'));await page.getByText('글이 삭제되었거나 조회할 수 없습니다.',{exact:false}).first().waitFor();assert.equal(await target.count(),0);assert.ok(!(await page.locator('body').innerText()).includes('COMMENT SENTINEL'));
   await page.reload();await page.getByText('글이 삭제되었거나 조회할 수 없습니다.',{exact:false}).first().waitFor();assert.equal(await target.count(),0);
   await page.evaluate(()=>setActor('owner'));await target.waitFor();await edit.click();await field.selectOption('public');await save.click();await target.getByText('공개설정 : 공개',{exact:true}).waitFor();
  });
  await check(menu+': stale edit fails without overwriting visibility; same-account refresh preserves draft; menu leave discards',async()=>{
   await edit.click();await field.selectOption('private');
   await page.evaluate(()=>dispatchEvent(new Event('minihompy:identity')));assert.equal(await field.inputValue(),'private');
   await run(()=>pg.query('update public.'+table+" set body=body where id=$1",[p]));
   await save.click();await page.waitForFunction(menu=>document.querySelector(menu==='board'?'.board-status':'.diary-status')?.textContent.includes('실패')||document.querySelector('.board-status')?.textContent.includes('변경'),menu);
   assert.equal(await field.inputValue(),'private');assert.equal((await run(()=>pg.query('select visibility from public.'+table+' where id=$1',[p]))).rows[0].visibility,'public');
   await navigate('home');await navigate(menu,p);await target.waitFor();assert.equal(await field.count(),0);
  });
 }
 await check('board: logout while private response is held discards late response and cached title/body',async()=>{
  const p=postIds.board;
  await run(()=>pg.query("update public.board_posts set visibility='private',title='PRIVATE LATE SENTINEL' where id=$1",[p]));
  await navigate('home');hold=true;await navigate('board',p);
  while(!release)await new Promise(r=>setTimeout(r,10));
  await page.evaluate(()=>setActor('anon'));release();release=null;
  await page.getByText('글이 삭제되었거나 조회할 수 없습니다.',{exact:false}).first().waitFor();
  assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE LATE SENTINEL'));
  await page.evaluate(()=>setActor('owner'));await page.locator('.board-post-title').waitFor();
  await page.locator('.board-edit').click();await page.locator('#board-edit-body').fill('discard on account change');
  await page.evaluate(()=>setActor('A'));await page.getByText('글이 삭제되었거나 조회할 수 없습니다.',{exact:false}).first().waitFor();
  assert.equal(await page.locator('#board-edit-body').count(),0);
 });
 await check('diary: private-only calendar marker and body removed on logout; central reset retains no draft',async()=>{
  const p=postIds.diary;
  await run(()=>pg.query("update public.diary_entries set visibility='private' where id=$1",[p]));
  await page.evaluate(()=>setActor('owner'));await navigate('diary',p);await page.locator('[data-entry="'+p+'"]').waitFor();
  assert.ok(await page.locator('.diary-day.written').count()>0);
  await page.locator('.diary-edit').click();await page.locator('.diary-field-body').fill('central switch draft');
  await page.evaluate(()=>dispatchEvent(new CustomEvent('minihompy:writing-reset',{detail:{clearDraft:true,reason:'account changed'}})));
  await page.locator('[data-entry="'+p+'"]').waitFor();assert.equal(await page.locator('.diary-field-body').count(),0);
  await page.evaluate(()=>setActor('anon'));await page.getByText('글이 삭제되었거나 조회할 수 없습니다.',{exact:false}).first().waitFor();
  assert.equal(await page.locator('.diary-day.written').count(),0);assert.equal(await page.locator('.diary-entry').count(),0);
 });
 await check('verified admin expiry fails closed; login can recover',async()=>{
  await page.evaluate(()=>setActor('owner'));await navigate('board',postIds.board);await page.locator('.board-post-title').waitFor();
  await page.evaluate(()=>{window.fixtureExpired=true;});await page.reload();
  // Reload recreates the fixture; invalidate after load and start a fresh read instead.
  await page.evaluate(()=>{setActor('owner');window.fixtureExpired=true;MinihompyApp.renderView('diary');});
  await page.getByText('사용자 상태가 변경되었습니다.',{exact:false}).first().waitFor();assert.equal(await page.locator('.diary-entry').count(),0);
  await page.evaluate(()=>{window.fixtureExpired=false;setActor('owner');});await navigate('board',postIds.board);await page.locator('.board-post-title').waitFor();
 });
 await check('save committed while logout occurs: late response cannot restore draft or private body',async()=>{
  await navigate('board',postIds.board);await page.locator('.board-edit').click();await page.locator('#board-edit-body').fill('PRIVATE SAVING SENTINEL');
  holdWrite=true;await page.locator('.board-save').click();while(!release)await new Promise(r=>setTimeout(r,10));
  await page.evaluate(()=>setActor('anon'));release();release=null;
  await page.getByText('글이 삭제되었거나 조회할 수 없습니다.',{exact:false}).first().waitFor();
  assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE SAVING SENTINEL'));assert.equal(await page.locator('.board-editor').count(),0);
  await page.evaluate(()=>setActor('owner'));await page.locator('.board-post-title').waitFor();
 });
 await check('administrator can change former authors visibility without gaining body-edit rights',async()=>{
  for(const menu of ['board','diary']){
   const p=postIds[menu];await run(()=>pg.query('update public.'+tables[menu][1]+' set author_id=null where id=$1',[p]));
   await navigate('home');await navigate(menu,p);
   const toggle=page.locator(menu==='board'?'.board-visibility':'.diary-visibility');await toggle.waitFor();
   assert.equal(await page.locator(menu==='board'?'.board-edit':'.diary-edit').count(),0);
   const before=(await run(()=>pg.query('select body,visibility from public.'+tables[menu][1]+' where id=$1',[p]))).rows[0];
   await toggle.click();await page.waitForFunction(menu=>document.querySelector(menu==='board'?'.board-visibility':'.diary-visibility')?.textContent.includes('나만보기'),menu);
   const after=(await run(()=>pg.query('select body,visibility,author_id from public.'+tables[menu][1]+' where id=$1',[p]))).rows[0];
   assert.equal(after.visibility,'public');assert.equal(after.body,before.body);assert.equal(after.author_id,null);
  }
 });
 assert.deepEqual(errors,[]);
 }finally{if(release)release();await context.close();await pg.close();}
}
 console.log('PASS: '+allResults.length+' member visibility UI/SQL groups');
}finally{await browser.close();}
