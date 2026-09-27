(() => {
  'use strict';
  // No token or pending operation persistence. Caller retains an immutable operation for recovery.
  window.createMinihompyRelationships=({runtime=window.MinihompyMemberWriting,centralApiUrl,fetcher=window.fetch}={})=>{
    const base=new URL(centralApiUrl||window.MINIHOMPY_VISITOR_IDENTITY_CONFIG?.centralApiUrl||window.MINIHOMPY_VISITOR_IDENTITY_CONFIG?.centralUrl);
    if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw Error('Invalid central URL');
    const operations=new WeakMap();
    const call=(action,body,stamp=runtime.snapshot())=>runtime.relationship('/relationships/'+action,body,stamp);
    function owned(operation){const stamp=operations.get(operation);if(!stamp)throw Error('Unknown relationship operation');runtime.check(stamp);return stamp;}
    return Object.freeze({
      async ready(){
        const url=new URL(window.MINIHOMPY_SUPABASE.url.replace(/\/$/,'')+'/functions/v1/member-writing/relationships/health');
        if(url.protocol!=='https:'||url.username||url.password)throw Error('Invalid personal URL');
        const response=await fetcher(url.href,{headers:{'X-Minihompy-Auth-Mode':'public'},credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw Object.assign(Error('관계 서버에 연결하지 못했습니다.'),{code:'IDENTITY_UNAVAILABLE',status:503});
        const d=await response.json();return d.relationship_protocol===1&&d.relationship_relay_ready===true;
      },
      state:target=>call('state',{target_member_id:target}),
      requests:(direction,{limit=20,cursor}={})=>call('requests',{direction,limit,...(cursor?{cursor}:{})}),
      prepare(action,target,relationship){
        const stamp=runtime.snapshot();if(!stamp)throw Object.assign(Error('회원 기능이 준비되지 않았습니다.'),{code:'AUTH_REQUIRED'});
        const operation=Object.freeze({action,target_member_id:target,expected_revision:relationship.revision,operation_id:crypto.randomUUID(),...(action==='request'?{}:{request_id:relationship.request_id})});
        operations.set(operation,stamp);return operation;
      },
      execute:operation=>call('actions',operation,owned(operation)),
      recover:operation=>call('operations',{operation_id:operation.operation_id},owned(operation)),
      // Repeating execute explicitly uses the same ID; network failure never triggers automatic resend.
      async friends(memberId,{limit=20,cursor}={}){
        const stamp=runtime.snapshot(),url=new URL(base.href.replace(/\/$/,'')+'/relationships/friends');
        url.search=new URLSearchParams({member_id:memberId,limit:String(limit),...(cursor?{cursor}:{})});
        let response;try{response=await fetcher(url.href,{credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});}catch{runtime.check(stamp);throw Object.assign(Error('일촌 목록을 불러오지 못했습니다.'),{code:'IDENTITY_UNAVAILABLE'});}
        runtime.check(stamp);const data=await response.json();runtime.check(stamp);
        if(!response.ok)throw Object.assign(Error('일촌 목록을 불러오지 못했습니다.'),{code:data.error?.code||'IDENTITY_UNAVAILABLE',status:response.status,retryAfter:Number(response.headers.get('Retry-After'))||1});
        if(!Array.isArray(data.items))throw Error('Invalid friends response');return data;
      },
    });
  };
})();
