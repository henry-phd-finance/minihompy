const encoder=new TextEncoder();
export async function visitDigest(secret,site,day,key){
 const signing=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=await crypto.subtle.sign('HMAC',signing,encoder.encode(JSON.stringify([site,day,key])));
 return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function handleVisitCounts(req,{env=globalThis.Deno?.env.toObject()||{},fetcher=fetch,rpc}={}){
 const origin=env.MINIHOMPY_SITE_ORIGIN;
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
 const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers});
 try{
  if(!origin||new URL(origin).origin!==origin||!origin.startsWith('https://'))return reply(503,{error:'NOT_CONFIGURED'});
  if(req.headers.get('Origin')&&req.headers.get('Origin')!==origin)return reply(403,{error:'FORBIDDEN'});
  headers['Access-Control-Allow-Origin']=origin;
  headers['Access-Control-Allow-Methods']='GET, POST, OPTIONS';headers['Access-Control-Allow-Headers']='content-type';
  const path=new URL(req.url).pathname.replace(/^.*\/visit-counts/,'');
  if(path!==''&&path!=='/')return reply(404,{error:'NOT_FOUND'});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(!['GET','POST'].includes(req.method))return reply(405,{error:'METHOD_NOT_ALLOWED'});
  const site=env.SUPABASE_URL,secret=env.MINIHOMPY_VISIT_SECRET;
  if(!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(site||'')||!env.SUPABASE_SERVICE_ROLE_KEY||typeof secret!=='string'||secret.length<32)return reply(503,{error:'NOT_CONFIGURED'});
  const call=rpc|| (async(name,args={})=>{
   const res=await fetcher(site+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'},body:JSON.stringify(args),redirect:'error',signal:AbortSignal.timeout(8000)});
   if(!res.ok)throw Error('Database unavailable');return res.json();
  });
  if(req.method==='GET')return reply(200,await call('visit_stats'));
  if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return reply(415,{error:'JSON_REQUIRED'});
  // Enforce the actual streamed bytes, not just a caller-supplied Content-Length.
  const reader=req.body?.getReader();if(!reader)return reply(400,{error:'BAD_REQUEST'});
  let bytes=0,parts=[],timer;
  const deadline=new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),3000);});
  try{
   while(true){
    const chunk=await Promise.race([reader.read(),deadline]);
    if(chunk.timeout){void reader.cancel().catch(()=>{});return reply(408,{error:'REQUEST_TIMEOUT'});}
    if(chunk.done)break;
    bytes+=chunk.value.length;
    if(bytes>256){void reader.cancel().catch(()=>{});return reply(413,{error:'TOO_LARGE'});}
    parts.push(chunk.value);
   }
  }finally{clearTimeout(timer);}
  const buffer=new Uint8Array(bytes);let offset=0;for(const part of parts){buffer.set(part,offset);offset+=part.length;}
  let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer));}catch{return reply(400,{error:'BAD_REQUEST'});}
  if(!body||Object.keys(body).length!==1||typeof body.browser_key!=='string'||!/^[0-9a-f]{64}$/.test(body.browser_key))return reply(400,{error:'BAD_REQUEST'});
  for(let attempt=0;attempt<2;attempt++){
   const stats=await call('visit_stats');
   const digest=await visitDigest(secret,site,stats.date,body.browser_key);
   const result=await call('visit_record',{p_day:stats.date,p_digest:digest});
   if(result.failure==='DAY_CHANGED')continue;
   if(result.failure==='RATE_LIMITED'){headers['Retry-After']='60';return reply(429,{error:'RATE_LIMITED'});}
   if(result.failure)throw Error('Record failed');return reply(200,result);
  }
  return reply(503,{error:'RETRY_LATER'});
 }catch{return reply(503,{error:'UNAVAILABLE'});}
}
