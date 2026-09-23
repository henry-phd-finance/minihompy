import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const code=await readFile(new URL('../member-writing-client.js',import.meta.url),'utf8');
const sandbox={URL,crypto,btoa,TextEncoder,AbortSignal};vm.runInNewContext(code,sandbox);
const actor={kind:'member',member_id:'member-A',role:'writer'},token='a'.repeat(43),replacement='b'.repeat(43);
const data=t=>({actor,session_token:t,expires_at:new Date(Date.now()+600000).toISOString()});
function fixture(){
 const records=new Map([['existing-admin','admin-session'],['existing-visitor','anonymous-session']]);const calls=[];let fail=false,broken=false,queued=null;
 const storage={getItem:k=>records.get(k)??null,setItem(k,v){if(broken)throw Error('storage');records.set(k,v);},removeItem:k=>records.delete(k)};
 const client=sandbox.createMinihompyMemberWriting({apiUrl:'https://site.test/functions/v1/member-writing',siteId:'B',storage,fetcher:async(url,init)=>{
  calls.push({url,init});assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.ok(init.signal);
  if(queued&&url.endsWith('/current'))return new Promise(resolve=>{queued.resolve=resolve;});
  if(fail)return Response.json({error:{code:'IDENTITY_UNAVAILABLE'}},{status:503});
  if(url.endsWith('/exchange'))return Response.json(data(calls.filter(c=>c.url.endsWith('/exchange')).length===1?token:replacement));
  return Response.json(url.endsWith('/revoke')?{revoked:true}:data(token));
 }});
 return {client,records,calls,setFail:v=>{fail=v;},setBroken:v=>{broken=v;},queue:v=>{queued=v;}};
}
{
 const f=fixture();assert.equal(await f.client.current(),null);assert.equal(f.calls.length,0);
 const p=await f.client.prepareProof();assert.match(p.code_verifier,/^[A-Za-z0-9_-]{43}$/);assert.match(p.code_challenge,/^[A-Za-z0-9_-]{43}$/);
 const result=await f.client.exchange('proof',p.code_verifier);assert.equal(result.session_token,undefined);assert.equal(f.client.state.status,'member');
 await f.client.current();assert.equal(f.calls.at(-1).init.headers.Authorization,'Bearer '+token);
 await f.client.exchange('fresh-proof',p.code_verifier);assert.equal(f.calls.at(-1).init.headers.Authorization,'Bearer '+token);
 assert.equal([...f.records.values()].includes(replacement),true);
 f.setFail(true);await assert.rejects(f.client.current());assert.equal(f.client.state.status,'error');assert.equal(f.client.state.actor,null);
 await assert.rejects(f.client.revoke());assert.equal([...f.records.values()].includes(replacement),true);
 f.setFail(false);await f.client.revoke();assert.equal(f.client.state.status,'anonymous');
 assert.equal(f.records.size,2);assert.equal(f.records.get('existing-admin'),'admin-session');assert.equal(f.records.get('existing-visitor'),'anonymous-session');
 await f.client.ownerCurrent('owner.jwt.token');assert.equal(f.calls.at(-1).init.headers['X-Minihompy-Auth-Mode'],'owner');assert.equal(f.records.size,2);
}
{
 const f=fixture();f.setBroken(true);await assert.rejects(f.client.exchange('proof','v'.repeat(43)));
 assert.equal(f.client.state.status,'error');assert.ok(f.calls.at(-1).url.endsWith('/revoke'));assert.equal(f.records.size,2);
}
{
 const f=fixture();await f.client.exchange('proof','v'.repeat(43));const delayed={};f.queue(delayed);
 const pending=f.client.current();await new Promise(setImmediate);await f.client.revoke();
 delayed.resolve(Response.json(data(token)));await pending;assert.equal(f.client.state.status,'anonymous');
}
console.log('PASS: PKCE preparation, scoped session storage, renewal, no fallback, revocation retry, storage failure cleanup, late-response isolation and owner/anonymous storage separation.');
