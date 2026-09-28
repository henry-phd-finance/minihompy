import {inspectImage} from '../../../photo-variant-format.js';
import {BUCKET,digest,immutableCopy,fail} from './io.js';
export async function uploadVariant({args,bytes,uid,owner,rpc,variantRpc,storage,signal}){
 const current=()=>{if(signal?.aborted)fail('REQUEST_TIMEOUT');};
 const call=async(action,payload)=>{const v=await variantRpc(action,payload);if(v.failure)fail(v.failure);return v;};
 current();let output;try{output=inspectImage(bytes);}catch{fail('BAD_IMAGE');}
 if(output.mime!=='image/webp'||output.width>1200||output.height>1200||args.recipe!=='display-v1'||!/^[0-9a-f]{64}$/.test(args.source_sha256||''))fail('BAD_IMAGE');
 const source=await rpc('read',{post_id:args.post_id,path:args.path,owner_id:await owner()});if(source.failure)fail(source.failure);
 const original=await storage.get(BUCKET,args.path,signal);
 if(await digest(original)!==source.sha256||source.sha256!==args.source_sha256||original.length!==source.size)fail('INTEGRITY_FAILED');
 let info;try{info=inspectImage(original);}catch{fail('BAD_IMAGE');}
 if(bytes.length>=original.length||output.width>info.displayWidth||output.height>info.displayHeight)fail('BAD_IMAGE');
 const ratio=Math.min(1,1200/Math.max(info.displayWidth,info.displayHeight));
 if(output.width!==Math.max(1,Math.round(info.displayWidth*ratio))||output.height!==Math.max(1,Math.round(info.displayHeight*ratio)))fail('BAD_IMAGE');
 const payload={...args,owner_id:uid,mime:'image/webp',size:bytes.length,width:output.width,height:output.height,sha256:await digest(bytes)};
 current();const v=await call('reserve',payload);
 if(v.state!=='ready'){
  current();await owner();await immutableCopy(storage,BUCKET,v.storage_path,bytes,'image/webp');current();
  // immutableCopy downloaded the actual stored bytes and checked size + SHA-256.
  const binding={...payload,id:v.id,operation_id:v.operation_id,owner_id:await owner()};
  await call('upload_confirm',binding);current();await call('complete',{...binding,owner_id:await owner()});
 }else{
  const stored=await storage.get(BUCKET,v.storage_path,signal);
  if(stored.length!==v.size||await digest(stored)!==v.sha256)fail('INTEGRITY_FAILED');
  await owner();current();
  const latest=await call('complete',{...payload,id:v.id,operation_id:v.operation_id,sha256:v.sha256,size:v.size,mime:v.mime,width:v.width,height:v.height});
  if(latest.state!=='ready')fail('REQUEST_CONFLICT');
 }
 return {variant_id:v.id,state:'ready'};
}
export async function cleanupVariants({path,owner,variantRpc,storage}){
 const call=async(action,payload)=>{const v=await variantRpc(action,{...payload,owner_id:await owner()});if(v.failure)fail(v.failure);return v;};
 const inventory=await call('inventory',{path});
 for(const v of inventory.items){
  if(v.state==='deleted')continue;
  const binding={path,id:v.id,operation_id:v.operation_id};
  const state=await call('cleanup_begin',binding);if(state.state!=='deleting')fail('REQUEST_CONFLICT');
  await storage.remove(BUCKET,[v.storage_path]);
  try{await storage.get(BUCKET,v.storage_path);fail('REQUEST_CONFLICT');}catch(e){if(e.code!=='NOT_FOUND')throw e;}
  await call('cleanup_finish',{...binding,storage_deleted:true});
 }
}
