import {commentCapability,protectedComments} from './protected-comments.js';
import {contentRead,contentTransport,bounded} from './content-read.js';
import {friendReviews} from './friend-reviews.js';
import {relationships} from './relationships.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE=/^[A-Za-z0-9_-]{43}$/;
const statuses={RATE_LIMITED:429,REVISION_CONFLICT:409,BAD_REQUEST:400,AUTH_REQUIRED:401,SESSION_EXPIRED:401,SESSION_REVOKED:401,FORBIDDEN:403,TARGET_MISMATCH:403,NOT_FOUND:404,REQUEST_CONFLICT:409,IDENTITY_UNAVAILABLE:503,NOT_CONFIGURED:503};
const env=k=>globalThis.Deno?.env?.get(k)??globalThis.process?.env?.[k];
class Failure extends Error{constructor(code){super('회원 인증을 확인하지 못했습니다.');this.code=code;this.status=statuses[code]||503;}}
const fail=code=>{throw new Failure(code);};
export async function tokenHash(token){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
const secret=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function limitedJson(response,max=16384,signal){
 const reader=response.body?.getReader();if(!reader)fail('BAD_REQUEST');let size=0;const chunks=[];
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)fail('BAD_REQUEST');chunks.push(value);}}finally{signal?.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{const v=JSON.parse(new TextDecoder().decode(bytes));if(!v||Array.isArray(v)||typeof v!=='object')fail('BAD_REQUEST');return v;}catch{fail('BAD_REQUEST');}
}
function bearer(req){const match=/^Bearer (\S+)$/.exec(req.headers.get('Authorization')||'');if(!match||match[1].length>16384)fail('AUTH_REQUIRED');return match[1];}
function cleanUrl(raw){try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search)throw Error();return u.href.replace(/\/$/,'');}catch{fail('NOT_CONFIGURED');}}
async function callRpc(db,action,args={}){
 let result;try{result=await db.rpc('member_writing_session',{p_action:action,p_args:args});}catch{fail('IDENTITY_UNAVAILABLE');}
 if(result.error)fail(result.error.code==='23505'?'REQUEST_CONFLICT':'IDENTITY_UNAVAILABLE');
 if(!result.data)fail('IDENTITY_UNAVAILABLE');if(result.data.failure)fail(result.data.failure);return result.data;
}
async function central(fetcher,base,path,body,credential){
 try{
  const r=await fetcher(`${base}/${path}`,{method:'POST',headers:{'Content-Type':'application/json',...(credential?{Authorization:`Bearer ${credential}`}:{})},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000),credentials:'omit'});
  if(!r.ok){if(r.status===429){const e=new Failure('RATE_LIMITED');const seconds=Number(r.headers.get('Retry-After'));e.retryAfter=Number.isInteger(seconds)&&seconds>=1&&seconds<=60?seconds:1;throw e;}if(r.status===401)fail('SESSION_REVOKED');if(r.status===403)fail('FORBIDDEN');if(r.status===409)fail('REQUEST_CONFLICT');if(r.status===400)fail('BAD_REQUEST');fail('IDENTITY_UNAVAILABLE');}
  return await limitedJson(r);
 }catch(e){if(e instanceof Failure)throw e;fail('IDENTITY_UNAVAILABLE');}
}
function checkedGrant(data,site){
 if(data.active!==true||data.site_id!==site||!UUID.test(data.member?.id||'')||!UUID.test(data.central_session_id||'')||!UUID.test(data.proof_id||''))fail('IDENTITY_UNAVAILABLE');
 const expiry=Date.parse(data.expires_at);if(!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+900000)fail('SESSION_EXPIRED');
 const name=data.member.display_name;if(typeof name!=='string'||[...name.trim()].length<1||[...name].length>20||/[\u0000-\u001f\u007f]/.test(name))fail('IDENTITY_UNAVAILABLE');
 try{const u=new URL(data.member.homepage_url);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.href.length>2048)throw Error();}catch{fail('IDENTITY_UNAVAILABLE');}
 return data;
}
const publicSession=s=>({actor:{kind:'member',member_id:s.member_id,display_name:s.display_name,homepage_url:s.homepage_url,role:'writer'},expires_at:s.expires_at});
export async function authenticateMember(req,{db,fetcher,centralUrl,siteId}){
 const token=bearer(req);if(!OPAQUE.test(token))fail('AUTH_REQUIRED');
 const hash=await tokenHash(token),s=await callRpc(db,'current',{site_id:siteId,token_hash:hash});
 const g=checkedGrant(await central(fetcher,centralUrl,'writing-grants/check',{site_id:siteId},s.central_grant),siteId);
 if(g.member.id!==s.member_id||g.central_session_id!==s.central_session_id||g.proof_id!==s.proof_id)fail('FORBIDDEN');
 // Recheck after remote verification so a local logout during the HTTP wait wins.
 const current=await callRpc(db,'current',{site_id:siteId,token_hash:hash});
 return {session:current,tokenHash:hash};
}
export async function authenticateOwner(req,{fetcher,projectUrl,publicKey}){
 const token=bearer(req);if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))fail('AUTH_REQUIRED');
 const headers={apikey:publicKey,Authorization:`Bearer ${token}`};
 try{
  const userResponse=await fetcher(`${projectUrl}/auth/v1/user`,{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!userResponse.ok)fail(userResponse.status>=500?'IDENTITY_UNAVAILABLE':'AUTH_REQUIRED');
  const user=await limitedJson(userResponse);
  if(!UUID.test(user.id||'')||user.is_anonymous!==false)fail('FORBIDDEN');
  const permission=await fetcher(`${projectUrl}/rest/v1/rpc/is_minihompy_admin`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!permission.ok)fail(permission.status>=500?'IDENTITY_UNAVAILABLE':'FORBIDDEN');
  if((await permission.text())!=='true')fail('FORBIDDEN');
  return {kind:'owner',local_user_id:user.id,role:'admin'};
 }catch(e){if(e instanceof Failure)throw e;fail('IDENTITY_UNAVAILABLE');}
}
export async function handleMemberWriting(req,options={}){
 const contentRequest=new URL(req.url).pathname.includes('/content/');
 const config=k=>options.config?.[k]??env(k),origin=req.headers.get('Origin');
 const headers={'Content-Type':'application/json','Cache-Control':'no-store',Vary:'Origin','Access-Control-Expose-Headers':'Retry-After','Access-Control-Allow-Methods':'GET, POST, PATCH, DELETE, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, apikey, X-Minihompy-Auth-Mode'};
 if(contentRequest||/\/comments(?:\/|$)/.test(new URL(req.url).pathname)){headers['Cache-Control']='private, no-store';headers.Vary='Origin, Authorization, X-Minihompy-Auth-Mode';}
 const reply=(status,body,extra={})=>new Response(JSON.stringify(body),{status,headers:{...headers,...extra}});
 if(origin&&origin===config('MINIHOMPY_SITE_ORIGIN'))headers['Access-Control-Allow-Origin']=origin;
 if(!config('MINIHOMPY_SITE_ORIGIN'))return reply(503,{error:{code:'NOT_CONFIGURED'}});
 if(origin&&origin!==config('MINIHOMPY_SITE_ORIGIN'))return reply(403,{error:{code:'FORBIDDEN'}});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 try{
  const siteId=config('MINIHOMPY_SITE_ID'),centralUrl=cleanUrl(config('MINIHOMPY_CENTRAL_API_URL'));
  if(!UUID.test(siteId||''))fail('NOT_CONFIGURED');
  const projectUrl=cleanUrl(config('SUPABASE_URL'));
  if(!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(projectUrl))fail('NOT_CONFIGURED');
  let fetcher=options.fetcher||fetch;
  let db=options.db;
  if(!db){const key=config('SUPABASE_SERVICE_ROLE_KEY');if(!key)fail('NOT_CONFIGURED');const {createClient}=await import('npm:@supabase/supabase-js@2.39.8');db=createClient(projectUrl,key,{auth:{persistSession:false}});}
  if(contentRequest)({db,fetcher}=contentTransport(req,db,fetcher));
  const cfg=await callRpc(db,'site');if(cfg.site_id!==siteId||cleanUrl(cfg.central_api_url)!==centralUrl)fail('NOT_CONFIGURED');
  const context={db,fetcher,siteId,centralUrl,projectUrl,transportPeerIp:options.transportPeerIp,publicKey:config('MINIHOMPY_PUBLIC_KEY')||config('SUPABASE_ANON_KEY')};
  const path=new URL(req.url).pathname.replace(/^\/(?:functions\/v1\/)?member-writing(?=\/|$)/,'');
  const mode=req.headers.get('X-Minihompy-Auth-Mode');
  if(!['member','owner','public'].includes(mode))fail('BAD_REQUEST');
  if(path.startsWith('/content/'))return await contentRead(req,context,mode,path,reply);
  if(path==='/friend-reviews'||path.startsWith('/friend-reviews/'))return await friendReviews(req,context,mode,path,reply);
  if(path.startsWith('/relationships/'))return await relationships(req,context,mode,path,reply);
  if(path==='/comments'||path.startsWith('/comments/'))return await comments(req,context,mode,path,reply);
  if(path==='/guestbook'||path.startsWith('/guestbook/'))return await guestbook(req,context,mode,path,reply);
  if(mode==='public')fail('FORBIDDEN'); // Public mode cannot access session endpoints.
  if(mode==='owner'){
   if(path!=='/sessions/current'||req.method!=='GET')fail('FORBIDDEN');
   if(!context.publicKey)fail('NOT_CONFIGURED');
   return reply(200,{actor:await authenticateOwner(req,context)});
  }
  if(path==='/sessions/current'&&req.method==='GET')return reply(200,publicSession((await authenticateMember(req,context)).session));
  if(req.method!=='POST')return reply(405,{error:{code:'METHOD_NOT_ALLOWED'}});
  if(!req.headers.get('Content-Type')?.startsWith('application/json'))fail('BAD_REQUEST');
  const body=await limitedJson(req);
  async function revoke(token){
   if(!OPAQUE.test(token))fail('AUTH_REQUIRED');
   const s=await callRpc(db,'revoke',{site_id:siteId,token_hash:await tokenHash(token)});
   if(s.central_delegation){
    await central(fetcher,centralUrl,'writing-delegations/revoke',{},s.central_delegation);
    await callRpc(db,'cleanup_done',{site_id:siteId,renewal_hash:s.renewal_hash});
   }else await central(fetcher,centralUrl,'writing-grants/revoke',{},s.central_grant);
  }
  if(path==='/sessions/revoke'){
   if(Object.keys(body).length)fail('BAD_REQUEST');await revoke(bearer(req));return reply(200,{revoked:true});
  }
  if(path==='/sessions/renew'){
   if(Object.keys(body).length)fail('BAD_REQUEST');
   const credential=bearer(req);if(!OPAQUE.test(credential))fail('AUTH_REQUIRED');
   const renewal_hash=await tokenHash(credential);
   const family=await callRpc(db,'family',{site_id:siteId,renewal_hash});
   const raw=await central(fetcher,centralUrl,'writing-delegations/renew',{site_id:siteId},family.central_delegation);
   const token=secret();let stored;
   try{
    const g=checkedGrant(raw,siteId);
    if(!OPAQUE.test(g.grant||'')||g.member.id!==family.member_id||g.central_session_id!==family.central_session_id||g.proof_id!==family.proof_id)fail('FORBIDDEN');
    const expiry=Date.parse(family.expires_at),centralExpiry=Date.parse(g.delegation_expires_at);
    if(!Number.isFinite(centralExpiry)||centralExpiry>expiry||Date.parse(g.expires_at)>Math.min(expiry,centralExpiry))fail('SESSION_EXPIRED');
    stored=await callRpc(db,'renew_create',{site_id:siteId,renewal_hash,member_id:g.member.id,central_session_id:g.central_session_id,proof_id:g.proof_id,token_hash:await tokenHash(token),central_grant:g.grant,display_name:g.member.display_name,homepage_url:g.member.homepage_url,expires_at:g.expires_at});
   }catch(e){if(OPAQUE.test(raw.grant||''))await central(fetcher,centralUrl,'writing-grants/revoke',{},raw.grant).catch(()=>{});throw e;}
   return reply(200,{session_token:token,...publicSession(stored)});
  }
  if(path!=='/sessions/exchange')fail('NOT_FOUND');
  const v2=body.protocol===2;
  if(body.protocol!==undefined&&!v2)fail('BAD_REQUEST');
  if(v2&&(typeof body.attempt_id!=='string'||!body.attempt_id||body.attempt_id.length>128||/[\u0000-\u001f\u007f]/.test(body.attempt_id)))fail('BAD_REQUEST');
  if(Object.keys(body).some(k=>!(v2?['writing_proof','code_verifier','protocol','attempt_id']:['writing_proof','code_verifier']).includes(k))||typeof body.writing_proof!=='string'||body.writing_proof.length>4096||typeof body.code_verifier!=='string'||!/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier))fail('BAD_REQUEST');
  // A new proof replaces the previous family/session after revocation; renewal above reuses the family.
  if(req.headers.has('Authorization'))await revoke(bearer(req));
  const raw=await central(fetcher,centralUrl,'writing-proofs/redeem',{...body,site_id:siteId});
  let stored;
  const token=secret(),renewal=v2?secret():null;
  try{
   const g=checkedGrant(raw,siteId);if(!OPAQUE.test(g.grant||''))fail('IDENTITY_UNAVAILABLE');
   if(v2){const deadline=Date.parse(g.delegation_expires_at);if(!OPAQUE.test(g.delegation||'')||!Number.isFinite(deadline)||deadline<=Date.now()||deadline>Date.now()+30*86400000||Date.parse(g.expires_at)>deadline)fail('IDENTITY_UNAVAILABLE');}
   stored=await callRpc(db,v2?'create_v2':'create',{...(v2?{renewal_hash:await tokenHash(renewal),central_delegation:g.delegation,renewal_expires_at:g.delegation_expires_at}:{}),site_id:siteId,member_id:g.member.id,central_session_id:g.central_session_id,proof_id:g.proof_id,token_hash:await tokenHash(token),central_grant:g.grant,display_name:g.member.display_name,homepage_url:g.member.homepage_url,expires_at:g.expires_at});
  }catch(e){if(v2&&OPAQUE.test(raw.delegation||''))await central(fetcher,centralUrl,'writing-delegations/revoke',{},raw.delegation).catch(()=>{});if(OPAQUE.test(raw.grant||''))await central(fetcher,centralUrl,'writing-grants/revoke',{},raw.grant).catch(()=>{});throw e;}
  return reply(200,{session_token:token,...publicSession(stored),...(v2?{renewal_token:renewal,renewal_expires_at:raw.delegation_expires_at}:{})});
 }catch(e){if(e.status===429)headers['Retry-After']=String(e.retryAfter||1);return reply(e instanceof Failure?e.status:503,{error:{code:e instanceof Failure?e.code:'IDENTITY_UNAVAILABLE',message:'회원 인증을 확인하지 못했습니다. 다시 시도해 주세요.'}});}
}

