import {createHash,randomUUID} from 'node:crypto';
import {request,canonical,post} from './friend-visibility-fixture.mjs';
export function commentArgs(action='create',operation={kind:'board',parent_id:post('board',1),request_id:randomUUID(),id:randomUUID(),body:'member comment'},mode='member'){
 const scope=mode==='public'?'public':'visible';
 const selectors={kind:operation.kind,parent_id:operation.parent_id,...(action==='list'?{page:operation.page,size:operation.size}:{operation_id:operation.request_id})};
 const access=request(mode,action,selectors,{scope});
 if(mode==='member')access.context.request_hash=createHash('sha256').update(canonical({protocol:1,mode,scope,action:'comments.'+action,selectors})).digest('hex');
 return {access,operation};
}
