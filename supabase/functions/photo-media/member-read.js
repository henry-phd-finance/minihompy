import {authorize,bounded,contentTransport,ready,rpc} from '../member-writing/content-read.js';
import {BUCKET,MAX_BYTES,digest,imageType,bytesOf,fail} from './io.js';
// Named service RPC adapter, never a browser-facing DB proxy.
export function memberDb({projectUrl,serviceKey,fetcher,signal}){
 return {rpc:(name,args)=>{
  const run=async abort=>{
   const r=await fetcher(projectUrl+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify(args),redirect:'error',signal:AbortSignal.any([signal,abort])});
   const bytes=await bytesOf(r.body,16384,5000,AbortSignal.any([signal,abort]));
   if(!r.ok)return {error:{code:'RPC_FAILED'}};
   return {data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};
  };
  return {abortSignal:run};
 }};
}
export async function memberPhotoRead(req,{env,fetcher,db,storage,args,headers}){
 return bounded(async signal=>{
  req=new Request(req.url,{method:req.method,headers:req.headers,signal:AbortSignal.any([req.signal,signal])});
  const siteId=env.MINIHOMPY_SITE_ID,centralUrl=env.MINIHOMPY_CENTRAL_API_URL;
  if(!/^[0-9a-f-]{36}$/.test(siteId||''))fail('NOT_CONFIGURED');
  try{const u=new URL(centralUrl);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search||u.href.replace(/\/$/,'')!==centralUrl)throw Error();}catch{fail('NOT_CONFIGURED');}
  const c={siteId,centralUrl,...contentTransport(req,db,fetcher)};
  const check=async()=>{
   const state=ready(await rpc(c.db,'friend_visibility_status',{}));if(!state.friend_visibility_ready)fail('NOT_CONFIGURED');
   const proof=await authorize(req,c,state,'visible',args,'read','photo');
   const a=await bounded(s=>rpc(c.db,'member_photo_read',{p_action:'read',p_args:{site_id:siteId,mode:'member',scope:'visible',selectors:args,...proof.args}},s),req.signal,proof.remaining());proof.fence();
   if(a.post_id!==args.post_id||a.path!==args.path||!Number.isInteger(a.size)||a.size<1||a.size>MAX_BYTES||!['image/png','image/jpeg','image/gif','image/webp'].includes(a.mime)||!/^[0-9a-f]{64}$/.test(a.sha256||''))fail('INTEGRITY_FAILURE');
   return {a,proof};
  };
  const first=await check();
  const bytes=await bounded(s=>storage.get(BUCKET,args.path,s),req.signal,30000);
  if(!(bytes instanceof Uint8Array)||bytes.length!==first.a.size||imageType(bytes,args.path)!==first.a.mime||await digest(bytes)!==first.a.sha256)fail('INTEGRITY_FAILURE');
  // A fresh central read context after buffering, not an extension of the first one.
  const last=await check();
  if(last.a.sha256!==first.a.sha256||last.a.size!==first.a.size||last.a.mime!==first.a.mime)fail('NOT_FOUND');
  const current=await bounded(s=>rpc(c.db,'member_writing_session',{p_action:'current',p_args:{site_id:siteId,token_hash:last.proof.verified.tokenHash}},s),req.signal,last.proof.remaining());
  if(current.member_id!==last.proof.verified.session.member_id||current.central_session_id!==last.proof.verified.session.central_session_id)fail('TARGET_MISMATCH');
  last.proof.fence();const response=new Response(bytes,{status:200,headers:{...headers,'Content-Type':last.a.mime,'Content-Length':String(bytes.length)}});last.proof.fence();return response;
 },req.signal,45000);
}