async function guestbook(req,context,mode,path,reply){
 const {db,siteId}=context;let auth={site_id:siteId,mode};
 if(mode==='member'){const verified=await authenticateMember(req,context);auth.token_hash=verified.tokenHash;}
 else if(mode==='owner'){if(!context.publicKey)fail('NOT_CONFIGURED');auth.owner_id=(await authenticateOwner(req,context)).local_user_id;}
 else if(mode!=='public')fail('BAD_REQUEST');
 let action,args;
 if(path==='/guestbook'&&req.method==='GET'){
  const q=new URL(req.url).searchParams;
  args={page:Number(q.get('page')||1),size:Number(q.get('size')||5)};
  if(q.has('post')){if(q.getAll('post').length!==1||!UUID.test(q.get('post')||''))fail('BAD_REQUEST');args.post=q.get('post');}
  if(!Number.isInteger(args.page)||args.page<1||args.page>100000||!Number.isInteger(args.size)||args.size<1||args.size>20)fail('BAD_REQUEST');action='list';
 }else{
  if(mode==='public')fail('FORBIDDEN');
  if(!req.headers.get('Content-Type')?.startsWith('application/json'))fail('BAD_REQUEST');
  const body=await limitedJson(req,32768);const match=/^\/guestbook\/([0-9a-f-]+)(\/private)?$/i.exec(path);
  if(path==='/guestbook'&&req.method==='POST')action='create';
  else if(match&&UUID.test(match[1])&&req.method==='PATCH'&&!match[2])action='update';
  else if(match&&UUID.test(match[1])&&req.method==='DELETE'&&!match[2])action='delete';
  else if(match&&UUID.test(match[1])&&req.method==='POST'&&match[2])action='private';
  else fail('NOT_FOUND');
  const fields={create:['request_id','id','body','visibility'],update:['request_id','revision','body'],private:['request_id','revision'],delete:['request_id','revision']}[action];
  if(Object.keys(body).some(k=>!fields.includes(k))||!UUID.test(body.request_id||''))fail('BAD_REQUEST');
  if(action==='create'&&(!UUID.test(body.id||'')||!['public','private'].includes(body.visibility)))fail('BAD_REQUEST');
  if(action!=='create'&&(!Number.isInteger(body.revision)||body.revision<1||body.revision>2147483647))fail('BAD_REQUEST');
  if(['create','update'].includes(action)&&(typeof body.body!=='string'||!body.body.trim()||[...body.body].length>5000))fail('BAD_REQUEST');
  args={...body,...(match?{id:match[1]}:{})};
 }
 const result=await db.rpc('member_guestbook',{p_action:action,p_args:{...args,...auth}});
 if(result.error||!result.data)fail('IDENTITY_UNAVAILABLE');if(result.data.failure)fail(result.data.failure);
 return reply(200,result.data);
}

