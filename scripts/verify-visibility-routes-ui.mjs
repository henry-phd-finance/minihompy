// Real views/repositories/router + personal SQL/RPC/RLS. Auth and HTTP transport are local fixtures.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {browserBackend,sqlTransport} from './helpers/home-browser-db.mjs';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])));
const {PGlite}=await import(pathToFileURL(resolve('../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js')));
const out=resolve('docs/verification/folder-visibility-step5');await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
const retained=new Set(['views/home.js','content-access.js','config.js','content.js','views/index.js','post-routes.js','post-location-repository.js','board-repository.js','photos-repository.js','diary-repository.js','comments-repository.js','comments.js','views/board.js','views/photos.js','views/diary.js','app.js','content-folders.js','content-folders-repository.js','photo-editor.js','assets/vendor/quill-2.0.3.js']);
const id=n=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ids={owner:id(1),A:id(2)},tables={board:['board_folders','board_posts'],photos:['photo_folders','photo_posts'],diary:['diary_folders','diary_entries']};
const allResults=[];
try{for(const width of [1280,375]){
 const {pg}=await memberWritingDb(PGlite,{siteId:id(99),centralUrl:'https://central.test/api'}),{handle,run}=sqlTransport(pg,ids);
 const context=await browser.newContext({viewport:{width,height:850},hasTouch:width===375});
 const errors=[];let sequence=100;
 const originals={},postIds={};
 await pg.query('insert into auth.users values($1),($2)',Object.values(ids));await pg.query('insert into private.minihompy_admins values($1)',[ids.owner]);
 for(const [menu,[folderTable,postTable]]of Object.entries(tables)){
  originals[menu]=(await pg.query(`select * from public.${folderTable} limit 1`)).rows[0];postIds[menu]=id(sequence++);
  const p=postIds[menu],f=originals[menu].id;
  if(menu==='board')await pg.query("insert into public.board_posts(id,folder_id,author_id,author_name,title,body) values($1,$2,$3,'owner','Keep board','keep body')",[p,f,ids.owner]);
  if(menu==='photos')await pg.query("insert into public.photo_posts(id,folder_id,author_id,author_name,title,body) values($1,$2,$3,'owner','Keep photo',$4)",[p,f,ids.owner,JSON.stringify([{type:'image',path:p+'/'+id(77)+'.png'}])]);
  if(menu==='diary')await pg.query("insert into public.diary_entries(id,folder_id,author_id,author_name,entry_date,entry_time,body) values($1,$2,$3,'owner','2026-09-24','12:30','keep diary')",[p,f,ids.owner]);
 }
 await pg.exec('update private.photo_media_state set ready=true');
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!=='https://folders.test')throw Error('External URL: '+url.origin);
  if(url.pathname==='/fixture-db'){
   const response=await handle(req.postDataJSON());
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

 try{
 for(const [menu,[ft,table]] of Object.entries(tables)){
  const post=postIds[menu],url='https://folders.test/#/'+menu+'?post='+post;
  const target=page.locator('[data-post="'+post+'"],[data-entry="'+post+'"]');
  await page.goto(url);await target.waitFor();
  await page.evaluate(()=>MinihompyApp.renderView('home'));
  await run(()=>pg.query('update public.'+table+" set visibility='private' where id=$1",[post]));
  await page.goBack();
  await page.getByText('글이 삭제되었거나 조회할 수 없습니다.',{exact:false}).first().waitFor();
  assert.equal(await target.count(),0);
  await page.reload();await page.getByText('글이 삭제되었거나 조회할 수 없습니다.',{exact:false}).first().waitFor();assert.equal(await target.count(),0);
  await run(()=>pg.query('update public.'+table+" set visibility='public' where id=$1",[post]));
  await page.reload();await target.waitFor();
  const dest=id(sequence++);
  await run(async()=>{
   await pg.query('insert into public.'+ft+"(id,label) values($1,'moved destination')",[dest]);
   await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[ids.owner]);
   await pg.query('update public.'+table+' set folder_id=$1 where id=$2',[dest,post]);
  });
  await page.reload();await target.waitFor();
  const location=await run(()=>pg.query('select public.post_location($1,$2,5) v',[menu,post]));assert.equal(location.rows[0].v.folder_id,dest);
  await run(()=>pg.query('delete from public.'+table+' where id=$1',[post]));
  await page.reload();await page.getByText('글이 삭제되었거나 조회할 수 없습니다.',{exact:false}).first().waitFor();assert.equal(await target.count(),0);
  allResults.push({width,menu});console.log('PASS '+width+' '+menu+': actual SQL direct address, hide/back/reload, move/reload, delete/reload');
 }
 assert.deepEqual(errors,[]);
 }finally{await context.close();await pg.close();}
}
 console.log('PASS: '+allResults.length+' browser/SQL groups');
}finally{await browser.close();}
