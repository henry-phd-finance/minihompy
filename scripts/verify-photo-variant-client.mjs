import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../photo-media-client.js',import.meta.url),'utf8');
let cases=0;
async function fixture({capability=true,variantFailure=false,holdConversion=false,holdOriginal=false,verifyFails=false}={}){
 const window=new EventTarget(),calls=[];let converts=0,releaseOriginal,started;
 const converted=new Blob(['webp'],{type:'image/webp'}),file=new Blob(['original'],{type:'image/png'});
 window.MINIHOMPY_SUPABASE={url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'public-fixture'};
 window.MinihompyContentAccess={open:async()=>({authorization:async()=> 'Bearer owner',verify:async()=>{if(verifyFails)throw Error('owner changed');},expire(){}})};
 window.MinihompyPhotoVariant={convert:async(_,{signal})=>{converts++;started?.();if(!holdConversion)return converted;return new Promise(r=>signal.addEventListener('abort',()=>r(null),{once:true}));}};
 const fetcher=async(url,opts)=>{calls.push({action:url.split('/').at(-1),opts});if(url.endsWith('/upload')&&holdOriginal)await new Promise(r=>releaseOriginal=r);if(url.endsWith('/health'))return Response.json(capability?{photo_variant_protocol:1,photo_variant_recipe:'display-v1'}:{});return Response.json({}, {status:variantFailure&&url.endsWith('/variant-upload')?503:200});};
 vm.runInNewContext(source,{window,AbortController,AbortSignal,FormData,Blob,URL,crypto,setTimeout,clearTimeout,fetch:fetcher});
 return {window,calls,file,upload:(options)=>window.MinihompyPhotoMedia.upload('post/file.png',file,options),get converts(){return converts;},waitConversion:()=>new Promise(r=>started=r),release:()=>releaseOriginal()};
}
for(const options of [{},{capability:false},{variantFailure:true},{verifyFails:true}]){
 const f=await fixture(options);await f.upload();assert.equal(f.calls[0].action,'upload');
 assert.equal(f.calls.filter(c=>c.action==='variant-upload').length,options.capability===false||options.verifyFails?0:1);
 if(options.capability===false)assert.equal(f.converts,0);
 assert.equal(f.calls.find(c=>c.action==='health').opts.headers.Authorization,undefined);cases++;
}
console.log('PASS capability fallback, original success survives conversion/upload failure, owner recheck, credential-free health');
for(const event of ['minihompy:content-access-reset','minihompy:menu-leave','pagehide']){
 const f=await fixture({holdConversion:true}),started=f.waitConversion(),job=f.upload();await started;
 f.window.dispatchEvent(event==='minihompy:menu-leave'?new CustomEvent(event,{detail:{id:'photos'}}):new Event(event));await job;
 assert(!f.calls.some(c=>c.action==='variant-upload'));cases++;
}
const f=await fixture({holdOriginal:true}),controller=new AbortController(),job=f.upload({signal:controller.signal});
await new Promise(r=>setTimeout(r,0));controller.abort();f.release();await job;assert.deepEqual(f.calls.map(c=>c.action),['upload']);cases++;
console.log('PASS conversion canceled on identity/menu/page departure, no late variant upload, original ACK retained for editor cleanup');
console.log('PASS '+cases+' client integration cases');
