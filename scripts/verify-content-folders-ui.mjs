// Real views/repositories/router + personal SQL/RPC/RLS. Auth and HTTP transport are local fixtures.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {browserBackend,sqlTransport} from './helpers/home-browser-db.mjs';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])));
const {PGlite}=await import(pathToFileURL(resolve('../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js')));
const out=resolve('docs/verification/folder-visibility-step3');await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
const retained=new Set(['views/home.js','content-access.js','config.js','content.js','views/index.js','post-routes.js','post-location-repository.js','board-repository.js','photos-repository.js','diary-repository.js','comments-repository.js','comments.js','views/board.js','views/photos.js','views/diary.js','app.js','content-folders.js','content-folders-repository.js','photo-editor.js','assets/vendor/quill-2.0.3.js']);
const id=n=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ids={owner:id(1),A:id(2)},tables={board:['board_folders','board_posts'],photos:['photo_folders','photo_posts'],diary:['diary_folders','diary_entries']};
const allResults=[];
try{for(const width of [1280,375]){
 const {pg}=await memberWritingDb(PGlite,{siteId:id(99),centralUrl:'https://central.test/api'}),{handle,run}=sqlTransport(pg,ids);
 const context=await browser.newContext({viewport:{width,height:850},hasTouch:width===375});
 const errors=[],requests=[];let lose=false,hold=false,release=null,sequence=100,snapshotOffline=false;
 const originals={},postIds={};
 await pg.query('insert into auth.users values($1),($2)',Object.values(ids));await pg.query('insert into private.minihompy_admins values($1)',[ids.owner]);
 for(const [menu,[folderTable,postTable]]of Object.entries(tables)){
  originals[menu]=(await pg.query(`select * from public.${folderTable} limit 1`)).rows[0];postIds[menu]=id(sequence++);
  const p=postIds[menu],f=originals[menu].id;
  if(menu==='board')await pg.query("insert into public.board_posts(id,folder_id,author_id,author_name,title,body) values($1,$2,$3,'owner','Keep board','keep body')",[p,f,ids.owner]);
  if(menu==='photos')await pg.query("insert into public.photo_posts(id,folder_id,author_id,author_name,title,body) values($1,$2,$3,'owner','Keep photo',$4)",[p,f,ids.owner,JSON.stringify([{type:'image',path:p+'/'+id(77)+'.png'}])]);
  if(menu==='diary')await pg.query("insert into public.diary_entries(id,folder_id,author_id,author_name,entry_date,entry_time,body) values($1,$2,$3,'owner','2026-09-24','12:30','keep diary')",[p,f,ids.owner]);
 }
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!=='https://folders.test')throw Error('External URL: '+url.origin);
  if(url.pathname==='/fixture-db'){
   const q=req.postDataJSON();requests.push(q);
   if(snapshotOffline&&q.rpc==='manage_content_folders'&&q.args.p_action==='snapshot')return route.fulfill({json:{data:null,error:{message:'offline'}}});
   const response=await handle(q);
   if(q.rpc==='manage_content_folders'&&q.args.p_action!=='snapshot'){
    if(hold){hold=false;await new Promise(r=>release=r);}
    if(lose){lose=false;return route.abort('failed').catch(()=>{});}
   }
   return route.fulfill({json:response}).catch(()=>{});
  }
  const file=url.pathname.slice(1)||'index.html';let body=await readFile(resolve(file));
  if(file==='index.html'){
   body=body.toString().replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g,(all,src)=>retained.has(src)?all:'');
   body=body.replace('<head>',`<head><script>window.fixtureIds=${JSON.stringify(ids)};${browserBackend}
window.MinihompyPhotoMedia={scope:()=>({read:async()=>{const r=await fetch('assets/photos/lake.jpg');return URL.createObjectURL(await r.blob());},dispose(){}}),cleanup:async()=>{},upload:async()=>{}};</script>`);
  }
  return route.fulfill({body,contentType:({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});
 });
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const dialog=page.locator('.folder-manager');
 const ready=async()=>{await dialog.locator('.folder-manager-list').waitFor({state:'attached'});await page.waitForFunction(()=>document.querySelector('.folder-manager')?.getAttribute('aria-busy')==='false');};
 const navigate=menu=>page.evaluate(menu=>MinihompyApp.renderView(menu),menu);
 const manager=async menu=>{await page.locator(`.${menu==='board'?'board':menu==='photos'?'photo':'diary'}-folder-manage`).click();await ready();};
 const row=name=>dialog.locator('li').filter({has:page.getByText(name,{exact:true})});
 const create=async name=>{await dialog.getByRole('button',{name:'폴더 만들기',exact:true}).click();await dialog.getByLabel('이름',{exact:true}).fill(name);await dialog.getByRole('button',{name:'저장',exact:true}).click();await ready();};
 const close=async()=>{await dialog.getByRole('button',{name:'닫기',exact:true}).click();await dialog.waitFor({state:'detached'});};
 const check=async(name,fn)=>{await fn();allResults.push({width,name});console.log(`PASS ${width}: ${name}`);};
 try{
 await page.goto('https://folders.test/');await page.waitForFunction(()=>window.MinihompyApp?.currentView);
 await check('No folder management controls or private snapshot requests for visitors',async()=>{
  for(const menu of Object.keys(tables)){await navigate(menu);await page.waitForFunction(menu=>document.querySelector('.content-main')?.dataset.view===menu||MinihompyApp.currentView===menu,menu);assert.equal(await page.locator('.board-folder-manage:visible,.photo-folder-manage:visible,.diary-folder-manage:visible').count(),0);}
  assert.equal(requests.filter(q=>q.rpc==='manage_content_folders').length,0);
 });
 await page.evaluate(()=>setActor('owner'));
 for(const [menu,[folderTable,postTable]]of Object.entries(tables))await check(`${menu}: actual UI CRUD/order/move-delete, location refresh and editor choices`,async()=>{
  await page.evaluate(({menu,p})=>MinihompyApp.renderView({id:menu,post:p}),{menu,p:postIds[menu]});
  await page.locator(`[data-post="${postIds[menu]}"],[data-entry="${postIds[menu]}"]`).waitFor();
  await manager(menu);assert.match(await row(originals[menu].label).innerText(),/전체 글 1개/);
  await create('새 폴더');const target=(await run(()=>pg.query(`select id from public.${folderTable} where label='새 폴더'`))).rows[0].id;
  await row('새 폴더').getByRole('button',{name:'이름·설명',exact:true}).click();await dialog.getByLabel('이름',{exact:true}).fill('옮길 곳');
  if(menu!=='diary')await dialog.getByLabel('설명',{exact:true}).fill('folder description');
  await dialog.getByRole('button',{name:'저장',exact:true}).click();await ready();
  const up=row('옮길 곳').getByRole('button',{name:'옮길 곳 위로',exact:true});await up.focus();await page.keyboard.press('Enter');await ready();
  assert.equal(await dialog.locator('li strong').first().textContent(),'옮길 곳');
  if(menu!=='diary'){
   await dialog.getByRole('button',{name:'구분선 추가',exact:true}).click();await dialog.getByRole('button',{name:'저장',exact:true}).click();await ready();
   await row('구분선').getByRole('button',{name:'삭제',exact:true}).click();await dialog.getByRole('button',{name:'삭제 확인',exact:true}).click();await ready();
  }else assert.equal(await dialog.getByRole('button',{name:'구분선 추가',exact:true}).count(),0);
  await create('빈 폴더');await row('빈 폴더').getByRole('button',{name:'삭제',exact:true}).click();await dialog.getByRole('button',{name:'삭제 확인',exact:true}).click();await ready();assert.equal(await row('빈 폴더').count(),0);
  await row(originals[menu].label).getByRole('button',{name:'삭제',exact:true}).click();
  assert.match(await dialog.innerText(),/총 1개/);await dialog.getByLabel('글을 옮길 폴더',{exact:true}).selectOption(target);
  await dialog.getByRole('button',{name:'모든 글 이동 후 폴더 삭제',exact:true}).click();await ready();
  assert.match(await dialog.locator('.folder-manager-status').innerText(),/글 1개/);
  assert.equal((await run(()=>pg.query(`select folder_id from public.${postTable} where id=$1`,[postIds[menu]]))).rows[0].folder_id,target);
  assert.equal(await row('옮길 곳').getByRole('button',{name:'삭제',exact:true}).isDisabled(),true);
  const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);
  await page.screenshot({path:resolve(out,`${menu}-${width}.png`)});await close();
  await page.locator(`[data-post="${postIds[menu]}"],[data-entry="${postIds[menu]}"]`).waitFor();assert.ok(page.url().includes(postIds[menu]));
  if(menu==='board'){
   await page.locator('.board-edit').click();assert.equal(await page.locator('#board-edit-folder option').count(),1);assert.equal(await page.locator('#board-edit-folder').inputValue(),target);assert.equal(await page.locator('.board-folder-manage').isDisabled(),true);await page.locator('.board-cancel').click();
  }else if(menu==='photos'){
   await page.locator('.photo-edit').click();await page.locator('.photo-editor-title').waitFor();assert.equal(await page.locator('.photo-folder-manage').isDisabled(),true);
   assert.equal(await page.locator('.photo-editor-folder option').count(),1);await page.locator('.photo-cancel').click();
  }else{
   await page.locator('.diary-edit').click();assert.equal(await page.locator('.diary-field-folder_id').inputValue(),target);assert.equal(await page.locator('.diary-folder-manage').isDisabled(),true);await page.locator('.diary-cancel').click();
  }
 });
 await check('Conflict refreshes snapshot and requires a new deletion confirmation',async()=>{
  await navigate('board');await manager('board');await create('충돌 폴더');const before=(await run(()=>pg.query("select id from public.board_folders where label='충돌 폴더'"))).rows[0].id;
  await row('충돌 폴더').getByRole('button',{name:'삭제',exact:true}).click();
  await run(()=>pg.query("insert into public.board_posts(id,folder_id,author_id,author_name,title,body) values($1,$2,$3,'owner','new','new')",[id(sequence++),before,ids.owner]));
  await dialog.getByRole('button',{name:'삭제 확인',exact:true}).click();await ready();assert.match(await dialog.locator('.folder-manager-status').innerText(),/변경되었습니다/);assert.match(await row('충돌 폴더').innerText(),/전체 글 1개/);assert.equal(await dialog.locator('form').count(),0);await close();
 });
 await check('Lost response retries identical request once; rapid double submit cannot duplicate folders',async()=>{
  await manager('board');await dialog.getByRole('button',{name:'폴더 만들기',exact:true}).click();await dialog.getByLabel('이름',{exact:true}).fill('응답 유실');lose=true;
  await dialog.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});await dialog.getByRole('button',{name:'같은 요청으로 결과 확인',exact:true}).waitFor();
  const first=requests.filter(q=>q.rpc==='manage_content_folders'&&q.args.p_action==='create').at(-1).args.p_args;
  await dialog.getByRole('button',{name:'같은 요청으로 결과 확인',exact:true}).click();await ready();
  const retries=requests.filter(q=>q.rpc==='manage_content_folders'&&q.args.p_args.request_id===first.request_id);assert.equal(retries.length,2);assert.deepEqual(retries[0],retries[1]);
  assert.equal((await run(()=>pg.query("select count(*)::int n from public.board_folders where label='응답 유실'"))).rows[0].n,1);await close();
 });
 await check('Snapshot outage has explicit retry; account reset discards unsaved form',async()=>{
  snapshotOffline=true;await page.locator('.board-folder-manage').click();await dialog.locator('.folder-manager-status').filter({hasText:'폴더 처리 결과를 확인하지 못했습니다.'}).waitFor();
  snapshotOffline=false;await dialog.getByRole('button',{name:'다시 조회',exact:true}).click();await ready();
  await dialog.getByRole('button',{name:'폴더 만들기',exact:true}).click();await dialog.getByLabel('이름',{exact:true}).fill('버릴 입력');
  await page.evaluate(()=>dispatchEvent(new CustomEvent('minihompy:writing-reset',{detail:{clearDraft:true}})));await dialog.waitFor({state:'detached'});
  await manager('board');assert.equal(await dialog.locator('input').count(),0);await close();
 });
 await check('Authentication refresh keeps form; logout closes manager and ignores a late mutation response',async()=>{
  await manager('board');await dialog.getByRole('button',{name:'폴더 만들기',exact:true}).click();await dialog.getByLabel('이름',{exact:true}).fill('늦은 응답');
  await page.evaluate(()=>dispatchEvent(new Event('minihompy:identity')));assert.equal(await dialog.getByLabel('이름',{exact:true}).inputValue(),'늦은 응답');
  hold=true;await dialog.getByRole('button',{name:'저장',exact:true}).click();
  for(let i=0;!release&&i<100;i++)await page.waitForTimeout(20);assert.ok(release);await page.evaluate(()=>setActor('anon'));await dialog.waitFor({state:'detached'});release();release=null;
  await page.waitForTimeout(100);assert.equal(await dialog.count(),0);assert.equal(await page.locator('.board-folder-manage:visible').count(),0);
 });
 await check('Menu departure discards manager input and late response; next visit reloads folders',async()=>{
  await page.evaluate(()=>setActor('owner'));await manager('board');await dialog.getByRole('button',{name:'폴더 만들기',exact:true}).click();await dialog.getByLabel('이름',{exact:true}).fill('메뉴 이탈');hold=true;await dialog.getByRole('button',{name:'저장',exact:true}).click();
  for(let i=0;!release&&i<100;i++)await page.waitForTimeout(20);assert.ok(release);await navigate('diary');await dialog.waitFor({state:'detached'});release();release=null;
  await navigate('board');await page.locator('.board-folder').filter({hasText:'메뉴 이탈'}).waitFor();await manager('board');assert.equal(await dialog.locator('input').count(),0);await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
 });
 await check('Legacy empty diary can create its first folder; keyboard focus remains inside dialog',async()=>{
  await run(()=>pg.exec('delete from public.diary_entries;delete from public.diary_folders'));
  await navigate('diary');await page.locator('.diary-empty').filter({hasText:'등록된 폴더가 없습니다.'}).waitFor();await manager('diary');
  assert.equal(await dialog.locator('li').count(),0);await create('첫 폴더');
  await dialog.getByRole('button',{name:'닫기',exact:true}).focus();
  for(let i=0;i<8;i++){await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.querySelector('.folder-manager').contains(document.activeElement)));}
  await close();await page.locator('.diary-folder-list button').filter({hasText:'첫 폴더'}).waitFor();
  assert.equal(await page.locator('.diary-write').isEnabled(),true);
 });
 assert.deepEqual(errors,[]);
 }finally{release?.();await context.close();await pg.close();}
 }
 await writeFile(resolve(out,'ui.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks:allResults,scope:'Real UI/repositories/router and SQL/RLS; local Auth/HTTP fixtures, Chromium 1280px and 375px touch viewport (not a physical phone). No deployment.'},null,2)+'\n');
 console.log(`PASS: ${allResults.length} browser integration groups`);
}finally{await browser.close();}
