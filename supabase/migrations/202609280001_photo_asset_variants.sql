begin;
-- No FK cascade: deleted posts/sources must not erase Storage cleanup paths.
create table private.photo_asset_variants (
 id uuid primary key default gen_random_uuid(), source_path text not null, post_id uuid not null,
 source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
 recipe text not null check(recipe='display-v1'), storage_path text not null unique,
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'), size integer not null check(size between 1 and 6291455),
 mime text not null check(mime='image/webp'), width integer not null check(width between 1 and 1200),
 height integer not null check(height between 1 and 1200), created_by uuid not null,
 state text not null default 'pending' check(state in ('pending','ready','deleting','deleted')),
 operation_id uuid not null default gen_random_uuid(), lease_expires_at timestamptz not null default clock_timestamp()+interval '15 minutes',
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 upload_verified_at timestamptz, deleted_at timestamptz,
 check(storage_path='variants/'||post_id::text||'/'||id::text||'.webp'),
 check(state<>'ready' or upload_verified_at is not null),
 check((state='deleted')=(deleted_at is not null))
);
create unique index photo_variants_active on private.photo_asset_variants(source_path,source_sha256,recipe) where state<>'deleted';
create index photo_variants_source on private.photo_asset_variants(source_path);
alter table private.photo_asset_variants enable row level security;
revoke all on private.photo_asset_variants from public,anon,authenticated,service_role;

-- Service-only. owner_id comes from authenticateOwner; hash/size/dimensions for
-- upload_confirm MUST come from actual immutable Storage bytes verified by the service.
-- SQL cannot establish a Storage byte hash or infer successful object deletion.
create function public.photo_variant(p_action text,p_args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.photo_assets; v private.photo_asset_variants; uid uuid; linked boolean; source_ok boolean; vid uuid;
begin
 -- Same ordering as photo_posts statement triggers and photo_media: lock, source, variant.
 perform pg_advisory_xact_lock(240001,2);
 uid:=(p_args->>'owner_id')::uuid;
 if uid is null or not exists(select 1 from private.minihompy_admins where user_id=uid) then return jsonb_build_object('failure','FORBIDDEN'); end if;
 if not exists(select 1 from private.photo_media_state where singleton and mode='protected' and ready) then return jsonb_build_object('failure','NOT_READY'); end if;
 if p_action='inventory' then
  return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at,t.id) from private.photo_asset_variants t where t.source_path=p_args->>'path'),'[]'::jsonb));
 end if;
 if p_action not in ('reserve','status','upload_confirm','complete','cleanup_begin','cleanup_finish') then return jsonb_build_object('failure','BAD_REQUEST'); end if;
 select * into a from private.photo_assets where path=p_args->>'path' for update;
 if p_action='reserve' then
  select * into v from private.photo_asset_variants where source_path=p_args->>'path' and source_sha256=p_args->>'source_sha256' and recipe=p_args->>'recipe' and state<>'deleted' for update;
 else
  select * into v from private.photo_asset_variants where id=(p_args->>'id')::uuid for update;
  if v.id is null then return jsonb_build_object('failure','NOT_FOUND'); end if;
  if v.source_path is distinct from p_args->>'path' or v.operation_id is distinct from (p_args->>'operation_id')::uuid then return jsonb_build_object('failure','REQUEST_CONFLICT'); end if;
 end if;
 linked:=exists(select 1 from public.photo_posts p where p.id=a.post_id and p.body @> jsonb_build_array(jsonb_build_object('type','image','path',a.path)));
 source_ok:=a.path is not null and a.complete and a.state<>'deleting' and
   ((a.state='attached' and linked) or (a.state='staged' and not a.ever_attached and not linked and a.uploaded_by=uid and a.created_at>clock_timestamp()-interval '15 minutes'));
 if p_action='status' then return to_jsonb(v); end if;
 if p_action='cleanup_begin' then
  if v.state='deleted' or v.state='deleting' then return to_jsonb(v); end if;
  -- A live pending upload cannot be safely deleted merely because a caller wants cleanup.
  if v.state='pending' and v.lease_expires_at>clock_timestamp() then return jsonb_build_object('failure','UPLOAD_PENDING'); end if;
  if v.state='ready' and a.path is not null and a.state<>'deleting' and a.sha256=v.source_sha256 and a.post_id=v.post_id and
    (linked or (not a.ever_attached and a.created_at>clock_timestamp()-interval '15 minutes')) then return jsonb_build_object('failure','IN_USE'); end if;
  update private.photo_asset_variants set state='deleting',updated_at=clock_timestamp() where id=v.id returning * into v;
  return to_jsonb(v);
 end if;
 if p_action='cleanup_finish' then
  if v.state='deleted' then return to_jsonb(v); end if;
  if v.state<>'deleting' or (p_args->>'storage_deleted')::boolean is distinct from true then return jsonb_build_object('failure','REQUEST_CONFLICT'); end if;
  update private.photo_asset_variants set state='deleted',deleted_at=clock_timestamp(),updated_at=clock_timestamp() where id=v.id returning * into v;
  return to_jsonb(v);
 end if;
 if not coalesce(source_ok,false) or a.post_id is distinct from (p_args->>'post_id')::uuid or a.sha256 is distinct from p_args->>'source_sha256' then return jsonb_build_object('failure','SOURCE_CHANGED'); end if;
 if p_action='reserve' then
  if p_args->>'recipe' is distinct from 'display-v1' or a.mime not in ('image/jpeg','image/png','image/webp') or
   p_args->>'mime' is distinct from 'image/webp' or (p_args->>'size')::integer is null or (p_args->>'size')::integer>=a.size then return jsonb_build_object('failure','BAD_REQUEST'); end if;
  if v.id is not null then
   if v.state='ready' then return to_jsonb(v); end if; -- First completed source/recipe wins.
   if v.state<>'pending' or v.lease_expires_at<=clock_timestamp() then return jsonb_build_object('failure','REQUEST_CONFLICT'); end if;
   if v.created_by<>uid or v.sha256 is distinct from p_args->>'sha256' or v.size is distinct from (p_args->>'size')::integer or
    v.width is distinct from (p_args->>'width')::integer or v.height is distinct from (p_args->>'height')::integer then return jsonb_build_object('failure','REQUEST_CONFLICT'); end if;
   return to_jsonb(v);
  end if;
  if (select count(*) from private.photo_asset_variants where created_by=uid and state='pending')>=100 then return jsonb_build_object('failure','RATE_LIMITED'); end if;
  vid:=gen_random_uuid();
  insert into private.photo_asset_variants(id,source_path,post_id,source_sha256,recipe,storage_path,sha256,size,mime,width,height,created_by)
   values(vid,a.path,a.post_id,a.sha256,'display-v1','variants/'||a.post_id::text||'/'||vid::text||'.webp',p_args->>'sha256',(p_args->>'size')::integer,'image/webp',(p_args->>'width')::integer,(p_args->>'height')::integer,uid) returning * into v;
  return to_jsonb(v);
 end if;
 if p_args->>'recipe' is distinct from v.recipe then return jsonb_build_object('failure','REQUEST_CONFLICT'); end if;
 if v.post_id<>a.post_id or v.source_sha256<>a.sha256 or v.size>=a.size or v.created_by<>uid or v.state not in ('pending','ready') then return jsonb_build_object('failure','REQUEST_CONFLICT'); end if;
 if v.sha256 is distinct from p_args->>'sha256' or v.size is distinct from (p_args->>'size')::integer or
  v.mime is distinct from p_args->>'mime' or v.width is distinct from (p_args->>'width')::integer or v.height is distinct from (p_args->>'height')::integer then return jsonb_build_object('failure','INTEGRITY_FAILED'); end if;
 if v.state='ready' then return to_jsonb(v); end if;
 if v.lease_expires_at<=clock_timestamp() then return jsonb_build_object('failure','LEASE_EXPIRED'); end if;
 if p_action='upload_confirm' then
  update private.photo_asset_variants set upload_verified_at=clock_timestamp(),updated_at=clock_timestamp() where id=v.id returning * into v;
 else
  if v.upload_verified_at is null then return jsonb_build_object('failure','UPLOAD_PENDING'); end if;
  update private.photo_asset_variants set state='ready',updated_at=clock_timestamp() where id=v.id returning * into v;
 end if;
 return to_jsonb(v);
