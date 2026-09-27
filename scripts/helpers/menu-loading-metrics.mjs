// Read-only timing: stores only allowlisted endpoint names, status and timing, never payloads or URLs.
export function endpoint(raw) {
 const p=new URL(raw).pathname;
 return p.match(/\/(?:auth\/v1\/user|rest\/v1\/(?:rpc\/is_minihompy_admin|diary_folders|photo_folders|post_comments|photo_posts)|functions\/v1\/(?:member-writing\/(?:content\/(?:health|list|calendar|detail|location|photo-check)|sessions\/(?:current|renew))|photo-media\/read))$/)?.[0] || null;
}
export async function measureMenu(page,menu,{timeout=90000}={}) {
 const requests=[],pending=new Map();let start;
 const began=req=>{const path=endpoint(req.url());if(path){const row={path,method:req.method(),startMs:Date.now()-start};requests.push(row);pending.set(req,row);}};
 const ended=async req=>{const row=pending.get(req);if(!row)return;row.endMs=Date.now()-start;row.durationMs=row.endMs-row.startMs;row.status=(await req.response())?.status()??null;};
 const failed=req=>{const row=pending.get(req);if(row){row.endMs=Date.now()-start;row.failed=true;}};
 await page.evaluate(menu=>{
  const m={menu,start:performance.now(),firstBodyMs:null,firstPhotoMs:null,allPhotosMs:null,settledMs:null,calendarReadyMs:null,empty:false,error:false,photoCount:0};window.__menuMetric=m;
  const visible=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight;};
  function frame(){if(window.__menuMetric!==m)return;const ms=Math.round(performance.now()-m.start),root=document.querySelector(menu==='diary'?'#diary-content':'#photos-content');if(root){
   const error=root.querySelector('.diary-retry,.photo-retry,.photo-image-retry,.photo-post-retry');if(error){m.error=true;m.settledMs=ms;return;}
   const body=root.querySelector(menu==='diary'?'.diary-entry-body':'.photo-post');
   const empty=[...root.querySelectorAll('.diary-empty,.photo-empty')].some(e=>/등록된.*없습니다/.test(e.textContent));
   if((body&&visible(body)||empty)&&m.firstBodyMs===null){m.firstBodyMs=ms;m.empty=empty;}
   const imgs=[...root.querySelectorAll('.photo-image')];m.photoCount=imgs.length;
   if(imgs.some(i=>i.complete&&i.naturalWidth&&visible(i))&&m.firstPhotoMs===null)m.firstPhotoMs=ms;
   const slots=[...root.querySelectorAll('.photo-image-slot')],photosReady=slots.every(s=>s.dataset.state==='ready');
   if(imgs.length&&photosReady&&imgs.every(i=>i.complete&&i.naturalWidth))m.allPhotosMs??=ms;
   const calendar=document.querySelector('.diary-calendar');const calendarReady=!calendar?.dataset.status||calendar.dataset.status==='ready';
   if(menu==='diary'&&calendarReady&&m.firstBodyMs!==null)m.calendarReadyMs??=ms;
   if(m.firstBodyMs!==null&&(menu==='diary'&&calendarReady||menu!=='diary'&&(empty||imgs.length&&m.allPhotosMs!==null||root.querySelector('.photo-post')&&!imgs.length&&!slots.length))){m.settledMs=ms;return;}
  }requestAnimationFrame(frame);}requestAnimationFrame(frame);
 },menu);
 start=Date.now();page.on('request',began);page.on('requestfinished',ended);page.on('requestfailed',failed);
 try{
  await page.locator(`[data-menu="${menu}"]`).click();
  await page.waitForFunction(()=>window.__menuMetric?.settledMs!==null,null,{timeout});
  // Frame timings include paint opportunity and decoded images, not just disappearance of a loading message.
  const result=await page.evaluate(()=>{const {start,...m}=window.__menuMetric;window.__menuMetric=null;return m;});
  await new Promise(resolve=>setImmediate(resolve));
  for(const row of requests)if(row.endMs===undefined)row.pendingAtSettle=true;
  return {...result,requests:structuredClone(requests),requestCount:requests.length};
 }finally{page.off('request',began);page.off('requestfinished',ended);page.off('requestfailed',failed);}
}
