import {inspectImage} from '../../../photo-variant-format.js';
import {digest,imageType,MAX_BYTES,UUID,fail} from './io.js';
export function validateRepresentation(r){
 if(!r||Array.isArray(r)||Object.keys(r).sort().join(',')!=='kind,revision,sha256,source_sha256'||r.kind!=='display-v1'
  ||!Number.isSafeInteger(r.revision)||r.revision<1||!['sha256','source_sha256'].every(k=>typeof r[k]==='string'&&/^[0-9a-f]{64}$/.test(r[k])))fail('BAD_REQUEST');
}
export function selectedPath(a,args){
 if(!args.representation)return args.path;
 const r=args.representation;
 if(a.post_id!==args.post_id||a.path!==args.path||a.source_sha256!==r.source_sha256||a.sha256!==r.sha256||a.revision!==r.revision||a.recipe!==r.kind
  ||!UUID.test(a.variant_id||'')||a.storage_path!==`variants/${args.post_id}/${a.variant_id}.webp`||a.mime!=='image/webp'
  ||!Number.isInteger(a.size)||a.size<1||a.size>MAX_BYTES||![a.width,a.height].every(n=>Number.isInteger(n)&&n>=1&&n<=1200))fail('INTEGRITY_FAILURE');
 return a.storage_path;
}
export async function verifyBytes(bytes,a,args){
 const path=selectedPath(a,args);
 if(!(bytes instanceof Uint8Array)||bytes.length!==a.size||imageType(bytes,path)!==a.mime||await digest(bytes)!==a.sha256)fail('INTEGRITY_FAILURE');
 if(args.representation){let info;try{info=inspectImage(bytes);}catch{fail('INTEGRITY_FAILURE');}if(info.width!==a.width||info.height!==a.height||info.mime!=='image/webp')fail('INTEGRITY_FAILURE');}
}
export function sameSelection(first,last,args){
 selectedPath(last,args);
 const keys=args.representation?['post_id','path','source_sha256','revision','storage_path','variant_id','recipe','sha256','mime','size','width','height']:['sha256','size','mime'];
 if(keys.some(k=>first[k]!==last[k]))fail('NOT_FOUND');
}
