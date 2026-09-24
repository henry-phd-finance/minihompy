-- Supabase PostgREST enables safeupdate: target the singleton row explicitly.
begin;
create or replace function public.photo_media(p_action text,p_args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.photo_assets; post_record public.photo_posts; uid uuid; admin boolean; m text; linked boolean; result jsonb; rate_key text; rate_limit integer; rate_amount integer;
begin
 perform pg_advisory_xact_lock(240001,2);
 select mode into m from private.photo_media_state where singleton;
 uid:=(p_args->>'owner_id')::uuid;
 admin:=uid is not null and exists(select 1 from private.minihompy_admins where user_id=uid);
 if p_action='inventory' then
  return jsonb_build_object('mode',m,'ready',(select ready from private.photo_media_state where singleton),
   'posts',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.photo_posts t),'[]'::jsonb),
   'assets',coalesce((select jsonb_agg(to_jsonb(t) order by path) from private.photo_assets t),'[]'::jsonb));
 end if;
 if p_action='freeze' then
  update private.photo_media_state set mode='frozen',ready=false where singleton;
  return jsonb_build_object('mode','frozen');
 end if;
 if p_action='protect' then
  if m<>'frozen' or exists(select 1 from public.photo_posts p cross join lateral jsonb_array_elements(p.body) b
   where b->>'type'='image' and not exists(select 1 from private.photo_assets aa
    where aa.path=b->>'path' and aa.post_id=p.id and aa.complete and aa.state='attached')) then
   return jsonb_build_object('failure','NOT_READY');
  end if;
  update private.photo_media_state set mode='protected' where singleton; -- ready stays false until Step 10 external checks.
  return jsonb_build_object('mode','protected');
 end if;
 if p_action not in ('read','reserve','complete','cleanup_begin','cleanup_finish','import') then
  return jsonb_build_object('failure','BAD_REQUEST');
 end if;
 if p_action<>'import' and uid is not null and not admin then return jsonb_build_object('failure','FORBIDDEN'); end if;
 if p_action in ('read','reserve','cleanup_begin') then
  rate_key:=p_action||':'||coalesce(uid::text,'public');
  rate_limit:=case p_action when 'read' then 1200 else 120 end;
  insert into private.photo_media_limits(key,window_at,amount) values(rate_key,clock_timestamp(),1)
   on conflict(key) do update set
    window_at=case when private.photo_media_limits.window_at<clock_timestamp()-interval '1 minute' then clock_timestamp() else private.photo_media_limits.window_at end,
    amount=case when private.photo_media_limits.window_at<clock_timestamp()-interval '1 minute' then 1 else private.photo_media_limits.amount+1 end
   returning amount into rate_amount;
  if rate_amount>rate_limit then return jsonb_build_object('failure','RATE_LIMITED'); end if;
 end if;
 select * into a from private.photo_assets where path=p_args->>'path' for update;
 if p_action in ('reserve','import') then
  if (p_action='reserve' and (not admin or m<>'protected' or not (select ready from private.photo_media_state where singleton))) or (p_action='import' and m<>'frozen') then
   return jsonb_build_object('failure','FORBIDDEN');
  end if;
  if a.path is not null then
   if a.state='deleting' or a.post_id<>(p_args->>'post_id')::uuid
    or a.sha256<>p_args->>'sha256' or a.size<>(p_args->>'size')::integer or a.mime<>p_args->>'mime'
    or (p_action='reserve' and a.uploaded_by is distinct from uid) then
    return jsonb_build_object('failure','REQUEST_CONFLICT');
   end if;
  else
   if p_action='reserve' and (select count(*) from private.photo_assets where uploaded_by=uid and state='staged')>=100 then
    return jsonb_build_object('failure','RATE_LIMITED');
   end if;
   insert into private.photo_assets(path,post_id,uploaded_by,size,mime,sha256)
    values(p_args->>'path',(p_args->>'post_id')::uuid,uid,(p_args->>'size')::integer,p_args->>'mime',p_args->>'sha256') returning * into a;
  end if;
  if p_action='import' then
   update private.photo_assets set complete=true,state=case when exists(select 1 from public.photo_posts p
    where p.id=a.post_id and p.body @> jsonb_build_array(jsonb_build_object('type','image','path',a.path))) then 'attached' else 'staged' end
    where path=a.path returning * into a;
   if a.state='attached' then update private.photo_assets set ever_attached=true where path=a.path returning * into a; end if;
  end if;
  return to_jsonb(a);
 end if;
 if a.path is null then
  if p_action='cleanup_finish' and admin then return '{"ok":true}'::jsonb; end if;
  return jsonb_build_object('failure','NOT_FOUND');
 end if;
 select * into post_record from public.photo_posts where id=a.post_id;
 linked:=post_record.id is not null and post_record.body @> jsonb_build_array(jsonb_build_object('type','image','path',a.path));
 if p_action='read' then
  if a.post_id is distinct from (p_args->>'post_id')::uuid or not a.complete or a.state='deleting'
   or not ((a.state='attached' and linked and (post_record.visibility='public' or admin))
     or (a.state='staged' and not a.ever_attached and not linked and admin and a.uploaded_by=uid)) then
   return jsonb_build_object('failure','NOT_FOUND');
  end if;
  return to_jsonb(a);
 end if;
 if not admin or m<>'protected' or not (select ready from private.photo_media_state where singleton) then return jsonb_build_object('failure','FORBIDDEN'); end if;
 if p_action='complete' then
  if a.state='deleting' or a.uploaded_by is distinct from uid or a.sha256<>p_args->>'sha256' then
   return jsonb_build_object('failure','REQUEST_CONFLICT');
  end if;
  update private.photo_assets set complete=true where path=a.path returning * into a;
  return to_jsonb(a);
 end if;
 if linked then return jsonb_build_object('failure','IN_USE'); end if;
 if not a.complete then return jsonb_build_object('failure','UPLOAD_PENDING'); end if;
 if p_action='cleanup_begin' then
  update private.photo_assets set state='deleting' where path=a.path returning * into a;
  return to_jsonb(a);
 end if;
 if a.state<>'deleting' then return jsonb_build_object('failure','REQUEST_CONFLICT'); end if;
 -- Retain tombstone: an immutable path can never be re-uploaded after cleanup.
 return '{"ok":true}'::jsonb;
exception when invalid_text_representation or check_violation or not_null_violation then
 return jsonb_build_object('failure','BAD_REQUEST');
end;
$$;
commit;
