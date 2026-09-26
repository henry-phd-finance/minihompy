begin;
create or replace function public.member_content_read(p_action text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='3s' set statement_timeout='3s' as $$
declare selectors jsonb:=p_args->'selectors'; k text; kind text:=selectors->>'kind'; t text; columns text; ordering text;
 view jsonb; result jsonb; post_id uuid; folder uuid; month_date date; day_date date; page integer:=1; size integer:=20;
 allowed text[]; deadline timestamptz; latest boolean:=false;
begin
 if p_action is null or p_action not in ('list','detail') or kind is null or kind not in ('board','photos','diary')
  or jsonb_typeof(selectors) is distinct from 'object' then raise exception 'BAD_REQUEST'; end if;
 allowed:=case p_action when 'detail' then array['kind','id'] else array['kind','folder_id','page','size']||case kind when 'diary' then array['month','date','latest'] else array[]::text[] end end;
 for k in select jsonb_object_keys(selectors) loop
  if not k=any(allowed) or jsonb_typeof(selectors->k)='null' then raise exception 'BAD_REQUEST'; end if;
  if k in ('folder_id','id') and (jsonb_typeof(selectors->k)<>'string' or (selectors->>k)!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then raise exception 'BAD_REQUEST'; end if;
 end loop;
 if p_action='detail' then post_id:=(selectors->>'id')::uuid;if post_id is null then raise exception 'BAD_REQUEST'; end if;
 else
  if not(selectors ?& array['page','size']) or jsonb_typeof(selectors->'page')<>'number' or jsonb_typeof(selectors->'size')<>'number'
   or (selectors->>'page')!~'^[0-9]+$' or (selectors->>'size')!~'^[0-9]+$' then raise exception 'BAD_REQUEST'; end if;
  page:=(selectors->>'page')::integer;size:=(selectors->>'size')::integer;
  if page not between 1 and 100000 or size not between 1 and 20 then raise exception 'BAD_REQUEST'; end if;
  folder:=(selectors->>'folder_id')::uuid;
  if selectors?'latest' then
   if kind<>'diary' or selectors->'latest'<>'true'::jsonb or selectors ?| array['month','date'] or page<>1 then raise exception 'BAD_REQUEST';end if;
   latest:=true;
  end if;
  if selectors?'month' then
   if jsonb_typeof(selectors->'month')<>'string' or (selectors->>'month')!~'^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'BAD_REQUEST'; end if;
   month_date:=((selectors->>'month')||'-01')::date;
   if month_date<date '1900-01-01' or month_date>date '9999-12-01' then raise exception 'BAD_REQUEST'; end if;
  end if;
  if selectors?'date' then
   if kind<>'diary' or jsonb_typeof(selectors->'date')<>'string' or (selectors->>'date')!~'^(19[0-9]{2}|[2-9][0-9]{3})-(0[1-9]|1[0-2])-[0-9]{2}$' then raise exception 'BAD_REQUEST'; end if;
   day_date:=(selectors->>'date')::date;
  end if;
 end if;
 view:=private.friend_read_authorize('content.'||p_action,p_args);deadline:=(view->>'deadline')::timestamptz;
 t:=case kind when 'board' then 'board_posts' when 'photos' then 'photo_posts' else 'diary_entries' end;
 columns:='id,folder_id,author_id,author_name,created_at,updated_at,visibility'||case kind when 'board' then ',title'||case p_action when 'detail' then ',body' else '' end when 'photos' then ',title,body,revision' else ',entry_date,entry_time,weather,body,revision' end;
 ordering:=case kind when 'diary' then 'entry_date,entry_time,id' else 'created_at desc,id desc' end;
 if p_action='detail' then
  -- Parent shares lock after session/family; mutations cannot interleave a stale detail.
  execute format('select jsonb_build_object(''item'',to_jsonb(p)) from (select %s from public.%I where id=$1 and private.friend_content_visible(visibility,$2,$3,$4) for share) p',columns,t)
   into result using post_id,view->>'mode',view->>'scope',(view->>'includes_friends')::boolean;
  if result is null then raise exception 'NOT_FOUND'; end if;
 elsif latest then
  -- Latest date, count, target and page use the same permission-filtered snapshot.
  with eligible as materialized (
   select id,entry_date from public.diary_entries
   where (folder is null or folder_id=folder) and private.friend_content_visible(visibility,view->>'mode',view->>'scope',(view->>'includes_friends')::boolean)
  ), chosen as (select max(entry_date) d from eligible), day_rows as materialized (
   select p.* from public.diary_entries p join eligible e on e.id=p.id where p.entry_date=(select d from chosen)
  ), totals as (select count(*) n,greatest(1,ceil(count(*)::numeric/size))::integer last_page from day_rows), paged as (
   select * from day_rows order by entry_time,id offset (select (last_page-1)*size from totals) limit size
  ) select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by entry_time,id) from paged p),'[]'::jsonb),
   'count',n,'page',last_page,'size',size,'selected_date',(select d from chosen),
   'target_id',(select id from day_rows order by entry_time desc,id desc limit 1)) into result from totals;
 else
  -- One SQL statement, one snapshot for both filtered count and page items.
  execute format('with filtered as materialized (select %s from public.%I where private.friend_content_visible(visibility,$1,$2,$3) and ($4::uuid is null or folder_id=$4) %s), paged as (select * from filtered order by %s offset $6 limit $7) select jsonb_build_object(''items'',coalesce((select jsonb_agg(to_jsonb(p) order by %s) from paged p),''[]''::jsonb),''count'',(select count(*) from filtered),''page'',$8,''size'',$7)',columns,t,case kind when 'diary' then 'and ($5::date is null or (entry_date >= $5 and entry_date < $5 + interval ''1 month'')) and ($9::date is null or entry_date=$9)' else 'and ($5::date is null and $9::date is null)' end,ordering,ordering)
   into result using view->>'mode',view->>'scope',(view->>'includes_friends')::boolean,folder,month_date,(page-1)*size,size,page,day_date;
 end if;
 if deadline is not null and deadline<=clock_timestamp() then raise exception 'READ_CONTEXT_EXPIRED'; end if;
 if octet_length(result::text)>1048576 then raise exception 'IDENTITY_UNAVAILABLE'; end if;
 return jsonb_build_object('protocol',1,'view',view-'deadline','data',result);
exception
 when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return jsonb_build_object('failure','BAD_REQUEST');
 when raise_exception then
  if sqlerrm=any(array['BAD_REQUEST','AUTH_REQUIRED','FORBIDDEN','NOT_CONFIGURED','TARGET_MISMATCH','SESSION_REVOKED','SESSION_EXPIRED','READ_CONTEXT_EXPIRED','NOT_FOUND','IDENTITY_UNAVAILABLE']) then return jsonb_build_object('failure',sqlerrm); end if;
  raise;
end $$;
create or replace function public.friend_visibility_status() returns jsonb
language sql security definer set search_path='' set lock_timeout='3s' set statement_timeout='3s' as $$
 select jsonb_build_object('friend_visibility_protocol',1,'friend_visibility_ready',ready,
  'friend_media_ready',media_ready,'friend_summary_ready',summary_ready,'friend_pages_ready',pages_ready,
  'owner_member_id',owner_member_id,'diary_latest_protocol',1) from private.friend_visibility_state where singleton
$$;
revoke all on function public.friend_visibility_status(),public.member_content_read(text,jsonb) from public,anon,authenticated;
grant execute on function public.friend_visibility_status(),public.member_content_read(text,jsonb) to service_role;
commit;
