// Only endpoint categories, timings, byte counts and anonymous within-sample groups are exported.
export function category(raw){const u=new URL(raw),p=u.pathname;
 if(/\.(js|css|woff2)$/.test(p))return 'static:'+p.split('/').at(-1);
 if(p.endsWith('/visit-counts'))return 'visits';
 if(p.includes('/auth/v1/'))return 'auth';
 const m=p.match(/\/functions\/v1\/(?:member-writing|photo-media)\/(content\/[a-z-]+|relationships\/[a-z-]+|sessions\/[a-z-]+|friend-reviews(?:\/[a-z-]+)?|read|health)$/);if(m)return m[1]==='read'?'photo/read':m[1];
 const n=p.match(/\/identity-api\/(navigation\/[a-z-]+|relationships\/[a-z-]+|[a-z-]+\/[a-z-]+)$/);if(n)return 'central/'+n[1];
 const t=p.match(/\/rest\/v1\/(?:rpc\/)?([a-z_]+)$/);if(t)return 'db/'+t[1];return null;
}
export function collect(page){let start=Date.now();const rows=[],map=new Map(),jobs=[];
 const begin=req=>{const c=category(req.url());if(!c)return;const r={category:c,method:req.method(),startMs:Date.now()-start};rows.push(r);map.set(req,r);};
 const end=req=>{const row=map.get(req);if(!row)return;jobs.push((async()=>{row.endMs=Date.now()-start;row.durationMs=row.endMs-row.startMs;try{row.status=(await req.response())?.status();const s=await req.sizes();row.responseBodyBytes=s.responseBodySize;row.responseHeaderBytes=s.responseHeadersSize;}catch{row.bytesUnavailable=true;}})());};
 const failed=req=>{const r=map.get(req);if(r){r.endMs=Date.now()-start;r.failed=true;}};
 page.on('request',begin);page.on('requestfinished',end);page.on('requestfailed',failed);
 return {elapsed:()=>Date.now()-start,async finish(){page.off('request',begin);page.off('requestfinished',end);page.off('requestfailed',failed);await Promise.allSettled(jobs);for(const r of rows)if(r.endMs===undefined)r.pendingAtEnd=true;return {requestCount:rows.length,responseBodyBytes:rows.reduce((n,r)=>n+(r.responseBodyBytes||0),0),counts:Object.fromEntries([...new Set(rows.map(r=>r.category))].sort().map(k=>[k,rows.filter(r=>r.category===k).length])),requests:rows};}};
}
export async function homeSample(page,action,{timeout=90000}={}){
 const collector=collect(page),marks={summaryMs:null,relationshipMs:null,reviewInputMs:null,authorsMs:null};let done=false,previousActivity=Date.now();
 const activity=()=>{previousActivity=Date.now();};page.on('request',activity);
 try{
  await action();
  while(collector.elapsed()<timeout){let s;try{s=await page.evaluate(()=>({
   summary:document.querySelector('.home-activity')?.dataset.status,
   relationship:document.querySelector('#relationship-summary')?.textContent,
   identified:window.MinihompySharedIdentity?.state.status==='identified',
   self:window.MinihompyNavigation?.state.status==='self',
   review:!!document.querySelector('[data-review-action=save]')&&!document.querySelector('[data-review-action=save]').hidden&&!document.querySelector('[data-review-action=save]').disabled,
   authors:document.querySelectorAll('.author-navigation').length,
   loadingAuthors:document.querySelectorAll('.author-navigation[data-status=loading]').length,
   listReady:document.querySelector('.friend-reviews')?.getAttribute('aria-busy')==='false'
  }));}catch(e){if(/Execution context was destroyed|Cannot find context|navigation/.test(e.message)){await new Promise(r=>setTimeout(r,50));continue;}throw e;}const ms=collector.elapsed();if(s.summary==='ready')marks.summaryMs??=ms;
   if(s.relationship&&!s.relationship.includes('확인 중'))marks.relationshipMs??=ms;
   if(s.review)marks.reviewInputMs??=ms;
   if(s.authors&&!s.loadingAuthors&&s.listReady)marks.authorsMs??=ms;
   if(s.summary==='ready'&&marks.relationshipMs!==null&&s.listReady&&!s.loadingAuthors&&Date.now()-previousActivity>=1200){done=true;break;}
   await new Promise(r=>setTimeout(r,50));
  }
  return {...marks,settled:done,totalMs:collector.elapsed(),...(await collector.finish())};
 }finally{page.off('request',activity);if(!done)await collector.finish();}
}
