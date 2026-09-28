(() => {
 'use strict';
 const base=new URL('.',document.currentScript.src),scripts=new Map();
 let generation=0,operation=null;
 const implementation=()=>window.MinihompyPhotoEditorImplementation;
 const admin=()=>window.MinihompyAdmin?.state.role==='admin';
 function load(path,ready){
  if(ready())return Promise.resolve();
  if(!scripts.has(path)){
   const promise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=new URL(path,base).href;script.async=true;
    script.onload=()=>{if(ready())resolve();else reject(Error('사진 편집기 초기화에 실패했습니다. 다시 시도해 주세요.'));};
    script.onerror=()=>reject(Error('사진 편집기를 불러오지 못했습니다. 다시 시도해 주세요.'));
    document.head.append(script);
   }).catch(error=>{scripts.delete(path);throw error;});
   scripts.set(path,promise);
  }
  return scripts.get(path);
 }
 const cancel=()=>{generation++;operation=null;};
 window.addEventListener('minihompy:content-access-reset',cancel);
 window.addEventListener('pagehide',cancel);
 window.addEventListener('minihompy:menu-leave',e=>{if(e.detail.id===null||e.detail.id==='photos')cancel();});
 window.MinihompyPhotoEditor=Object.freeze({
  get active(){return implementation()?.active||false;},
  get busy(){return !!operation||implementation()?.busy||false;},
  get loading(){return !!operation;},
  start(post,folder,{isCurrent=()=>true}={}){
   if(!admin()||!isCurrent())return Promise.resolve(false);
   if(operation)return operation;
   const token=generation,user=window.MinihompyAdmin.state.userId;
   const current=()=>token===generation&&admin()&&window.MinihompyAdmin.state.userId===user&&isCurrent();
   const promise=(async()=>{
    // Static dependencies may finish after cancellation; only this attempt can open a draft.
    await Promise.all([load('assets/vendor/quill-2.0.3.js',()=>!!window.Quill),load('photo-variant-client.js',()=>!!window.MinihompyPhotoVariant)]);if(!current())return false;
    await load('photo-editor.js',()=>!!implementation());if(!current())return false;
    return await implementation().start(post,folder,{isCurrent:current});
   })().catch(error=>{if(!current())return false;throw error;}).finally(()=>{if(operation===promise)operation=null;});
   operation=promise;return promise;
  },
  render(...args){return implementation().render(...args);},
 });
})();
