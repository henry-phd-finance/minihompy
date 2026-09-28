import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {handlePhotoMedia} from '../supabase/functions/photo-media/handler.js';
import {digest,BUCKET,fail} from '../supabase/functions/photo-media/io.js';
import {inspectImage} from '../photo-variant-format.js';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2]))),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
let images;
try{
 const page=await browser.newPage();await page.route('https://fixture.test/**',async r=>{const path=new URL(r.request().url()).pathname;return r.fulfill({contentType:path==='/'?'text/html':'text/javascript',body:path==='/'?'<!doctype html>':await readFile(new URL('../'+path.slice(1),import.meta.url),'utf8')});});
 await page.goto('https://fixture.test/');await page.addScriptTag({url:'/photo-variant-client.js'});
 images=await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1000;const ctx=canvas.getContext('2d');const pixels=ctx.createImageData(1600,1000);
  for(let y=0;y<1000;y++)for(let x=0;x<1600;x++){const p=(y*1600+x)*4;pixels.data.set([x%256,y%256,(x+y)%256,x<800?128:255],p);}ctx.putImageData(pixels,0,0);
  const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));const output=await MinihompyPhotoVariant.convert(blob);if(!output)throw Error('Expected savings');
  const b=await createImageBitmap(output),preview=new OffscreenCanvas(b.width,b.height),c=preview.getContext('2d');c.drawImage(b,0,0);const alpha=c.getImageData(100,100,1,1).data[3];const dimensions=[b.width,b.height];b.close();
  const tiny=new Blob([new Uint8Array([71,73,70,56,57,97])],{type:'image/gif'});if(await MinihompyPhotoVariant.convert(tiny)!==null)throw Error('GIF converted');
  const ac=new AbortController();ac.abort();if(await MinihompyPhotoVariant.convert(blob,{signal:ac.signal})!==null)throw Error('Aborted conversion');
  // EXIF orientation 6 must rotate the 80x40 JPEG to 40x80, without preserving EXIF.
  canvas.width=80;canvas.height=40;const g=ctx.createLinearGradient(0,0,80,40);g.addColorStop(0,'red');g.addColorStop(1,'blue');ctx.fillStyle=g;ctx.fillRect(0,0,80,40);
  const jpeg=new Uint8Array(await (await new Promise(r=>canvas.toBlob(r,'image/jpeg',1))).arrayBuffer());
  const exif=new Uint8Array([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
  const rotated=new Blob([jpeg.slice(0,2),exif,jpeg.slice(2)],{type:'image/jpeg'}),rot=await MinihompyPhotoVariant.convert(rotated);if(!rot)throw Error('EXIF conversion failed');
  const rb=await createImageBitmap(rot),rotation=[rb.width,rb.height];rb.close();
  // No savings: small transparent PNG stays original.
  const small=new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],{type:'image/png'});
  if(await MinihompyPhotoVariant.convert(small)!==null)throw Error('Small image enlarged');
  return {source:Array.from(new Uint8Array(await blob.arrayBuffer())),output:Array.from(new Uint8Array(await output.arrayBuffer())),alpha,dimensions,rotation};
 });
 assert.deepEqual(images.dimensions,[1200,750]);assert.deepEqual(images.rotation,[40,80]);assert(Math.abs(images.alpha-128)<=1);assert(images.output.length<images.source.length);
 console.log('PASS real Worker resize, alpha preservation, EXIF rotation, GIF/no-gain skip, cancellation');
 // Hard timeout terminates the worker; a failed/unsupported worker never fails original upload.
 await page.evaluate(()=>{window.terminated=0;window.Worker=class{postMessage(){}terminate(){terminated++;}};const timer=setTimeout;window.setTimeout=(fn,ms)=>timer(fn,ms===10000?20:ms);});
 assert.equal(await page.evaluate(()=>MinihompyPhotoVariant.convert(new Blob(['x']))),null);assert.equal(await page.evaluate(()=>terminated),1);
 await page.evaluate(()=>{window.Worker=class{constructor(){throw Error('unsupported');}};});assert.equal(await page.evaluate(()=>MinihompyPhotoVariant.convert(new Blob(['x']))),null);
 console.log('PASS stuck Worker terminated at deadline and unavailable Worker skips conversion');
}finally{await browser.close();}
const original=new Uint8Array(images.source),derived=new Uint8Array(images.output);
const huge=original.slice();new DataView(huge.buffer).setUint32(16,8193);assert.throws(()=>inspectImage(huge));
const pixels=original.slice();new DataView(pixels.buffer).setUint32(16,5000);new DataView(pixels.buffer).setUint32(20,5000);assert.throws(()=>inspectImage(pixels));
const apng=new Uint8Array(original.length+20);apng.set(original.slice(0,33));apng.set([0,0,0,8,97,99,84,76],33);apng.set(original.slice(33),53);assert.throws(()=>inspectImage(apng));
const animation=derived.slice();animation.set([65,78,73,77],12);assert.throws(()=>inspectImage(animation));assert.throws(()=>inspectImage(derived.slice(0,-1)));
console.log('PASS predecode bounds/animation/truncation rejection');
const id=n=>'80000000-0000-4000-8000-'+String(n).padStart(12,'0'),owner=id(1),post=id(10);let path=post+'/'+id(11)+'.png';
const {pg}=await memberWritingDb(PGlite,{siteId:id(9),centralUrl:'https://central.test',photoMedia:true});
const objects=new Map();let lost=false,corrupt=false,valid=true,variantCalls=0,deleteFail=false,revokeAfterPut=false;
const env={SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service-fixture',SUPABASE_ANON_KEY:'fixture',MINIHOMPY_SITE_ORIGIN:'https://home.test',MINIHOMPY_SITE_ID:id(9),MINIHOMPY_CENTRAL_API_URL:'https://central.test'};
const fetcher=async url=>url.endsWith('/auth/v1/user')?Response.json(valid?{id:owner,is_anonymous:false}:{},{status:valid?200:401}):new Response('true');
const callDb=async(name,action,args)=>{await pg.exec('set role service_role');try{const v=(await pg.query('select public.'+name+'($1,$2) v',[action,args])).rows[0].v;if(v.failure)fail(v.failure);return v;}finally{await pg.exec('reset role');}};
const rpc=(action,args)=>callDb('photo_media',action,args),variantRpc=(action,args)=>{variantCalls++;return callDb('photo_variant',action,args);};
const storage={async get(_,p){if(!objects.has(p))fail('NOT_FOUND');return objects.get(p).slice();},async put(_,p,b){if(objects.has(p))fail('EXISTS');objects.set(p,corrupt?new Uint8Array([1]):b.slice());if(revokeAfterPut&&p.startsWith('variants/')){revokeAfterPut=false;valid=false;}if(lost){lost=false;fail('STORAGE_UNAVAILABLE');}},async remove(_,paths){if(deleteFail){deleteFail=false;fail('STORAGE_UNAVAILABLE');}paths.forEach(p=>objects.delete(p));}};
const invoke=(action,body,{mode='owner',signal}={})=>handlePhotoMedia(new Request('https://edge.test/functions/v1/photo-media/'+action,{method:action==='health'?'GET':'POST',headers:{Origin:'https://home.test','X-Minihompy-Auth-Mode':mode,...(mode!=='public'?{Authorization:'Bearer a.b.c'}:{}),...(body instanceof FormData||!body?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal}),{env,fetcher,rpc,variantRpc,storage,variantStatus:async()=>(await pg.query('select public.photo_variant_status() v')).rows[0].v});
const form=(bytes=derived)=>{const f=new FormData();f.set('file',new Blob([bytes],{type:'image/webp'}));f.set('post_id',post);f.set('path',path);f.set('recipe','display-v1');return f;};
try{
 await pg.query('insert into auth.users values($1)',[owner]);await pg.query('insert into private.minihompy_admins values($1)',[owner]);await pg.exec("update private.photo_media_state set mode='protected',ready=true where singleton");
 for(const file of ['202609280001_photo_asset_variants.sql','202609280002_photo_variant_status.sql'])await pg.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 assert.equal((await (await invoke('health',null,{mode:'public'})).json()).photo_variant_protocol,1);
 await pg.exec("update private.photo_media_state set ready=false where singleton");assert.equal((await (await invoke('health',null,{mode:'public'})).json()).photo_variant_protocol,undefined);await pg.exec("update private.photo_media_state set ready=true where singleton");
 const hash=await digest(original);const args={owner_id:owner,path,post_id:post,size:original.length,mime:'image/png',sha256:hash};await rpc('reserve',args);await storage.put(BUCKET,path,original);await rpc('complete',args);
 const f=form();f.set('source_sha256',hash);lost=true;const first=await invoke('variant-upload',f);assert.equal(first.status,200,await first.clone().text());const result=await first.json();assert.equal(result.state,'ready');assert.equal(result.storage_path,undefined);
 assert.deepEqual(objects.get(path),original);const again=await invoke('variant-upload',f);assert.deepEqual(await again.json(),result);assert.equal(objects.size,2);
 console.log('PASS DB-gated capability, actual SQL reserve/upload/confirm/complete, lost Storage ACK recovery, immutable original, idempotent duplicate');
 const before=variantCalls;assert.equal((await invoke('variant-upload',f,{mode:'member'})).status,403);assert.equal(variantCalls,before);
 valid=false;assert.equal((await invoke('variant-upload',f)).status,401);valid=true;
 const wrong=form();wrong.set('source_sha256','f'.repeat(64));assert.equal((await invoke('variant-upload',wrong)).status,409);
 const malformed=form(derived.slice(0,-1));malformed.set('source_sha256',hash);assert.equal((await invoke('variant-upload',malformed)).status,400);
 const v=(await pg.query('select * from private.photo_asset_variants')).rows[0];objects.set(v.storage_path,new Uint8Array([1]));assert.equal((await invoke('variant-upload',f)).status,409);objects.set(v.storage_path,derived);
 console.log('PASS member/expired owner denial, source-hash mismatch, malformed output, corrupted stored derivative rejected');
 deleteFail=true;assert.equal((await invoke('cleanup',{paths:[path]})).status,503);assert(objects.has(path));assert.equal((await pg.query('select state from private.photo_asset_variants')).rows[0].state,'deleting');
 assert.equal((await invoke('cleanup',{paths:[path]})).status,200);assert.equal(objects.size,0);assert.equal((await pg.query('select state from private.photo_asset_variants')).rows[0].state,'deleted');
 console.log('PASS partial cleanup preserves original, retry confirms derived deletion then original, tombstone retained');
 path=post+'/'+id(12)+'.png';await rpc('reserve',{...args,path});await storage.put(BUCKET,path,original);await rpc('complete',{...args,path});
 const retryForm=form();retryForm.set('source_sha256',hash);revokeAfterPut=true;
 assert.equal((await invoke('variant-upload',retryForm)).status,401);assert(objects.has(path));
 assert.equal((await pg.query('select state from private.photo_asset_variants where source_path=$1',[path])).rows[0].state,'pending');
 valid=true;assert.equal((await invoke('variant-upload',retryForm)).status,200);
 console.log('PASS owner revoked after Storage upload leaves tracked pending derivative, authenticated retry recovers');
 path=post+'/'+id(13)+'.png';await rpc('reserve',{...args,path});await storage.put(BUCKET,path,original);await rpc('complete',{...args,path});
 const corruptForm=form();corruptForm.set('source_sha256',hash);corrupt=true;assert.equal((await invoke('variant-upload',corruptForm)).status,503);corrupt=false;
 assert.equal((await invoke('variant-upload',corruptForm)).status,409);assert.deepEqual(objects.get(path),original);
 const broken=(await pg.query('select * from private.photo_asset_variants where source_path=$1',[path])).rows[0];
 await pg.query("update private.photo_asset_variants set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[broken.id]);
 const binding={owner_id:owner,path,id:broken.id,operation_id:broken.operation_id};await variantRpc('cleanup_begin',binding);await storage.remove(BUCKET,[broken.storage_path]);await variantRpc('cleanup_finish',{...binding,storage_deleted:true});
 assert.equal((await invoke('variant-upload',corruptForm)).status,200);
 console.log('PASS partial corrupt upload never overwritten or marked ready, lease cleanup permits fresh immutable retry');
}finally{await pg.close();}
