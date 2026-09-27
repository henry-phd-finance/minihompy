import assert from 'node:assert/strict';import {readFile,readdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
const out=resolve(process.env.VERIFICATION_DIR||'docs/verification/menu-loading-step7');
for(const variant of ['full','legacy-final']){
 const d=JSON.parse(await readFile(out+'/metrics-'+variant+'/fixture-baseline.json','utf8'));assert.equal(d.samples.length,20);
 for(const s of d.samples){
  assert.equal(s.error,false);assert.ok(s.firstBodyMs>0);assert.equal(s.requests.filter(r=>r.path.endsWith('/user')||r.path.endsWith('/is_minihompy_admin')).length,0);
  assert.ok(s.requests.filter(r=>r.path.endsWith('/health')).length<=1);
  for(const r of s.requests){assert.ok(Object.keys(r).every(k=>['path','method','startMs','endMs','durationMs','status','pendingAtSettle','failed'].includes(k)));assert.ok(r.path.startsWith('/')&&!r.path.includes('?'));assert.equal(r.status,200);assert.equal(r.failed,undefined);assert.equal(r.pendingAtSettle,undefined);}
  if(s.menu==='photos'){
   if(s.scenario==='empty'){assert.equal(s.requests.filter(r=>r.path.endsWith('/list')).length,1);assert.equal(s.allPhotosMs,null);}
   else{assert.ok(s.firstBodyMs<s.firstPhotoMs);assert.ok(s.allPhotosMs-s.firstPhotoMs>=300);assert.equal(s.photoCount,['owner','friend'].includes(s.scenario)?4:2);
    if(variant==='full'){assert.equal(s.requests.filter(r=>r.path.endsWith('/list')).length,1);assert.equal(s.requests.filter(r=>r.path.endsWith('/photo-check')).length,2);}
   }
  }else assert.ok(s.calendarReadyMs>s.firstBodyMs);
 }
}
console.log('PASS: 40 final samples; actual decoded first/all photos, bounded checks, no extra owner verification, no pending requests or payloads in traces.');
const runtime=['admin-auth.js','visitor-identity.js','visitor-session.js','content-access.js','diary-repository.js','views/diary.js','member-writing-client.js','member-writing-runtime.js','photo-media-client.js','photos-repository.js','views/photos.js','styles.css'];
for(const file of runtime)assert.deepEqual(await readFile(file),await readFile('_site/'+file),file+' artifact is stale');
console.log('PASS: built artifact matches all performance-related runtime files.');
const walk=async dir=>{const files=[];for(const e of await readdir(dir,{withFileTypes:true})){const path=dir+'/'+e.name;if(e.isDirectory())files.push(...await walk(path));else if(/\.(json|log|txt|md|js|html|css)$/.test(path))files.push(path);}return files;};
for(const path of [...await walk(out),...await walk('_site')]){const text=await readFile(path,'utf8');assert.ok(!/(?:sbp_|ghp_|github_pat_|sb_secret_)[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text),'Credential pattern in '+path);}
console.log('PASS: evidence and Pages contain no recognized private credential literals; env/backend files separately excluded by artifact checks.');
