(() => {
 'use strict';
 window.createMinihompyFriendReviews=({runtime=window.MinihompyMemberWriting,fetcher=window.fetch}={})=>{
  const operations=new WeakMap();
  const call=(path,options,stamp=runtime.snapshot())=>runtime.review('/friend-reviews'+path,options,stamp);
  function owned(op){const record=operations.get(op);if(!record)throw Error('Unknown operation');runtime.check(record.stamp);return record;}
  return Object.freeze({
   async list(cursor=null){const r=await call('?'+new URLSearchParams({limit:'5',...(cursor?{cursor}:{})}),{mode:'public'});if(!Array.isArray(r.items)||r.items.length>5||r.next_cursor!==null&&typeof r.next_cursor!=='string')throw Error('Invalid list');return r;},
   async ready(){const s=runtime.snapshot(),r=await fetcher(window.MINIHOMPY_SUPABASE.url.replace(/\/$/,'')+'/functions/v1/member-writing/relationships/health',{headers:{'X-Minihompy-Auth-Mode':'public'},credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});runtime.check(s);if(!r.ok)throw Error('Health failed');const d=await r.json();runtime.check(s);return d.friend_reviews_ready===true;},
   prepare(action,value,mode='member'){
    if(!['create','delete'].includes(action)||!['member','owner'].includes(mode)||action==='create'&&mode!=='member')throw Error('Invalid review operation');
    const op=Object.freeze({operation_id:crypto.randomUUID(),...(action==='create'?{body:value}:{review_id:value})});operations.set(op,{action,mode,stamp:runtime.snapshot()});return op;
   },
   execute(op){const {action,mode,stamp}=owned(op);return call(action==='create'?'':'/delete',{method:'POST',body:op,mode},stamp);},
   recover(op){const {mode,stamp}=owned(op);return call('/operations',{method:'POST',body:{operation_id:op.operation_id},mode},stamp);},
  });
 };
})();
