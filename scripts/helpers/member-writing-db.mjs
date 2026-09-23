import {readFile} from 'node:fs/promises';
export async function memberWritingDb(PGlite,{siteId,centralUrl,writing=true}){
 const pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,public to anon,authenticated,service_role;
 grant execute on function auth.uid() to anon,authenticated,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant usage on schema storage to anon,authenticated;
 grant select,insert,update,delete on storage.objects to anon,authenticated;`);
 for(const file of ['202609130001_identity.sql','202609130002_board.sql','202609130003_settings.sql','202609130004_photos.sql','202609130005_diary.sql','202609130006_guestbook.sql','202609130007_guestbook_clock.sql','202609130008_comments.sql','202609130009_profile.sql','202609130010_board_retry.sql','202609230001_member_writing_foundation.sql','202609230002_member_writing_sessions.sql','202609230003_member_guestbook.sql','202609230004_member_comments.sql','202609230005_home_summary.sql','202609230006_post_location.sql','202609230007_guestbook_post_location.sql','202609230008_visit_counts.sql'].filter(name=>writing||name<'202609230001'))await pg.exec(await readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
 if(writing)await pg.query('insert into private.member_writing_site(site_id,central_api_url) values($1,$2)',[siteId,centralUrl]);
 let queue=Promise.resolve();
 const db={rpc(name,args){
  const operation=queue.then(async()=>{
  if(!['member_writing_session','member_guestbook','member_comments'].includes(name))throw Error('Unexpected RPC');
  await pg.exec('set role service_role');
  try{const r=await pg.query('select public.'+name+'($1,$2) as value',[args.p_action,JSON.stringify(args.p_args)]);return {data:r.rows[0].value,error:null};}
  catch(e){return {data:null,error:{code:e.code}};}
  finally{await pg.exec('reset role');}
  });
  queue=operation.catch(()=>{});return operation;
 }};
 return {pg,db};
}
