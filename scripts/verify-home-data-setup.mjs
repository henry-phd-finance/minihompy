import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {writingMigrations} from '../setup/member-writing-setup.mjs';
import {upgradeHomeData,homeMigrations} from '../setup/home-data-setup.mjs';
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2]||'../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js')));
const {pg}=await memberWritingDb(PGlite,{writing:false});
const target=await mkdtemp(join(tmpdir(),'home-setup-'));
const config={githubUser:'alice',githubRepo:'minihompy',projectRef:'a'.repeat(20),publishableKey:'sb_publishable_testpublickey',handle:'alice',displayName:'Alice',centralApiUrl:'https://central.test/api',centralPageUrl:'https://central.test/hub'};
let secrets=[],deploys=0,fail=false,admin=true,requests=0;const log=[];
const sql=async text=>(await pg.exec(text)).at(-1)?.rows||[];
const fetcher=async(url,init={})=>{
 requests++;
 if(url.includes('/auth/v1/token'))return Response.json({access_token:'fixture'});
 if(url.endsWith('/is_minihompy_admin'))return Response.json(admin);
 if(url.endsWith('/database/query'))return Response.json(await sql(JSON.parse(init.body).query));
 if(url.endsWith('/secrets')){
  if(init.method==='POST'){for(const item of JSON.parse(init.body)){secrets=secrets.filter(s=>s.name!==item.name);secrets.push(item);}return Response.json({});}
  return Response.json(secrets.map(s=>({name:s.name})));
 }
 if(url.endsWith('/visit-counts')){assert.equal(init.method,undefined);return Response.json((await sql('select public.visit_stats() as data'))[0].data,{status:fail?503:200,headers:{'access-control-allow-origin':'https://alice.github.io'}});}
 if(url.endsWith('/home_summary'))return Response.json((await sql("select public.home_summary('{}') as data"))[0].data);
 if(url.includes('/logout'))return Response.json({});
 throw Error('Unexpected request');
};
try{
 for(const name of writingMigrations)await pg.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 for(const name of ['supabase','index.html','home-data-config.js','visit-counts.js','home-repository.js','home-activity.js','post-routes.js','post-location-repository.js'])await cp(new URL('../'+name,import.meta.url),join(target,name),{recursive:true});
 await writeFile(join(target,'supabase-config.js'),'window.MINIHOMPY_SUPABASE={url:"https://'+'a'.repeat(20)+'.supabase.co"}');
 const opts={config,target,email:'fixture@test',password:'private',managementToken:'private-management',fetcher,deploy:async()=>{deploys++;},log:s=>log.push(s)};
 const disabled=await readFile(join(target,'home-data-config.js'),'utf8');
 await upgradeHomeData({...opts,dryRun:true});assert.equal(requests,0);assert.equal(deploys,0);
 admin=false;await assert.rejects(upgradeHomeData(opts),/관리자/);assert.equal(secrets.length,0);admin=true;
 fail=true;await assert.rejects(upgradeHomeData(opts),/준비 확인/);assert.equal(await readFile(join(target,'home-data-config.js'),'utf8'),disabled);
 assert.equal(secrets.filter(s=>s.name==='MINIHOMPY_VISIT_SECRET').length,1);const originalSecret=secrets.find(s=>s.name==='MINIHOMPY_VISIT_SECRET').value;assert.match(originalSecret,/^[0-9a-f]{64}$/);
 fail=false;await upgradeHomeData(opts);await upgradeHomeData(opts);
 const activated=await readFile(join(target,'home-data-config.js'),'utf8');assert.match(activated,/"enabled":true/);assert.ok(activated.includes('https://alice.github.io/minihompy/'));assert.ok(!activated.includes(originalSecret));assert.ok(!log.join('').includes(originalSecret));
 assert.equal(secrets.find(s=>s.name==='MINIHOMPY_VISIT_SECRET').value,originalSecret);assert.equal((await sql('select * from private.minihompy_setup_migrations')).length,4);assert.equal((await sql('select public.visit_stats() as data'))[0].data.total,0);
 await sql("select public.visit_record((now() at time zone 'Asia/Seoul')::date,repeat('a',64))");
 await sql('delete from private.minihompy_setup_migrations');await upgradeHomeData(opts);assert.equal((await sql('select public.visit_stats() as data'))[0].data.total,1);assert.equal(secrets.find(s=>s.name==='MINIHOMPY_VISIT_SECRET').value,originalSecret);
 console.log('PASS: offline dry run, admin preflight, failed deploy leaves disabled, first secret creation, retry preserves secret, readiness is read-only');
 // Fresh home migration and repeated tracked upgrades have both completed.
 const file=join(target,'supabase/migrations',homeMigrations[0]);await writeFile(file,(await readFile(file,'utf8'))+'\n-- changed');await assert.rejects(upgradeHomeData(opts),/해시/);
 await cp(new URL('../supabase/migrations/'+homeMigrations[0],import.meta.url),file);
 secrets=secrets.filter(s=>s.name!=='MINIHOMPY_VISIT_SECRET');await sql('update private.visit_total set total=1');await assert.rejects(upgradeHomeData(opts),/secret이 없습니다/);assert.ok(!secrets.some(s=>s.name==='MINIHOMPY_VISIT_SECRET'));
 await writeFile(join(target,'.minihompy-home-data.lock'),'');await assert.rejects(upgradeHomeData(opts),/이미 실행/);await rm(join(target,'.minihompy-home-data.lock'));
 await rm(join(target,'visit-counts.js'));await assert.rejects(upgradeHomeData({...opts,dryRun:true}),/ENOENT/);
 console.log('PASS: migration hash mismatch, missing secret with existing counts, concurrent local installer and missing runtime rejection');
}finally{await pg.close();await rm(target,{recursive:true,force:true});}
