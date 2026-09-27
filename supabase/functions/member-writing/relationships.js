import {reviewRpc} from './friend-reviews.js';
import {authenticateMember} from './handler.js';
import {input,output,json,fail,errorReply,STATUS} from './relationship-protocol.js';
async function localCurrent(context,authenticated){
 const r=await context.db.rpc('member_writing_session',{p_action:'current',p_args:{site_id:context.siteId,token_hash:authenticated.tokenHash}});
 if(r.error||!r.data)fail('IDENTITY_UNAVAILABLE');if(r.data.failure)fail(r.data.failure);
 if(r.data.member_id!==authenticated.session.member_id||r.data.central_session_id!==authenticated.session.central_session_id)fail('FORBIDDEN');
}
async function central(context,action,body,authenticated){
 const start=Date.now();let response;
 try{response=await context.fetcher(context.centralUrl+'/relationships/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+authenticated.session.central_grant},body:JSON.stringify({...body,site_id:context.siteId}),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)});}catch{fail('IDENTITY_UNAVAILABLE');}
 const raw=await json(response,262144,'IDENTITY_UNAVAILABLE');
 if(!response.ok){const code=raw.error?.code;if(!Object.hasOwn(STATUS,code)||STATUS[code]!==response.status)fail('IDENTITY_UNAVAILABLE');try{fail(code);}catch(e){e.retryAfter=Number(response.headers.get('Retry-After'));throw e;}}
 const data=output(action,raw,{wireCursor:true});
 if(action==='state'&&data.target.member_id!==body.target_member_id)fail('TARGET_MISMATCH');
 if(['actions','operations'].includes(action)&&data.operation_result.operation_id!==body.operation_id)fail('TARGET_MISMATCH');
 if(action==='actions'&&(data.relationship.target.member_id!==body.target_member_id||data.operation_result.action!==body.action))fail('TARGET_MISMATCH');
 await localCurrent(context,authenticated);
 return {data,serverTime:raw.server_time,start,end:Date.now()};
}
// Server-only authorization helper; never expose permits as a browser route.
export async function requestReviewPermit(context,authenticated,body){
 const args=input('review-permits',body);
 let owner;try{const response=await context.fetcher(context.centralUrl+'/navigation/site?site_id='+encodeURIComponent(context.siteId),{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)fail('IDENTITY_UNAVAILABLE');owner=(await json(response,8192,'IDENTITY_UNAVAILABLE')).item;if(owner?.site_id!==context.siteId)fail('TARGET_MISMATCH');}catch{fail('IDENTITY_UNAVAILABLE');}
 const r=await central(context,'review-permits',args,authenticated),d=r.data;
 if(d.actor_member_id!==authenticated.session.member_id||d.site_id!==context.siteId||d.central_session_id!==authenticated.session.central_session_id||d.operation_id!==args.operation_id||d.body_sha256!==args.body_sha256||d.owner_member_id===d.actor_member_id||d.owner_member_id!==owner.id)fail('TARGET_MISMATCH');
 const clock=Date.parse(r.serverTime);if(!Number.isFinite(clock)||clock<r.start-5000||clock>r.end+5000)fail('IDENTITY_UNAVAILABLE');
 if(Date.parse(d.expires_at)<=r.end)fail('PERMIT_EXPIRED');
 return d;
}
export async function relationships(req,context,mode,path,reply){
 try{
  const action=path.slice('/relationships/'.length);
  if(action==='health'){
   if(req.method!=='GET')fail('METHOD_NOT_ALLOWED');
   let ready=false;try{const r=await context.fetcher(context.centralUrl+'/health',{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(10000)});ready=r.ok&&(await json(r,8192,'IDENTITY_UNAVAILABLE')).relationship_protocol===1;}catch{}
   let reviews=false;try{reviews=(await reviewRpc(context,'health',{})).friend_reviews_protocol===1;}catch{}
   return reply(200,{relationship_protocol:ready?1:0,relationship_relay_ready:ready,friend_reviews_ready:ready&&reviews});
  }
  if(!['state','requests','actions','operations'].includes(action))fail('NOT_FOUND');
  if(mode!=='member')fail('FORBIDDEN');
  if(req.method!=='POST')fail('METHOD_NOT_ALLOWED');
  if(new URL(req.url).search||req.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')fail('BAD_REQUEST');
  const args=input(action,await json(req));const a=await authenticateMember(req,context);
  const r=await central(context,action,args,a);
  return reply(200,r.data);
 }catch(e){const r=errorReply(e);return reply(r.status,r.body,r.headers);}
}
