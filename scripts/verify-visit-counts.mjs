import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {memberWritingDb} from './helpers/member-writing-db.mjs';import {handleVisitCounts,visitDigest} from '../supabase/functions/visit-counts/handler.js';
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2]||'../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js')));
const {pg}=await memberWritingDb(PGlite,{siteId:'10000000-0000-4000-8000-000000000001',centralUrl:'https://central.test/functions/v1/identity-api'});
const sql=await readFile(new URL('../supabase/migrations/202609230008_visit_counts.sql',import.meta.url),'utf8');
const env={MINIHOMPY_SITE_ORIGIN:'https://a.example',SUPABASE_URL:'https://'+'a'.repeat(20)+'.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-service-only',MINIHOMPY_VISIT_SECRET:'test-secret-'.repeat(4)};
let now='2026-09-23T14:59:59Z',rollover=false,groups=0;const day=()=>new Date(Date.parse(now)+9*3600000).toISOString().slice(0,10);
const stats=async()=>(await pg.query('select private.visit_stats_at($1) value',[now])).rows[0].value;
const record=async(date,digest)=>(await pg.query('select private.visit_record_at($1,$2,$3) value',[date,digest,now])).rows[0].value;
const rpc=async(name,args)=>{if(name==='visit_stats')return stats();if(rollover){now='2026-09-23T15:00:00Z';rollover=false;}return record(args.p_day,args.p_digest);};
const call=async({method='GET',body,origin='https://a.example',options={},status=200,raw}={})=>{const res=await handleVisitCounts(new Request('https://edge.test/functions/v1/visit-counts',{method,headers:{Origin:origin,'Content-Type':'application/json'},...(method==='POST'?{body:raw??JSON.stringify(body)}:{})}),{env,rpc,...options});assert.equal(res.status,status);assert.equal(res.headers.get('Cache-Control'),'no-store');return res.status===204?null:res.json();};
const key=n=>n.toString(16).padStart(64,'0');const post=n=>call({method:'POST',body:{browser_key:key(n)}});
const check=async(label,fn)=>{await fn();console.log(`PASS ${++groups}: ${label}`);};
try{
 await pg.exec(sql);
 const original=async()=>{const result={};for(const t of ['board_posts','photo_posts','diary_entries','guestbook_posts','post_comments','minihompy_settings','minihompy_profile'])result[t]=(await pg.query(`select to_jsonb(t) data from public.${t} t order by id`)).rows;return result;};const before=await original();
 await check('read-only initial zero and separated write endpoint',async()=>{assert.equal((await call()).total,0);await call();assert.equal((await pg.query('select count(*) from private.visit_keys')).rows[0].count,0);assert.equal((await post(1)).counted,true);assert.equal((await post(1)).counted,false);assert.equal((await call()).total,1);});
 await check('overlapping callers and lost-response retry do not duplicate',async()=>{const results=await Promise.all(Array.from({length:12},()=>post(2)));assert.equal(results.filter(r=>r.counted).length,1);assert.equal((await post(2)).total,2);});
 await check('Korean midnight, stale/future dates and rollover between signing and recording',async()=>{assert.equal((await call()).date,'2026-09-23');assert.equal((await record('2999-01-01',key(3))).failure,'DAY_CHANGED');rollover=true;const next=await post(1);assert.equal(next.date,'2026-09-24');assert.equal(next.today,1);assert.equal(next.total,3);assert.equal((await post(1)).counted,false);});
 await check('HMAC isolates days/sites and database stores no raw browser key or credentials',async()=>{const a=await visitDigest(env.MINIHOMPY_VISIT_SECRET,env.SUPABASE_URL,day(),key(1));assert.notEqual(a,await visitDigest(env.MINIHOMPY_VISIT_SECRET,'other',day(),key(1)));assert.notEqual(a,await visitDigest(env.MINIHOMPY_VISIT_SECRET,env.SUPABASE_URL,'2026-09-25',key(1)));const rows=(await pg.query('select * from private.visit_keys')).rows;assert.ok(rows.some(r=>r.digest===a));const text=JSON.stringify(rows);assert.ok(!text.includes(key(1)));assert.ok(!text.includes(env.MINIHOMPY_VISIT_SECRET));});
 await check('per-key, new-visitor and site request limits keep counters correct',async()=>{
  for(let n=0;n<58;n++)await post(1);await call({method:'POST',body:{browser_key:key(1)},status:429});assert.equal((await call()).today,1);
  now='2026-09-23T15:01:00Z';for(let n=100;n<220;n++)await post(n);await call({method:'POST',body:{browser_key:key(220)},status:429});assert.equal((await call()).today,121);
  // Exhaust the separate site request budget via already-counted keys.
  await pg.exec('update private.visit_total set requests=600');await call({method:'POST',body:{browser_key:key(100)},status:429});now='2026-09-23T15:02:00Z';assert.equal((await post(100)).counted,false);
 });
 await check('retention removes only expired dedup keys and keeps daily/cumulative totals',async()=>{
  const total=(await stats()).total;now='2026-09-27T15:00:00Z';assert.equal((await stats()).today,0);const result=await post(1);assert.equal(result.total,total+1);assert.equal((await pg.query('select count(*) from private.visit_keys')).rows[0].count,1);assert.ok((await pg.query('select count(*) from private.visit_days')).rows[0].count>=3);
  await pg.exec(sql);assert.equal((await stats()).total,total+1);assert.deepEqual(await original(),before);
 });
 await check('overflow rolls back dedup/counters and failures can retry safely',async()=>{
  await pg.exec('begin');await pg.exec('update private.visit_total set total=9007199254740991');await assert.rejects(()=>record(day(),key(777)),e=>e.code==='22003');await pg.exec('rollback');assert.equal((await pg.query('select count(*) from private.visit_keys where digest=$1',[key(777)])).rows[0].count,0);
  const retry=await post(777);assert.equal(retry.counted,true);assert.equal((await post(777)).counted,false);
 });
 await check('browser roles cannot write/read dedup or execute clock helpers; service RPC only',async()=>{
  for(const role of ['anon','authenticated','service_role']){await pg.exec('set role '+role);await assert.rejects(()=>pg.exec('select * from private.visit_keys'),e=>e.code==='42501');await assert.rejects(()=>pg.query('select private.visit_record_at($1,$2,$3)',[day(),key(999),now]),e=>e.code==='42501');if(role!=='service_role'){await assert.rejects(()=>pg.query('select public.visit_record($1,$2)',[day(),key(999)]),e=>e.code==='42501');await assert.rejects(()=>pg.exec('update private.visit_total set total=999'),e=>e.code==='42501');}else {
   const live=(await pg.query('select public.visit_stats() data')).rows[0].data;assert.equal(live.version,1);
   const args=[live.date,key(9000)];
   assert.equal((await pg.query('select public.visit_record($1,$2) data',args)).rows[0].data.counted,true);
   assert.equal((await pg.query('select public.visit_record($1,$2) data',args)).rows[0].data.counted,false);
  }await pg.exec('reset role');}
 });
 await check('API rejects forged fields, invalid keys, oversized streamed bytes, wrong origin/method; sanitized failures',async()=>{
  for(const body of [{browser_key:'bad'},{browser_key:key(1),date:'2999-01-01'},{browser_key:key(1),increment:100},null])await call({method:'POST',body,status:400});
  await call({method:'POST',raw:'x'.repeat(257),status:413});await call({method:'POST',raw:'{',status:400});await call({origin:'https://evil.example',status:403});await call({method:'DELETE',status:405});await call({method:'OPTIONS',status:204});await call({options:{env:{...env,MINIHOMPY_VISIT_SECRET:''}},status:503});
  assert.deepEqual(await call({options:{rpc:async()=>{throw Error('SECRET SQL')}} ,status:503}),{error:'UNAVAILABLE'});
  let requests=0;await call({options:{rpc:undefined,fetcher:async(url,init)=>{requests++;assert.equal(url,env.SUPABASE_URL+'/rest/v1/rpc/visit_stats');assert.equal(init.redirect,'error');assert.ok(init.signal);assert.equal(init.headers.Authorization,'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY);return Response.json(await stats());}}});assert.equal(requests,1);
 });
 await check('slow request bodies time out without a database call',async()=>{
  let cancelled=false;
  const req=new Request('https://edge.test/functions/v1/visit-counts',{method:'POST',headers:{Origin:env.MINIHOMPY_SITE_ORIGIN,'Content-Type':'application/json'},duplex:'half',body:new ReadableStream({cancel(){cancelled=true;}})});
  const res=await handleVisitCounts(req,{env,rpc:()=>{throw Error('Must not call database');}});
  assert.equal(res.status,408);assert.equal(cancelled,true);assert.deepEqual(await res.json(),{error:'REQUEST_TIMEOUT'});
 });
 console.log(`PASS: ${groups} visit count groups; actual SQL and edge handler, no deployment`);
}finally{await pg.close();}
