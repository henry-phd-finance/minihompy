import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile('photos-repository.js','utf8');
const post={id:'post',revision:3,body:[{type:'image',path:'post/a.jpg'},{type:'text',text:'body'}]};
const photo={post_id:'post',revision:3,path:'post/a.jpg',source_sha256:'a'.repeat(64),representation:{kind:'display-v1',sha256:'b'.repeat(64),width:1200,height:750,size:123}};
const fixture=(capabilities,items)=>{const calls=[],window={MinihompyContentAccess:{read:async(action,body,options)=>{calls.push({action,body,options});return action==='readiness'?{capabilities}:{data:{items}};}}};vm.runInNewContext(source,{window});return {api:window.MinihompyPhotosRepository,calls};};
const capabilities={photo_check_protocol:1,photo_variant_read_protocol:1},signal=new AbortController().signal;
for(const caps of [{},{photo_check_protocol:1},{photo_check_protocol:1,photo_variant_protocol:1}]){const f=fixture(caps,[]);assert.equal(await f.api.revalidate([post],null,{details:true,variant:true,selectionOnly:true,signal}),null);assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.signal,signal);}
console.log('PASS 1: legacy/no read capability/upload-only server has no selection request');
for(const rep of [photo.representation,null]){const items=[{id:post.id,valid:true,photos:[{...photo,representation:rep}]}],f=fixture(capabilities,items);assert.equal(await f.api.revalidate([post],null,{details:true,variant:true,signal}),items);assert.equal(f.calls[1].body.variant,'display-v1');assert.equal(f.calls[1].options.signal,signal);}
console.log('PASS 2: ready descriptor and authorized null accepted, variant and cancellation forwarded');
for(const mutate of [p=>p.photos.pop(),p=>p.photos.push(photo),p=>p.photos[0].post_id='other',p=>p.photos[0].revision++,p=>p.photos[0].path='other/a.jpg',p=>p.photos[0].source_sha256='bad',p=>delete p.photos[0].representation,p=>p.photos[0].representation.sha256='bad',p=>p.photos[0].representation.width=1201,p=>p.photos[0].representation.size=0,p=>p.valid=false]){const item={id:post.id,valid:true,photos:[structuredClone(photo)]};mutate(item);const f=fixture(capabilities,[item]);await assert.rejects(f.api.revalidate([post],null,{details:true,variant:true}));}
console.log('PASS 3: missing/duplicate/mismatched path/post/revision, malformed hashes/representation/dimensions and hidden metadata rejected');
const denied=[{id:post.id,valid:false,photos:[]}],f=fixture(capabilities,denied);assert.equal(await f.api.revalidate([post],null,{details:true,variant:true}),denied);
console.log('PASS 4: invalid post can return only empty metadata, never a fallback descriptor');
