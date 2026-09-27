import assert from 'node:assert/strict';import {readFile,mkdir,writeFile} from 'node:fs/promises';import {resolve,extname} from 'node:path';import {pathToFileURL} from 'node:url';import {initialSettings} from './settings-fixture.mjs';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2]))),out=resolve(process.env.VERIFICATION_DIR||'/tmp/home-profile-step2');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});const jpg=await readFile('assets/photos/lake.jpg');
let count=0;
try{for(const width of [1280,375]){
 let row={payload:structuredClone(initialSettings),revision:1},allowOwner=true,failUpload=false,loseSave=false,hold=false,release,patches=0;const objects=new Map();
 const page=await browser.newPage({viewport:{width,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://home.test/**',async route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.pathname==='/data/settings'){
   if(req.method()==='PATCH'){
    if(!allowOwner)return route.fulfill({status:403,json:{message:'denied'}});
    if(Number(u.searchParams.get('revision'))!==row.revision)return route.fulfill({json:{data:null}});
    const payload=req.postDataJSON().payload;if(payload.profile.imagePath&&!objects.has(payload.profile.imagePath))return route.fulfill({status:400,json:{message:'missing image'}});
    row={payload,revision:row.revision+1};patches++;if(loseSave){loseSave=false;return route.fulfill({status:503,json:{message:'lost response'}});}
   }
   return route.fulfill({json:{data:row}});
  }
  if(u.pathname.startsWith('/objects/')){
   const path=u.pathname.slice(9);if(hold)await new Promise(r=>release=r);
   if(!allowOwner)return route.fulfill({status:403,json:{message:'denied'}});
   if(req.method()==='POST'){
    if(failUpload)return route.fulfill({status:400,json:{statusCode:'400'}});
    if(objects.has(path))return route.fulfill({status:409,json:{statusCode:'409'}});
    objects.set(path,req.postDataBuffer());return route.fulfill({json:{}});
   }
   if(req.method()==='DELETE'){if(row.payload.profile.imagePath!==path)objects.delete(path);return route.fulfill({json:{}});}
   return route.fulfill({body:objects.get(path),contentType:'image/jpeg'});
  }
  if(u.pathname.startsWith('/images/'))return route.fulfill({body:objects.get(u.pathname.slice(8))||jpg,contentType:'image/jpeg'});
  const file=u.pathname.slice(1)||'index.html';
  if(file==='index.html'){
   let html=(await readFile(file,'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
   const setup=`
    window.MinihompyAdmin={state:{role:'${allowOwner?'admin':'reader'}',userId:${allowOwner?'"owner"':'null'}}};
    window.createMinihompyIdentity=()=>({current:async()=>MinihompyAdmin.state});window.MINIHOMPY_VIEWS={};
    const fetchResult=async(url,init)=>{const r=await fetch(url,init),b=await r.json();return r.ok?b:{error:{...b,statusCode:String(r.status)}};};
    window.MinihompyBackend={getClient:()=>({
     from:()=>{let value,revision;const q={select:()=>q,eq:(key,v)=>{if(key==='revision')revision=v;return q;},update:v=>{value=v;return q;},maybeSingle:()=>fetchResult('/data/settings'+(revision?'?revision='+revision:''),value?{method:'PATCH',body:JSON.stringify(value)}:undefined)};return q;},
     storage:{from:()=>({getPublicUrl:p=>({data:{publicUrl:'https://home.test/images/'+p}}),upload:async(p,f)=>fetchResult('/objects/'+p,{method:'POST',body:f}),download:async p=>({data:await (await fetch('/objects/'+p)).blob()}),remove:async ps=>{for(const p of ps)await fetchResult('/objects/'+p,{method:'DELETE'});return {data:[]};}})}
    })};`;
   const scripts=['config.js','content.js','post-routes.js','home-profile-data.js','home-profile.js','views/home.js'];
   html=html.replace('</head>',`<script>${setup}</script>`+scripts.map(f=>`<script src="/${f}"></script>`).join('')+`<script>MINIHOMPY_VIEWS.diary={label:'다이어리',createLeft:()=>document.createDocumentFragment(),createMain:()=>document.createDocumentFragment()};</script><script src="/app.js" defer></script></head>`);
   return route.fulfill({contentType:'text/html',body:html});
  }
  try{return route.fulfill({body:await readFile(file),contentType:({'.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'})[extname(file)]});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('https://home.test/#/home');const edit=page.locator('[data-home-profile-edit]'),dialog=page.locator('.home-profile-dialog'),greeting=dialog.locator('textarea'),file=dialog.locator('input[type=file]');
 const open=async()=>{await edit.click();await dialog.waitFor();};const save=async()=>{await dialog.getByRole('button',{name:'저장',exact:true}).click();};
 await open();await greeting.fill('새 인사말\n<b>안녕하세요</b>');await file.setInputFiles({name:'photo.jpg',mimeType:'image/jpeg',buffer:jpg});await page.waitForFunction(()=>!document.querySelector('.home-profile-dialog button[type=submit]').disabled&&document.querySelector('.home-profile-dialog img').src.startsWith('blob:'));
 await dialog.screenshot({path:resolve(out,`editor-${width}.png`)});assert(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth));await save();await dialog.waitFor({state:'detached'});
 assert.equal(patches,1);assert.equal(row.payload.profile.introduction,'새 인사말\n<b>안녕하세요</b>');assert.equal(await page.locator('.profile-status b').count(),0);const first=row.payload.profile.imagePath;assert(objects.has(first));await page.reload();await page.locator('.profile-image-slot img').waitFor();assert.equal(await page.locator('.profile-status').textContent(),row.payload.profile.introduction);
 allowOwner=false;await page.reload();await page.locator('.profile-image-slot img').waitFor();assert.equal(await edit.isVisible(),false);assert((await page.locator('.profile-image-slot img').getAttribute('src')).endsWith(first));assert.equal(await page.locator('.profile-status').textContent(),row.payload.profile.introduction);allowOwner=true;await page.reload();await edit.waitFor();
 console.log(`PASS ${++count}: ${width}px owner edit, decoded preview, atomic settings save, safe multiline greeting, reload persistence`);
 await open();await file.setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});await dialog.getByRole('status').filter({hasText:'6MB'}).waitFor();assert.equal(row.payload.profile.imagePath,first);await dialog.getByRole('button',{name:'취소',exact:true}).click();
 await open();await file.setInputFiles({name:'next.jpg',mimeType:'image/jpeg',buffer:jpg});await page.waitForFunction(()=>!document.querySelector('.home-profile-dialog button[type=submit]').disabled);failUpload=true;await save();await dialog.getByRole('status').filter({hasText:'저장하지 못'}).waitFor();assert.equal(row.payload.profile.imagePath,first);failUpload=false;await save();await dialog.waitFor({state:'detached'});await page.waitForTimeout(100);assert(!objects.has(first));
 console.log(`PASS ${++count}: ${width}px invalid image denied, upload failure retains draft, retry and old image cleanup`);
 await open();const other=structuredClone(row);other.payload.page.title='다른 창 제목';row={...other,revision:row.revision+1};await greeting.fill('충돌 초안');await save();await dialog.getByRole('status').filter({hasText:'저장하지 못'}).waitFor();assert.equal(row.payload.page.title,'다른 창 제목');assert.equal(await greeting.inputValue(),'충돌 초안');await dialog.getByRole('button',{name:'다시 불러오기'}).click();await page.waitForFunction(()=>document.querySelector('.home-profile-dialog textarea')?.value!=='충돌 초안');await greeting.fill('응답 유실에도 저장됨');loseSave=true;await save();await dialog.getByRole('status').filter({hasText:'저장하지 못'}).waitFor();await dialog.getByRole('button',{name:'다시 불러오기'}).click();await page.waitForFunction(()=>document.querySelector('.home-profile-dialog textarea')?.value==='응답 유실에도 저장됨'&&!document.querySelector('.home-profile-dialog button[type=submit]').disabled);
 await dialog.getByRole('button',{name:'기본 캐릭터로'}).click();await save();await dialog.waitFor({state:'detached'});assert.equal(row.payload.profile.imagePath,'');assert.equal(await page.locator('.profile-image-slot.reference-sprite').count(),1);
 console.log(`PASS ${++count}: ${width}px stale revision never overwrites concurrent settings, lost response reload, reset image`);
 await open();await greeting.fill('폐기할 초안');await page.evaluate(()=>{location.hash='#/diary';});await dialog.waitFor({state:'detached'});await page.locator('[data-menu=home]').click();await open();assert.notEqual(await greeting.inputValue(),'폐기할 초안');
 await file.setInputFiles({name:'pending.jpg',mimeType:'image/jpeg',buffer:jpg});await page.waitForFunction(()=>!document.querySelector('.home-profile-dialog button[type=submit]').disabled);hold=true;await save();while(!release)await new Promise(r=>setTimeout(r,10));allowOwner=false;await page.evaluate(()=>{MinihompyAdmin.state={role:'reader',userId:null};dispatchEvent(new Event('minihompy:identity'));});hold=false;release();await dialog.waitFor({state:'detached'});await page.waitForTimeout(100);assert.equal(row.payload.profile.imagePath,'');await page.reload();await page.locator('.profile-status').waitFor();assert.equal(await edit.isVisible(),false);assert.equal(await page.locator('.profile-status').textContent(),'응답 유실에도 저장됨');assert.deepEqual(errors,[]);
 await page.screenshot({path:resolve(out,`visitor-${width}.png`)});console.log(`PASS ${++count}: ${width}px menu discard, identity switch blocks pending save, visitor reads without edit controls`);await page.close();
}await writeFile(resolve(out,'results.json'),JSON.stringify({passed:true,groups:count},null,2));}finally{await browser.close();}
