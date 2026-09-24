import assert from 'node:assert/strict';
import {bytesOf,adapters,BUCKET,MAX_BYTES} from '../supabase/functions/photo-media/io.js';
import {bounded} from '../supabase/functions/member-writing/content-read.js';
import {memberDb} from '../supabase/functions/photo-media/member-read.js';
import {handlePhotoMedia} from '../supabase/functions/photo-media/handler.js';
let groups=0;const check=async(name,fn)=>{await fn();console.log(`PASS ${++groups}: ${name}`);};
await check('file body abort cancels stream; timeout and oversize release reader',async()=>{
 let cancelled=false;const controller=new AbortController();const body=new ReadableStream({pull(){},cancel(){cancelled=true;}});const p=bytesOf(body,MAX_BYTES,1000,controller.signal);controller.abort();await assert.rejects(p);assert.equal(cancelled,true);
 cancelled=false;await assert.rejects(bytesOf(new ReadableStream({pull(){},cancel(){cancelled=true;}}),MAX_BYTES,20),e=>e.code==='REQUEST_TIMEOUT');assert.equal(cancelled,true);
 await assert.rejects(bytesOf(new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_BYTES+1));c.close();}})),e=>e.code==='TOO_LARGE');
});
await check('Storage fetch and its response body share cancellation, redirect denied, service credential scoped',async()=>{
 let cancelled=false,seen;const controller=new AbortController();const api=adapters({projectUrl:'https://abcdefghijklmnopqrst.supabase.co',serviceKey:'test-service',fetcher:async(url,init)=>{seen=init;assert.equal(url,'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/authenticated/'+BUCKET+'/a/b.png');return new Response(new ReadableStream({pull(){},cancel(){cancelled=true;}}));}});
 const p=api.storage.get(BUCKET,'a/b.png',controller.signal);await new Promise(r=>setTimeout(r,10));controller.abort();await assert.rejects(p);assert.equal(cancelled,true);assert.equal(seen.signal.aborted,true);assert.equal(seen.redirect,'error');assert.equal(seen.headers.Authorization,'Bearer test-service');
});
await check('named RPC adapter refuses oversized JSON and cancels stalled body',async()=>{
 const controller=new AbortController();let cancelled=false;const db=memberDb({projectUrl:'https://abcdefghijklmnopqrst.supabase.co',serviceKey:'test',signal:controller.signal,fetcher:async()=>new Response(new ReadableStream({pull(){},cancel(){cancelled=true;}}))});
 const p=db.rpc('member_photo_read',{}).abortSignal(controller.signal);await new Promise(r=>setTimeout(r,10));controller.abort();await assert.rejects(p);assert.equal(cancelled,true);
 const large=memberDb({projectUrl:'https://abcdefghijklmnopqrst.supabase.co',serviceKey:'test',signal:new AbortController().signal,fetcher:async()=>new Response(' '.repeat(16385))});await assert.rejects(large.rpc('member_photo_read',{}).abortSignal(new AbortController().signal),e=>e.code==='TOO_LARGE');
});
await check('request body cancellation fails closed; CORS permits explicit mode and no response caching',async()=>{
 const env={MINIHOMPY_SITE_ORIGIN:'https://home.test',SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_ANON_KEY:'test',SUPABASE_SERVICE_ROLE_KEY:'service'};
 const controller=new AbortController();controller.abort();const req=new Request('https://edge.test/photo-media/read',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:'{}'});
 const r=await handlePhotoMedia(req,{env});assert.equal(r.status,408);assert.equal(r.headers.get('Cache-Control'),'private, no-store');
 const pre=await handlePhotoMedia(new Request('https://edge.test/photo-media/read',{method:'OPTIONS',headers:{Origin:'https://home.test'}}),{env});assert.equal(pre.status,204);assert.ok(pre.headers.get('Access-Control-Allow-Headers').includes('X-Minihompy-Auth-Mode'));
});
await check('bounded Storage wait aborts even if a transport ignores cancellation; late result is discarded',async()=>{
 let signal;const start=performance.now();await assert.rejects(bounded(s=>{signal=s;return new Promise(r=>setTimeout(()=>r(new Uint8Array([1])),80));},new AbortController().signal,20));assert.equal(signal.aborted,true);assert.ok(performance.now()-start<70);
});
console.log(`All ${groups} photo HTTP boundary groups passed; no external network.`);
