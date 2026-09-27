import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
class CustomEvent extends Event{constructor(name,options={}){super(name);this.detail=options.detail;}}
const source=await readFile('photo-media-client.js','utf8'),turn=()=>new Promise(setImmediate);
function fixture(){
 const window=new EventTarget(),timers=new Map(),created=[],revoked=[];let serial=0,read=async()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png'}}),verify=async()=>{};
 window.MinihompyContentAccess={open:async()=>({verify:()=>verify()}),read:async(action,body,{signal})=>{assert.equal(action,'photo');return {response:await read(body,signal),verify:()=>verify()};}};
 vm.runInNewContext(source,{window,Event,CustomEvent,AbortSignal,AbortController,FormData,Blob,URL:{createObjectURL:()=>{const u='blob:'+ ++serial;created.push(u);return u;},revokeObjectURL:u=>revoked.push(u)},setTimeout:(f,ms)=>{assert.equal(ms,45000);const id=++serial;timers.set(id,f);return id;},clearTimeout:id=>timers.delete(id)});
 return {window,api:window.MinihompyPhotoMedia,timers,created,revoked,setRead:f=>read=f,setVerify:f=>verify=f};
}
{
 const f=fixture(),pending=[];let active=0,max=0,cancels=0;
 f.setRead(async()=>{active++;max=Math.max(max,active);await new Promise(r=>pending.push(r));active--;return new Response(new ReadableStream({cancel(){cancels++;}}),{headers:{'Content-Type':'image/png'}});});
 const s=f.api.scope(),reads=Array.from({length:9},(_,i)=>s.read('post','path'+i));const settled=Promise.allSettled(reads);await turn();assert.equal(max,4);assert.equal(f.timers.size,9);[...f.timers.values()].at(-1)();assert.ok((await settled).every(r=>r.status==='rejected'));assert.equal(pending.length,4);
 for(const release of pending)release();await turn();assert.equal(cancels,4);assert.equal(f.created.length,0);assert.equal(f.timers.size,0);
 f.setRead(async()=>new Response(new Uint8Array([1]),{headers:{'Content-Type':'image/png'}}));const next=f.api.scope();assert.ok((await next.read('post','fresh')).startsWith('blob:'));next.dispose();
 console.log('PASS 1: max four reads; queue and active cancellation settle even if transport ignores abort; late bodies cancelled; next scope progresses');
}
{
 const f=fixture();let calls=0;f.setRead(async()=>{calls++;return new Response(new Uint8Array([1]),{headers:{'Content-Type':'image/png'}});});const s=f.api.scope();const urls=await Promise.all([s.read('post','same'),s.read('post','same')]);assert.equal(urls[0],urls[1]);assert.equal(calls,1);
 f.window.dispatchEvent(new Event('minihompy:content-access-reset'));assert.deepEqual(f.revoked,f.created);await assert.rejects(s.read('post','same'));
 const next=f.api.scope();assert.notEqual(await next.read('post','same'),urls[0]);f.window.dispatchEvent(new CustomEvent('minihompy:menu-leave',{detail:{id:'photos'}}));assert.equal(calls,2);assert.deepEqual(f.revoked,f.created);
 console.log('PASS 2: scoped deduplication; access/menu reset revokes every URL and prevents cache reuse');
}
{
 const f=fixture(),s=f.api.scope();await s.read('post','good');let cancelled=0;
 f.setRead(async()=>new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'Content-Type':'image/png'}}));const p=s.read('post','hung');const rejection=assert.rejects(p);await turn();assert.equal(f.timers.size,1);[...f.timers.values()][0]();await rejection;await turn();assert.equal(cancelled,1);assert.deepEqual(f.revoked,f.created);assert.equal(f.timers.size,0);
 console.log('PASS 3: 45-second total read deadline cancels stalled stream and revokes already-created URLs');
}
{
 for(const [type,bytes] of [['text/html',new Uint8Array([1])],['image/png',new Uint8Array()],['image/png',new Uint8Array(6*1024*1024+1)]]){
  const f=fixture();f.setRead(async()=>new Response(bytes,{headers:{'Content-Type':type}}));const s=f.api.scope();await assert.rejects(s.read('post','bad'));assert.equal(f.created.length,0);assert.equal(f.timers.size,0);s.dispose();
 }
 const f=fixture(),s=f.api.scope();f.setVerify(async()=>{throw Error('revoked');});await assert.rejects(s.read('post','stale'));assert.equal(f.created.length,0);s.dispose();
 console.log('PASS 4: MIME/empty/6 MiB limit and final access verification reject before URL creation');
}
{
 const values=new Map(),requests=[],scope={URL,crypto,btoa,TextEncoder,AbortSignal};
 vm.runInNewContext(await readFile('member-writing-client.js','utf8'),scope);
 const client=scope.createMinihompyMemberWriting({apiUrl:'https://b.test/functions/v1/member-writing',siteId:'B',storage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},fetcher:async(url,init)=>{requests.push({url,init});return url.endsWith('/read')?new Response(new Uint8Array([1]),{headers:{'Content-Type':'image/png'}}):Response.json({actor:{kind:'member',member_id:'A'},session_token:'a'.repeat(43),expires_at:new Date(Date.now()+600000).toISOString()});}});
 await client.exchange('proof','v'.repeat(43));
 for(const mode of ['member','owner','public']){const response=await client.media({post_id:'post',path:'path'},{mode,accessToken:'owner.jwt'});assert.equal(response.headers.get('Content-Type'),'image/png');const {url,init}=requests.at(-1);assert.equal(url,'https://b.test/functions/v1/photo-media/read');assert.equal(init.headers['X-Minihompy-Auth-Mode'],mode);assert.equal(init.headers.Authorization,mode==='member'?'Bearer '+'a'.repeat(43):mode==='owner'?'Bearer owner.jwt':undefined);assert.equal(init.cache,'no-store');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');}
 console.log('PASS 5: binary route stays on target site, distinct private member/owner credentials, explicit public mode and no-store');
}
