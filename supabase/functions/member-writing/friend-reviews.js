import {authenticateMember,authenticateOwner,tokenHash} from './handler.js';
import {requestReviewPermit} from './relationships.js';
import {UUID,json,fail,errorReply} from './relationship-protocol.js';
export async function reviewRpc(context,action,args){
 let r;try{const query=context.db.rpc('member_friend_reviews',{p_action:action,p_args:{...args,site_id:context.siteId}});r=await (query.abortSignal?query.abortSignal(AbortSignal.timeout(5000)):query);}catch{fail('IDENTITY_UNAVAILABLE');}
 if(r.error||!r.data)fail('IDENTITY_UNAVAILABLE');
 if(r.data.failure){try{fail(r.data.failure);}catch(e){e.retryAfter=r.data.retry_after;throw e;}}
 return r.data;
}
function cursor(value,site){
 try{if(!/^[A-Za-z0-9_-]{1,512}$/.test(value))throw Error();const c=JSON.parse(atob(value.replace(/-/g,'+').replace(/_/g,'/')));
  if(Object.keys(c).sort().join()!=='id,site,time,v'||c.v!==1||c.site!==site||!UUID.test(c.id)||typeof c.time!=='string'||!Number.isFinite(Date.parse(c.time)))throw Error();return c;
 }catch{fail('BAD_REQUEST');}
}
export async function friendReviews(req,context,mode,path,reply){
 try{
  if(path==='/friend-reviews'&&req.method==='GET'){
   const q=new URL(req.url).searchParams;
   for(const k of q.keys())if(!['limit','cursor'].includes(k)||q.getAll(k).length!==1)fail('BAD_REQUEST');
   const limit=q.has('limit')?Number(q.get('limit')):20;if(!Number.isInteger(limit)||limit<1||limit>50)fail('BAD_REQUEST');
   const after=q.has('cursor')?cursor(q.get('cursor'),context.siteId):null;
   // Only the transport adapter supplies this value. Never trust forwarding headers.
   if(typeof context.transportPeerIp!=='string'||!context.transportPeerIp||context.transportPeerIp.length>256)fail('IDENTITY_UNAVAILABLE');
   const result=await reviewRpc(context,'list',{mode:'public',limit,peer_hash:await tokenHash(context.siteId+':'+context.transportPeerIp),...(after?{before_time:after.time,before_id:after.id}:{})});
   const items=result.items.slice(0,limit),last=items.at(-1);
   const next_cursor=result.items.length>limit?btoa(JSON.stringify({v:1,site:context.siteId,time:last.created_at,id:last.id})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''):null;
   return reply(200,{items,next_cursor});
  }
  if(!['/friend-reviews','/friend-reviews/delete','/friend-reviews/operations'].includes(path))fail('NOT_FOUND');
  if(req.method!=='POST')fail('METHOD_NOT_ALLOWED');
  if(new URL(req.url).search||req.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')fail('BAD_REQUEST');
  const body=await json(req),action=path==='/friend-reviews'?'create':path.endsWith('/delete')?'delete':'operations';
  const fields=action==='create'?['operation_id','body']:action==='delete'?['operation_id','review_id']:['operation_id'];
  if(Object.keys(body).some(k=>!fields.includes(k))||!UUID.test(body.operation_id||''))fail('BAD_REQUEST');
  body.operation_id=body.operation_id.toLowerCase();
  if(action==='delete'){if(!UUID.test(body.review_id||''))fail('BAD_REQUEST');body.review_id=body.review_id.toLowerCase();}
  if(action==='create'){
   if(typeof body.body!=='string')fail('BAD_REQUEST');
   body.body=body.body.replace(/\r\n/g,'\n').trim();
   if(!body.body||[...body.body].length>200||/[\u0000-\u0009\u000b-\u001f\u007f]/u.test(body.body))fail('BAD_REQUEST');
  }
  let authenticated,auth={mode};
  if(mode==='member'){authenticated=await authenticateMember(req,context);auth.token_hash=authenticated.tokenHash;}
  else if(mode==='owner'&&action!=='create'){if(!context.publicKey)fail('NOT_CONFIGURED');auth.owner_id=(await authenticateOwner(req,context)).local_user_id;}
  else fail('FORBIDDEN');
  if(action==='create'){
   try{return reply(200,await reviewRpc(context,'lookup',{...body,...auth}));}catch(e){if(e.code!=='NOT_FOUND')throw e;}
   const permit=await requestReviewPermit(context,authenticated,{operation_id:body.operation_id,body_sha256:await tokenHash(body.body)});
   // Central logout after authorization must be observed before the local commit.
   const current=await authenticateMember(req,context);
   if(current.session.member_id!==authenticated.session.member_id||current.session.central_session_id!==permit.central_session_id)fail('TARGET_MISMATCH');
   return reply(200,await reviewRpc(context,'create',{...body,...auth,permit,checked_at:new Date().toISOString()}));
  }
  return reply(200,await reviewRpc(context,action,{...body,...auth}));
 }catch(e){const r=errorReply(e);return reply(r.status,r.body,r.headers);}
}
