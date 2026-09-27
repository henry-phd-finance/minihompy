import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const window={};vm.runInNewContext(await readFile(new URL('../post-routes.js',import.meta.url),'utf8'),{window,URLSearchParams});const r=window.MinihompyPostRoutes,id='10000000-0000-4000-8000-000000000001';
for(const kind of ['board','photos','diary','guestbook']){const route=r.parse(r.href(kind,id));assert.equal(route.id,kind);assert.equal(route.post,id);}
for(const hash of ['#/board?post=bad','#/board?post=','#/board?post='+id+'&post='+id,'#/board?post='+id+'&token=secret','#/home?post='+id,'#/%E0%A4%A','#/board?post='+id+'?other'])assert.equal(r.parse(hash).invalid,true,hash);
assert.equal(r.parse('#/settings').id,'settings');assert.equal(r.parse('#/home').post,null);assert.throws(()=>r.href('board','bad'));
let calls=0,signalSeen;window.MinihompyBackend={getClient:()=>({rpc:(name,args)=>{assert.equal(name,'post_location');calls++;return Promise.resolve({data:{id:args.p_id,page:3,folder_id:id,entry_date:'2001-01-01'},error:null});}})};
vm.runInNewContext(await readFile(new URL('../post-location-repository.js',import.meta.url),'utf8'),{window});assert.equal((await window.MinihompyPostLocation.locate('diary',id,20)).page,3);assert.equal(calls,1);await assert.rejects(()=>window.MinihompyPostLocation.locate('bad',id,20));assert.equal(calls,1);
console.log('PASS: four route round trips, legacy menus, malformed/duplicate/extra parameters, bounded location request');
