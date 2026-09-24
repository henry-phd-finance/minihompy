begin;

-- New authorized summary; original public-only home_summary stays unchanged.
create function private.friend_home_summary_at(p_menus text[], p_as_of timestamptz, p_mode text, p_scope text, p_friend boolean)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
 menus text[]; settings jsonb; start_at timestamptz; result jsonb;
begin
 if p_menus is null or cardinality(p_menus)>4 or coalesce(array_ndims(p_menus),1)<>1
   or exists(select 1 from unnest(p_menus) m where m is null or m not in ('board','photos','diary','guestbook'))
   or cardinality(p_menus)<>(select count(distinct m) from unnest(p_menus) m) then
   raise exception 'Invalid home menus' using errcode='22023';
 end if;
 select payload into settings from public.minihompy_settings where id=1;
 if settings is null or jsonb_typeof(settings->'menus') is distinct from 'array' then
   raise exception 'Home settings unavailable' using errcode='55000';
 end if;
 select coalesce(array_agg(m order by m collate "C"),'{}'::text[]) into menus
 from unnest(p_menus) m where exists(
   select 1 from jsonb_array_elements(settings->'menus') e
   where e->>'id'=m and e->'visible'='true'::jsonb);
 start_at:=date_trunc('day',p_as_of at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
 with posts as materialized (
   -- This service wrapper runs as definer: apply verified view before aggregation.
   -- Filter parents before recent items, totals and comment aggregation.
   select 'board'::text kind,id,created_at from public.board_posts where 'board'=any(menus) and private.friend_content_visible(visibility,p_mode,p_scope,p_friend) and created_at<=p_as_of
   union all select 'photos',id,created_at from public.photo_posts where 'photos'=any(menus) and private.friend_content_visible(visibility,p_mode,p_scope,p_friend) and created_at<=p_as_of
   union all select 'diary',id,created_at from public.diary_entries where 'diary'=any(menus) and private.friend_content_visible(visibility,p_mode,p_scope,p_friend) and created_at<=p_as_of
   union all select 'guestbook',id,created_at from public.guestbook_posts where 'guestbook'=any(menus) and visibility='public' and created_at<=p_as_of
 ), comments_today as materialized (
   select p.kind,p.id,count(*) amount from public.post_comments c join posts p
   on p.id=coalesce(c.board_post_id,c.photo_post_id,c.diary_entry_id,c.guestbook_post_id)
     and p.kind=case when c.board_post_id is not null then 'board' when c.photo_post_id is not null then 'photos' when c.diary_entry_id is not null then 'diary' else 'guestbook' end
   where c.created_at>=start_at and c.created_at<=p_as_of group by p.kind,p.id
 ), recent as (
   select * from posts order by created_at desc,kind collate "C",id desc limit 5
 ), items as (
   select r.kind,r.id,r.created_at,
   private.home_summary_text(case r.kind
    when 'board' then (select title from public.board_posts where id=r.id)
    when 'photos' then (select title from public.photo_posts where id=r.id)
    when 'diary' then (select body from public.diary_entries where id=r.id)
    else (select body from public.guestbook_posts where id=r.id) end) as label,
   coalesce(c.amount,0) as today_comments
   from recent r left join comments_today c on c.kind=r.kind and c.id=r.id
 )
 select jsonb_build_object('version',1,'as_of',p_as_of,'date',(p_as_of at time zone 'Asia/Seoul')::date,'timezone','Asia/Seoul',
  'menus',to_jsonb(menus),
  'recent',coalesce((select jsonb_agg(to_jsonb(i) order by created_at desc,kind collate "C",id desc) from items i),'[]'::jsonb),
  'counts',coalesce((select jsonb_object_agg(m,jsonb_build_object('today',(select count(*) from posts where kind=m and created_at>=start_at),'total',(select count(*) from posts where kind=m))) from unnest(menus) m),'{}'::jsonb),
  'today_comments',coalesce((select sum(amount) from comments_today),0)) into result;
 return result;
end;
$$;
revoke all on function private.friend_home_summary_at(text[],timestamptz,text,text,boolean) from public,anon,authenticated,service_role;


create function public.member_content_aggregate(p_action text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='3s' set statement_timeout='3s' as $$
declare s jsonb:=p_args->'selectors'; allowed text[]; k text; menus text[]; month_date date; kind text; tab text;
 view jsonb; result jsonb; deadline timestamptz; size integer; target uuid;
begin
 if p_action is null or p_action not in ('summary','calendar','location') or jsonb_typeof(s) is distinct from 'object' then raise exception 'BAD_REQUEST'; end if;
 allowed:=case p_action when 'summary' then array['menus'] when 'calendar' then array['month'] else array['kind','id','size'] end;
 if not s ?& allowed then raise exception 'BAD_REQUEST'; end if;
 for k in select jsonb_object_keys(s) loop if not k=any(allowed) or jsonb_typeof(s->k)='null' then raise exception 'BAD_REQUEST'; end if;end loop;
 if p_action='summary' then
  if jsonb_typeof(s->'menus')<>'array' or jsonb_array_length(s->'menus')>4 then raise exception 'BAD_REQUEST'; end if;
  if exists(select 1 from jsonb_array_elements(s->'menus') e where jsonb_typeof(e)<>'string' or e#>>'{}' not in ('board','photos','diary','guestbook')) then raise exception 'BAD_REQUEST'; end if;
  select coalesce(array_agg(m order by m collate "C"),'{}'::text[]) into menus from jsonb_array_elements_text(s->'menus') m;
  if cardinality(menus)<>(select count(distinct m) from unnest(menus) m) or to_jsonb(menus)<>s->'menus' then raise exception 'BAD_REQUEST'; end if;
 elsif p_action='calendar' then
  if jsonb_typeof(s->'month')<>'string' or (s->>'month')!~'^(19[0-9]{2}|[2-9][0-9]{3})-(0[1-9]|1[0-2])$' then raise exception 'BAD_REQUEST'; end if;
  month_date:=((s->>'month')||'-01')::date;
 else
  kind:=s->>'kind';if kind not in ('board','photos','diary') or jsonb_typeof(s->'id')<>'string' or (s->>'id')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   or jsonb_typeof(s->'size')<>'number' or (s->>'size')!~'^[0-9]+$' then raise exception 'BAD_REQUEST'; end if;
  size:=(s->>'size')::integer;target:=(s->>'id')::uuid;if size not between 1 and 20 then raise exception 'BAD_REQUEST'; end if;
 end if;
 view:=private.friend_read_authorize('content.'||p_action,p_args);deadline:=(view->>'deadline')::timestamptz;
 if p_action='summary' then
  result:=private.friend_home_summary_at(menus,clock_timestamp(),view->>'mode',view->>'scope',(view->>'includes_friends')::boolean);
 elsif p_action='calendar' then
  select jsonb_build_object('dates',coalesce(jsonb_agg(d order by d),'[]'::jsonb)) into result from
   (select distinct entry_date d from public.diary_entries where entry_date>=month_date and entry_date<month_date+interval '1 month'
    and private.friend_content_visible(visibility,view->>'mode',view->>'scope',(view->>'includes_friends')::boolean)) dates;
 else
  tab:=case kind when 'board' then 'board_posts' when 'photos' then 'photo_posts' else 'diary_entries' end;
  -- Filter, target lookup and rank share a single snapshot. No unfiltered existence lookup.
  execute format('with visible as materialized (select * from public.%I where private.friend_content_visible(visibility,$1,$2,$3)), ranked as (select id,folder_id,%s,row_number() over(partition by folder_id%s order by %s) n from visible) select jsonb_build_object(''id'',id,''folder_id'',folder_id,''entry_date'',entry_date,''page'',(n-1)/$5+1) from ranked where id=$4',tab,
   case kind when 'diary' then 'entry_date' else 'null::date entry_date' end,
   case kind when 'diary' then ',entry_date' else '' end,
   case kind when 'diary' then 'entry_time,id' else 'created_at desc,id desc' end)
   into result using view->>'mode',view->>'scope',(view->>'includes_friends')::boolean,target,size;
  if result is null then raise exception 'NOT_FOUND'; end if;
 end if;
 if deadline is not null and deadline<=clock_timestamp() then raise exception 'READ_CONTEXT_EXPIRED'; end if;
 if octet_length(result::text)>1048576 then raise exception 'IDENTITY_UNAVAILABLE'; end if;
 return jsonb_build_object('protocol',1,'view',view-'deadline','data',result);
exception
 when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return jsonb_build_object('failure','BAD_REQUEST');
 when raise_exception then
  if sqlerrm=any(array['BAD_REQUEST','FORBIDDEN','NOT_CONFIGURED','TARGET_MISMATCH','SESSION_REVOKED','SESSION_EXPIRED','READ_CONTEXT_EXPIRED','NOT_FOUND','IDENTITY_UNAVAILABLE']) then return jsonb_build_object('failure',sqlerrm); end if;raise;
end $$;
revoke all on function public.member_content_aggregate(text,jsonb) from public,anon,authenticated;
grant execute on function public.member_content_aggregate(text,jsonb) to service_role;
commit;
