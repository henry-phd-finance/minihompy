(() => {
  'use strict';
  const bindings = new Set(), queued = new Set(), controllers = new Set();
  let generation = 0, timer;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function paint(binding, status, profile) {
    binding.root.dataset.status = status;
    for (const link of [binding.name,binding.house]) {
      link.removeAttribute('href'); link.tabIndex = profile ? 0 : -1;
      link.setAttribute('aria-disabled',String(!profile));
      if (profile) link.href = profile.homepage_url;
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
    const batch = [...queued].filter(b => b.root.isConnected); queued.clear();
    const stamp = generation;
    const versions = new Map(batch.map(b=>[b,b.version]));
    const current = b => b.root.isConnected && b.version === versions.get(b);
    const ids = [...new Set(batch.map(b=>b.id))];
    const config = window.MINIHOMPY_VISITOR_IDENTITY_CONFIG;
    if (!config?.enabled || !(config.centralApiUrl || config.centralUrl)) { batch.forEach(b=>paint(b,'unavailable')); return; }
    // Keep requests bounded even if several independent comment widgets render together.
    for (let start=0;start<ids.length;start+=50) {
      if (stamp !== generation) return;
      const selected = ids.slice(start,start+50), group = batch.filter(b=>selected.includes(b.id));
      const controller = new AbortController(); controllers.add(controller);
      const timeout = setTimeout(()=>controller.abort(),config.navigationTimeoutMs || 8000);
      try {
        const response = await fetch(`${(config.centralApiUrl || config.centralUrl).replace(/\/$/,'')}/navigation/members?member_ids=${encodeURIComponent(selected.join(','))}`,{signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store'});
        if (!response.ok) throw Error('Lookup failed');
        const data = await response.json();
        if (!Array.isArray(data.items) || data.items.length > selected.length) throw Error('Invalid response');
        const profiles = new Map();
        for (const row of data.items) {
          const p = window.parseMinihompyNavigationProfile(row);
          if (!selected.includes(p.id) || profiles.has(p.id)) throw Error('Unexpected member');
          profiles.set(p.id,p);
        }
        if (stamp !== generation) return;
        for (const binding of group) if (current(binding)) paint(binding,profiles.has(binding.id)?'ready':'unavailable',profiles.get(binding.id));
      } catch {
        if (stamp === generation) for (const binding of group) if (current(binding)) paint(binding,'error');
      } finally {clearTimeout(timeout);controllers.delete(controller);}
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
    retry.addEventListener('click',()=>{for(const b of bindings)if(b.id===binding.id&&b.root.isConnected)queue(b);});
    bindings.add(binding);queue(binding); return root;
  }
  function invalidate() {
    generation++; for(const c of controllers)c.abort();controllers.clear();
    queued.clear();
    for(const b of bindings) {if(!b.root.isConnected)bindings.delete(b);else queue(b);}
  }
  // Public profiles are fetched again; no historical URL or persistent profile cache is used.
  for(const event of ['minihompy:visitor-identity','minihompy:navigation-invalidate','minihompy:writing-reset'])window.addEventListener(event,invalidate);
  window.addEventListener('storage',e=>{if(e.key===null||e.key===`minihompy.writing.pending:${window.MINIHOMPY_VISITOR_IDENTITY_CONFIG?.siteId}:change`)invalidate();});
  new MutationObserver(()=>{for(const b of bindings)if(!b.root.isConnected){bindings.delete(b);queued.delete(b);}}).observe(document.documentElement,{childList:true,subtree:true});
  window.MinihompyAuthorNavigation = Object.freeze({create});
})();
