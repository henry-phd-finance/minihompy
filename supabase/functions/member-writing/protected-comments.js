import {authenticateOwner} from './handler.js';
import {authorize,bounded,contentTransport,ready,rpc} from './content-read.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS={BAD_REQUEST:400,AUTH_REQUIRED:401,SESSION_EXPIRED:401,SESSION_REVOKED:401,FORBIDDEN:403,TARGET_MISMATCH:403,NOT_FOUND:404,RATE_LIMITED:429,REQUEST_CONFLICT:409,REVISION_CONFLICT:409,NOT_CONFIGURED:503,IDENTITY_UNAVAILABLE:503,READ_CONTEXT_EXPIRED:503};
const fail=code=>{throw Object.assign(Error(code),{code});};
export async function commentCapability(req,context){
 try{
  const c=contentTransport(req,context.db,context.fetcher),r=await c.db.rpc('friend_comments_status',{});
  // Only known missing-RPC errors select the old public-only implementation.
  if(['42883','PGRST202'].includes(r?.error?.code))return {active:false};
  if(r?.error||r?.data?.protocol!==1||typeof r.data.ready!=='boolean')return {failure:true};
  return {active:r.data.ready};
 }catch{return {failure:true};}
}
function output(result,action,args,mode,actor){
 const receipt=d=>{
  if(!UUID.test(d?.id||'')||!Number.isInteger(d.revision)||d.revision<1||typeof d.deleted!=='boolean'||typeof d.replayed!=='boolean')fail('IDENTITY_UNAVAILABLE');
  if(action==='operations'){if(!['create','update','delete'].includes(d.operation)||d.deleted!==(d.operation==='delete')||!d.replayed)fail('IDENTITY_UNAVAILABLE');}
  else if(d.id!==args.id||d.deleted!==(action==='delete'))fail('IDENTITY_UNAVAILABLE');
  return {id:d.id,revision:d.revision,deleted:d.deleted,replayed:d.replayed,...(action==='operations'?{operation:d.operation}:{})};
 };
 if(action!=='list')return receipt(result);
 if(!Number.isSafeInteger(result?.count)||result.count<0||result.page!==args.page||result.size!==args.size||!Array.isArray(result.items)||result.items.length!==Math.min(args.size,Math.max(0,result.count-(args.page-1)*args.size)))fail('IDENTITY_UNAVAILABLE');
 const parentColumn={board:'board_post_id',photos:'photo_post_id',diary:'diary_entry_id'}[args.kind];
 const items=result.items.map(p=>{
  if(!UUID.test(p?.id||'')||p[parentColumn]!==args.parent_id||!['member','local'].includes(p.author_kind)||!Number.isInteger(p.revision)||p.revision<1||typeof p.body!=='string'||[...p.body].length>1000||typeof p.author_name!=='string'||[...p.author_name].length>20)fail('IDENTITY_UNAVAILABLE');
  for(const k of ['created_at','updated_at'])if(typeof p[k]!=='string'||!Number.isFinite(Date.parse(p[k])))fail('IDENTITY_UNAVAILABLE');
  for(const k of ['board_post_id','photo_post_id','diary_entry_id','guestbook_post_id'])if(k!==parentColumn&&p[k]!==null)fail('IDENTITY_UNAVAILABLE');
  if(p.author_kind==='member'){
   if(p.author_id!==null||!UUID.test(p.author_member_id||''))fail('IDENTITY_UNAVAILABLE');
   try{const u=new URL(p.author_homepage_url);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.href.length>2048)throw Error();}catch{fail('IDENTITY_UNAVAILABLE');}
  }else if(!(p.author_id===null||UUID.test(p.author_id||''))||p.author_member_id!==null||p.author_homepage_url!==null)fail('IDENTITY_UNAVAILABLE');
  const ownMember=mode==='member'&&p.author_kind==='member'&&p.author_member_id===actor;
  const ownLocal=mode==='owner'&&p.author_kind==='local'&&p.author_id===actor;
  const fields=['id','board_post_id','photo_post_id','diary_entry_id','guestbook_post_id','author_kind','author_id','author_member_id','author_homepage_url','author_name','body','revision','created_at','updated_at'];
  return {...Object.fromEntries(fields.map(k=>[k,p[k]])),can_edit:ownMember||ownLocal,can_delete:mode==='owner'||ownMember};
 });
 if(new Set(items.map(p=>p.id)).size!==items.length)fail('IDENTITY_UNAVAILABLE');
 return {items,count:result.count,page:result.page,size:result.size};
}
export async function protectedComments(req,context,mode,action,args,reply){
 const headers={'Cache-Control':'private, no-store',Vary:'Origin, Authorization, X-Minihompy-Auth-Mode'};
 try{
  const c={...context,...contentTransport(req,context.db,context.fetcher)};
  if(mode==='public'&&(req.headers.has('Authorization')||action!=='list'))fail('FORBIDDEN');
  if(mode==='owner'&&!['list','delete','operations'].includes(action))fail('FORBIDDEN');
  const state=ready(await rpc(c.db,'friend_visibility_status',{}));if(!state.friend_visibility_ready)fail('NOT_CONFIGURED');
  const scope=mode==='public'?'public':'visible',selectors={kind:args.kind,parent_id:args.parent_id,...(action==='list'?{page:args.page,size:args.size}:{operation_id:args.request_id})};
  let checked,auth={},actor,check=()=>{if(req.signal.aborted)fail('IDENTITY_UNAVAILABLE');};
  if(mode==='member'){
   checked=await authorize(req,c,state,scope,selectors,action,'comments');auth=checked.args;actor=checked.verified.session.member_id;check=checked.fence;
  }else if(mode==='owner'){
   if(!c.publicKey)fail('NOT_CONFIGURED');auth.owner_id=(await bounded(()=>authenticateOwner(req,c),req.signal,15000)).local_user_id;actor=auth.owner_id;
  }
  const remaining=()=>checked?checked.remaining():5000;check();
  const result=await bounded(signal=>rpc(c.db,'member_content_comments',{p_action:action,p_args:{access:{site_id:c.siteId,mode,scope,selectors,...auth},operation:args}},signal),req.signal,remaining()).catch(e=>{check();throw e;});check();
  const clean=output(result,action,args,mode,actor);
  if(mode==='member'){
   const s=await bounded(signal=>rpc(c.db,'member_writing_session',{p_action:'current',p_args:{site_id:c.siteId,token_hash:checked.verified.tokenHash}},signal),req.signal,remaining()).catch(e=>{check();throw e;});
   if(s.member_id!==actor||s.central_session_id!==checked.verified.session.central_session_id)fail('TARGET_MISMATCH');
  }else if(mode==='owner'&&(await bounded(()=>authenticateOwner(req,c),req.signal,15000)).local_user_id!==actor)fail('FORBIDDEN');
  check();if(new TextEncoder().encode(JSON.stringify(clean)).length>1048576)fail('IDENTITY_UNAVAILABLE');const response=reply(200,clean,headers);check();return response;
 }catch(e){const code=Object.hasOwn(STATUS,e?.code)?e.code:'IDENTITY_UNAVAILABLE';return reply(STATUS[code],{error:{code,message:'댓글을 확인하지 못했습니다. 다시 시도해 주세요.'}},{...headers,...(code==='RATE_LIMITED'?{'Retry-After':String(e.retryAfter||1)}:{})});}
}
