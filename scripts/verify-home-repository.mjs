import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
let response,calls=0,seenSignal,seenMenus;
const fixture=()=>({version:1,as_of:'2026-09-23T15:00:00+00:00',date:'2026-09-24',timezone:'Asia/Seoul',menus:['board'],counts:{board:{today:1,total:1}},today_comments:1,recent:[{id:'10000000-0000-4000-8000-000000000001',kind:'board',created_at:'2026-09-23T15:00:00+00:00',label:'<img src=x onerror=alert(1)>',today_comments:1}]});
const window={MinihompyBackend:{getClient(kind){assert.equal(kind,'visitor');return {rpc(name,args){calls++;assert.equal(name,'home_summary');seenMenus=Array.from(args.p_menus);const promise=Promise.resolve(response);promise.abortSignal=s=>{seenSignal=s;return promise;};return promise;}};}}};
vm.runInNewContext(await readFile(new URL('../home-repository.js',import.meta.url),'utf8'),{window});
const repo=window.MinihompyHomeRepository;
response={data:fixture(),error:null};const signal=new AbortController().signal;assert.deepEqual(await repo.summary(['board'],{signal}),fixture());assert.equal(calls,1);assert.equal(seenSignal,signal);assert.deepEqual(seenMenus,['board']);
for(const menus of [null,['bad'],['board','board'],[null]])await assert.rejects(()=>repo.summary(menus));assert.equal(calls,1);
response={data:null,error:{message:'private internal SQL'}};await assert.rejects(()=>repo.summary(),e=>!e.message.includes('private')&&e.message.includes('다시'));
for(const mutate of [v=>v.recent.push(v.recent[0]),v=>v.counts.board.total=-1,v=>v.counts.board.today=2,v=>v.menus.push('guestbook'),v=>v.recent[0].body='unexpected private field',v=>v.date='2026-09-23',v=>v.recent[0].id='bad',v=>v.recent[0].label='a'.repeat(121),v=>v.recent[0].today_comments=2,v=>v.recent[0].created_at='2027-01-01',v=>v.recent=[],v=>v.timezone='UTC']){const value=fixture();mutate(value);response={data:value,error:null};await assert.rejects(()=>repo.summary(['board']));}
response={data:{...fixture(),menus:[],counts:{},recent:[],today_comments:0},error:null};assert.deepEqual((await repo.summary([])).recent,[]);
console.log('PASS: one visitor RPC, menu validation, abort forwarding, bounded strict response, no error-to-empty fallback or privileged metadata');