exception when invalid_text_representation or check_violation or not_null_violation or numeric_value_out_of_range then
 return jsonb_build_object('failure','BAD_REQUEST');
end;
$$;
revoke all on function public.photo_variant(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.photo_variant(text,jsonb) to service_role;

-- Preserve original protocol and original rows. Old cleanup callers must fail
-- closed until a variant-aware service has confirmed every derived deletion.
alter function public.photo_media(text,jsonb) rename to photo_media_without_variants;
revoke all on function public.photo_media_without_variants(text,jsonb) from public,anon,authenticated,service_role;
create function public.photo_media(p_action text,p_args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; uid uuid;
begin
 perform pg_advisory_xact_lock(240001,2);
 if p_action in ('cleanup_begin','cleanup_finish') then
  uid:=(p_args->>'owner_id')::uuid;
  if uid is null or not exists(select 1 from private.minihompy_admins where user_id=uid) then return jsonb_build_object('failure','FORBIDDEN'); end if;
  if exists(select 1 from private.photo_asset_variants where source_path=p_args->>'path' and state='pending' and lease_expires_at>clock_timestamp()) then return jsonb_build_object('failure','UPLOAD_PENDING'); end if;
  if p_action='cleanup_finish' and exists(select 1 from private.photo_asset_variants where source_path=p_args->>'path' and state<>'deleted') then return jsonb_build_object('failure','VARIANTS_PENDING'); end if;
 end if;
 result:=public.photo_media_without_variants(p_action,p_args);
 if p_action='cleanup_begin' and not result ? 'failure' then
  update private.photo_asset_variants set state='deleting',updated_at=clock_timestamp() where source_path=p_args->>'path' and state in ('pending','ready');
  if exists(select 1 from private.photo_asset_variants where source_path=p_args->>'path' and state<>'deleted') then return jsonb_build_object('failure','VARIANTS_PENDING'); end if;
 end if;
 return result;
exception when invalid_text_representation then return jsonb_build_object('failure','BAD_REQUEST');
end;
$$;
revoke all on function public.photo_media(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.photo_media(text,jsonb) to service_role;
commit;
