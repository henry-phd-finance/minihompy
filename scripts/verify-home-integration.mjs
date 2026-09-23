import assert from 'node:assert/strict';import {readFile,mkdir} from 'node:fs/promises';import {resolve,extname} from 'node:path';import {pathToFileURL} from 'node:url';
import {memberWritingDb} from './helpers/member-writing-db.mjs';import {browserBackend,sqlTransport} from './helpers/home-browser-db.mjs';import {handleVisitCounts} from '../supabase/functions/visit-counts/handler.js';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])));
const {PGlite}=await import(pathToFileURL(resolve(process.argv[3]||'../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js')));
const root=resolve('.'),out=resolve('docs/verification/home-data-step6');await mkdir(out,{recursive:true});
const id=n=>`80000000-0000-4000-8000-${String(n).padStart(12,'0')}`,ids={owner:id(1),A:id(2),B:id(3)};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
const retained=new Set(['config.js','content.js','views/index.js','home-repository.js','home-activity.js','visit-counts.js','post-routes.js','post-location-repository.js','board-repository.js','photos-repository.js','diary-repository.js','guestbook-repository.js','comments-repository.js','comments.js','views/home.js','views/board.js','views/photos.js','views/diary.js','views/guestbook.js','app.js']);
try{for(const width of [1280,375]){
 const {pg}=await memberWritingDb(PGlite,{siteId:id(99),centralUrl:'https://central.test/api'});const {run,handle}=sqlTransport(pg,ids);
 await pg.query('insert into auth.users values($1),($2),($3)',Object.values(ids));await pg.query('insert into private.minihompy_admins values($1)',[ids.owner]);
 const context=await browser.newContext({viewport:{width,height:820}}),errors=[],responses=[];let now='2026-09-23T14:59:59Z',offline=false,hold=false,release;
 const env={MINIHOMPY_SITE_ORIGIN:'https://home.test',SUPABASE_URL:'https://'+'a'.repeat(20)+'.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',MINIHOMPY_VISIT_SECRET:'fixture-secret-'.repeat(4)};
 const stats=()=>run(async()=>(await pg.query('select private.visit_stats_at($1) as data',[now])).rows[0].data);
 try{
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.origin===env.SUPABASE_URL){
   const res=await handleVisitCounts(new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}:{})}),{env,rpc:async(name,args)=>name==='visit_stats'?stats():run(async()=>(await pg.query('select private.visit_record_at($1,$2,$3) as data',[args.p_day,args.p_digest,now])).rows[0].data)});
   return route.fulfill({status:res.status,body:await res.text(),headers:Object.fromEntries(res.headers)}).catch(()=>{});
  }
  if(u.origin!=='https://home.test')throw Error('External request blocked: '+u.origin);
  if(u.pathname==='/fixture-db'){
   const q=req.postDataJSON();let data;
   if(offline&&q.rpc==='home_summary')data={data:null,error:{message:'offline'}};else data=await handle(q);
   if(q.rpc==='home_summary'){responses.push(data);if(hold){hold=false;await new Promise(r=>release=r);}}
   return route.fulfill({json:data}).catch(()=>{});
  }
  const file=u.pathname.slice(1)||'index.html';
  let body=await readFile(resolve(root,file));
  if(file==='index.html'){
   body=body.toString().replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g,(all,src)=>retained.has(src)?all:'');
   body=body.replace('<head>',`<head><script>window.fixtureIds=${JSON.stringify(ids)};window.MINIHOMPY_SUPABASE={url:'${env.SUPABASE_URL}'};window.MINIHOMPY_HOME_DATA_CONFIG={enabled:true,supabaseUrl:MINIHOMPY_SUPABASE.url,homepage:'https://home.test/'};${browserBackend}</script>`);
  }
  return route.fulfill({body,contentType:({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));let accept=true;page.on('dialog',d=>accept?d.accept():d.dismiss());
 const home=async()=>{await page.evaluate(()=>{MinihompyApp.renderView('home');dispatchEvent(new Event('minihompy:content-changed'));});await page.waitForFunction(()=>document.querySelector('.home-activity')?.dataset.status==='ready');};
 await page.goto('https://home.test/');await page.locator('.home-activity-empty').waitFor();await page.waitForFunction(()=>document.querySelector('.visit-count')?.dataset.status==='ready');assert.equal((await stats()).total,1);
 const folders={};for(const [kind,table] of [['board','board_folders'],['photos','photo_folders'],['diary','diary_folders']])folders[kind]=(await run(()=>pg.query(`select id from public.${table} where ${kind==='photos'?"kind='folder'":'true'} limit 1`))).rows[0].id;
 await page.evaluate(()=>setActor('owner'));
 const privateId=id(50);await page.evaluate(async id=>MinihompyGuestbookRepository.save({id,body:'PRIVATE SENTINEL',visibility:'private',name:'Owner'}),privateId);
 await page.evaluate(async id=>MinihompyCommentsRepository.save('guestbook',id,{id:crypto.randomUUID(),name:'Owner',body:'PRIVATE COMMENT'}),privateId);
 await home();assert.equal(await page.locator('.home-post-link').count(),0);assert.equal(await page.locator('.home-today-comments').textContent(),'오늘 댓글 0');
 const parents={board:id(10),photos:id(11),diary:id(12),guestbook:id(13)};
 await page.evaluate(async({parents,folders})=>{
  await MinihompyBoardRepository.save({requestId:parents.board,folder_id:folders.board,title:'BOARD PUBLIC',body:'board body'});
  await MinihompyPhotosRepository.save({id:parents.photos,folder_id:folders.photos,title:'PHOTO PUBLIC',body:[{type:'image',path:parents.photos+'/'+crypto.randomUUID()+'.png'},{type:'text',text:'photo text'}]});
  await MinihompyDiaryRepository.save({id:parents.diary,folder_id:folders.diary,entry_date:'2001-02-03',entry_time:'12:00',weather:'',body:'DIARY PUBLIC'});
  await MinihompyGuestbookRepository.save({id:parents.guestbook,name:'Owner',body:'GUEST PUBLIC',visibility:'public'});
  for(const kind of Object.keys(parents))await MinihompyCommentsRepository.save(kind,parents[kind],{id:crypto.randomUUID(),name:'Owner',body:'PUBLIC COMMENT '+kind});
 },{parents,folders});
 await home();assert.equal(await page.locator('.home-post-link').count(),4);assert.equal(await page.locator('.home-today-comments').textContent(),'오늘 댓글 4');
 for(const actor of ['anon','A','B','owner']){await page.evaluate(actor=>setActor(actor),actor);await page.waitForFunction(()=>document.querySelector('.home-activity')?.dataset.status==='ready');const res=responses.at(-1).data;assert.equal(res.today_comments,4);assert.equal(res.recent.length,4);assert.ok(!JSON.stringify(res).includes(privateId));assert.ok(!(await page.locator('.home-activity').innerHTML()).includes('PRIVATE'));}
 await page.screenshot({path:resolve(out,`integrated-${width}.png`)});
 for(const kind of Object.keys(parents)){
  const link=page.locator(`.home-post-link[href^="#/${kind}?"]`);await link.focus();await page.keyboard.press('Enter');const target=page.locator(`[data-${kind==='diary'?'entry':'post'}="${parents[kind]}"]`);await target.waitFor();await target.locator('[data-comment]').filter({hasText:'PUBLIC COMMENT '+kind}).waitFor().catch(async e=>{console.log(await target.innerText(),errors);throw e;});await home();
 }
 console.log(`PASS ${width}: real SQL/browser create four posts/comments → public home → real destination/comments; empty/private-only and anonymous/A/B/owner parity`);
 await page.evaluate(()=>MinihompyApp.renderView('board'));await page.locator('.board-write').click();await page.locator('#board-edit-title').fill('DRAFT');accept=false;const before=page.url();await page.locator('[data-menu=photos]').click();assert.notEqual(page.url(),before);await page.evaluate(()=>MinihompyApp.renderView('board'));assert.equal(await page.locator('#board-edit-title').count(),0);accept=true;await home();
 await page.locator('.home-post-link[href^="#/board?"]').click();await page.locator('.board-post-title').waitFor();await page.goBack();await page.locator('.home-post-link').first().waitFor();await page.goForward();await page.locator('.board-post-title').waitFor();await page.reload();await page.locator('.board-post-title').waitFor();await home();assert.equal((await stats()).total,1);
 const peers=await Promise.all([context.newPage(),context.newPage()]);await Promise.all(peers.map(async peer=>{await peer.goto('https://home.test/');await peer.waitForFunction(()=>document.querySelector('.visit-count')?.dataset.status==='ready');}));assert.equal((await stats()).total,1);await Promise.all(peers.map(peer=>peer.close()));
 const blocked=await context.newPage();await blocked.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw Error('blocked');}}));await blocked.goto('https://home.test/');await blocked.waitForFunction(()=>document.querySelector('.visit-count')?.dataset.status==='ready');assert.equal((await stats()).total,1);await blocked.close();
 now='2026-09-23T15:00:00Z';await page.reload();await page.waitForFunction(()=>document.querySelector('.visit-count')?.dataset.status==='ready');assert.equal((await stats()).total,2);
 now=new Date(Date.parse(now)+4*86400000).toISOString();await page.reload();await page.waitForFunction(()=>document.querySelector('.visit-count')?.dataset.status==='ready');assert.equal((await stats()).total,3);assert.equal((await run(()=>pg.query('select count(*) from private.visit_keys'))).rows[0].count,1);
 console.log(`PASS ${width}: menu draft discard, history/reload, same-browser tabs, blocked storage, server day and dedup cleanup preserve TOTAL`);
 await home();offline=true;await page.evaluate(()=>dispatchEvent(new Event('focus')));await page.locator('.home-activity-retry').waitFor();assert.equal(await page.locator('.home-post-link').count(),0);offline=false;await page.locator('.home-activity-retry').click();await page.waitForFunction(()=>document.querySelector('.home-activity')?.dataset.status==='ready');
 hold=true;await page.evaluate(()=>dispatchEvent(new Event('focus')));await page.waitForTimeout(100);assert.ok(release);await page.locator('[data-menu=board]').click();release();release=null;await page.locator('.board-table tbody tr').first().waitFor();await home();
 await page.evaluate(()=>setActor('owner'));
 await page.evaluate(async id=>{const row=(await MinihompyBackend.getClient().from('guestbook_posts').select('*').eq('id',id).maybeSingle()).data;await MinihompyGuestbookRepository.makePrivate(row);},parents.guestbook);await home();assert.equal(await page.locator('.home-post-link').count(),3);assert.equal(await page.locator('.home-today-comments').textContent(),'오늘 댓글 3');
 for(const [kind,table] of [['board','board_posts'],['photos','photo_posts'],['diary','diary_entries'],['guestbook','guestbook_posts']]){
  await page.evaluate(async({kind,table,id})=>{const row=(await MinihompyBackend.getClient().from(table).select('*').eq('id',id).maybeSingle()).data;const repo={board:MinihompyBoardRepository,photos:MinihompyPhotosRepository,diary:MinihompyDiaryRepository,guestbook:MinihompyGuestbookRepository}[kind];await repo.remove(row);},{kind,table,id:parents[kind]});await home();assert.equal(await page.locator(`.home-post-link[href*="${parents[kind]}"]`).count(),0);
 }
 assert.equal(await page.locator('.home-post-link').count(),0);assert.equal(await page.locator('.home-today-comments').textContent(),'오늘 댓글 0');assert.deepEqual(errors,[]);
 console.log(`PASS ${width}: outage/retry and late response isolation; four real repository deletes cascade comments and clear home`);
 }finally{release?.();await context.close();await pg.close();}
}}finally{await browser.close();}
