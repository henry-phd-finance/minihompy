import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
const root=fileURLToPath(new URL('../',import.meta.url));
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const name=`minihompy-installer-${pkg.version}`, archive=join(root,'dist',name+'.tar.gz');
const hash=data=>createHash('sha256').update(data).digest('hex');
const before=hash(await readFile(archive));
assert.equal((await readFile(archive+'.sha256','utf8')).split(' ')[0],before);
execFileSync(process.execPath,['scripts/build-installer.mjs'],{cwd:root});
assert.equal(hash(await readFile(archive)),before,'repeat builds are reproducible');
const temp=await mkdtemp(join(tmpdir(),'minihompy-installer-check-'));
try{
 execFileSync('tar',['-xzf',archive,'-C',temp]);
 const site=join(temp,name),manifest=JSON.parse(await readFile(join(site,'installer-manifest.json'),'utf8'));
 async function walk(dir,prefix=''){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){assert.ok(!e.isSymbolicLink());const p=prefix+e.name;if(e.isDirectory())out.push(...await walk(join(dir,e.name),p+'/'));else out.push(p);}return out;}
 assert.deepEqual((await walk(site)).sort(),[...Object.keys(manifest.files),'installer-manifest.json'].sort());
 for(const [path,sha] of Object.entries(manifest.files)){
  assert.equal(hash(await readFile(join(site,path))),sha,path);
  assert.ok(!/(^|\/)(\.env[^/]*|node_modules|\.git|\.temp|references|minihompy-identity|verification|screenshots)(\/|$)/.test(path),path);
  assert.ok(!path.endsWith('.lock')&&!path.endsWith('.pem')&&!path.endsWith('.key')&&path!=='setup/config.json',path);
 }
 for(const dir of ['supabase/migrations','supabase/functions']){
  assert.deepEqual(await walk(join(site,dir)),await walk(join(root,dir)),dir);
  for(const path of await walk(join(root,dir)))assert.equal(hash(await readFile(join(site,dir,path))),hash(await readFile(join(root,dir,path))));
 }
 for(const path of ['scripts/backfill-photo-variants.mjs','setup/photo-variant-backfill.mjs','setup/photo-variant-encoder.mjs','docs/photo-variant-backfill.md'])assert.ok(manifest.files[path],path);
 assert.match(execFileSync(process.execPath,['scripts/backfill-photo-variants.mjs','--help'],{cwd:site,encoding:'utf8'}),/Default: dry run/);
 const window={};
 for(const name of ['supabase-config.js','visitor-identity-config.js','member-writing-config.js','home-data-config.js'])runInNewContext(await readFile(join(site,name),'utf8'),{window});
 assert.equal(window.MINIHOMPY_SUPABASE.url,'');assert.equal(window.MINIHOMPY_SUPABASE.publishableKey,'');
 assert.equal(window.MINIHOMPY_VISITOR_IDENTITY_CONFIG.siteId,'');
 for(const global of ['MINIHOMPY_VISITOR_IDENTITY_CONFIG','MINIHOMPY_MEMBER_WRITING_CONFIG','MINIHOMPY_HOME_DATA_CONFIG'])assert.equal(window[global].enabled,false);
 const example=JSON.parse(await readFile(join(site,'setup/config.example.json'),'utf8'));
 await writeFile(join(site,'setup/config.json'),JSON.stringify(example));
 execFileSync(process.execPath,['setup/setup.mjs','install','--config','setup/config.json','--dry-run'],{cwd:site});
 execFileSync(process.execPath,['scripts/build-pages.mjs'],{cwd:site});
 execFileSync(process.execPath,['scripts/verify-artifact.mjs'],{cwd:site});
 console.log(`PASS: ${Object.keys(manifest.files).length} hashed files, complete SQL/functions, clean identity templates, reproducible archive, extracted offline install dry run and Pages build.`);
}finally{await rm(temp,{recursive:true,force:true});}
