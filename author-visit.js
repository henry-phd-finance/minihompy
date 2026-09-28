(() => {
  'use strict';
  const status=document.querySelector('#visit-status'),retry=document.querySelector('#visit-retry');
  const id=new URL(location.href).searchParams.get('member_id')?.toLowerCase();
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  let job=null;
  async function visit(){
    if(job)return;
    const config=window.MINIHOMPY_VISITOR_IDENTITY_CONFIG,stamp=JSON.stringify(config);
    retry.hidden=true;status.textContent='방문할 미니홈피를 확인하고 있습니다.';
    const controller=job=new AbortController(),timer=setTimeout(()=>controller.abort(),config?.navigationTimeoutMs||8000);
    try{
      if(!uuid.test(id||'')||!config?.enabled||!(config.centralApiUrl||config.centralUrl))throw Error('Invalid configuration');
      const res=await fetch(`${(config.centralApiUrl||config.centralUrl).replace(/\/$/,'')}/navigation/members?member_ids=${encodeURIComponent(id)}`,{signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store'});
      if(!res.ok)throw Error('Unavailable');
      const data=await res.json();
      if(!Array.isArray(data.items)||data.items.length>1)throw Error('Invalid response');
      if(job!==controller||controller.signal.aborted)return;
      if(stamp!==JSON.stringify(window.MINIHOMPY_VISITOR_IDENTITY_CONFIG))throw Error('Configuration changed');
      if(!data.items.length){status.textContent='방문 가능한 등록 홈이 없습니다.';retry.hidden=false;return;}
      const profile=window.parseMinihompyNavigationProfile(data.items[0]);
      if(profile.id!==id)throw Error('Wrong member');
      location.replace(profile.homepage_url);
    }catch{if(job===controller){status.textContent='미니홈피를 확인하지 못했습니다. 다시 시도해 주세요.';retry.hidden=false;}}
    finally{clearTimeout(timer);if(job===controller)job=null;}
  }
  retry.addEventListener('click',()=>void visit());
  window.addEventListener('pagehide',()=>{job?.abort();job=null;});
  window.addEventListener('pageshow',e=>{if(e.persisted)void visit();});
  void visit();
})();
