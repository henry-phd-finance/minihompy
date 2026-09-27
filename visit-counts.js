(() => {
  'use strict';
  const root=document.querySelector('.visit-count');
  if(!root||new URLSearchParams(location.search).has('login_intent'))return; // Login-only pages never record a visit.
  const today=root.querySelector('[data-visit=today]'),total=root.querySelector('[data-visit=total]');
  const status=root.querySelector('[data-visit=status]'),retry=root.querySelector('button');
  const config=window.MINIHOMPY_HOME_DATA_CONFIG;
  let running=false,generation=0,controller,timer,nextAllowed=0;
  const enabled=config?.enabled===true && config.supabaseUrl===window.MINIHOMPY_SUPABASE?.url && config.homepage===new URL('./',location.href).href;
  function show(state,text){root.title='';root.dataset.status=state;root.setAttribute('aria-busy',String(state==='loading'));today.textContent=total.textContent='—';status.textContent=text;retry.hidden=state!=='error';}
  if(!enabled){show('disabled','준비 중');return;}
  const storageName='minihompy:visit:v1:'+config.supabaseUrl+':'+config.homepage;
  async function browserKey(signal){
    // Serialize first creation across tabs. If durable storage/locks are unavailable,
    // read statistics only; do not mint a fresh visitor on each page load.
    try{
      if(!navigator.locks)return null;
      return await navigator.locks.request(storageName,{signal},()=>{
        let key=localStorage.getItem(storageName);
        if(!/^[0-9a-f]{64}$/.test(key||'')){
          key=[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
          localStorage.setItem(storageName,key);
        }
        return localStorage.getItem(storageName)===key?key:null;
      });
    }catch{return null;}
  }
  function valid(data){
    return data?.version===1 && data.timezone==='Asia/Seoul' && /^\d{4}-\d{2}-\d{2}$/.test(data.date) && Number.isSafeInteger(data.today) && data.today>=0 && Number.isSafeInteger(data.total) && data.total>=data.today;
  }
  async function refresh(){
    if(document.visibilityState!=='visible'||running)return;
    clearTimeout(timer);
    if(Date.now()<nextAllowed){timer=setTimeout(refresh,nextAllowed-Date.now());return;}
    running=true;const current=++generation;controller=new AbortController();const signal=controller.signal;
    show('loading','집계 중');
    const requestController=controller;
    const timeout=setTimeout(()=>requestController.abort(),10000);
    try{
      const key=await browserKey(signal);
      if(current!==generation||document.visibilityState!=='visible')return;
      if(signal.aborted)throw Error('Timed out');
      const res=await fetch(config.supabaseUrl+'/functions/v1/visit-counts',{method:key?'POST':'GET',...(key?{headers:{'Content-Type':'application/json'},body:JSON.stringify({browser_key:key})}:{}),credentials:'omit',cache:'no-store',redirect:'error',signal});
      if(res.status===429)nextAllowed=Date.now()+Math.max(60,Math.min(3600,Number(res.headers.get('Retry-After'))||60))*1000;
      if(!res.ok)throw Error('Unavailable');
      const data=await res.json();if(!valid(data)||(key&&typeof data.counted!=='boolean'))throw Error('Invalid statistics');
      if(current!==generation)return;
      root.dataset.status='ready';root.setAttribute('aria-busy','false');retry.hidden=true;
      today.textContent=data.today.toLocaleString('ko-KR');total.textContent=data.total.toLocaleString('ko-KR');
      status.textContent=key?'':'조회만';root.title=`${data.date} 한국 시간 · TODAY ${data.today} / TOTAL ${data.total}`+(key?'':' · 브라우저 저장소를 사용할 수 없어 방문 기록을 생략했습니다.');
      nextAllowed=Date.now()+1000;
      const now=Date.now(),midnight=Math.floor((now+9*3600000)/86400000)*86400000+86400000-9*3600000;
      timer=setTimeout(refresh,Math.max(1000,Math.min(60000,midnight-now)));
    }catch{
      if(current!==generation)return;
      show('error','조회 실패');root.title='방문 통계를 불러오지 못했습니다. 다시 시도해 주세요.';
      nextAllowed=Math.max(nextAllowed,Date.now()+1000);
    }finally{clearTimeout(timeout);if(current===generation)running=false;}
  }
  function suspend(){generation++;controller?.abort();clearTimeout(timer);running=false;show('idle','대기 중');}
  retry.addEventListener('click',()=>void refresh());
  document.addEventListener('visibilitychange',()=>document.visibilityState==='visible'?void refresh():suspend());
  window.addEventListener('pagehide',suspend);
  for(const event of ['pageshow','focus'])window.addEventListener(event,()=>void refresh());
  void refresh();
})();
