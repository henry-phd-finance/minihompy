import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,cp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {pgcrypto} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js';
import {applyMemberRelationships,deployMemberRelationships} from '../../minihompy-central/scripts/deploy-member-relationships.mjs';
import {runSetup} from '../setup/identity-setup.mjs';
import {applyFriendReviews} from '../setup/member-relationship-setup.mjs';
const queryFor=pg=>async sql=>(await pg.exec(sql)).at(-1)?.rows||[];
const central=new PGlite({extensions:{pgcrypto}}),personal=new PGlite();
const target=await mkdtemp(join(tmpdir(),'relationship-install-'));
try{
 await central.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 for(const file of (await readdir(new URL('../../minihompy-central/supabase/migrations/',import.meta.url))).sort().filter(n=>n.endsWith('.sql')&&n<'202609240001'))await central.exec(await readFile(new URL('../../minihompy-central/supabase/migrations/'+file,import.meta.url),'utf8'));
 const query=queryFor(central);
 await central.exec("insert into private.identity_members(handle,display_name) values('existing','preserve')");
 const before=(await central.query('select * from private.identity_members')).rows;
 let deployments=0,failDeploy=true,healthReady=false;
 const fetcher=async(url,options)=>{
  if(url.endsWith('/database/query'))return Response.json(await query(JSON.parse(options.body).query));
  if(url.endsWith('/health'))return Response.json({relationship_protocol:healthReady?1:0});
  throw Error('Unexpected endpoint; secrets must not change');
 };
 const runner=(_cmd,args)=>{assert.ok(['identity-api','identity-page'].includes(args[2]));deployments++;const child=new EventEmitter();queueMicrotask(()=>child.emit('close',failDeploy?1:0));return child;};
 const options={env:{CENTRAL_PROJECT_REF:'a'.repeat(20),SUPABASE_ACCESS_TOKEN:'test-only'},fetcher,runner};
 await deployMemberRelationships(options);assert.equal(deployments,0);
 await assert.rejects(deployMemberRelationships({...options,apply:true}),/deploy failed/);
 assert.equal((await query('select * from private.member_writing_deployments')).length,1);
 failDeploy=false;await assert.rejects(deployMemberRelationships({...options,apply:true}),/health probe/);
 await central.exec("insert into private.identity_members(id,handle,display_name) values('10000000-0000-4000-8000-000000000001','one','one'),('10000000-0000-4000-8000-000000000002','two','two'); insert into private.identity_relationships(member_low,member_high,state,revision,request_id,sender_id,receiver_id,requested_at,accepted_at,updated_at) values('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','accepted',2,gen_random_uuid(),'10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',now(),now(),now())");
 const relationshipBefore=await query('select * from private.identity_relationships');
 healthReady=true;await deployMemberRelationships({...options,apply:true});await applyMemberRelationships({query});
 assert.deepEqual((await central.query("select * from private.identity_members where handle='existing'")).rows,before);
 assert.deepEqual(await query('select * from private.identity_relationships'),relationshipBefore);
 await central.exec("update private.member_writing_deployments set sha256='bad'");await assert.rejects(applyMemberRelationships({query}),/hash differs/);
 await central.exec('delete from private.member_writing_deployments');await assert.rejects(applyMemberRelationships({query}),/Untracked/);
 console.log('PASS central: fresh base + tracked relationship install, interrupted deploy/probe retry, unchanged identities, no secret writes, dry run, hash/untracked rejection');
 // Real fresh-install SQL through the production installer; stop at mocked Auth
 // boundary intentionally, then rerun all migrations without replaying any DDL.
 await personal.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
 for(const file of ['supabase','login','index.html'])await cp(new URL('../'+file,import.meta.url),join(target,file),{recursive:true});
 await mkdir(join(target,'scripts'));await cp(new URL('build-pages.mjs',import.meta.url),join(target,'scripts/build-pages.mjs'));
 const config={githubUser:'alice',githubRepo:'minihompy',projectRef:'a'.repeat(20),publishableKey:'sb_publishable_testpublickey',handle:'alice',displayName:'Alice',centralApiUrl:'https://central.test/api',centralPageUrl:'https://central.test/hub'};
 let authBoundaries=0;
 const personalQuery=queryFor(personal),install={config,command:'install',target,email:'test@example.test',password:'test',managementToken:'test',log:()=>{},fetcher:async(url,options)=>{
  if(url.endsWith('/database/query'))return Response.json(await personalQuery(JSON.parse(options.body).query));
  if(url.includes('/auth/v1/token')){authBoundaries++;throw Error('TEST_AUTH_BOUNDARY');}throw Error('unexpected');
 }};
 for(let i=0;i<2;i++)await assert.rejects(runSetup(install),/연결 실패/);
 assert.equal(authBoundaries,2);
 await applyFriendReviews({target,query:personalQuery});
 const migrations=(await readdir(join(target,'supabase/migrations'))).filter(n=>/^\d+_[a-z0-9_]+\.sql$/.test(n));
 assert.equal((await personalQuery('select * from private.minihompy_setup_migrations')).length,migrations.length);
 const settings=(await personalQuery("select proconfig from pg_proc where proname='member_friend_reviews'"))[0].proconfig;
 assert.ok(settings.includes('lock_timeout=5s'));assert.ok(settings.includes('statement_timeout=5s'));
 console.log('PASS personal: real fresh installer applies every migration, interrupted install retry, relationship command accepts tracked fresh schema, RPC timeout declarations');
}finally{await central.close();await personal.close();await rm(target,{recursive:true,force:true});}
