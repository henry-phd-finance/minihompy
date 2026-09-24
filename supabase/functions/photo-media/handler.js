import {memberDb,memberPhotoRead} from './member-read.js';
import {bounded} from '../member-writing/content-read.js';
import {authenticateOwner} from '../member-writing/handler.js';
import {adapters,BUCKET,MAX_BYTES,bytesOf,digest,imageType,validPath,immutableCopy,fail} from './io.js';
const statuses={SESSION_EXPIRED:401,SESSION_REVOKED:401,TARGET_MISMATCH:403,READ_CONTEXT_EXPIRED:503,NOT_CONFIGURED:503,IDENTITY_UNAVAILABLE:503,BAD_REQUEST:400,BAD_IMAGE:400,AUTH_REQUIRED:401,FORBIDDEN:403,NOT_FOUND:404,REQUEST_CONFLICT:409,IN_USE:409,UPLOAD_PENDING:409,TOO_LARGE:413,RATE_LIMITED:429,REQUEST_TIMEOUT:408};
export async function handlePhotoMedia(req,{env=globalThis.Deno?.env.toObject()||{},fetcher=fetch,rpc,storage,db,bodyTimeout=15000}={}){
 const headers={'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',Vary:'Origin, Authorization, X-Minihompy-Auth-Mode','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, apikey, X-Minihompy-Auth-Mode'};
 const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers});
 try{
  const origin=env.MINIHOMPY_SITE_ORIGIN;
  if(!origin||!origin.startsWith('https://')||new URL(origin).origin!==origin)fail('NOT_CONFIGURED');
  if(req.headers.get('Origin')&&req.headers.get('Origin')!==origin)fail('FORBIDDEN');
  headers['Access-Control-Allow-Origin']=origin;
  const path=new URL(req.url).pathname.replace(/^\/(?:functions\/v1\/)?photo-media(?=\/|$)/,'');
  if(!['/read','/upload','/cleanup','/health'].includes(path))return reply(404,{error:{code:'NOT_FOUND'}});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(path==='/health'){
   if(req.method!=='GET')return reply(405,{error:{code:'METHOD_NOT_ALLOWED'}});
   if(req.headers.has('Authorization')||new URL(req.url).search||req.headers.get('X-Minihompy-Auth-Mode')!=='public')fail('BAD_REQUEST');
   if(!env.SUPABASE_SERVICE_ROLE_KEY||!env.MINIHOMPY_SITE_ID||!env.MINIHOMPY_CENTRAL_API_URL||!env.SUPABASE_URL)fail('NOT_CONFIGURED');
   return reply(200,{friend_media_protocol:1,friend_visibility_setup_protocol:1,site_id:env.MINIHOMPY_SITE_ID,central_api_url:env.MINIHOMPY_CENTRAL_API_URL,project_url:env.SUPABASE_URL});
  }
  if(req.method!=='POST')return reply(405,{error:{code:'METHOD_NOT_ALLOWED'}});
  if(req.headers.has('Range')||new URL(req.url).search)fail('BAD_REQUEST');
  const projectUrl=env.SUPABASE_URL,publicKey=env.MINIHOMPY_PUBLIC_KEY||env.SUPABASE_ANON_KEY;
  if(!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(projectUrl||'')||!publicKey||!env.SUPABASE_SERVICE_ROLE_KEY)fail('NOT_CONFIGURED');
  const context={fetcher,projectUrl,publicKey};
  const owner=async()=> (await authenticateOwner(req,context)).local_user_id;
  const mode=req.headers.get('X-Minihompy-Auth-Mode')||(req.headers.has('Authorization')?'owner':'public');
  if(!['public','owner','member'].includes(mode)||mode==='public'&&req.headers.has('Authorization'))fail('BAD_REQUEST');
  if(mode==='member'&&path!=='/read')fail('FORBIDDEN');
  const uid=mode==='owner'?await owner():null;
  if(path!=='/read'&&!uid)fail('AUTH_REQUIRED');
  const api=adapters({projectUrl,serviceKey:env.SUPABASE_SERVICE_ROLE_KEY,fetcher});
  rpc=rpc||api.rpc;storage=storage||api.storage;
  const raw=await bytesOf(req.body,path==='/upload'?MAX_BYTES+16384:8192,bodyTimeout,req.signal);
  let args,bytes,mime;
  if(path==='/upload'){
   if(!req.headers.get('Content-Type')?.startsWith('multipart/form-data;'))fail('BAD_REQUEST');
   let form;try{form=await new Response(raw,{headers:{'Content-Type':req.headers.get('Content-Type')}}).formData();}catch{fail('BAD_REQUEST');}
   if([...form.keys()].sort().join(',')!=='file,path,post_id')fail('BAD_REQUEST');
   args={post_id:form.get('post_id'),path:form.get('path')};
   const file=form.get('file');if(!(file instanceof Blob))fail('BAD_REQUEST');
   bytes=new Uint8Array(await file.arrayBuffer());mime=imageType(bytes,String(args.path));
   if(file.type!==mime)fail('BAD_IMAGE');
  }else{
   if(!req.headers.get('Content-Type')?.startsWith('application/json'))fail('BAD_REQUEST');
   try{args=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{fail('BAD_REQUEST');}
   if(!args||Array.isArray(args)||typeof args!=='object')fail('BAD_REQUEST');
   if(Object.keys(args).sort().join(',')!==(path==='/read'?'path,post_id':'paths'))fail('BAD_REQUEST');
  }
  if(path==='/cleanup'){
   if(!Array.isArray(args.paths)||args.paths.length<1||args.paths.length>20||new Set(args.paths).size!==args.paths.length
     ||args.paths.some(p=>typeof p!=='string'||!validPath(p.split('/')[0],p)))fail('BAD_REQUEST');
   // Individually retryable. A partial failure must never imply that all paths were removed.
   for(const path of args.paths){
    await owner();
    const a=await rpc('cleanup_begin',{owner_id:uid,path});
    if(a.failure)fail(a.failure);
    await storage.remove(BUCKET,[path]);
    await rpc('cleanup_finish',{owner_id:await owner(),path});
   }
   return reply(200,{ok:true});
  }
  if(!validPath(args.post_id,args.path))fail('BAD_REQUEST');
  if(path==='/upload'){
   const sha256=await digest(bytes),payload={...args,owner_id:uid,size:bytes.length,mime,sha256};
   const a=await rpc('reserve',payload);if(a.failure)fail(a.failure);
   if(!a.complete)await immutableCopy(storage,BUCKET,args.path,bytes,mime);
   await rpc('complete',{path:args.path,owner_id:await owner(),sha256});
   return reply(200,{path:args.path});
  }
  if(mode==='member')return await memberPhotoRead(req,{env,fetcher,db:db||memberDb({projectUrl,serviceKey:env.SUPABASE_SERVICE_ROLE_KEY,fetcher,signal:req.signal}),storage,args,headers});
  const read=async()=>{const a=await rpc('read',{...args,owner_id:uid?await owner():null});if(a.failure)fail(a.failure);return a;};
  const a=await read();bytes=await bounded(signal=>storage.get(BUCKET,args.path,signal),req.signal,30000);
  if(bytes.length!==a.size||imageType(bytes,args.path)!==a.mime||await digest(bytes)!==a.sha256)fail('INTEGRITY_FAILURE');
  const latest=await read();
  if(latest.sha256!==a.sha256)fail('NOT_FOUND');
  return new Response(bytes,{status:200,headers:{...headers,'Content-Type':a.mime,'Content-Length':String(bytes.length)}});
 }catch(e){if(e.code==='RATE_LIMITED')headers['Retry-After']=String(e.retryAfter||1);return reply(statuses[e.code]||503,{error:{code:statuses[e.code]?e.code:'UNAVAILABLE'}});}
}
