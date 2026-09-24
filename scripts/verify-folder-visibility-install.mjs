// Exercise the real install migration loop against an empty SQL database, then feature preparation.
import assert from 'node:assert/strict';
import {mkdtemp,cp,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {runSetup} from '../setup/identity-setup.mjs';
import {upgradeFolderVisibility} from '../setup/folder-visibility-setup.mjs';
const target=await mkdtemp(join(tmpdir(),'visibility-install-')),pg=new PGlite();
const owner='90000000-0000-4000-8000-000000000001',registration='90000000-0000-4000-8000-000000000002';
const config={githubUser:'alice',githubRepo:'minihompy',projectRef:'a'.repeat(20),publishableKey:'sb_publishable_testpublickey',handle:'alice',displayName:'Alice',centralApiUrl:'https://central.test/api',centralPageUrl:'https://central.test/hub'};
const fetcher=async(url,init={})=>{
 const body=init.body?JSON.parse(init.body):{};
 if(url.endsWith('/database/query'))return Response.json((await pg.exec(body.query)).at(-1)?.rows||[]);
 if(url.includes('/auth/v1/token'))return Response.json({access_token:'fixture.token.signature'});
 if(url.endsWith('/auth/v1/user'))return Response.json({id:owner,is_anonymous:false,role:'authenticated'});
 if(url.endsWith('/is_minihompy_admin'))return Response.json(true);
 if(url.endsWith('/owner-login'))return Response.json({access_token:'fixture.token.signature'});
 if(url.endsWith('/secrets')||url.endsWith('/config/auth')||url.includes('/logout'))return Response.json({});
 if(url.endsWith('/sites'))return Response.json({registration_id:registration,expires_at:new Date(Date.now()+86400000).toISOString(),verification_url:`https://alice.github.io/minihompy/minihompy-identity/${registration}.json`,verification_file:{registration_id:registration,challenge:'a'.repeat(43)}},{status:202});
 if(url.endsWith('/photo-media/read'))return Response.json({error:{code:'NOT_FOUND'}},{status:404,headers:{'access-control-allow-origin':'https://alice.github.io','cache-control':'private, no-store'}});
 throw Error('Unexpected request '+url);
};
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${owner}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
 for(const name of ['supabase','scripts','index.html','login','content-access.js','content-folders-repository.js','content-folders.js','photo-media-client.js','photos-repository.js','photo-editor.js'])await cp(new URL('../'+name,import.meta.url),join(target,name),{recursive:true});
 const opts={config,target,command:'install',email:'fixture@test',password:'fixture-password',managementToken:'fixture-token',fetcher,deploy:async()=>{},log:()=>{}};
 await runSetup(opts);
 const before=(await pg.query('select * from private.minihompy_setup_migrations order by name')).rows;
 assert.equal(before.length,(await readdir(join(target,'supabase/migrations'))).filter(x=>x.endsWith('.sql')).length);
 assert.deepEqual(await upgradeFolderVisibility(opts),{prepared:true,mediaMode:'legacy',mediaReady:false});
 assert.deepEqual((await pg.query('select * from private.minihompy_setup_migrations order by name')).rows,before);
 assert.equal((await pg.query("select public from storage.buckets where id='minihompy-photos-private'")).rows[0].public,false);
 console.log('PASS: real fresh install executes all migrations in order; subsequent folder preparation accepts tracked hashes, preserves ledger and leaves photo media disabled');
}finally{await pg.close();await rm(target,{recursive:true,force:true});}
