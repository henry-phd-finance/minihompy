(() => {
 'use strict';
 const url=new URL('photo-variant-worker.js',document.currentScript.src);let tail=Promise.resolve();
 function convert(file,{signal}={}){
  const job=tail.then(()=>new Promise(resolve=>{
   if(signal?.aborted||!file.size||file.size>6291456)return resolve(null);
   let worker,timer,done=false;
   const finish=result=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker?.terminate();resolve(result);};
   const abort=()=>finish(null);signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,10000);
   try{worker=new Worker(url,{type:'module'});worker.onerror=abort;worker.onmessage=e=>finish(e.data.bytes?new Blob([e.data.bytes],{type:'image/webp'}):null);
    file.arrayBuffer().then(bytes=>{if(!done)worker.postMessage({bytes},[bytes]);},abort);
   }catch{abort();}
  }));tail=job.catch(()=>{});return job;
 }
 window.MinihompyPhotoVariant=Object.freeze({convert});
})();
