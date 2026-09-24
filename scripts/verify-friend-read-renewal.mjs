import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../member-writing-runtime.js',import.meta.url),'utf8');
function fixture({fail=false,held=false}={}){
 let clock=Date.now(),expires=clock+900000;
 class Clock extends Date { static now(){return clock;} }
 const window=new EventTarget(),document=new EventTarget(),store=new Map();let release;
 const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 const counts={current:0,renew:0,revoke:0,read:0};const timers=[];
 const data=()=>({actor:{member_id:'A',kind:'member'},expires_at:new Date(expires).toISOString()});
 document.currentScript={src:'https://b.test/home/member-writing-runtime.js'};document.visibilityState='visible';document.querySelector=()=>null;
 window.MINIHOMPY_MEMBER_WRITING_CONFIG={enabled:true};window.MINIHOMPY_VISITOR_IDENTITY_CONFIG={siteId:'B'};window.MINIHOMPY_SUPABASE={url:'https://b.test'};
 window.MinihompySharedIdentity={state:{status:'identified',visitor:{id:'A'}},retry:async()=>{}};
 window.MinihompyAdmin={state:{role:'reader'}};window.MinihompyVisitorSession={context:async()=>({role:'reader'})};
 window.createMinihompyMemberWriting=()=>({invalidate(){},hasRenewal:()=>true,current:async()=>{counts.current++;return counts.renew?data():null;},renew:async()=>{counts.renew++;expires=clock+900000;if(fail)throw Object.assign(Error('fixture'),{status:503});if(held)return new Promise(r=>release=r);return data();},revoke:async()=>{counts.revoke++;},prepareProof:async()=>({}),content:async()=>({}),read:async()=>{counts.read++;if(counts.read===1)throw Object.assign(Error('expired'),{status:401});return {ok:true};}});
 vm.runInNewContext(source,{window,document,location:{pathname:'/home/'},URL,Event,CustomEvent,Date:Clock,Math,Error,crypto,sessionStorage:storage,localStorage:storage,setInterval(){},clearTimeout(){},setTimeout(fn,ms){timers.push(ms);if(ms<12000)queueMicrotask(fn);return timers.length;}});
 return {window,document,counts,timers,store,advance:ms=>clock+=ms,api:window.MinihompyMemberWriting,release:()=>release(data())};
}
const f=fixture();const value=await f.api.read('summary',{mode:'member',body:{menus:['board']}});assert.equal(value.ok,true);assert.equal(f.counts.read,2);assert.equal(f.api.state.status,'ready');
console.log('PASS: reactive 401 revalidates shared session and retries read once');
