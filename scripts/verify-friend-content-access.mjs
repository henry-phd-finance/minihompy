import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
class CustomEvent extends Event{constructor(name,options={}){super(name);this.detail=options.detail;}}
const window=new EventTarget();let ready=true,healthError,held,mode,renewals=0;
window.MINIHOMPY_VISITOR_IDENTITY_CONFIG={enabled:true};window.MINIHOMPY_MEMBER_WRITING_CONFIG={enabled:true};window.MinihompyAdmin={state:{role:'reader'}};window.MinihompySharedIdentity={state:{status:'identified',visitor:{id:'A'}}};
window.MinihompyMemberWriting={snapshot:()=>({}),check(){},state:{status:'ready'},retry:async()=>{renewals++;},read:async(action,options)=>{
 if(action==='health'){if(healthError)throw healthError;return {friend_visibility_protocol:1,friend_visibility_ready:ready,friend_media_ready:ready,friend_summary_ready:ready,friend_pages_ready:ready};}
 mode=options.mode;if(held)await new Promise(r=>held=r);return {protocol:1,view:{mode,scope:mode==='public'?'public':'visible',includes_friends:mode!=='public'},data:{actor:window.MinihompySharedIdentity.state.visitor?.id}};
}};
vm.runInNewContext(await readFile('content-access.js','utf8'),{window,CustomEvent,AbortController,AbortSignal,crypto});const access=window.MinihompyContentAccess;
assert.equal((await access.read('summary',{menus:[]})).mode,'member');window.MinihompyAdmin.state={role:'admin',userId:'owner'};window.dispatchEvent(new Event('minihompy:identity'));assert.equal((await access.read('summary',{})).mode,'owner');
window.MinihompyAdmin.state={role:'reader'};window.MinihompySharedIdentity.state={status:'anonymous'};window.dispatchEvent(new Event('minihompy:identity'));assert.equal((await access.read('summary',{})).mode,'public');
window.MinihompySharedIdentity.state={status:'error'};window.dispatchEvent(new Event('minihompy:visitor-identity'));await assert.rejects(access.read('summary',{}));
ready=false;assert.equal((await access.read('summary',{})).legacy,true);healthError={status:404};assert.equal((await access.read('summary',{})).legacy,true);healthError={status:503};await assert.rejects(access.read('summary',{}));healthError=null;ready=true;
console.log('PASS: explicit roles, only unsupported/unready fallback, identity or health failure never downgrades');
window.MinihompySharedIdentity.state={status:'identified',visitor:{id:'A'}};window.dispatchEvent(new Event('minihompy:visitor-identity'));held=true;const pending=access.read('summary',{});await new Promise(setImmediate);const release=held;window.MinihompySharedIdentity.state={status:'identified',visitor:{id:'B'}};window.dispatchEvent(new Event('minihompy:visitor-identity'));held=null;release();await assert.rejects(pending);
window.MinihompyMemberWriting.state={status:'error'};await access.retry();assert.equal(renewals,1);window.MinihompyMemberWriting=null;await assert.rejects(access.read('summary',{}));
console.log('PASS: late other-account data rejected, common retry reused, missing enabled runtime fails closed');
