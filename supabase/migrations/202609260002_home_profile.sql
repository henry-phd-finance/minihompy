begin;
-- Keep the sidebar greeting in the existing settings; optional imagePath is new.
create function private.validate_home_profile_image() returns trigger
language plpgsql security definer set search_path = '' as $$
declare path text;
begin
  if new.payload->'profile' ? 'imagePath' then
    path:=new.payload#>>'{profile,imagePath}';
    if jsonb_typeof(new.payload#>'{profile,imagePath}') is distinct from 'string'
      or (path<>'' and path!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif)$') then
      raise exception 'Invalid home profile image' using errcode='23514';
    end if;
    if path<>'' and not exists(select 1 from storage.objects where bucket_id='minihompy-home-profile' and name=path) then
      raise exception 'Home profile image must be uploaded first' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_home_profile_image() from public,anon,authenticated;
create trigger validate_home_profile_image before insert or update on public.minihompy_settings
for each row execute function private.validate_home_profile_image();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('minihompy-home-profile','minihompy-home-profile',true,6291456,array['image/jpeg','image/png','image/webp','image/gif']);
create policy home_profile_objects_read on storage.objects for select to authenticated
using(bucket_id='minihompy-home-profile' and (select public.is_minihompy_admin()));
create policy home_profile_objects_insert on storage.objects for insert to authenticated
with check(bucket_id='minihompy-home-profile' and (select public.is_minihompy_admin())
  and name~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif)$');
create policy home_profile_objects_delete on storage.objects for delete to authenticated
using(bucket_id='minihompy-home-profile' and (select public.is_minihompy_admin())
  and not exists(select 1 from public.minihompy_settings where payload#>>'{profile,imagePath}'=storage.objects.name));
commit;
