import assert from 'node:assert/strict';import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const root=resolve(process.env.INSTALL_SOURCE_ROOT||'.');
const {applyInstallMigrations}=await import(pathToFileURL(root+'/setup/identity-setup.mjs'));const {applyFriendVisibilityMigrations}=await import(pathToFileURL(root+'/setup/friend-visibility-setup.mjs'));
const pg=new PGlite(),query=async sql=>{try{return (await pg.exec(sql)).at(-1)?.rows||[];}catch(e){await pg.exec('rollback');throw e;}};
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
 await applyInstallMigrations({root,query,log:()=>{}});
 const expected=(await readdir(root+'/supabase/migrations')).filter(n=>/^\d+_[a-z0-9_]+\.sql$/.test(n)).sort(),ledger=await query('select name,sha256 from private.minihompy_setup_migrations order by name');assert.deepEqual(ledger.map(r=>r.name),expected);
 await query("insert into auth.users values('80000000-0000-4000-8000-000000000001');insert into private.minihompy_admins values('80000000-0000-4000-8000-000000000001');select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000001',false);insert into public.board_posts(folder_id,author_name,title,body) select id,'owner','preserved','private test fixture' from public.board_folders limit 1;");
 const before=await query('select * from public.board_posts');await applyInstallMigrations({root,query,log:()=>{}});await applyFriendVisibilityMigrations({target:root,query,checkOnly:true,log:()=>{}});assert.deepEqual(await query('select * from public.board_posts'),before);assert.deepEqual(await query('select name,sha256 from private.minihompy_setup_migrations order by name'),ledger);
 console.log('PASS 1: actual fresh install applies all '+expected.length+' migrations; second install and upgrade check preserve content and ledger');
 await query("update private.photo_media_state set mode='protected',ready=true");const caps=(await query('select public.photo_variant_status() c'))[0].c;assert.equal(caps.photo_variant_protocol,1);assert.equal(caps.photo_variant_read_protocol,1);assert.equal(caps.photo_variant_recipe,'display-v1');
 for(const role of ['anon','authenticated']){await pg.exec('set role '+role);await assert.rejects(pg.exec('select public.photo_variant_status()'));await assert.rejects(pg.exec('select * from private.photo_asset_variants'));await pg.exec('reset role');}
 console.log('PASS 2: fresh install exposes both service-only variant capabilities; browser metadata access remains denied');
 await query("update private.minihompy_setup_migrations set sha256='wrong' where name='202609280003_photo_variant_reads.sql'");await assert.rejects(applyInstallMigrations({root,query,log:()=>{}}),/변경/);console.log('PASS 3: existing migration hash drift rejects replay');
}finally{await pg.close();}
