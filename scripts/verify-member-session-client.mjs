import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const scope={URL,crypto,btoa,TextEncoder,AbortSignal};vm.runInNewContext(await readFile(new URL('../member-writing-client.js',import.meta.url),'utf8'),scope);
const values=new Map(),requests=[];let hold,release,failure=false;
const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
const data=()=>({actor:{kind:'member',member_id:'A'},session_token:'a'.repeat(43),renewal_token:'r'.repeat(43),expires_at:new Date(Date.now()+600000).toISOString(),renewal_expires_at:new Date(Date.now()+86400000).toISOString()});
const client=scope.createMinihompyMemberWriting({apiUrl:'https://b.test/member-writing',siteId:'B',storage,fetcher:async(url,init)=>{
 requests.push({url,init});
 if(failure)return Response.json({error:{code:'RATE_LIMITED'}},{status:429,headers:{'Retry-After':'3'}});
 if(hold&&url.endsWith('/renew'))return new Promise(r=>release=r);
 return Response.json(url.endsWith('/revoke')?{revoked:true}:data());
}});
await client.exchange('proof','v'.repeat(43),'attempt');assert.equal(JSON.parse(requests[0].init.body).protocol,2);assert.equal(client.hasRenewal(),true);
await client.renew();assert.equal(requests.at(-1).init.headers.Authorization,'Bearer '+'r'.repeat(43));
failure=true;await assert.rejects(client.renew(),e=>e.status===429&&e.retryAfter===3);assert.equal(client.hasRenewal(),true);failure=false;
console.log('PASS: v2 exchange retains separate renewal credential and Retry-After without discarding it');
hold=true;const first=client.renew(),second=client.renew();await new Promise(setImmediate);assert.equal(first,second);
await client.revoke();release(Response.json(data()));assert.equal(await first,null);assert.equal(values.size,0);assert.equal(client.state.status,'anonymous');
console.log('PASS: concurrent renewal is shared and a late response cannot restore revoked credentials');
