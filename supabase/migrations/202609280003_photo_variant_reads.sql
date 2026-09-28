begin;
-- Private resolver: callers must first authorize the ORIGINAL through its existing read policy.
create function private.photo_representation(s jsonb,a jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb:=s->'representation'; p public.photo_posts; v private.photo_asset_variants;
begin
 if not s ? 'representation' then return a; end if;
 if jsonb_typeof(r) is distinct from 'object' or not r ?& array['kind','source_sha256','sha256','revision']
  or r-array['kind','source_sha256','sha256','revision']<>'{}'::jsonb
  or r->>'kind' is distinct from 'display-v1'
  or jsonb_typeof(r->'source_sha256') is distinct from 'string' or (r->>'source_sha256')!~'^[0-9a-f]{64}$'
  or jsonb_typeof(r->'sha256') is distinct from 'string' or (r->>'sha256')!~'^[0-9a-f]{64}$'
  or jsonb_typeof(r->'revision') is distinct from 'number' or (r->>'revision')!~'^[1-9][0-9]*$'
  or (r->>'revision')::numeric>9007199254740991 then raise exception 'BAD_REQUEST'; end if;
 perform pg_advisory_xact_lock(240001,2);
 perform singleton from private.photo_media_state where singleton and mode='protected' and ready for share;
 if not found then raise exception 'NOT_CONFIGURED'; end if;
 select * into p from public.photo_posts where id=(s->>'post_id')::uuid for share;
 if not found or p.revision<>(r->>'revision')::bigint or a->>'sha256' is distinct from r->>'source_sha256'
  or not p.body @> jsonb_build_array(jsonb_build_object('type','image','path',s->>'path')) then raise exception 'NOT_FOUND'; end if;
 select * into v from private.photo_asset_variants where source_path=s->>'path' and post_id=p.id
  and source_sha256=r->>'source_sha256' and recipe='display-v1' and state='ready' and sha256=r->>'sha256' for share;
 if not found then raise exception 'NOT_FOUND'; end if;
 return jsonb_build_object('post_id',p.id,'path',s->>'path','source_sha256',v.source_sha256,'revision',p.revision,
  'storage_path',v.storage_path,'variant_id',v.id,'recipe',v.recipe,'sha256',v.sha256,'mime',v.mime,'size',v.size,'width',v.width,'height',v.height);
end $$;
revoke all on function private.photo_representation(jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.photo_representation_read(p_action text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='3s' set statement_timeout='3s' as $$
declare a jsonb;
begin
 if p_action is distinct from 'read' or not p_args ? 'representation' then raise exception 'BAD_REQUEST'; end if;
 perform pg_advisory_xact_lock(240001,2);
 a:=public.photo_media('read',p_args-'representation');
 if a ? 'failure' then return a; end if;
 return private.photo_representation(p_args,a);
exception
 when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('failure','BAD_REQUEST');
 when raise_exception then
  if sqlerrm=any(array['BAD_REQUEST','FORBIDDEN','NOT_FOUND','NOT_CONFIGURED']) then return jsonb_build_object('failure',sqlerrm); end if;raise;
end $$;
revoke all on function public.photo_representation_read(text,jsonb) from public,anon,authenticated;
grant execute on function public.photo_representation_read(text,jsonb) to service_role;

-- Member-only metadata authorization. File bytes remain in the private Storage bucket.
create or replace function public.member_photo_read(p_action text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='3s' set statement_timeout='3s' as $$
declare view jsonb; s jsonb:=p_args->'selectors'; p public.photo_posts; a private.photo_assets; deadline timestamptz;
begin
 if p_action is distinct from 'read' or p_args->>'mode' is distinct from 'member' or p_args->>'scope' is distinct from 'visible'
  or jsonb_typeof(s) is distinct from 'object' or not s ?& array['post_id','path'] or s-array['post_id','path','representation']<>'{}'::jsonb
  or jsonb_typeof(s->'post_id') is distinct from 'string' or jsonb_typeof(s->'path') is distinct from 'string'
  or (s->>'post_id')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or (s->>'path')!~('^'||(s->>'post_id')||'/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|gif)$') then raise exception 'BAD_REQUEST'; end if;
 view:=private.friend_read_authorize('photo.read',p_args);deadline:=(view->>'deadline')::timestamptz;
 -- Shared with existing media reserve/cleanup operations; post update locks win before metadata is returned.
 perform pg_advisory_xact_lock(240001,2);
 if deadline<=clock_timestamp() then raise exception 'READ_CONTEXT_EXPIRED'; end if;
 if not exists(select 1 from private.photo_media_state where singleton and mode='protected' and ready) then raise exception 'NOT_CONFIGURED'; end if;
 select * into p from public.photo_posts where id=(s->>'post_id')::uuid for share;
 if not found or not private.friend_content_visible(p.visibility::text,'member','visible',(view->>'includes_friends')::boolean) then raise exception 'NOT_FOUND'; end if;
 select * into a from private.photo_assets where path=s->>'path' for share;
 if not found or a.post_id<>p.id or not a.complete or a.state<>'attached'
  or not p.body @> jsonb_build_array(jsonb_build_object('type','image','path',a.path)) then raise exception 'NOT_FOUND'; end if;
 if deadline<=clock_timestamp() then raise exception 'READ_CONTEXT_EXPIRED'; end if;
 return private.photo_representation(s,jsonb_build_object('post_id',a.post_id,'path',a.path,'size',a.size,'mime',a.mime,'sha256',a.sha256));
exception
 when numeric_value_out_of_range or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('failure','BAD_REQUEST');
 when raise_exception then
  if sqlerrm=any(array['BAD_REQUEST','FORBIDDEN','NOT_CONFIGURED','TARGET_MISMATCH','SESSION_REVOKED','SESSION_EXPIRED','READ_CONTEXT_EXPIRED','NOT_FOUND']) then return jsonb_build_object('failure',sqlerrm); end if;
  raise;
end $$;
revoke all on function public.member_photo_read(text,jsonb) from public,anon,authenticated;
grant execute on function public.member_photo_read(text,jsonb) to service_role;

-- One fresh authorization binds the entire bounded ID/revision set. No post data escapes.
create or replace function public.member_photo_check(p_action text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='3s' set statement_timeout='3s' as $$
declare selectors jsonb:=p_args->'selectors'; item jsonb; view jsonb; result jsonb:='[]';
 v_post_id uuid; expected bigint; row_data public.photo_posts; valid boolean; deadline timestamptz; photos jsonb;
begin
 if p_action is distinct from 'photo-check' or jsonb_typeof(selectors) is distinct from 'object'
  or selectors-array['posts','variant']<>'{}'::jsonb or (selectors ? 'variant' and selectors->>'variant' is distinct from 'display-v1') or jsonb_typeof(selectors->'posts') is distinct from 'array' then raise exception 'BAD_REQUEST';end if;
 if jsonb_array_length(selectors->'posts') not between 1 and 2 then raise exception 'BAD_REQUEST';end if;
 for item in select value from jsonb_array_elements(selectors->'posts') loop
  if jsonb_typeof(item) is distinct from 'object' or item-array['id','revision']<>'{}'::jsonb
   or jsonb_typeof(item->'id') is distinct from 'string' or (item->>'id')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   or jsonb_typeof(item->'revision') is distinct from 'number' or (item->>'revision')!~'^[1-9][0-9]*$' then raise exception 'BAD_REQUEST';end if;
  if (item->>'revision')::numeric>9007199254740991 then raise exception 'BAD_REQUEST';end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(selectors->'posts'))<>jsonb_array_length(selectors->'posts') then raise exception 'BAD_REQUEST';end if;
 view:=private.friend_read_authorize('content.photo-check',p_args);deadline:=(view->>'deadline')::timestamptz;
 perform pg_advisory_xact_lock(240001,2);
 if selectors ? 'variant' then
  perform singleton from private.photo_media_state where singleton and mode='protected' and ready for share;
  if not found then raise exception 'NOT_CONFIGURED'; end if;
 end if;
 -- Lock parent rows in deterministic order, after the family/session authorization locks.
 perform p.id from public.photo_posts p where p.id in (select (value->>'id')::uuid from jsonb_array_elements(selectors->'posts')) order by p.id for share;
 for item in select value from jsonb_array_elements(selectors->'posts') loop
  v_post_id:=(item->>'id')::uuid;expected:=(item->>'revision')::bigint;
  select * into row_data from public.photo_posts where id=v_post_id;
  valid:=found and row_data.revision=expected and private.friend_content_visible(row_data.visibility,view->>'mode',view->>'scope',(view->>'includes_friends')::boolean);
  if valid then
   -- Revision covers body/link changes; also fail closed for incomplete or detached assets.
   valid:=not exists(select 1 from jsonb_array_elements(row_data.body) b where b->>'type'='image'
    and not exists(select 1 from private.photo_assets a where a.path=b->>'path' and a.post_id=v_post_id and a.complete and a.state='attached'));
  end if;
  photos:='[]'::jsonb;
  if valid and selectors ? 'variant' then
   select coalesce(jsonb_agg(jsonb_build_object('post_id',a.post_id,'revision',row_data.revision,'path',a.path,'source_sha256',a.sha256,
    'representation',case when v.id is null then null else jsonb_build_object('kind',v.recipe,'sha256',v.sha256,'width',v.width,'height',v.height,'size',v.size) end) order by a.path),'[]'::jsonb)
   into photos from private.photo_assets a left join private.photo_asset_variants v on v.source_path=a.path and v.post_id=a.post_id
    and v.source_sha256=a.sha256 and v.recipe='display-v1' and v.state='ready'
   where a.post_id=v_post_id and a.complete and a.state='attached' and row_data.body @> jsonb_build_array(jsonb_build_object('type','image','path',a.path));
  end if;
  result:=result||jsonb_build_array(jsonb_build_object('id',v_post_id,'valid',coalesce(valid,false))||case when selectors ? 'variant' then jsonb_build_object('photos',photos) else '{}'::jsonb end);
 end loop;
 if deadline is not null and deadline<=clock_timestamp() then raise exception 'READ_CONTEXT_EXPIRED';end if;
 return jsonb_build_object('protocol',1,'view',view-'deadline','data',jsonb_build_object('items',result));
exception
 when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('failure','BAD_REQUEST');
 when raise_exception then
  if sqlerrm=any(array['BAD_REQUEST','AUTH_REQUIRED','FORBIDDEN','NOT_CONFIGURED','TARGET_MISMATCH','SESSION_REVOKED','SESSION_EXPIRED','READ_CONTEXT_EXPIRED','IDENTITY_UNAVAILABLE']) then return jsonb_build_object('failure',sqlerrm);end if;
  raise;
end $$;

create or replace function public.photo_variant_status() returns jsonb
language sql security definer set search_path='' as $$
 select case when exists(select 1 from private.photo_media_state where singleton and mode='protected' and ready)
  and to_regclass('private.photo_asset_variants') is not null and to_regprocedure('public.photo_variant(text,jsonb)') is not null
  and to_regprocedure('public.photo_representation_read(text,jsonb)') is not null
  and to_regprocedure('private.photo_representation(jsonb,jsonb)') is not null
  and to_regprocedure('public.member_photo_read(text,jsonb)') is not null
  and to_regprocedure('public.member_photo_check(text,jsonb)') is not null
 then jsonb_build_object('photo_variant_protocol',1,'photo_variant_recipe','display-v1','photo_variant_read_protocol',1) else '{}'::jsonb end
$$;
create or replace function public.friend_visibility_status() returns jsonb
language sql security definer set search_path='' set lock_timeout='3s' set statement_timeout='3s' as $$
 select jsonb_build_object('friend_visibility_protocol',1,'friend_visibility_ready',ready,
  'friend_media_ready',media_ready,'friend_summary_ready',summary_ready,'friend_pages_ready',pages_ready,
  'owner_member_id',owner_member_id,'diary_latest_protocol',1,'photo_check_protocol',1)||public.photo_variant_status()
 from private.friend_visibility_state where singleton
$$;
revoke all on function public.friend_visibility_status(),public.member_photo_check(text,jsonb),public.photo_variant_status() from public,anon,authenticated;
grant execute on function public.friend_visibility_status(),public.member_photo_check(text,jsonb),public.photo_variant_status() to service_role;
commit;
