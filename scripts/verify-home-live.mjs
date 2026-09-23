// Explicit production read/visit verification. No content bodies or credentials logged.
import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
if(process.env.MINIHOMPY_LIVE_HOME!=='1')throw Error('MINIHOMPY_LIVE_HOME=1 required');
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
const homes=['https://henry-phd-finance.github.io/minihompy/','https://henry-hs-jung.github.io/minihompy/'];const results=[];
try{for(const [index,home] of homes.entries()){
 const context=await browser.newContext({viewport:{width:1280,height:820}}),page=await context.newPage();page.setDefaultTimeout(45000);
 try{
  await page.goto(home);await page.waitForFunction(()=>MinihompySharedIdentity?.state.status==='anonymous');
  const ready=()=>page.waitForFunction(()=>document.querySelector('.home-activity')?.dataset.status==='ready'&&document.querySelector('.visit-count')?.dataset.status==='ready');await ready();
  const data=await page.evaluate(()=>MinihompyHomeRepository.summary());
  const shown=await page.locator('.home-post-link').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
  assert.deepEqual(shown,data.recent.map(r=>`#/${r.kind}?post=${r.id}`));
  for(const kind of data.menus)assert.equal(await page.locator(`.home-activity [data-kind=${kind}] dd`).textContent(),`${data.counts[kind].today} / ${data.counts[kind].total}`);
  assert.equal(await page.locator('.home-today-comments').textContent(),'오늘 댓글 '+data.today_comments);
  for(const item of data.recent){
   await page.locator(`.home-post-link[href="#/${item.kind}?post=${item.id}"]`).click();
   await page.locator(`[data-${item.kind==='diary'?'entry':'post'}="${item.id}"]`).waitFor();
   await page.locator('[data-menu=home]').click();await ready();
  }
  // Also open the newest public item of each kind, even if outside the overall top five.
  const kinds=[];
  for(const kind of ['board','photos','diary','guestbook']){
   const summary=await page.evaluate(kind=>MinihompyHomeRepository.summary([kind]),kind);if(!summary.recent.length)continue;
   const id=summary.recent[0].id;await page.goto(home+`#/${kind}?post=${id}`);await page.locator(`[data-${kind==='diary'?'entry':'post'}="${id}"]`).waitFor();kinds.push(kind);
  }
  await page.goto(home);await ready();
  const probe=()=>page.evaluate(async()=>{
   const c=MINIHOMPY_HOME_DATA_CONFIG,key=localStorage.getItem('minihompy:visit:v1:'+c.supabaseUrl+':'+c.homepage);if(!key)throw Error('Missing durable key');
   const r=await fetch(c.supabaseUrl+'/functions/v1/visit-counts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({browser_key:key})});if(!r.ok)throw Error('Visit probe failed');const value=await r.json();return {counted:value.counted,today:value.today,total:value.total};
  });
  const before=await probe();assert.equal(before.counted,false);await page.reload();await ready();const after=await probe();assert.equal(after.counted,false);
  // Same context/new tab keeps the same browser storage key.
  const tab=await context.newPage();await tab.goto(home);await tab.waitForFunction(()=>document.querySelector('.visit-count')?.dataset.status==='ready');await tab.close();assert.equal((await probe()).counted,false);
  results.push({site:index?'B':'A',recentLinks:shown.length,kinds,counts:data.counts,todayComments:data.today_comments,reloadDeduplicated:true,newTabDeduplicated:true,visitsBefore:before,visitsAfter:after});
  console.log('PASS: '+(index?'B':'A')+' real home counts/recent links/direct content addresses, reload and new-tab visit deduplication');
 }finally{await context.close();}
}
 await writeFile(new URL('../docs/verification/home-data-step7/home-live.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),results},null,2)+'\n');
}finally{await browser.close();}
