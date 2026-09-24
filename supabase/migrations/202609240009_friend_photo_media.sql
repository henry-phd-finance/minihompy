begin;
-- Member-only metadata authorization. File bytes remain in the private Storage bucket.
create function public.member_photo_read(p_action text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='3s' set statement_timeout='3s' as $$
declare view jsonb; s jsonb:=p_args->'selectors'; p public.photo_posts; a private.photo_assets; deadline timestamptz;
begin
 if p_action is distinct from 'read' or p_args->>'mode' is distinct from 'member' or p_args->>'scope' is distinct from 'visible'
  or jsonb_typeof(s) is distinct from 'object' or not s ?& array['post_id','path'] or (select count(*) from jsonb_object_keys(s))<>2
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
 return jsonb_build_object('post_id',a.post_id,'path',a.path,'size',a.size,'mime',a.mime,'sha256',a.sha256);
exception
 when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('failure','BAD_REQUEST');
 when raise_exception then
  if sqlerrm=any(array['BAD_REQUEST','FORBIDDEN','NOT_CONFIGURED','TARGET_MISMATCH','SESSION_REVOKED','SESSION_EXPIRED','READ_CONTEXT_EXPIRED','NOT_FOUND']) then return jsonb_build_object('failure',sqlerrm); end if;
  raise;
end $$;
revoke all on function public.member_photo_read(text,jsonb) from public,anon,authenticated;
grant execute on function public.member_photo_read(text,jsonb) to service_role;
commit;
