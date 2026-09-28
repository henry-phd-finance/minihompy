// Sequential, source-preserving backfill. No post mutation or original cleanup API.
import {BUCKET,MAX_BYTES,UUID,digest,validPath,fail} from '../supabase/functions/photo-media/io.js';
import {inspectImage} from '../photo-variant-format.js';
import {uploadVariant} from '../supabase/functions/photo-media/variants.js';
export const RECIPE='display-v1';
function variantPath(v){if(!UUID.test(v?.post_id||'')||!UUID.test(v?.id||'')||v.storage_path!==`variants/${v.post_id}/${v.id}.webp`)fail('INVALID_VARIANT_PATH');return v.storage_path;}
export async function backfillPhotos({project,ownerId,dryRun=true,rpc,variantRpc,storage,variantReady,convert,journal,save,files,signal,maxFiles=10000,maxNewBytes=128*1024*1024}){
 const current=()=>{if(signal?.aborted)fail('ABORTED');};
 current();if(journal&&(journal.version!==1||journal.project!==project||journal.recipe!==RECIPE||journal.ownerId!==ownerId))fail('JOURNAL_MISMATCH');
 journal??={version:1,project,ownerId,recipe:RECIPE,items:{}};
 for(const [key,item] of Object.entries(journal.items))if(!validPath(item.post_id,item.path)||key!==await digest(new TextEncoder().encode(JSON.stringify([project,item.path,item.source_sha256,RECIPE]))))fail('JOURNAL_MISMATCH');
 const state=await rpc('inventory');if(state.mode!=='protected'||!state.ready||(await storage.bucket(BUCKET)).public!==false)fail('PROTECTED_MEDIA_REQUIRED');
 if(!dryRun&&!variantReady)fail('VARIANT_SETUP_REQUIRED');
 const assets=new Map(state.assets.map(a=>[a.path,a])),targets=new Map();
 for(const p of state.posts)for(const b of p.body){if(b.type!=='image')continue;
  const a=assets.get(b.path);if(!validPath(p.id,b.path)||!a||a.post_id!==p.id||a.state!=='attached'||!a.complete||!Number.isInteger(a.size)||a.size<1||a.size>MAX_BYTES||!/^[0-9a-f]{64}$/.test(a.sha256))fail('SOURCE_INVALID');
  targets.set(b.path,{path:b.path,post_id:p.id,source_sha256:a.sha256,size:a.size,mime:a.mime});
 }
 if(targets.size>maxFiles||Object.keys(journal.items).length>maxFiles)fail('FILE_LIMIT');
 const result={dryRun,variantReady,files:targets.size,sourceBytes:0,ready:0,skipped:0,generated:0,additionalBytes:0,failed:0,pendingCleanup:0};
 const persist=async()=>{if(!dryRun)await save(journal);};
 // Clean ONLY reservations this journal owns. DB refuses ready/in-use or live leases.
 if(!dryRun)for(const [key,item] of Object.entries(journal.items)){
  current();if(item.status==='ready')continue;
  const t=targets.get(item.path),stale=!t||t.source_sha256!==item.source_sha256;
  if(!item.reservation&&stale){
   const rows=(await variantRpc('inventory',{owner_id:ownerId,path:item.path})).items;
   const found=rows.find(v=>v.state!=='deleted'&&v.source_sha256===item.source_sha256&&v.recipe===RECIPE&&v.sha256===item.outputHash&&v.created_by===ownerId);
   if(found){item.reservation={id:found.id,operation_id:found.operation_id};await persist();}
   else{await files.remove(key);item.status='obsolete';await persist();continue;}
  }
  if(!item.reservation)continue;
  const v=await variantRpc('status',{owner_id:ownerId,path:item.path,id:item.reservation.id,operation_id:item.reservation.operation_id});
  if(v.state==='deleted'){await files.remove(key);item.status='retry';delete item.reservation;await persist();continue;}
  if(v.state==='ready'&&!stale){item.status='ready';await files.remove(key);await persist();continue;}
  if(v.state==='deleting'||stale||Date.parse(v.lease_expires_at)<=Date.now()){
   try{const binding={owner_id:ownerId,path:item.path,id:v.id,operation_id:v.operation_id};
    await variantRpc('cleanup_begin',binding);await storage.remove(BUCKET,[variantPath(v)]);
    try{await storage.get(BUCKET,variantPath(v));fail('DELETE_UNCONFIRMED');}catch(e){if(e.code!=='NOT_FOUND')throw e;}
    await variantRpc('cleanup_finish',{...binding,storage_deleted:true});await files.remove(key);item.status=stale?'obsolete':'retry';delete item.reservation;await persist();
   }catch(e){if(e.code!=='UPLOAD_PENDING')throw e;result.pendingCleanup++;}
  }
 }
 for(const target of targets.values()){
  current();result.sourceBytes+=target.size;
  const key=await digest(new TextEncoder().encode(JSON.stringify([project,target.path,target.source_sha256,RECIPE])));
  if(!journal.items[key]&&Object.keys(journal.items).length>=maxFiles)fail('FILE_LIMIT');
  const item=journal.items[key]??={...target,status:'new'};
  const args={path:target.path,post_id:target.post_id,owner_id:ownerId};
  const owner=async()=>{current();const a=await rpc('read',args);if(a.sha256!==target.source_sha256||a.size!==target.size)fail('SOURCE_CHANGED');return ownerId;};
  try{
   await owner();
   const variants=variantReady?(await variantRpc('inventory',{owner_id:ownerId,path:target.path})).items:[];
   const ready=variants.find(v=>v.state==='ready'&&v.source_sha256===target.source_sha256&&v.recipe===RECIPE);
   if(ready){const b=await storage.get(BUCKET,variantPath(ready),signal);if(b.length!==ready.size||await digest(b)!==ready.sha256)fail('INTEGRITY_FAILURE');await owner();item.status='ready';if(!dryRun)await files.remove(key);result.ready++;await persist();continue;}
   // Never trust the journal alone to skip a ready file: the server is authoritative.
   const original=await storage.get(BUCKET,target.path,signal);current();if(original.length!==target.size||await digest(original)!==target.source_sha256)fail('SOURCE_CHANGED');
   let output=!dryRun?await files.load(key):null;
   if(output&&item.outputHash&&await digest(output)!==item.outputHash)fail('STAGED_OUTPUT_CHANGED');
   if(!output){output=await convert(original,{signal});current();}
   if(!output){item.status='skipped';item.reason='unsupported-no-savings-or-conversion-skip';result.skipped++;await persist();continue;}
   const src=inspectImage(original),out=inspectImage(output),scale=Math.min(1,1200/Math.max(src.displayWidth,src.displayHeight));
   if(out.mime!=='image/webp'||output.length>=original.length||out.width!==Math.max(1,Math.round(src.displayWidth*scale))||out.height!==Math.max(1,Math.round(src.displayHeight*scale)))fail('INVALID_OUTPUT');
   await owner();
   if(result.additionalBytes+output.length>maxNewBytes)fail('STORAGE_BUDGET');
   result.additionalBytes+=output.length;
   if(dryRun){result.generated++;continue;}
   await files.put(key,output);item.status='prepared';item.outputHash=await digest(output);await persist();
   const abandoned=variants.find(v=>v.state==='pending'&&v.source_sha256===target.source_sha256&&v.recipe===RECIPE&&v.created_by===ownerId&&v.sha256===item.outputHash);
   if(abandoned&&Date.parse(abandoned.lease_expires_at)<=Date.now()){
    const binding={owner_id:ownerId,path:target.path,id:abandoned.id,operation_id:abandoned.operation_id};
    item.reservation={id:abandoned.id,operation_id:abandoned.operation_id};await persist();
    await variantRpc('cleanup_begin',binding);await storage.remove(BUCKET,[variantPath(abandoned)]);
    try{await storage.get(BUCKET,variantPath(abandoned));fail('DELETE_UNCONFIRMED');}catch(e){if(e.code!=='NOT_FOUND')throw e;}
    await variantRpc('cleanup_finish',{...binding,storage_deleted:true});delete item.reservation;await persist();
   }
   const trackingRpc=async(action,payload)=>{current();const v=await variantRpc(action,payload);if(action==='reserve'){item.reservation={id:v.id,operation_id:v.operation_id};item.status='pending';await persist();}return v;};
   await uploadVariant({args:{...args,recipe:RECIPE,source_sha256:target.source_sha256},bytes:output,uid:ownerId,owner,rpc,variantRpc:trackingRpc,storage,signal});
   item.status='ready';await persist();await files.remove(key);result.generated++;
  }catch(e){item.status='failed';item.error=/^[A-Z_]+$/.test(e.code||'')?e.code:'FAILED';await persist();if(signal?.aborted||['STORAGE_BUDGET','FORBIDDEN','NOT_READY'].includes(e.code))throw e;result.failed++;}
 }
 await persist();return result;
}
