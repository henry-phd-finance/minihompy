import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../member-writing-runtime.js',import.meta.url),'utf8');
function fixture({fail=false,held=false}={}){
 let clock=Date.now(),expires=clock+900000;
 class Clock extends Date { static now(){return clock;} }
 const window=new EventTarget(),document=new EventTarget(),store=new Map();let release;
 const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 const counts={current:0,renew:0,revoke:0};const timers=[];
 const data=()=>({actor:{member_id:'A',kind:'member'},expires_at:new Date(expires).toISOString()});
 document.currentScript={src:'https://b.test/home/member-writing-runtime.js'};document.visibilityState='visible';document.querySelector=()=>null;
 window.MINIHOMPY_MEMBER_WRITING_CONFIG={enabled:true};window.MINIHOMPY_VISITOR_IDENTITY_CONFIG={siteId:'B'};window.MINIHOMPY_SUPABASE={url:'https://b.test'};
 window.MinihompySharedIdentity={state:{status:'identified',visitor:{id:'A'}},retry:async()=>{}};
 window.MinihompyAdmin={state:{role:'reader'}};window.MinihompyVisitorSession={context:async()=>({role:'reader'})};
 window.createMinihompyMemberWriting=()=>({invalidate(){},hasRenewal:()=>true,current:async()=>{counts.current++;return counts.renew?data():null;},renew:async()=>{counts.renew++;expires=clock+900000;if(fail)throw Object.assign(Error('fixture'),{status:503});if(held)return new Promise(r=>release=r);return data();},revoke:async()=>{counts.revoke++;},prepareProof:async()=>({}),content:async()=>({})});
 vm.runInNewContext(source,{window,document,location:{pathname:'/home/'},URL,Event,CustomEvent,Date:Clock,Math,Error,crypto,sessionStorage:storage,localStorage:storage,setInterval(){},clearTimeout(){},setTimeout(fn,ms){timers.push(ms);if(ms<12000)queueMicrotask(fn);return timers.length;}});
 return {window,document,counts,timers,store,advance:ms=>clock+=ms,api:window.MinihompyMemberWriting,release:()=>release(data())};
}
{
 const f=fixture();const result=await Promise.all(Array.from({length:8},()=>f.api.context()));assert.ok(result.every(x=>x.memberId==='A'));assert.equal(f.counts.current,1);assert.equal(f.counts.renew,1);
 await f.api.context();assert.equal(f.counts.renew,1);assert.equal(f.api.state.status,'ready');
 console.log('PASS: concurrent contexts share a single renewal and menu contexts reuse ready session');
}
{
 const f=fixture({fail:true});await assert.rejects(f.api.context());assert.equal(f.counts.renew,4);assert.equal(f.api.state.status,'error');
 assert.ok(f.timers.some(n=>n>=1000&&n<1200));assert.ok(f.timers.some(n=>n>=3000&&n<3200));assert.ok(f.timers.some(n=>n>=10000&&n<10200));
 await assert.rejects(f.api.context());assert.equal(f.counts.renew,4);
 console.log('PASS: automatic renewal retries 1/3/10 seconds then stops; another menu cannot restart loop');
}
{
 const f=fixture({held:true});const pending=f.api.context();await new Promise(setImmediate);
 const event=new Event('storage');event.key='minihompy.writing.pending:B:change';event.newValue=JSON.stringify({memberId:'C'});f.window.dispatchEvent(event);f.release();await assert.rejects(pending);
 assert.notEqual(f.api.state.status,'ready');assert.ok(f.counts.revoke);console.log('PASS: other-account notification invalidates an in-flight renewal');
}
{
 const f=fixture();f.document.visibilityState='hidden';f.window.dispatchEvent(new Event('focus'));await new Promise(setImmediate);assert.equal(f.counts.renew,0);
 f.document.visibilityState='visible';f.document.dispatchEvent(new Event('visibilitychange'));await new Promise(setImmediate);assert.equal(f.counts.renew,1);console.log('PASS: hidden tab defers renewal until visible');
}

{
 const f=fixture();await f.api.context();assert.equal(f.counts.renew,1);
 f.advance(14*60000-1);await f.api.context();assert.equal(f.counts.renew,1);
 f.advance(1);await f.api.context();assert.equal(f.counts.renew,2);
 f.advance(59999);await f.api.context();assert.equal(f.counts.renew,2);
 console.log('PASS: controlled 13:59.999 reuses token, 14:00 renews proactively, original 15-minute boundary remains ready');
}
{
 const f=fixture();await f.api.context();f.document.visibilityState='hidden';f.advance(20*60000);
 f.window.dispatchEvent(new Event('focus'));await new Promise(setImmediate);assert.equal(f.counts.renew,1);
 f.document.visibilityState='visible';f.document.dispatchEvent(new Event('visibilitychange'));await new Promise(setImmediate);
 assert.equal(f.counts.renew,2);assert.equal(f.api.state.status,'ready');
 console.log('PASS: controlled 20-minute hidden tab does not renew until visibility returns');
}
