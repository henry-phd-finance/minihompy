import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {backfillPhotos} from '../setup/photo-variant-backfill.mjs';import {createEncoder} from '../setup/photo-variant-encoder.mjs';
import {digest,fail} from '../supabase/functions/photo-media/io.js';
const id=n=>'a0000000-0000-4000-8000-'+String(n).padStart(12,'0'),ownerId=id(1),project='https://aaaaaaaaaaaaaaaaaaaa.supabase.co';
const encoder=await createEncoder({playwrightModule:process.argv[2],chromiumPath:process.env.CHROMIUM_PATH});
const original=new Uint8Array(await readFile('assets/photos/lake.jpg')),output=await encoder.convert(original);assert(output&&output.length<original.length);
const {pg}=await memberWritingDb(PGlite,{photoMedia:true,friendVisibility:true,siteId:id(99),centralUrl:'https://central.test/api'});let journal,saves=0,converted=0,mutations=0,hook=null,lost=false;
const objects=new Map(),staged=new Map();
const sql=async(name,action,args={})=>{const v=(await pg.query('select public.'+name+'($1,$2) v',[action,args])).rows[0].v;if(v.failure)fail(v.failure);return v;};
const rpc=(action,args)=>{assert(['inventory','read','reserve','complete'].includes(action));return sql('photo_media',action,args);};
const variantRpc=async(action,args)=>{if(!['inventory','status'].includes(action))mutations++;if(hook)await hook(action,args);return sql('photo_variant',action,args);};
const storage={bucket:async()=>({public:false}),get:async(_,p)=>{if(!objects.has(p))fail('NOT_FOUND');return objects.get(p).slice();},put:async(_,p,b)=>{assert(p.startsWith('variants/'));if(objects.has(p))fail('EXISTS');objects.set(p,b.slice());if(lost){lost=false;fail('STORAGE_UNAVAILABLE');}},remove:async(_,paths)=>{assert(paths.every(p=>p.startsWith('variants/')));for(const p of paths)objects.delete(p);}};
const files={load:async k=>staged.get(k),put:async(k,b)=>staged.set(k,b.slice()),remove:async k=>staged.delete(k)};
const base={project,ownerId,rpc,variantRpc,storage,variantReady:true,files,save:async j=>{saves++;journal=structuredClone(j);},convert:async b=>{converted++;return encoder.convert(b);}};
const run=(options={})=>backfillPhotos({...base,journal:journal&&structuredClone(journal),dryRun:false,...options});
async function seed(n,bytes=original,ext='jpg'){
 const path=id(n)+'/'+id(n+100)+'.'+ext,a={owner_id:ownerId,path,post_id:id(n),size:bytes.length,mime:ext==='gif'?'image/gif':'image/jpeg',sha256:await digest(bytes)};
 await rpc('reserve',a);objects.set(path,bytes.slice());await rpc('complete',a);
 await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[ownerId]);await pg.query("insert into public.photo_posts(id,folder_id,author_id,author_name,title,body,visibility) select $1,id,$2,'owner','fixture',$3,'private' from public.photo_folders limit 1",[id(n),ownerId,JSON.stringify([{type:'image',path}])]);return path;
}
async function unchanged(snapshot){for(const [path,b] of snapshot)assert.deepEqual(objects.get(path),b);}
try{
 for(const f of ['202609280001_photo_asset_variants.sql','202609280002_photo_variant_status.sql','202609280003_photo_variant_reads.sql'])await pg.exec(await readFile('supabase/migrations/'+f,'utf8'));
 await pg.query('insert into auth.users values($1)',[ownerId]);await pg.query('insert into private.minihompy_admins values($1)',[ownerId]);await pg.exec("update private.photo_media_state set mode='protected',ready=true");
 const path=await seed(10);const gif=new Uint8Array(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'));await seed(11,gif,'gif');
 const snapshot=new Map(objects),postsBefore=(await rpc('inventory')).posts;
 const dry=await run({dryRun:true,variantReady:false});assert.equal(dry.generated,1);assert.equal(dry.skipped,1);assert.equal(dry.additionalBytes,output.length);assert.equal(saves,0);assert.equal(mutations,0);assert.equal(staged.size,0);
 console.log('PASS 1: old-schema-compatible dry run performs real Worker conversion, exact byte estimate, GIF skip, zero server/journal writes');
 lost=true;const applied=await run();assert.equal(applied.generated,1);assert.equal(applied.skipped,1);assert.equal(staged.size,0);assert.equal(objects.size,3);await unchanged(snapshot);assert.deepEqual((await rpc('inventory')).posts,postsBefore);
 const before=converted,again=await run();assert.equal(again.ready,1);assert.equal(again.generated,0);assert.equal(converted,before+1);assert.equal(objects.size,3);
 console.log('PASS 2: apply/lost upload ACK/replay; completed variant verified without regeneration; original bytes/posts unchanged');
 const second=await seed(12);let interrupted=false;hook=async action=>{if(action==='upload_confirm'&&!interrupted){interrupted=true;fail('INTERRUPTED');}};
 assert.equal((await run()).failed,1);hook=null;const pending=(await pg.query("select * from private.photo_asset_variants where source_path=$1",[second])).rows[0];assert.equal(pending.state,'pending');const resumed=await run();assert.equal(resumed.generated,1);assert.equal((await variantRpc('status',{path:second,id:pending.id,operation_id:pending.operation_id,owner_id:ownerId})).state,'ready');assert.equal(staged.size,0);
 console.log('PASS 3: interrupted uploaded reservation resumes from private staged bytes without duplicate objects');
 const third=await seed(13);hook=async(action,args)=>{if(action==='upload_confirm'&&args.path===third){await pg.query('delete from public.photo_posts where id=$1',[id(13)]);hook=null;}};
 assert.equal((await run()).failed,1);assert.equal((await run()).pendingCleanup,1);await pg.query("update private.photo_asset_variants set lease_expires_at=clock_timestamp()-interval '1 second' where source_path=$1",[third]);await run();const gone=(await pg.query('select * from private.photo_asset_variants where source_path=$1',[third])).rows[0];assert.equal(gone.state,'deleted');assert(!objects.has(gone.storage_path));assert(objects.has(third));
 console.log('PASS 4: deletion during upload never completes; live lease preserved; expired temporary derivative alone cleaned on resume');
 const fourth=await seed(14);hook=async(action,args)=>{if(action==='reserve'&&args.path===fourth){await pg.query("update private.photo_assets set sha256=$1 where path=$2",['f'.repeat(64),fourth]);hook=null;}};
 assert.equal((await run()).failed,1);assert.equal((await pg.query('select count(*)::int n from private.photo_asset_variants where source_path=$1',[fourth])).rows[0].n,0);await pg.query('update private.photo_assets set sha256=$1 where path=$2',[await digest(original),fourth]);
 console.log('PASS 5: source replacement between conversion and reserve is rejected, with no derivative attached to changed source');
 await assert.rejects(run({project:'https://bbbbbbbbbbbbbbbbbbbb.supabase.co'}),e=>e.code==='JOURNAL_MISMATCH');await assert.rejects(run({maxNewBytes:1}),e=>e.code==='STORAGE_BUDGET');await assert.rejects(run({signal:AbortSignal.abort()}),e=>e.code==='ABORTED');await unchanged(snapshot);
 console.log('PASS 6: project binding, byte budget and cancellation stop safely; original hashes preserved');
 // Persist a pending reservation, expire it, then remove its journal reservation as if reserve ACK/save was lost.
 hook=async(action,args)=>{if(action==='upload_confirm'&&args.path===fourth){hook=null;fail('INTERRUPTED');}};await run();await pg.query("update private.photo_asset_variants set lease_expires_at=clock_timestamp()-interval '1 second' where source_path=$1",[fourth]);
 for(const item of Object.values(journal.items))if(item.path===fourth)delete item.reservation;
 assert.equal((await run()).failed,0);assert.equal((await pg.query("select count(*)::int n from private.photo_asset_variants where source_path=$1 and state='ready'",[fourth])).rows[0].n,1);assert.equal(staged.size,0);
 console.log('PASS 7: expired orphan reservation recovered by journal source/output hash; fresh immutable variant succeeds');
 const fifth=await seed(15),controller=new AbortController();hook=async(action,args)=>{if(action==='reserve'&&args.path===fifth){controller.abort();hook=null;}};
 await assert.rejects(run({signal:controller.signal}));assert(Object.values(journal.items).find(i=>i.path===fifth).reservation);assert.equal((await run()).failed,0);assert.equal(staged.size,0);
 console.log('PASS 8: cancellation at reserve persists recovery binding; resumed run completes exactly once');
 const sixth=await seed(16);hook=async(action,args)=>{if(action==='upload_confirm'&&args.path===sixth){hook=null;fail('INTERRUPTED');}};await run();
 for(const item of Object.values(journal.items))if(item.path===sixth)delete item.reservation;
 await pg.query('delete from public.photo_posts where id=$1',[id(16)]);assert.equal((await run()).pendingCleanup,1);
 await pg.query("update private.photo_asset_variants set lease_expires_at=clock_timestamp()-interval '1 second' where source_path=$1",[sixth]);await run();assert.equal(staged.size,0);assert(objects.has(sixth));
 console.log('PASS 9: deleted source plus lost reservation journal recovers only matching orphan and cleans staged output after lease');


}finally{await encoder.close();await pg.close();}
