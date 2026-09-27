(() => {
 'use strict';
 const MAX=6*1024*1024,scopes=new Set();
 let active=0;const queue=[];
 const failure=(message,code)=>Object.assign(new Error(message),{code});
 function drain(){
  while(active<4&&queue.length){
   const task=queue.shift();if(task.signal.aborted){task.reject(failure('이미지 조회가 취소되었습니다.','ABORTED'));continue;}
   active++;Promise.resolve().then(task.run).then(task.resolve,task.reject).finally(()=>{active--;drain();});
  }
 }
 const scheduled=(signal,run)=>new Promise((resolve,reject)=>{
  const task={signal,run,resolve:v=>{signal.removeEventListener('abort',abort);resolve(v);},reject:e=>{signal.removeEventListener('abort',abort);reject(e);}};
  const abort=()=>{const i=queue.indexOf(task);if(i>=0)queue.splice(i,1);task.reject(failure('이미지 조회가 취소되었습니다.','ABORTED'));};
  if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});queue.push(task);drain();
 });
 async function cancellable(signal,run){
  if(signal.aborted)throw failure('이미지 조회가 취소되었습니다.','ABORTED');let abort;
  try{return await Promise.race([Promise.resolve().then(run),new Promise((_,reject)=>{abort=()=>reject(failure('이미지 조회가 취소되었습니다.','ABORTED'));signal.addEventListener('abort',abort,{once:true});})]);}
  finally{signal.removeEventListener('abort',abort);}
 }

 function endpoint(action){
  const config=window.MINIHOMPY_SUPABASE;
  if(!/^https:\/\/[a-z]{20}\.supabase\.co\/?$/.test(config?.url||'')||!config.publishableKey)throw Error('사진 서버 설정을 확인해 주세요.');
  return {url:config.url.replace(/\/$/,'')+'/functions/v1/photo-media/'+action,key:config.publishableKey};
 }
 async function call(action,body,{signal,ctx}={}){
  const access=ctx||await window.MinihompyContentAccess.open(action!=='read');
  if(action==='read'){const r=await window.MinihompyContentAccess.read?.('photo',body,{signal});if(r&&!r.legacy)return {response:r.response,access:{verify:async()=>{await r.verify();await access.verify();}}};}
  const auth=await access.authorization();
  if(action!=='read'&&!auth)throw Error('관리자 로그인이 필요합니다.');
  const {url,key}=endpoint(action),multipart=body instanceof FormData;
  const response=await fetch(url,{method:'POST',headers:{apikey:key,...(auth?{Authorization:auth}:{}),...(multipart?{}:{'Content-Type':'application/json'})},
   body:multipart?body:JSON.stringify(body),signal:signal||AbortSignal.timeout(30000),cache:'no-store',credentials:'omit',redirect:'error'});
  if(!response.ok){
   let code;try{code=(await response.json()).error?.code;}catch{}
   if(auth&&(response.status===401||response.status===403)){await access.verify();if(window.MinihompyAdmin?.handleRejection)await window.MinihompyAdmin.handleRejection({status:response.status,code});else access.expire();}
   throw failure(response.status===404?'사진이 삭제되었거나 조회할 수 없습니다.':'사진 요청을 완료하지 못했습니다. 다시 시도해 주세요.',code||String(response.status));
  }
  return {response,access};
 }
 function scope(){
  const controller=new AbortController(),urls=new Set(),cache=new Map();let disposed=false;
  const current=()=>{if(disposed||controller.signal.aborted)throw failure('이미지 조회가 취소되었습니다.','ABORTED');};
  const result={
   async read(post,path){
    current();const key=post+':'+path;
    if(!cache.has(key)){
     const timer=setTimeout(()=>result.dispose(),45000);
     cache.set(key,scheduled(controller.signal,()=>cancellable(controller.signal,async()=>{
      current();
      const ctx=await window.MinihompyContentAccess.open();
      const {response,access}=await call('read',{post_id:post,path},{signal:controller.signal,ctx});
      if(disposed||controller.signal.aborted){void response.body?.cancel().catch(()=>{});current();}
      const type=response.headers.get('Content-Type')?.split(';')[0];
      if(!['image/jpeg','image/png','image/gif','image/webp'].includes(type)){void response.body?.cancel();throw Error('올바른 이미지 응답이 아닙니다.');}
      const reader=response.body.getReader(),chunks=[];let size=0;
      try{for(;;){const {value,done}=await cancellable(controller.signal,()=>reader.read());current();if(done)break;size+=value.length;if(size>MAX)throw Error('이미지 크기 제한을 초과했습니다.');chunks.push(value);}}
      finally{void reader.cancel().catch(()=>{});}
      await access.verify();current();
      if(!size)throw Error('빈 이미지입니다.');
      const url=URL.createObjectURL(new Blob(chunks,{type}));urls.add(url);return url;
    })).finally(()=>clearTimeout(timer)).catch(error=>{cache.delete(key);throw error;}));
    }
    return cache.get(key);
   },
   dispose(){
    if(disposed)return;disposed=true;controller.abort();for(const url of urls)URL.revokeObjectURL(url);
    urls.clear();cache.clear();scopes.delete(result);drain();
   },
  };
  scopes.add(result);return result;
 }
 const dispose=()=>{for(const s of [...scopes])s.dispose();};
 window.addEventListener('minihompy:content-access-reset',dispose);
 window.addEventListener('minihompy:menu-leave',e=>{if(e.detail.id===null||e.detail.id==='photos')dispose();});
 window.addEventListener('pagehide',dispose);
 window.MinihompyPhotoMedia=Object.freeze({
  scope,
  async upload(path,file){
   const form=new FormData();form.set('post_id',path.split('/')[0]);form.set('path',path);form.set('file',file);
   // A mutation may finish after menu leave. Only the editor generation may advance to saving.
   await call('upload',form);
  },
  async cleanup(paths){
   const unique=[...new Set(paths)];for(let i=0;i<unique.length;i+=20)await call('cleanup',{paths:unique.slice(i,i+20)});
  },
 });
})();
