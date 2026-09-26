begin;
-- One fresh authorization binds the entire bounded ID/revision set. No post data escapes.
create or replace function public.member_photo_check(p_action text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='3s' set statement_timeout='3s' as $$
declare selectors jsonb:=p_args->'selectors'; item jsonb; view jsonb; result jsonb:='[]';
 v_post_id uuid; expected bigint; row_data public.photo_posts; valid boolean; deadline timestamptz;
begin
 if p_action is distinct from 'photo-check' or jsonb_typeof(selectors) is distinct from 'object'
  or selectors-'posts'<>'{}'::jsonb or jsonb_typeof(selectors->'posts') is distinct from 'array' then raise exception 'BAD_REQUEST';end if;
 if jsonb_array_length(selectors->'posts') not between 1 and 2 then raise exception 'BAD_REQUEST';end if;
 for item in select value from jsonb_array_elements(selectors->'posts') loop
  if jsonb_typeof(item) is distinct from 'object' or item-array['id','revision']<>'{}'::jsonb
   or jsonb_typeof(item->'id') is distinct from 'string' or (item->>'id')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   or jsonb_typeof(item->'revision') is distinct from 'number' or (item->>'revision')!~'^[1-9][0-9]*$' then raise exception 'BAD_REQUEST';end if;
  if (item->>'revision')::numeric>9007199254740991 then raise exception 'BAD_REQUEST';end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(selectors->'posts'))<>jsonb_array_length(selectors->'posts') then raise exception 'BAD_REQUEST';end if;
 view:=private.friend_read_authorize('content.photo-check',p_args);deadline:=(view->>'deadline')::timestamptz;
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
  result:=result||jsonb_build_array(jsonb_build_object('id',v_post_id,'valid',coalesce(valid,false)));
 end loop;
 if deadline is not null and deadline<=clock_timestamp() then raise exception 'READ_CONTEXT_EXPIRED';end if;
 return jsonb_build_object('protocol',1,'view',view-'deadline','data',jsonb_build_object('items',result));
exception
 when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('failure','BAD_REQUEST');
 when raise_exception then
  if sqlerrm=any(array['BAD_REQUEST','AUTH_REQUIRED','FORBIDDEN','NOT_CONFIGURED','TARGET_MISMATCH','SESSION_REVOKED','SESSION_EXPIRED','READ_CONTEXT_EXPIRED','IDENTITY_UNAVAILABLE']) then return jsonb_build_object('failure',sqlerrm);end if;
  raise;
end $$;
create or replace function public.friend_visibility_status() returns jsonb
language sql security definer set search_path='' set lock_timeout='3s' set statement_timeout='3s' as $$
 select jsonb_build_object('friend_visibility_protocol',1,'friend_visibility_ready',ready,
  'friend_media_ready',media_ready,'friend_summary_ready',summary_ready,'friend_pages_ready',pages_ready,
  'owner_member_id',owner_member_id,'diary_latest_protocol',1,'photo_check_protocol',1) from private.friend_visibility_state where singleton
$$;
revoke all on function public.friend_visibility_status(),public.member_photo_check(text,jsonb) from public,anon,authenticated;
grant execute on function public.friend_visibility_status(),public.member_photo_check(text,jsonb) to service_role;
commit;
