(() => {
  'use strict';
  const bindings = new Set(), queued = new Set(), controllers = new Set();
  let generation = 0, timer, observed;
  const cache=new Map(), pending=new Map();
  const base=new URL("./",document.currentScript.src);
  const configKey=()=>JSON.stringify([window.MINIHOMPY_SUPABASE?.url,window.MINIHOMPY_VISITOR_IDENTITY_CONFIG,window.MINIHOMPY_RELEASE]);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function paint(binding, status, profile) {
    binding.root.dataset.status = status;
    for (const link of [binding.name,binding.house]) {
      link.removeAttribute('href'); link.tabIndex = profile ? 0 : -1;
      link.setAttribute('aria-disabled',String(!profile));
      if (profile) link.href = new URL('author-visit.html?member_id='+binding.id,base).href;
    }
    binding.handle.textContent = profile ? ` (@${profile.handle})` : '';
    const message = status === 'loading' ? '홈 확인 중' : status === 'error' ? '홈 확인 실패' : status === 'unavailable' ? '방문 가능한 홈 없음' : '';
    binding.status.textContent = message;
    binding.retry.hidden = status !== 'error' && status !== 'unavailable';
    binding.name.title = profile ? `${binding.name.textContent} (@${profile.handle})의 미니홈피 방문` : message;
    binding.house.setAttribute('aria-label',profile ? `${binding.name.textContent} (@${profile.handle})의 미니홈피 방문` : message);
    binding.root.dispatchEvent(new Event('minihompy:content-resize',{bubbles:true}));
  }
  function queue(binding) {
    binding.version = (binding.version || 0) + 1;
    paint(binding,'loading'); queued.add(binding);
    if (!timer) timer = setTimeout(() => { timer = null; void flush(); },0);
  }
  async function flush() {
    if(observed!==configKey()){invalidate();return;}
    const batch=[...queued].filter(b=>b.root.isConnected);queued.clear();
    const config=window.MINIHOMPY_VISITOR_IDENTITY_CONFIG, stamp=generation;
    if(!config?.enabled||!(config.centralApiUrl||config.centralUrl)){batch.forEach(b=>paint(b,'unavailable'));return;}
    const missing=[];
    for(const b of batch){
      const entry=cache.get(b.id);
      if(entry&&entry.until>Date.now()){cache.delete(b.id);cache.set(b.id,entry);paint(b,'ready',entry.profile);continue;}
      cache.delete(b.id);
      if(!pending.has(b.id)){pending.set(b.id,{listeners:new Map()});missing.push(b.id);}
      pending.get(b.id).listeners.set(b,b.version);
    }
    for(let start=0;start<missing.length;start+=50){
      const selected=missing.slice(start,start+50),entries=selected.map(id=>pending.get(id));
      const controller=new AbortController();controller.entries=entries;controllers.add(controller);
      const timeout=setTimeout(()=>controller.abort(),config.navigationTimeoutMs||8000);
      void (async()=>{
        try{
          const response=await fetch(`${(config.centralApiUrl||config.centralUrl).replace(/\/$/,'')}/navigation/members?member_ids=${encodeURIComponent(selected.join(','))}`,{signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store'});
          if(!response.ok)throw Error('Lookup failed');
          const data=await response.json(),profiles=new Map();
          if(!Array.isArray(data.items)||data.items.length>selected.length)throw Error('Invalid response');
          for(const row of data.items){const p=window.parseMinihompyNavigationProfile(row);if(!selected.includes(p.id)||profiles.has(p.id))throw Error('Unexpected member');profiles.set(p.id,p);}
          if(stamp!==generation||controller.signal.aborted)return;
          if(observed!==configKey()){invalidate();return;}
          selected.forEach((id,i)=>{
            const p=profiles.get(id);
            if(p){cache.delete(id);cache.set(id,{profile:p,until:Date.now()+30000});while(cache.size>200)cache.delete(cache.keys().next().value);}
            for(const [b,v] of entries[i].listeners)if(b.root.isConnected&&b.version===v)paint(b,p?'ready':'unavailable',p);
          });
        }catch{
          if(stamp===generation){if(observed!==configKey()){invalidate();return;}for(const entry of entries)for(const [b,v] of entry.listeners)if(b.root.isConnected&&b.version===v)paint(b,'error');}
        }finally{
          clearTimeout(timeout);controllers.delete(controller);
          selected.forEach((id,i)=>{if(pending.get(id)===entries[i])pending.delete(id);});
        }
      })();
    }
  }
  function create(record, nameClass) {
    const root = document.createElement('span'); root.className = 'author-navigation';
    if (record.author_kind !== 'member' || !uuid.test(record.author_member_id || '')) {
      const name = document.createElement('span'); name.className = nameClass; name.textContent = record.author_name;
      root.append(name); return root;
    }
    const name = document.createElement('a'); name.className = nameClass; name.textContent = record.author_name;
    const house = document.createElement('a'); house.className = 'author-home'; house.textContent = '⌂';
    const handle = document.createElement('span'); handle.className = 'author-handle';
    const status = document.createElement('span'); status.className = 'author-home-status';
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'author-home-retry'; retry.textContent = '홈 다시 확인';
    for (const link of [name,house]) {link.rel='noopener noreferrer';link.addEventListener('click',e=>{if(!link.hasAttribute('href'))e.preventDefault();});}
    root.append(name,handle,house,status,retry);
    const binding = {root,name,house,handle,status,retry,id:record.author_member_id.toLowerCase()};
    retry.addEventListener('click',invalidate);
    bindings.add(binding);queue(binding); return root;
  }
  function invalidate() {
    generation++; observed=configKey();cache.clear();pending.clear();for(const c of controllers)c.abort();controllers.clear();
    queued.clear();
    for(const b of bindings) {if(!b.root.isConnected)bindings.delete(b);else queue(b);}
  }
  // Successful public display profiles only; actual navigation always revalidates in the relay.
  for(const event of ['minihompy:visitor-identity','minihompy:navigation-invalidate','minihompy:writing-reset','minihompy:settings'])window.addEventListener(event,invalidate);
  window.addEventListener('storage',e=>{if(e.key===null||e.key===`minihompy.writing.pending:${window.MINIHOMPY_VISITOR_IDENTITY_CONFIG?.siteId}:change`)invalidate();});
  new MutationObserver(()=>{for(const b of bindings)if(!b.root.isConnected){bindings.delete(b);queued.delete(b);for(const entry of pending.values())entry.listeners.delete(b);}for(const c of controllers)if(!c.entries.some(e=>e.listeners.size)){c.abort();for(const [id,e] of pending)if(c.entries.includes(e))pending.delete(id);}}).observe(document.documentElement,{childList:true,subtree:true});
  observed=configKey();
  window.MinihompyAuthorNavigation = Object.freeze({create});
})();
