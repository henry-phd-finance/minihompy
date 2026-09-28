import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,symlink,readFile,readdir,rm,chmod} from 'node:fs/promises';
import {run} from './backfill-photo-variants.mjs';
const project='https://aaaaaaaaaaaaaaaaaaaa.supabase.co',owner='a0000000-0000-4000-8000-000000000001';
const env={SUPABASE_URL:project,SUPABASE_SERVICE_ROLE_KEY:'fixture',CHROMIUM_PATH:process.env.CHROMIUM_PATH};
const root=await mkdtemp('/tmp/backfill-cli-'),originalFetch=globalThis.fetch;let capable=false,requests=[];
globalThis.fetch=async(url,init)=>{requests.push({url,init});assert.equal(init.redirect,'error');if(url.endsWith('/photo_variant_status'))return capable?Response.json({photo_variant_protocol:1}):new Response('{}',{status:404});if(url.endsWith('/photo_media')){assert.equal(JSON.parse(init.body).p_action,'inventory');return Response.json({mode:'protected',ready:true,posts:[],assets:[]});}if(url.endsWith('/bucket/minihompy-photos-private'))return Response.json({public:false});throw Error('Unexpected write or request');};
const args=dir=>['--project',project,'--owner-id',owner,'--journal-dir',dir,'--playwright-module',process.argv[2]];
try{
 await assert.rejects(run([...args(root),'--bogus'],env));await assert.rejects(run(args(root),{...env,SUPABASE_URL:project.replace('a','b')}));assert.equal(requests.length,0);
 await run(args(root),env);assert.deepEqual(await readdir(root),[]);assert.equal(requests.length,3);
 console.log('PASS 1: default CLI is dry run, capability absent allowed, no journal/media writes, strict flags/project validation');
 await assert.rejects(run([...args(root),'--apply'],env),/Variant setup required/);assert.deepEqual(await readdir(root),[]);
 console.log('PASS 2: apply refuses undeployed variant capability before any mutation');
 await chmod(root,0o755);await assert.rejects(run(args(root),env),/0700/);await chmod(root,0o700);
 await mkdir(root+'/run.lock');await assert.rejects(run(args(root),env));assert((await readdir(root)).includes('run.lock'));await rm(root+'/run.lock',{recursive:true});
 await writeFile(root+'/outside','{}',{mode:0o600});await symlink(root+'/outside',root+'/journal.json');await assert.rejects(run(args(root),env),/Unsafe/);await rm(root+'/journal.json');assert.equal(await readFile(root+'/outside','utf8'),'{}');
 console.log('PASS 3: permissions, exclusive lock and symlink journal rejected; existing lock/external file preserved');
 await mkdir(root+'/safe',{mode:0o700});capable=true;await run([...args(root+'/safe'),'--apply'],env);const journal=JSON.parse(await readFile(root+'/safe/journal.json','utf8'));assert.equal(journal.project,project);assert.equal(journal.ownerId,owner);assert.equal(journal.recipe,'display-v1');
 await writeFile(root+'/safe/'+'a'.repeat(64)+'.webp',new Uint8Array([1]),{mode:0o600});await writeFile(root+'/safe/output.tmp',new Uint8Array([1]),{mode:0o600});await run([...args(root+'/safe'),'--apply'],env);assert.deepEqual(await readdir(root+'/safe'),['journal.json']);
 console.log('PASS 4: private atomic journal and orphan staged-file cleanup; source/API mutation allowlist remains empty');
}finally{globalThis.fetch=originalFetch;await rm(root,{recursive:true,force:true});}
