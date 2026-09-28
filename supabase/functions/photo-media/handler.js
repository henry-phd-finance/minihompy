import {validateRepresentation,selectedPath,verifyBytes,sameSelection} from './representation.js';
import {uploadVariant,cleanupVariants} from './variants.js';
import {memberDb,memberPhotoRead} from './member-read.js';
import {bounded} from '../member-writing/content-read.js';
import {authenticateOwner} from '../member-writing/handler.js';
import {adapters,BUCKET,MAX_BYTES,bytesOf,digest,imageType,validPath,immutableCopy,fail} from './io.js';
const statuses={VARIANTS_PENDING:409,SOURCE_CHANGED:409,LEASE_EXPIRED:409,INTEGRITY_FAILED:409,NOT_READY:503,SESSION_EXPIRED:401,SESSION_REVOKED:401,TARGET_MISMATCH:403,READ_CONTEXT_EXPIRED:503,NOT_CONFIGURED:503,IDENTITY_UNAVAILABLE:503,BAD_REQUEST:400,BAD_IMAGE:400,AUTH_REQUIRED:401,FORBIDDEN:403,NOT_FOUND:404,REQUEST_CONFLICT:409,IN_USE:409,UPLOAD_PENDING:409,TOO_LARGE:413,RATE_LIMITED:429,REQUEST_TIMEOUT:408};
export async function handlePhotoMedia(req,{env=globalThis.Deno?.env.toObject()||{},fetcher=fetch,rpc,variantRpc,variantStatus,representationRpc,storage,db,bodyTimeout=15000}={}){
 const headers={'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',Vary:'Origin, Authorization, X-Minihompy-Auth-Mode','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, apikey, X-Minihompy-Auth-Mode'};
 const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers});
 try{
  const origin=env.MINIHOMPY_SITE_ORIGIN;
  if(!origin||!origin.startsWith('https://')||new URL(origin).origin!==origin)fail('NOT_CONFIGURED');
  if(req.headers.get('Origin')&&req.headers.get('Origin')!==origin)fail('FORBIDDEN');
  headers['Access-Control-Allow-Origin']=origin;
  const path=new URL(req.url).pathname.replace(/^\/(?:functions\/v1\/)?photo-media(?=\/|$)/,'');
  if(!['/read','/upload','/variant-upload','/cleanup','/health'].includes(path))return reply(404,{error:{code:'NOT_FOUND'}});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(path==='/health'){
   if(req.method!=='GET')return reply(405,{error:{code:'METHOD_NOT_ALLOWED'}});
   if(req.headers.has('Authorization')||new URL(req.url).search||req.headers.get('X-Minihompy-Auth-Mode')!=='public')fail('BAD_REQUEST');
   if(!env.SUPABASE_SERVICE_ROLE_KEY||!env.MINIHOMPY_SITE_ID||!env.MINIHOMPY_CENTRAL_API_URL||!env.SUPABASE_URL)fail('NOT_CONFIGURED');
   let capability={};try{const v=await (variantStatus||adapters({projectUrl:env.SUPABASE_URL,serviceKey:env.SUPABASE_SERVICE_ROLE_KEY,fetcher}).variantStatus)();if(v.photo_variant_protocol===1&&v.photo_variant_recipe==='display-v1')capability={photo_variant_protocol:1,photo_variant_recipe:'display-v1',...(v.photo_variant_read_protocol===1?{photo_variant_read_protocol:1}:{})};}catch{}
   return reply(200,{...capability,friend_media_protocol:1,friend_visibility_setup_protocol:1,site_id:env.MINIHOMPY_SITE_ID,central_api_url:env.MINIHOMPY_CENTRAL_API_URL,project_url:env.SUPABASE_URL});
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
  rpc=rpc||api.rpc;storage=storage||api.storage;variantRpc=variantRpc||adapters({projectUrl,serviceKey:env.SUPABASE_SERVICE_ROLE_KEY,fetcher,rpcName:'photo_variant'}).rpc;
  const raw=await bytesOf(req.body,['/upload','/variant-upload'].includes(path)?MAX_BYTES+16384:8192,bodyTimeout,req.signal);
  let args,bytes,mime;
  if(path==='/upload'||path==='/variant-upload'){
   if(!req.headers.get('Content-Type')?.startsWith('multipart/form-data;'))fail('BAD_REQUEST');
   let form;try{form=await new Response(raw,{headers:{'Content-Type':req.headers.get('Content-Type')}}).formData();}catch{fail('BAD_REQUEST');}
   if([...form.keys()].sort().join(',')!==(path==='/upload'?'file,path,post_id':'file,path,post_id,recipe,source_sha256'))fail('BAD_REQUEST');
   args={post_id:form.get('post_id'),path:form.get('path')};
   if(path==='/variant-upload'){args.recipe=form.get('recipe');args.source_sha256=form.get('source_sha256');}
   const file=form.get('file');if(!(file instanceof Blob))fail('BAD_REQUEST');
   bytes=new Uint8Array(await file.arrayBuffer());mime=imageType(bytes,path==='/variant-upload'?'variant.webp':String(args.path));
   if(file.type!==mime)fail('BAD_IMAGE');
  }else{
   if(!req.headers.get('Content-Type')?.startsWith('application/json'))fail('BAD_REQUEST');
   try{args=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{fail('BAD_REQUEST');}
   if(!args||Array.isArray(args)||typeof args!=='object')fail('BAD_REQUEST');
   if(Object.keys(args).sort().join(',')!==(path==='/read'?('representation'in args?'path,post_id,representation':'path,post_id'):'paths'))fail('BAD_REQUEST');
   if('representation'in args)validateRepresentation(args.representation);
  }
  if(path==='/cleanup'){
   if(!Array.isArray(args.paths)||args.paths.length<1||args.paths.length>20||new Set(args.paths).size!==args.paths.length
     ||args.paths.some(p=>typeof p!=='string'||!validPath(p.split('/')[0],p)))fail('BAD_REQUEST');
   // Individually retryable. A partial failure must never imply that all paths were removed.
   for(const path of args.paths){
    let a;try{a=await rpc('cleanup_begin',{owner_id:await owner(),path});}catch(e){if(e.code!=='VARIANTS_PENDING')throw e;a={failure:e.code};}
    if(a.failure==='VARIANTS_PENDING'){await cleanupVariants({path,owner,variantRpc,storage});a=await rpc('cleanup_begin',{owner_id:await owner(),path});}
    if(a.failure)fail(a.failure);
    await storage.remove(BUCKET,[path]);
    const finished=await rpc('cleanup_finish',{owner_id:await owner(),path});if(finished.failure)fail(finished.failure);
   }
   return reply(200,{ok:true});
  }
  if(!validPath(args.post_id,args.path))fail('BAD_REQUEST');
  if(path==='/variant-upload')return reply(200,await uploadVariant({args,bytes,uid,owner,rpc,variantRpc,storage,signal:req.signal}));
  if(path==='/upload'){
   const sha256=await digest(bytes),payload={...args,owner_id:uid,size:bytes.length,mime,sha256};
   const a=await rpc('reserve',payload);if(a.failure)fail(a.failure);
   if(!a.complete)await immutableCopy(storage,BUCKET,args.path,bytes,mime);
   await rpc('complete',{path:args.path,owner_id:await owner(),sha256});
   return reply(200,{path:args.path});
  }
  if(mode==='member')return await memberPhotoRead(req,{env,fetcher,db:db||memberDb({projectUrl,serviceKey:env.SUPABASE_SERVICE_ROLE_KEY,fetcher,signal:req.signal}),storage,args,headers});
  const reader=args.representation?(representationRpc||adapters({projectUrl,serviceKey:env.SUPABASE_SERVICE_ROLE_KEY,fetcher,rpcName:'photo_representation_read'}).rpc):rpc;
  const read=async()=>{const a=await reader('read',{...args,owner_id:uid?await owner():null});if(a.failure)fail(a.failure);return a;};
  const a=await read();bytes=await bounded(signal=>storage.get(BUCKET,selectedPath(a,args),signal),req.signal,30000);
  await verifyBytes(bytes,a,args);
  const latest=await read();
  sameSelection(a,latest,args);
  return new Response(bytes,{status:200,headers:{...headers,'Content-Type':a.mime,'Content-Length':String(bytes.length)}});
 }catch(e){if(e.code==='RATE_LIMITED')headers['Retry-After']=String(e.retryAfter||1);return reply(statuses[e.code]||503,{error:{code:statuses[e.code]?e.code:'UNAVAILABLE'}});}
}
