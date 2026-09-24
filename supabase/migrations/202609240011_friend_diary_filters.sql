begin;
create or replace function public.member_content_read(p_action text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='3s' set statement_timeout='3s' as $$
declare selectors jsonb:=p_args->'selectors'; k text; kind text:=selectors->>'kind'; t text; columns text; ordering text;
 view jsonb; result jsonb; post_id uuid; folder uuid; month_date date; day_date date; page integer:=1; size integer:=20;
 allowed text[]; deadline timestamptz;
begin
 if p_action is null or p_action not in ('list','detail') or kind is null or kind not in ('board','photos','diary')
  or jsonb_typeof(selectors) is distinct from 'object' then raise exception 'BAD_REQUEST'; end if;
 allowed:=case p_action when 'detail' then array['kind','id'] else array['kind','folder_id','page','size']||case kind when 'diary' then array['month','date'] else array[]::text[] end end;
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
create or replace function public.member_content_aggregate(p_action text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='3s' set statement_timeout='3s' as $$
declare s jsonb:=p_args->'selectors'; allowed text[]; k text; menus text[]; month_date date; kind text; tab text;
 view jsonb; result jsonb; deadline timestamptz; size integer; target uuid; folder uuid;
begin
 if p_action is null or p_action not in ('summary','calendar','location') or jsonb_typeof(s) is distinct from 'object' then raise exception 'BAD_REQUEST'; end if;
 allowed:=case p_action when 'summary' then array['menus'] when 'calendar' then array['month'] else array['kind','id','size'] end;
 if not s ?& allowed then raise exception 'BAD_REQUEST'; end if;
 if p_action='calendar' then allowed:=allowed||array['folder_id'];end if;
 for k in select jsonb_object_keys(s) loop if not k=any(allowed) or jsonb_typeof(s->k)='null' then raise exception 'BAD_REQUEST'; end if;end loop;
 if p_action='summary' then
  if jsonb_typeof(s->'menus')<>'array' or jsonb_array_length(s->'menus')>4 then raise exception 'BAD_REQUEST'; end if;
  if exists(select 1 from jsonb_array_elements(s->'menus') e where jsonb_typeof(e)<>'string' or e#>>'{}' not in ('board','photos','diary','guestbook')) then raise exception 'BAD_REQUEST'; end if;
  select coalesce(array_agg(m order by m collate "C"),'{}'::text[]) into menus from jsonb_array_elements_text(s->'menus') m;
  if cardinality(menus)<>(select count(distinct m) from unnest(menus) m) or to_jsonb(menus)<>s->'menus' then raise exception 'BAD_REQUEST'; end if;
 elsif p_action='calendar' then
  if jsonb_typeof(s->'month')<>'string' or (s->>'month')!~'^(19[0-9]{2}|[2-9][0-9]{3})-(0[1-9]|1[0-2])$' then raise exception 'BAD_REQUEST'; end if;
  month_date:=((s->>'month')||'-01')::date;
  if s?'folder_id' then
   if jsonb_typeof(s->'folder_id')<>'string' or (s->>'folder_id')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'BAD_REQUEST';end if;folder:=(s->>'folder_id')::uuid;
  end if;
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
   (select distinct entry_date d from public.diary_entries where (folder is null or folder_id=folder) and entry_date>=month_date and entry_date<month_date+interval '1 month'
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
commit;
