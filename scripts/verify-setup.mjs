import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { execFileSync } from 'node:child_process';
import { runSetup, validateConfig, runtimeFiles } from '../setup/identity-setup.mjs';
const root=await mkdtemp(join(tmpdir(),'minihompy-setup-'));
const registration='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', site='bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', owner='cccccccc-1111-4111-8111-cccccccccccc';
const config={githubUser:'alice',githubRepo:'minihompy',projectRef:'a'.repeat(20),publishableKey:'sb_publishable_testpublickey',handle:'alice',displayName:'Alice',centralApiUrl:'https://central.test/api',centralPageUrl:'https://central.test/hub'};
const requests=[],logs=[];let deployed=0, failure='', admin=true, existing=false;
const fetcher=async(url,options)=>{
  const body=options.body?JSON.parse(options.body):null;requests.push({url,body,headers:options.headers});
  if(failure && url.endsWith(failure))return Response.json({error:'secret must not be printed'},{status:503});
  if(url.endsWith('/database/query')) {
    if(body.query.startsWith('select to_regclass'))return Response.json([{existing,tracked:false}]);
    return Response.json([]);
  }
  if(url.includes('/auth/v1/token'))return Response.json({access_token:'access.proof.token',refresh_token:'refresh-private'});
  if(url.endsWith('/auth/v1/user'))return Response.json({id:owner,is_anonymous:false,role:'authenticated'});
  if(url.endsWith('/is_minihompy_admin'))return Response.json(admin);
  if(url.endsWith('/owner-login'))return Response.json({access_token:'owner.proof.token'});
  if(url.endsWith('/secrets') || url.endsWith('/config/auth'))return Response.json({});
  if(url.endsWith('/sites') || url.endsWith('/sites/reverify'))return Response.json({registration_id:registration,expires_at:new Date(Date.now()+86400000).toISOString(),verification_url:`https://alice.github.io/minihompy/minihompy-identity/${registration}.json`,verification_file:{registration_id:registration,challenge:'a'.repeat(43)}},{status:202});
  if(url.endsWith('/sites/verify'))return Response.json({status:'verified',site_id:site,member_id:registration,handle:'alice'});
  throw Error('Unexpected request');
};
const options={config,command:'install',target:root,email:'private@example.test',password:'private-password',managementToken:'private-management',fetcher,deploy:async()=>{deployed++;},log:s=>logs.push(s)};
try {
  for(const name of ['index.html','login/index.html','scripts/build-pages.mjs','supabase/functions/owner-login/index.ts','supabase/functions/owner-login/handler.js']){await mkdir(join(root,name,'..'),{recursive:true});await writeFile(join(root,name),'fixture');}
  await mkdir(join(root,'supabase/migrations'),{recursive:true});await writeFile(join(root,'supabase/migrations/202609130001_identity.sql'),'begin;\nselect 1;\ncommit;\n');
  const before=await readdir(root);await runSetup({...options,dryRun:true});assert.deepEqual(await readdir(root),before);assert.equal(requests.length,0);assert.equal(deployed,0);
  assert.throws(()=>validateConfig({...config,password:'forbidden'}));assert.throws(()=>validateConfig({...config,publishableKey:'sb_secret_forbidden'}));
  assert.equal(validateConfig({...config,githubRepo:'alice.github.io'}).basePath,'/');
  assert.throws(()=>validateConfig({...config,githubRepo:'../escape'}));
  existing=true;await assert.rejects(runSetup(options),/기존 DB/);existing=false;
  failure='/database/query';await assert.rejects(runSetup(options),/HTTP 503/);assert.equal(deployed,0);failure='';
  const pending=await runSetup(options);assert.equal(pending.status,'pending');assert.equal(deployed,1);
  const proof=JSON.parse(await readFile(join(root,`minihompy-identity/${registration}.json`),'utf8'));assert.equal(proof.challenge,'a'.repeat(43));
  assert.match(await readFile(join(root,'visitor-identity-config.js'),'utf8'),/"enabled": false/);
  const saved=await readFile(join(root,'.minihompy-registration.json'),'utf8');assert.ok(!saved.includes('private-'));assert.ok(!saved.includes('access.proof.token'));
  failure='/sites/verify';await assert.rejects(runSetup({...options,command:'verify'}),/HTTP 503/);assert.match(await readFile(join(root,'visitor-identity-config.js'),'utf8'),/"enabled": false/);failure='';
  await runSetup({...options,command:'verify'});
  const window={};runInNewContext(await readFile(join(root,'visitor-identity-config.js'),'utf8'),{window});assert.equal(window.MINIHOMPY_VISITOR_IDENTITY_CONFIG.siteId,site);assert.equal(window.MINIHOMPY_VISITOR_IDENTITY_CONFIG.handle,'alice');
  const verifyCount=()=>requests.filter(r=>r.url.endsWith('/sites/verify')).length;const count=verifyCount();await runSetup({...options,command:'verify'});assert.equal(verifyCount(),count,'file generation retry must not consume a registration again');
  admin=false;await assert.rejects(runSetup({...options,command:'upgrade',config:{...config,siteId:site}}),/관리자/);admin=true;
  const registrationStart=requests.length; await runSetup({...options,command:'register'});
  assert.ok(!requests.slice(registrationStart).some(r=>r.url.endsWith('/database/query')));
  assert.ok(requests.slice(registrationStart).some(r=>r.url.endsWith('/sites')));
  const from=requests.length;await runSetup({...options,command:'upgrade',config:{...config,siteId:site}});
  assert.ok(requests.slice(from).some(r=>r.url.endsWith('/sites/reverify')&&r.body.site_id===site));assert.ok(!requests.slice(from).some(r=>r.url.endsWith('/database/query')),'upgrade must not rewrite existing tables/bindings');
  const deploymentBefore=deployed;failure='/sites/reverify';await assert.rejects(runSetup({...options,command:'upgrade',config:{...config,siteId:site}}));assert.equal(deployed,deploymentBefore,'unproven existing owner must not deploy a new mapping');failure='';
  for(const req of requests.filter(r=>r.url.startsWith(config.centralApiUrl))){const body=JSON.stringify(req.body);assert.ok(!/private-password|private@example|private-management|refresh-private/.test(body));assert.equal(req.headers.Authorization,'Bearer access.proof.token');}
  assert.ok(!logs.join('\n').includes('private-password'));
  for(const content of Object.values(runtimeFiles(validateConfig({...config,displayName:'"quote'}),site)))runInNewContext(content,{window:{}});
  await cp(new URL('./build-pages.mjs',import.meta.url),join(root,'scripts/build-pages.mjs'));
  for(const dir of ['assets','views'])await mkdir(join(root,dir),{recursive:true});
  await writeFile(join(root,'styles.css'),'');
  execFileSync(process.execPath,[join(root,'scripts/build-pages.mjs')],{cwd:root,stdio:'pipe'});
  assert.deepEqual(JSON.parse(await readFile(join(root,`_site/minihompy-identity/${registration}.json`),'utf8')),proof);
  const artifact=await readdir(join(root,'_site'));
  assert.ok(!artifact.includes('.minihompy-registration.json') && !artifact.includes('supabase') && !artifact.includes('scripts'));
  console.log('PASS: dry-run isolation, public-key/input validation, migration fail-stop, no untracked DB replay, Auth owner proof, pending/verify/reverify, same site ID, retry after consumption, private data confinement.');
} finally {await rm(root,{recursive:true,force:true});}