async function comments(req,context,mode,path,reply){
 const {db,siteId}=context;const auth={site_id:siteId,mode};
 let action,args;
 const operationMatch=/^\/comments\/operations\/([0-9a-f-]+)$/i.exec(path);
 if((path==='/comments'||operationMatch)&&req.method==='GET'){
  const q=new URL(req.url).searchParams;
  for(const k of q.keys())if(!['kind','parent_id',...(operationMatch?[]:['page','size'])].includes(k)||q.getAll(k).length!==1)fail('BAD_REQUEST');
  args={kind:q.get('kind'),parent_id:q.get('parent_id'),page:Number(q.get('page')||1),size:Number(q.get('size')||20)};
  if(!Number.isInteger(args.page)||args.page<1||args.page>100000||!Number.isInteger(args.size)||args.size<1||args.size>100)fail('BAD_REQUEST');
  action=operationMatch?'operations':'list';
  if(operationMatch){if(!UUID.test(operationMatch[1]))fail('BAD_REQUEST');args={kind:args.kind,parent_id:args.parent_id,request_id:operationMatch[1]};}
 }else{
  if(mode==='public')fail('FORBIDDEN');
  if(!req.headers.get('Content-Type')?.startsWith('application/json'))fail('BAD_REQUEST');
  const body=await bounded(signal=>limitedJson(req,8192,signal),req.signal,5000);const match=/^\/comments\/([0-9a-f-]+)$/i.exec(path);
  if(path.startsWith('/relationships/'))return await relationships(req,context,mode,path,reply);
  if(path==='/comments'&&req.method==='POST')action='create';
  else if(match&&UUID.test(match[1])&&req.method==='PATCH')action='update';
  else if(match&&UUID.test(match[1])&&req.method==='DELETE')action='delete';
  else fail('NOT_FOUND');
  const fields=['request_id','kind','parent_id',...(action==='create'?['id','body']:action==='update'?['revision','body']:['revision'])];
  if(Object.keys(body).some(k=>!fields.includes(k))||!UUID.test(body.request_id||''))fail('BAD_REQUEST');
  if(action==='create'&&!UUID.test(body.id||''))fail('BAD_REQUEST');
  if(action!=='create'&&(!Number.isInteger(body.revision)||body.revision<1||body.revision>2147483647))fail('BAD_REQUEST');
  if(action!=='delete'&&(typeof body.body!=='string'||!body.body.trim()||[...body.body].length>1000))fail('BAD_REQUEST');
  args={...body,...(match?{id:match[1]}:{})};
 }
 if(!['board','photos','diary','guestbook'].includes(args.kind)||!UUID.test(args.parent_id||''))fail('BAD_REQUEST');
 for(const key of ['parent_id','id','request_id'])if(args[key])args[key]=args[key].toLowerCase();
 if(args.kind!=='guestbook'){
  const capability=await commentCapability(req,context);
  if(capability.active)return protectedComments(req,context,mode,action,args,reply);
  if(capability.failure)return reply(503,{error:{code:'NOT_CONFIGURED',message:'댓글 기능을 확인하지 못했습니다.'}});
 }
 if(action==='operations')fail('NOT_CONFIGURED');
 if(mode==='member')auth.token_hash=(await authenticateMember(req,context)).tokenHash;
 else if(mode==='owner'){if(!context.publicKey)fail('NOT_CONFIGURED');auth.owner_id=(await authenticateOwner(req,context)).local_user_id;}
 const result=await db.rpc('member_comments',{p_action:action,p_args:{...args,...auth}});
 if(result.error||!result.data)fail('IDENTITY_UNAVAILABLE');if(result.data.failure)fail(result.data.failure);
 return reply(200,result.data);
}
