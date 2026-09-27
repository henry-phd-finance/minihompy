// Offline, explicit phases. No automatic ready=true and no rollback to public.
import {BUCKET,LEGACY_BUCKET,validPath,digest,imageType,immutableCopy,fail} from '../supabase/functions/photo-media/io.js';
export async function inventory(storage){
 const paths=[];
 for(let offset=0;;offset+=100){
  const roots=await storage.list(LEGACY_BUCKET,'',offset);
  for(const root of roots){
   if(root.id||!validPath(root.name,root.name+'/10000000-0000-4000-8000-000000000001.png'))fail('UNEXPECTED_LEGACY_PATH');
   for(let pos=0;;pos+=100){
    const rows=await storage.list(LEGACY_BUCKET,root.name,pos);
    for(const row of rows){const path=root.name+'/'+row.name;if(!row.id||!validPath(root.name,path))fail('UNEXPECTED_LEGACY_PATH');paths.push(path);}
    if(rows.length<100)break;
   }
  }
  if(roots.length<100)break;
 }
 if(new Set(paths).size!==paths.length)fail('DUPLICATE_PATH');return paths.sort();
}
export function references(posts){
 const refs=new Map();
 for(const p of posts)for(const b of p.body){
  if(b.type!=='image')continue;
  if(!validPath(p.id,b.path))fail('INVALID_REFERENCE');
  if(refs.has(b.path))fail('DUPLICATE_REFERENCE');refs.set(b.path,p.id);
 }
 return refs;
}
export async function migratePhotos({phase='inventory',dryRun=true,rpc,storage,journal,save,backup,loadBackup}){
 if(!['inventory','copy','protect','close-legacy'].includes(phase))fail('BAD_PHASE');
 const state=await rpc('inventory'),refs=references(state.posts);
 const target=await storage.bucket(BUCKET);
 if(target.public!==false)fail('PRIVATE_BUCKET_REQUIRED');
 if(dryRun){
  const paths=await inventory(storage);for(const path of refs.keys())if(!paths.includes(path))fail('MISSING_LEGACY_FILE');
  let bytes=0;
  for(const path of paths){const b=await storage.get(LEGACY_BUCKET,path);imageType(b,path);bytes+=b.length;}
  return {dryRun:true,mode:state.mode,posts:state.posts.length,files:paths.length,referenced:refs.size,bytes};
 }
 if(phase==='inventory'){
  if(journal)fail('JOURNAL_EXISTS');
  await rpc('freeze'); // Fail closed on every subsequent interruption.
  const frozen=await rpc('inventory'),paths=await inventory(storage),frozenRefs=references(frozen.posts);
  for(const path of frozenRefs.keys())if(!paths.includes(path))fail('MISSING_LEGACY_FILE');
  // Existing journal must not be overwritten: it is the recovery/backup source.
  journal={version:1,posts:frozen.posts,legacyBucket:await storage.bucket(LEGACY_BUCKET),files:{},phase:'inventory'};
  for(const path of paths){
   const bytes=await storage.get(LEGACY_BUCKET,path),mime=imageType(bytes,path),sha256=await digest(bytes);
   await backup(path,bytes);journal.files[path]={size:bytes.length,mime,sha256,post_id:path.split('/')[0],referenced:frozenRefs.has(path)};
  }
  await save(journal);
  return {phase:'inventory',files:paths.length};
 }
 if(!journal||journal.version!==1)fail('JOURNAL_REQUIRED');
 if(JSON.stringify(state.posts)!==JSON.stringify(journal.posts))fail('POSTS_CHANGED');
 if(phase==='copy'){
  if(state.mode!=='frozen')fail('FREEZE_REQUIRED');
  if(JSON.stringify(await inventory(storage))!==JSON.stringify(Object.keys(journal.files).sort()))fail('INVENTORY_CHANGED');
  for(const [path,f] of Object.entries(journal.files)){
   const bytes=await storage.get(LEGACY_BUCKET,path),saved=await loadBackup(path);
   if(await digest(bytes)!==f.sha256||await digest(saved)!==f.sha256||bytes.length!==f.size)fail('SOURCE_CHANGED');
   await immutableCopy(storage,BUCKET,path,bytes,f.mime);
   await rpc('import',{path,...f});
   f.copied=true;await save(journal); // Replays verify bytes again, not just this bit.
  }
  journal.phase='copied';await save(journal);return {phase:'copied',files:Object.keys(journal.files).length};
 }
 for(const [path,f]of Object.entries(journal.files)){
  if(!f.copied)fail('COPY_REQUIRED');
  const bytes=await storage.get(BUCKET,path),saved=await loadBackup(path);
  if(await digest(bytes)!==f.sha256||await digest(saved)!==f.sha256)fail('INTEGRITY_FAILURE');
 }
 if(phase==='protect'){
  if(journal.phase!=='copied'&&journal.phase!=='protected')fail('COPY_REQUIRED');
  if(state.mode!=='protected')await rpc('protect');
  journal.phase='protected';await save(journal);return {phase:'protected',ready:false};
 }
 if(state.mode!=='protected'||state.ready)fail('PROTECTED_WRITE_FREEZE_REQUIRED');
 // Original objects are removed ONLY after backup, copied bytes and registry are verified.
 const assets=new Map(state.assets.map(a=>[a.path,a]));
 for(const [path,f]of Object.entries(journal.files)){
  const a=assets.get(path);if(!a?.complete||a.sha256!==f.sha256||a.state==='deleting')fail('REGISTRY_MISMATCH');
 }
 const remaining=await inventory(storage);
 if(remaining.some(path=>!journal.files[path]))fail('INVENTORY_CHANGED');
 await storage.close(LEGACY_BUCKET);
 if((await storage.bucket(LEGACY_BUCKET)).public!==false)fail('LEGACY_STILL_PUBLIC');
 for(const path of remaining){
  const f=journal.files[path],bytes=await storage.get(LEGACY_BUCKET,path);
  if(await digest(bytes)!==f.sha256)fail('SOURCE_CHANGED');
  await storage.remove(LEGACY_BUCKET,[path]);f.removed=true;await save(journal);
 }
 if((await inventory(storage)).length)fail('LEGACY_NOT_EMPTY');
 journal.phase='closed';await save(journal);
 return {phase:'closed',ready:false,requires:'Step 10 Auth/Storage/CDN/Pages checks before trusted ready activation'};
}
