import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const files=['member-writing-client.js','member-writing-runtime.js','member-relationships-repository.js'];
const sources=await Promise.all(files.map(f=>readFile(new URL('../'+f,import.meta.url),'utf8')));
const A='70000000-0000-4000-8000-000000000001',B='70000000-0000-4000-8000-000000000002';
let groups=0;const check=async(name,fn)=>{await fn();console.log(`PASS ${++groups}: ${name}`);};
function fixture(){
 const window=new EventTarget(),document=new EventTarget(),store=new Map(),calls=[];let hold,held,failAction=false,renewed=false;
 const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 store.set('minihompy.member-writing.v1:B:https://b.test','t'.repeat(43));store.set('minihompy.member-writing.v1:B:https://b.test:renewal','n'.repeat(43));
 const member=()=>({actor:{kind:'member',member_id:A},expires_at:new Date(Date.now()+(renewed?900000:30000)).toISOString()});
 const fetcher=async(url,init)=>{
  calls.push({url,init,body:init.body?JSON.parse(init.body):null});
  if(url.endsWith('/sessions/current'))return Response.json(member());
  if(url.endsWith('/sessions/renew')){renewed=true;return Response.json({...member(),session_token:'r'.repeat(43)});}
  if(url.endsWith('/relationships/actions')&&failAction)return Response.json({error:{code:'IDENTITY_UNAVAILABLE'}},{status:503});
  if(hold&&url.includes('/relationships/'))await new Promise(r=>{held=r;});
  return Response.json(url.includes('/friends?')?{items:[],next_cursor:null}:{state:'accepted'});
 };
 document.currentScript={src:'https://b.test/home/member-writing-runtime.js'};document.visibilityState='visible';document.querySelector=()=>null;
 window.MINIHOMPY_MEMBER_WRITING_CONFIG={enabled:true};window.MINIHOMPY_VISITOR_IDENTITY_CONFIG={siteId:'B',centralApiUrl:'https://central.test'};window.MINIHOMPY_SUPABASE={url:'https://b.test'};
 window.MinihompySharedIdentity={state:{status:'identified',visitor:{id:A}},retry:async()=>{}};
 // Both local admin and central member exist. Relationship transport must not ask for owner credentials.
 window.MinihompyAdmin={state:{role:'admin',userId:'local-owner'}};
 window.MinihompyVisitorSession={context:async()=>{throw Error('Owner context must not be used');}};
 window.fetch=fetcher;
 const sandbox={window,document,location:{pathname:'/home/'},URL,URLSearchParams,Event,CustomEvent,Date,Math,Error,crypto,sessionStorage:storage,localStorage:storage,fetch:fetcher,Response,AbortSignal,TextEncoder,btoa,atob,setInterval(){},clearTimeout(){},setTimeout(){return 1;}};
 const ctx=vm.createContext(sandbox);vm.runInContext(sources[0],ctx);window.createMinihompyMemberWriting=ctx.createMinihompyMemberWriting;
 vm.runInContext(sources[1],ctx);vm.runInContext(sources[2],ctx);
 const runtime=window.MinihompyMemberWriting,repo=window.createMinihompyRelationships();
 return {window,calls,store,runtime,repo,hold:()=>hold=true,release:()=>held(),fail:()=>failAction=true};
}
await check('concurrent relationship reads share renewal and use member bearer even for local admin',async()=>{
 const f=fixture();await Promise.all([f.repo.state(B),f.repo.state(B)]);
 assert.equal(f.calls.filter(c=>c.url.endsWith('/sessions/renew')).length,1);
 const posts=f.calls.filter(c=>c.url.endsWith('/relationships/state'));assert.equal(posts.length,2);
 for(const {init} of posts){assert.equal(init.headers['X-Minihompy-Auth-Mode'],'member');assert.equal(init.headers.Authorization,'Bearer '+'r'.repeat(43));assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');}
});
await check('immutable operation retains ID for explicit retry and result recovery, never automatic resend',async()=>{
 const f=fixture(),op=f.repo.prepare('request',B,{revision:0});assert.ok(Object.isFrozen(op));f.fail();
 await assert.rejects(f.repo.execute(op));assert.equal(f.calls.filter(c=>c.url.endsWith('/relationships/actions')).length,1);
 await f.runtime.retry();await f.repo.recover(op);
 const c=f.calls.find(c=>c.url.endsWith('/relationships/operations'));assert.equal(c.body.operation_id,op.operation_id);
 assert.ok([...f.store.values()].every(v=>!v.includes(op.operation_id)));
});
await check('account switch rejects both stale response and old operation recovery before another send',async()=>{
 const f=fixture();await f.repo.state(B);const op=f.repo.prepare('request',B,{revision:0});f.hold();const pending=f.repo.execute(op);
 await new Promise(setImmediate);f.window.MinihompySharedIdentity.state={status:'identified',visitor:{id:B}};f.release();
 await assert.rejects(pending,e=>e.code==='IDENTITY_CHANGED');const n=f.calls.length;
 assert.throws(()=>f.repo.recover(op),e=>e.code==='IDENTITY_CHANGED');assert.throws(()=>f.repo.execute(op),e=>e.code==='IDENTITY_CHANGED');assert.equal(f.calls.length,n);
});
await check('anonymous/disabled identities do not send member requests; arbitrary tasks are refused',async()=>{
 const f=fixture();f.window.MinihompySharedIdentity.state={status:'anonymous'};await assert.rejects(f.repo.state(B),e=>e.code==='AUTH_REQUIRED');assert.equal(f.calls.length,0);
 assert.throws(()=>f.repo.execute({operation_id:crypto.randomUUID()}));
 f.window.MINIHOMPY_MEMBER_WRITING_CONFIG.enabled=false;assert.throws(()=>f.repo.prepare('request',B,{revision:0}));
});
await check('public friends use credential-free HTTPS and discard account-stale responses',async()=>{
 const f=fixture();await f.repo.friends(B);let c=f.calls[0];assert.equal(c.init.credentials,'omit');assert.equal(c.init.headers,undefined);assert.ok(c.url.startsWith('https://central.test/relationships/friends?'));
 f.hold();const pending=f.repo.friends(B);await new Promise(setImmediate);f.window.MinihompySharedIdentity.state={status:'anonymous'};f.release();await assert.rejects(pending,e=>e.code==='IDENTITY_CHANGED');
});
console.log(`All ${groups} browser client/runtime/repository groups passed (VM, actual source).`);
