// Adversarial HTTP/transport boundaries; real handler, controlled DB/fetch transports.
import assert from 'node:assert/strict';
import {handleMemberWriting} from '../supabase/functions/member-writing/handler.js';
const id=n=>`90000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const config={MINIHOMPY_SITE_ORIGIN:'https://home.test',MINIHOMPY_SITE_ID:id(1),MINIHOMPY_CENTRAL_API_URL:'https://central.test/api',SUPABASE_URL:'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',MINIHOMPY_PUBLIC_KEY:'fixture'};
let groups=0,transform=null,hang=null,observedSignal=null,calls=[];
const db={rpc(name,args){
 calls.push(name);
 if(hang===name)return {abortSignal(signal){observedSignal=signal;return new Promise(()=>{});}};
 if(name==='member_writing_session')return Promise.resolve({data:{site_id:id(1),central_api_url:config.MINIHOMPY_CENTRAL_API_URL}});
 if(name==='friend_visibility_status')return Promise.resolve({data:{friend_visibility_protocol:1,friend_visibility_ready:false,friend_media_ready:false,friend_summary_ready:false,friend_pages_ready:false,owner_member_id:null,private_secret:'hidden'}});
 if(name==='member_content_read'){
  const s=args.p_args.selectors,row={id:id(10),folder_id:id(20),author_id:null,author_name:'Writer',title:'Title',created_at:'2026-09-24T00:00:00Z',updated_at:'2026-09-24T00:00:00Z',visibility:'public'};
  let result={protocol:1,view:{mode:'public',scope:'public',includes_friends:false},data:{items:[row],count:1,page:s.page,size:s.size}};
  if(transform)result=transform(result);return Promise.resolve({data:result});
 }
 throw Error('Unexpected RPC');
}};
const options={config,db,fetcher:()=>{throw Error('Public read must not call central');}};
async function call({path='/content/list',method='POST',body=JSON.stringify({kind:'board'}),headers={},signal}={},status=200){
 const r=await handleMemberWriting(new Request(config.SUPABASE_URL+'/functions/v1/member-writing'+path,{method,headers:{Origin:config.MINIHOMPY_SITE_ORIGIN,'Content-Type':'application/json','X-Minihompy-Auth-Mode':'public',...headers},...(!['GET','OPTIONS'].includes(method)?{body,...(body instanceof ReadableStream?{duplex:'half'}:{})}:{}),signal}),options);
 assert.equal(r.status,status);assert.equal(r.headers.get('Cache-Control'),'private, no-store');assert.equal(r.headers.get('Vary'),'Origin, Authorization, X-Minihompy-Auth-Mode');return r;
}
const check=async(name,fn)=>{await fn();console.log(`PASS ${++groups}: ${name}`);};
await check('public response is explicit, health strips private fields, CORS/OPTIONS remains scoped',async()=>{
 assert.equal((await (await call()).json()).data.count,1);
 const health=await (await call({path:'/content/health',method:'GET'})).json();assert.equal('private_secret'in health,false);assert.equal('owner_member_id'in health,false);
 const preflight=await call({method:'OPTIONS'},204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),config.MINIHOMPY_SITE_ORIGIN);
 const bad=await call({headers:{Origin:'https://evil.test'}},403);assert.equal(bad.headers.get('Access-Control-Allow-Origin'),null);
});
await check('strict methods/body/query/UTF-8/fields and limits fail without content SQL',async()=>{
 for(const request of [{method:'GET'},{path:'/content/unknown'}])await call(request,request.method?405:404);
 for(const request of [{body:'{'},{body:'[]'},{body:JSON.stringify({kind:'board',body:'x'.repeat(9000)})},{path:'/content/list?select=*'},{headers:{'Content-Type':'text/plain'}},{body:new Uint8Array([0xff])},{body:JSON.stringify({kind:'diary',month:'0000-01'})}]){calls=[];await call(request,400);assert.ok(!calls.includes('member_content_read'));}
});
await check('poisoned DB visibility/count/identity is rejected, extra fields stripped',async()=>{
 for(const change of [d=>({...d,data:{...d.data,count:0}}),d=>({...d,data:{...d.data,items:[{...d.data.items[0],visibility:'friends'}]}}),d=>({...d,data:{...d.data,items:[{...d.data.items[0],id:'invalid'}]}})]){transform=change;await call({},503);}
 transform=d=>({...d,data:{...d.data,secret:'NO LEAK',items:d.data.items.map(p=>({...p,secret:'NO LEAK'}))}});assert.ok(!JSON.stringify(await (await call()).json()).includes('NO LEAK'));transform=null;
});
await check('oversized aggregate response is rejected even when individual rows fit limits',async()=>{
 transform=d=>({...d,data:{...d.data,count:20,items:Array.from({length:20},(_,n)=>({...d.data.items[0],id:id(100+n),entry_date:'2026-09-24',entry_time:'12:30:00',weather:'',revision:1,body:'가'.repeat(50000)}))}});
 await call({body:JSON.stringify({kind:'diary'})},503);transform=null;
});
await check('request cancellation aborts outstanding RPC; pre-cancelled request never reaches content',async()=>{
 const controller=new AbortController();hang='member_content_read';const pending=call({signal:controller.signal},503);
 while(!observedSignal)await new Promise(r=>setTimeout(r,5));controller.abort();await pending;assert.equal(observedSignal.aborted,true);hang=null;
 calls=[];await call({signal:controller.signal},503);assert.ok(!calls.includes('member_content_read'));
});
await check('stalled request body is cancelled after five seconds',async()=>{
 let cancelled=false;const body=new ReadableStream({cancel(){cancelled=true;}}),start=performance.now();await call({body},503);assert.equal(cancelled,true);console.log('Timeout elapsed ms:',performance.now()-start);assert.ok(performance.now()-start>=4900&&performance.now()-start<6500,'elapsed '+(performance.now()-start));
});
await check('stalled DB response aborts after five seconds rather than retaining an HTTP request',async()=>{
 hang='member_content_read';observedSignal=null;const start=performance.now();await call({},503);assert.equal(observedSignal.aborted,true);console.log('Timeout elapsed ms:',performance.now()-start);assert.ok(performance.now()-start>=4900&&performance.now()-start<6500,'elapsed '+(performance.now()-start));hang=null;
});
console.log(`All ${groups} hostile HTTP boundary groups passed.`);
