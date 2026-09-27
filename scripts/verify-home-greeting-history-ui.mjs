import assert from 'node:assert/strict';import {readFile,mkdir} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2]))),out='/tmp/home-greeting-history-ui';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
try{for(const width of [1280,375]){
 let entries=Array.from({length:12},(_,i)=>({id:String(i+1),body:i===0?'첫 줄\n<script>안전한 텍스트</script>':'인삿말 '+i,recorded_at:'2026-09-27T01:00:00Z',is_initial:i===11})),fail=false,loseDelete=false,allowDelete=true;
 const page=await browser.newPage({viewport:{width,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://history.test/**',async route=>{
  const req=route.request(),u=new URL(req.url());if(u.pathname==='/api/history'){
   if(req.method()==='DELETE'){if(!allowDelete)return route.fulfill({json:{data:[]}});entries=entries.filter(x=>x.id!==u.searchParams.get('id'));return route.fulfill({json:loseDelete?{error:'lost ACK'}:{data:[{id:u.searchParams.get('id')}]}});}
   return route.fulfill({json:fail?{error:'unavailable'}:{data:entries.slice(Number(u.searchParams.get('start')),Number(u.searchParams.get('end'))+1)}});
  }
  return route.fulfill({contentType:'text/html',body:'<div class="minihompy"><div class="profile-panel"></div></div><div class="comments-widget"><p class="photo-comment">댓글 첫 줄<br>둘째 줄 <time class="photo-comment-date">(오늘)</time><span class="comment-actions"><button>삭제</button></span></p><p class="photo-comment">다음 댓글</p></div>'});
 });
 await page.goto('https://history.test/');await page.addStyleTag({content:await readFile('styles.css','utf8')});
 await page.evaluate(()=>{
  window.MINIHOMPY_VIEWS={};window.MinihompyAdmin={state:{role:'visitor'}};
  window.createMinihompyIdentity=()=>({current:async()=>MinihompyAdmin.state});
  window.MinihompyBackend={getClient:()=>({from:()=>{
   let deleting=false,id,start,end;const q={delete:()=>{deleting=true;return q;},eq:(_k,v)=>{id=v;return q;},select:()=>deleting?fetch('/api/history?id='+id,{method:'DELETE'}).then(r=>r.json()):q,order:()=>q,range:(a,b)=>{start=a;end=b;return q;},abortSignal:signal=>fetch('/api/history?start='+start+'&end='+end,{signal}).then(r=>r.json())};return q;
  }})};
 });
 await page.addScriptTag({content:await readFile('home-profile-history.js','utf8')});await page.addScriptTag({content:await readFile('views/home.js','utf8')});await page.evaluate(()=>document.querySelector('.profile-panel').append(MINIHOMPY_VIEWS.home.createLeft()));
 const history=page.locator('[data-home-profile-history]'),dialog=page.locator('.greeting-history-dialog'),items=dialog.locator('li');
 await history.click();await page.waitForFunction(()=>document.querySelectorAll('.greeting-history-list li').length===10);assert.equal(await dialog.getByRole('button',{name:'삭제',exact:true}).count(),0);assert.equal(await items.locator('script').count(),0);assert((await items.first().innerText()).includes('<script>'));
 await dialog.getByRole('button',{name:'다음',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.greeting-history-list li').length===2);assert((await dialog.innerText()).includes('기록 시작'));await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert(await history.evaluate(e=>e===document.activeElement));
 await page.evaluate(()=>{MinihompyAdmin.state={role:'admin',userId:'owner'};dispatchEvent(new CustomEvent('minihompy:identity'));});await history.click();await items.first().waitFor();await dialog.getByRole('button',{name:'삭제',exact:true}).first().click();await dialog.getByRole('button',{name:'취소',exact:true}).click();assert.equal(entries.length,12);
 await dialog.getByRole('button',{name:'삭제',exact:true}).first().click();await dialog.getByRole('button',{name:'삭제 확인',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.greeting-history-list li p')?.textContent==='인삿말 1');assert.equal(entries.length,11);
 loseDelete=true;await dialog.getByRole('button',{name:'삭제',exact:true}).first().click();await dialog.getByRole('button',{name:'삭제 확인',exact:true}).click();await dialog.getByRole('status').filter({hasText:'결과를 확인'}).waitFor();assert.equal(entries.length,10);loseDelete=false;await dialog.getByRole('button',{name:'다시 불러오기'}).click();await page.waitForFunction(()=>document.querySelector('.greeting-history-list li p')?.textContent==='인삿말 2');
 await page.screenshot({path:out+'/owner-'+width+'.png'});assert(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth));
 await page.evaluate(()=>{MinihompyAdmin.state={role:'visitor'};dispatchEvent(new CustomEvent('minihompy:identity'));});await dialog.waitFor({state:'detached'});
 fail=true;await history.click();await dialog.getByRole('status').filter({hasText:'불러오지 못'}).waitFor();fail=false;await dialog.getByRole('button',{name:'다시 불러오기'}).click();await items.first().waitFor();
 await page.evaluate(()=>dispatchEvent(new CustomEvent('minihompy:menu-leave',{detail:{id:'home'}})));await dialog.waitFor({state:'detached'});
 assert(await page.locator('.photo-comment').first().evaluate(e=>{const s=getComputedStyle(e);return Math.abs(parseFloat(s.lineHeight)/parseFloat(s.fontSize)-1.2)<.01&&parseFloat(s.marginBottom)===0;}));assert.deepEqual(errors,[]);
 console.log(`PASS ${width}px public history, safe multiline content, pages, owner delete/cancel/ACK recovery, identity/menu cleanup and 1.2 comment leading.`);await page.close();
}}finally{await browser.close();}
