import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const visitor=await readFile(new URL('../visitor-identity.js',import.meta.url),'utf8'),runtime=await readFile(new URL('../member-writing-runtime.js',import.meta.url),'utf8');
async function check(cancel){
 const window=new EventTarget(),document=new EventTarget(),store=new Map(),location={origin:'https://a.test',pathname:'/home/',search:'',hash:'#vt=ticket&wp=proof'},data={actor:{member_id:'A'},expires_at:new Date(Date.now()+900000).toISOString()};
 const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};let finish,exchanges=0;
 const ready=new Promise(r=>finish=r);window.crypto=crypto;window.sessionStorage=storage;
 window.MINIHOMPY_MEMBER_WRITING_CONFIG={enabled:true};window.MINIHOMPY_VISITOR_IDENTITY_CONFIG={enabled:false,siteId:'A'};window.MINIHOMPY_SUPABASE={url:'https://a.test'};
 window.MinihompyAdmin={state:{role:'reader',userId:null},refresh:()=>ready};
 window.MinihompyVisitorSession={context:async()=>({role:'admin'})};
 window.createMinihompyMemberWriting=()=>({invalidate(){},hasRenewal:()=>true,exchange:async()=>{exchanges++;await ready;return data;},current:async()=>data,renew:async()=>data,revoke:async()=>{},prepareProof:async()=>({})});
 document.currentScript={src:'https://a.test/home/member-writing-runtime.js'};document.visibilityState='visible';document.readyState='complete';document.documentElement={dataset:{}};document.querySelector=()=>null;
 const ctx=vm.createContext({window,document,location,history:{replaceState(_a,_b,url){const u=new URL(url,location.origin);location.pathname=u.pathname;location.hash=u.hash;}},URL,URLSearchParams,Event,CustomEvent,AbortController,Date,Math,Error,crypto,sessionStorage:storage,localStorage:storage,setInterval(){},setTimeout(){return 1;},clearTimeout(){},fetch:async()=>Response.json({attempt_id:'attempt',status:'identified',profile:{id:'A'},return_path:'/home/'})});
 vm.runInContext(visitor,ctx);vm.runInContext(runtime,ctx);
 storage.setItem('minihompy.identity.redirect.v1:A',JSON.stringify({attempt_id:'attempt',started_at:Date.now(),return_path:'/home/',writing:{code_verifier:'verifier'}}));
 const shared=window.MinihompySharedIdentity=window.createMinihompySharedIdentity({enabled:true,siteId:'A',centralApiUrl:'https://central.test/api',centralPageUrl:'https://central.test'},storage);
 const pending=shared.resolve();await new Promise(setImmediate);assert.equal(exchanges,0,'Proof must wait for initial local administrator verification');
 if(cancel)shared.getLogoutUrl();
 window.MinihompyAdmin.state={role:'admin',userId:'owner'};window.dispatchEvent(new Event('minihompy:identity'));finish();await pending;await new Promise(setImmediate);
 assert.equal(exchanges,cancel?0:1);assert.equal(shared.state.status,cancel?'unverified':'identified');if(!cancel)assert.equal(window.MinihompyMemberWriting.state.status,'ready');
 console.log('PASS: '+(cancel?'Logout during initial admin verification invalidates callback before proof exchange':'Delayed initial admin verification cannot invalidate member proof exchange'));
}
await check(false);await check(true);
