-- Friends visibility is opt-in; no existing content is reclassified.
begin;
alter table public.board_posts drop constraint board_posts_visibility_check, add constraint board_posts_visibility_check check(visibility in ('public','friends','private'));
alter table public.photo_posts drop constraint photo_posts_visibility_check, add constraint photo_posts_visibility_check check(visibility in ('public','friends','private'));
alter table public.diary_entries drop constraint diary_entries_visibility_check, add constraint diary_entries_visibility_check check(visibility in ('public','friends','private'));
create table private.friend_visibility_state (
 singleton boolean primary key default true check(singleton),
 owner_member_id uuid,
 ready boolean not null default false,
 media_ready boolean not null default false,
 summary_ready boolean not null default false,
 pages_ready boolean not null default false,
 check(not ready or (owner_member_id is not null and media_ready and summary_ready and pages_ready))
);
insert into private.friend_visibility_state default values;
alter table private.friend_visibility_state enable row level security;
revoke all on private.friend_visibility_state from public,anon,authenticated,service_role;

create or replace function private.guard_content_visibility() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (tg_op='INSERT' or new.visibility is distinct from old.visibility) and not public.is_minihompy_admin()
   and current_setting('role') not in ('none','service_role') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if new.visibility='friends' and not coalesce((select ready from private.friend_visibility_state where singleton for share),false) then
  raise exception 'NOT_CONFIGURED' using errcode='23514';
 end if;
 if tg_table_name='photo_posts' and new.visibility<>'public'
   and not coalesce((select ready from private.photo_media_state where singleton for share),false) then
  raise exception 'MEDIA_NOT_READY' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function private.guard_content_visibility() from public,anon,authenticated,service_role;

-- Preserve ordinary RLS, local comment parent locks and public-only summary/media.
-- Old member comments must fail closed until Step 5 adds fresh parent authorization.
create or replace function public.set_content_visibility(p_kind text,p_id uuid,p_visibility text,p_expected_version text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); t text; row_data jsonb; previous private.content_visibility_requests;
 payload jsonb; result jsonb; matches boolean;
begin
 if v_actor is null then return jsonb_build_object('failure','AUTH_REQUIRED'); end if;
 if not public.is_minihompy_admin() then return jsonb_build_object('failure','FORBIDDEN'); end if;
 begin
  if p_kind is null or p_kind not in ('board','photos','diary') or p_visibility is null or p_visibility not in ('public','friends','private')
    or p_id is null or p_request_id is null or p_expected_version is null then raise exception 'BAD_REQUEST'; end if;
  t:=case p_kind when 'board' then 'board_posts' when 'photos' then 'photo_posts' else 'diary_entries' end;
  perform pg_advisory_xact_lock(240001,case p_kind when 'board' then 1 when 'photos' then 2 else 3 end);
  if not public.is_minihompy_admin() then raise exception 'FORBIDDEN'; end if;
  execute format('select to_jsonb(p) from public.%I p where id=$1 for update',t) into row_data using p_id;
  if row_data is null then raise exception 'NOT_FOUND'; end if;
  if p_visibility='friends' and not coalesce((select ready from private.friend_visibility_state where singleton for share),false) then
   raise exception 'NOT_CONFIGURED' using errcode='23514';
  end if;
  if p_kind='photos' and p_visibility<>'public' and not coalesce((select ready from private.photo_media_state where singleton for share),false) then
   raise exception 'MEDIA_NOT_READY' using errcode='23514';
  end if;
  payload:=jsonb_build_object('id',p_id,'visibility',p_visibility,'expected_version',p_expected_version);
  delete from private.content_visibility_requests r where r.actor=v_actor and r.kind=p_kind and r.created_at<clock_timestamp()-interval '24 hours';
  select * into previous from private.content_visibility_requests r where r.actor=v_actor and r.kind=p_kind and r.request_id=p_request_id;
  if found then
   if previous.payload<>payload then raise exception 'REQUEST_CONFLICT'; end if;
   return previous.result||jsonb_build_object('replayed',true);
  end if;
  if p_kind='board' then matches:=(row_data->>'updated_at')::timestamptz=p_expected_version::timestamptz;
  else matches:=(row_data->>'revision')::integer=p_expected_version::integer; end if;
  if not matches then raise exception 'REVISION_CONFLICT'; end if;
  if p_visibility is distinct from row_data->>'visibility' then
   execute format('update public.%I set visibility=$2 where id=$1 returning to_jsonb(%I)',t,t) into row_data using p_id,p_visibility;
  end if;
  result:=jsonb_build_object('id',p_id,'visibility',row_data->>'visibility','updated_at',row_data->'updated_at','revision',row_data->'revision','replayed',false);
  insert into private.content_visibility_requests(actor,kind,request_id,payload,result) values(v_actor,p_kind,p_request_id,payload,result);
  return result;
 exception
  when raise_exception then
   if sqlerrm=any(array['BAD_REQUEST','FORBIDDEN','NOT_FOUND','REQUEST_CONFLICT','REVISION_CONFLICT']) then return jsonb_build_object('failure',sqlerrm); end if;
   raise;
  when check_violation then
   if sqlerrm in ('MEDIA_NOT_READY','NOT_CONFIGURED') then return jsonb_build_object('failure',sqlerrm); end if;
   raise;
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
   return jsonb_build_object('failure','BAD_REQUEST');
 end;
end;
$$;
revoke all on function public.set_content_visibility(text,uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.set_content_visibility(text,uuid,text,text,uuid) to authenticated;

create or replace function public.member_comments(p_action text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cfg private.member_writing_site; s private.member_writing_sessions;
  actor uuid; mode text:=p_args->>'mode'; item public.post_comments;
  prior private.member_writing_requests; limits private.member_writing_limits;
  v_request_id uuid; resource uuid; expected integer; hash text;
  v_kind text:=p_args->>'kind'; parent_id uuid:=(p_args->>'parent_id')::uuid; parent_table text; parent_column text; parent_row jsonb;
  page integer; size integer; total bigint; items jsonb; write_now timestamptz:=clock_timestamp();
begin
  select * into cfg from private.member_writing_site where singleton;
  if cfg.site_id is null or cfg.site_id is distinct from (p_args->>'site_id')::uuid then return jsonb_build_object('failure','TARGET_MISMATCH'); end if;
  if mode='member' then
    select * into s from private.member_writing_sessions where site_id=cfg.site_id and token_hash=p_args->>'token_hash' for update;
    if not found or s.revoked_at is not null then return jsonb_build_object('failure','SESSION_REVOKED'); end if;
    if s.expires_at<=clock_timestamp() then return jsonb_build_object('failure','SESSION_EXPIRED'); end if;
    actor:=s.member_id;
  elsif mode='owner' then
    actor:=(p_args->>'owner_id')::uuid;
    if not exists(select 1 from private.minihompy_admins where user_id=actor) then return jsonb_build_object('failure','FORBIDDEN'); end if;
  elsif mode<>'public' or mode is null then return jsonb_build_object('failure','BAD_REQUEST'); end if;

  if mode<>'public' then
  perform pg_advisory_xact_lock(hashtextextended(cfg.site_id::text||':'||mode||':'||actor::text,0));
  end if;
  -- Parent lock is held through mutation/replay: hide/delete cannot race this check.
  parent_table:=case v_kind when 'board' then 'board_posts' when 'photos' then 'photo_posts' when 'diary' then 'diary_entries' when 'guestbook' then 'guestbook_posts' end;
  parent_column:=case v_kind when 'board' then 'board_post_id' when 'photos' then 'photo_post_id' when 'diary' then 'diary_entry_id' when 'guestbook' then 'guestbook_post_id' end;
  if parent_table is null or parent_id is null then return jsonb_build_object('failure','BAD_REQUEST'); end if;
  execute format('select to_jsonb(p) from public.%I p where id=$1 for share',parent_table) into parent_row using parent_id;
  if mode='owner' and not exists(select 1 from private.minihompy_admins where user_id=actor) then return jsonb_build_object('failure','FORBIDDEN'); end if;
  if mode='member' and s.expires_at<=clock_timestamp() then return jsonb_build_object('failure','SESSION_EXPIRED'); end if;
  if parent_row is null or (v_kind<>'guestbook' and parent_row->>'visibility' is distinct from 'public' and mode<>'owner')
    or (v_kind='guestbook' and parent_row->>'visibility'='private' and mode<>'owner'
    and not coalesce(mode='member' and parent_row->>'author_kind'='member' and (parent_row->>'author_member_id')::uuid=actor,false)) then
    return jsonb_build_object('failure','NOT_FOUND');
  end if;
  if p_action='list' then
    page:=(p_args->>'page')::integer;size:=(p_args->>'size')::integer;
    if page is null or size is null or page<1 or page>100000 or size<1 or size>100 then return jsonb_build_object('failure','BAD_REQUEST'); end if;
    execute format('select count(*) from public.post_comments where %I=$1',parent_column) into total using parent_id;
    execute format('select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object(''can_edit'',coalesce((author_kind=''member'' and $4=''member'' and author_member_id=$5) or (author_kind=''local'' and $4=''owner'' and author_id=$5),false),''can_delete'',coalesce($4=''owner'' or (author_kind=''member'' and $4=''member'' and author_member_id=$5),false)) order by created_at,id),''[]''::jsonb) from (select * from public.post_comments where %I=$1 order by created_at,id offset $2 limit $3) c',parent_column)
      into items using parent_id,(page-1)*size,size,mode,actor;
    return jsonb_build_object('items',items,'count',total,'page',page,'size',size);
  end if;
  if mode='public' then return jsonb_build_object('failure','FORBIDDEN'); end if;
  if p_action not in ('create','update','delete') then return jsonb_build_object('failure','BAD_REQUEST'); end if;
  if mode='owner' and p_action<>'delete' then return jsonb_build_object('failure','FORBIDDEN'); end if;
  v_request_id:=(p_args->>'request_id')::uuid;resource:=(p_args->>'id')::uuid;expected:=(p_args->>'revision')::integer;
  if v_request_id is null or resource is null or (p_action<>'create' and (expected is null or expected<1)) then return jsonb_build_object('failure','BAD_REQUEST'); end if;
  if p_action in ('create','update') and (p_args->>'body' is null or char_length(p_args->>'body')>1000 or char_length(btrim(p_args->>'body',E' \n\r\t'))=0) then return jsonb_build_object('failure','BAD_REQUEST'); end if;
  -- Per-actor transaction lock serializes retries across distinct browser sessions.

  hash:=encode(sha256(convert_to(jsonb_build_object('operation',p_action,'id',resource,'revision',expected,'body',p_args->>'body','kind',v_kind,'parent_id',parent_id)::text,'UTF8')),'hex');
  select * into prior from private.member_writing_requests where site_id=cfg.site_id and actor_kind=mode and member_id=actor and member_writing_requests.request_id=v_request_id;
  if found then
    if prior.payload_hash<>hash or prior.operation<>'comment.'||p_action then return jsonb_build_object('failure','REQUEST_CONFLICT'); end if;
    return jsonb_build_object('id',prior.resource_id,'revision',prior.result_revision,'deleted',p_action='delete','replayed',true);
  end if;
  select * into item from public.post_comments where id=resource for update;
  if found and (to_jsonb(item)->>parent_column)::uuid is distinct from parent_id then return jsonb_build_object('failure','NOT_FOUND');end if;
  if p_action='create' then
    if found then
      if item.author_kind<>'member' or item.author_member_id<>actor then return jsonb_build_object('failure','NOT_FOUND'); end if;
      return jsonb_build_object('failure','REQUEST_CONFLICT');
    end if;
    insert into private.member_writing_limits values(cfg.site_id,actor,'comment','-infinity',write_now,0) on conflict do nothing;
    select * into limits from private.member_writing_limits where site_id=cfg.site_id and member_id=actor and kind='comment' for update;
    if limits.window_start<=write_now-interval '24 hours' then limits.window_start:=write_now;limits.writes:=0;end if;
    if limits.last_write>write_now-interval '10 seconds' or limits.writes>=100 then return jsonb_build_object('failure','RATE_LIMITED'); end if;
    execute format('insert into public.post_comments(id,%I,author_id,author_kind,author_member_id,author_homepage_url,author_name,body) values($1,$2,null,''member'',$3,$4,$5,$6) returning *',parent_column)
      into item using resource,parent_id,actor,s.homepage_url,s.display_name,p_args->>'body';
    update private.member_writing_limits set last_write=write_now,window_start=limits.window_start,writes=limits.writes+1 where site_id=cfg.site_id and member_id=actor and kind='comment';
  else
    if not found or not (mode='owner' or (item.author_kind='member' and item.author_member_id=actor)) then return jsonb_build_object('failure','NOT_FOUND'); end if;
    if item.revision<>expected then return jsonb_build_object('failure','REVISION_CONFLICT'); end if;
    if p_action='update' then update public.post_comments set body=p_args->>'body' where id=resource returning * into item;
    else delete from public.post_comments where id=resource; end if;
  end if;
  insert into private.member_writing_requests(site_id,actor_kind,member_id,request_id,operation,payload_hash,resource_id,result_revision)
    values(cfg.site_id,mode,actor,v_request_id,'comment.'||p_action,hash,resource,item.revision);
  return jsonb_build_object('id',resource,'revision',item.revision,'deleted',p_action='delete','replayed',false);
end;
$$;
revoke all on function public.member_comments(text,jsonb) from public,anon,authenticated;
grant execute on function public.member_comments(text,jsonb) to service_role;

-- Canonical request descriptor: recursively sorted object keys, compact JSON.
-- Protocol selectors allow only validated strings, integers and booleans.
create function private.friend_canonical_json(p_value jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare result text;
begin
 if jsonb_typeof(p_value)='object' then
  select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||private.friend_canonical_json(value),',' order by key collate "C"),'')||'}' into result from jsonb_each(p_value);
 elsif jsonb_typeof(p_value)='array' then
  select '['||coalesce(string_agg(private.friend_canonical_json(value),',' order by ord),'')||']' into result from jsonb_array_elements(p_value) with ordinality a(value,ord);
 else result:=p_value::text;
 end if;
 return result;
end $$;
create function private.friend_content_visible(p_visibility text,p_mode text,p_scope text,p_friend boolean) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(p_visibility='public' or (p_scope='visible' and
  ((p_mode='owner' and p_visibility in ('friends','private')) or (p_mode='member' and p_friend and p_visibility='friends'))),false)
$$;

-- This helper trusts ONLY the service caller to obtain the central HTTPS context.
-- It does not turn arbitrary user JSON into a cryptographic authorization token.
create function private.friend_read_authorize(p_action text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg private.member_writing_site; feature private.friend_visibility_state;
 mode text:=p_args->>'mode'; scope text:=p_args->>'scope'; ctx jsonb:=p_args->'context'; s jsonb;
 k text; allowed text[]; calculated_hash text; deadline timestamptz; started timestamptz; stamp timestamptz; expires timestamptz;
begin
 if jsonb_typeof(p_args) is distinct from 'object' or octet_length(p_args::text)>8192
  or mode is null or mode not in ('public','member','owner') or scope is null or scope not in ('public','visible')
  or (mode='public' and scope<>'public') then raise exception 'BAD_REQUEST'; end if;
 allowed:=array['site_id','mode','scope','selectors']||case mode when 'member' then array['token_hash','request_id','context','read_started_at','deadline'] when 'owner' then array['owner_id'] else array[]::text[] end;
 for k in select jsonb_object_keys(p_args) loop
  if not k=any(allowed) or jsonb_typeof(p_args->k)='null' then raise exception 'BAD_REQUEST'; end if;
 end loop;
 select * into cfg from private.member_writing_site where singleton for share;
 if cfg.site_id is null then raise exception 'NOT_CONFIGURED'; end if;
 if cfg.site_id is distinct from (p_args->>'site_id')::uuid then raise exception 'TARGET_MISMATCH'; end if;
 if mode='owner' then
  perform 1 from private.minihompy_admins where user_id=(p_args->>'owner_id')::uuid for share;
  if not found then raise exception 'FORBIDDEN'; end if;
 elsif mode='member' then
  if coalesce(p_args->>'token_hash','')!~'^[0-9a-f]{64}$' then raise exception 'AUTH_REQUIRED'; end if;
  -- Existing RPC locks family BEFORE session; preserve logout/renewal lock order.
  s:=public.member_writing_session('current',jsonb_build_object('site_id',cfg.site_id,'token_hash',p_args->>'token_hash'));
  if s?'failure' then raise exception '%',s->>'failure'; end if;
  select * into feature from private.friend_visibility_state where singleton for share;
  if not coalesce(feature.ready,false) then raise exception 'NOT_CONFIGURED'; end if;
  if jsonb_typeof(ctx) is distinct from 'object' or ctx->'protocol' is distinct from '1'::jsonb
   or (select count(*) from jsonb_object_keys(ctx))<>12 then raise exception 'TARGET_MISMATCH'; end if;
  for k in select jsonb_object_keys(ctx) loop
   if not k=any(array['protocol','request_id','request_hash','actor_member_id','site_id','owner_member_id','central_session_id','relationship','relationship_revision','can_read_friends','authorized_at','expires_at']) then raise exception 'TARGET_MISMATCH'; end if;
  end loop;
  if ctx->>'site_id' is distinct from cfg.site_id::text or ctx->>'actor_member_id' is distinct from s->>'member_id'
   or ctx->>'central_session_id' is distinct from s->>'central_session_id' or ctx->>'owner_member_id' is distinct from feature.owner_member_id::text
   or (ctx->>'request_id')::uuid is distinct from (p_args->>'request_id')::uuid or p_args->>'request_id' is null then raise exception 'TARGET_MISMATCH'; end if;
  calculated_hash:=encode(sha256(convert_to(private.friend_canonical_json(jsonb_build_object('protocol',1,'mode','member','scope',scope,'action',p_action,'selectors',p_args->'selectors')),'UTF8')),'hex');
  if ctx->>'request_hash' is distinct from calculated_hash then raise exception 'TARGET_MISMATCH'; end if;
  if coalesce(ctx->>'relationship','') not in ('none','pending','accepted','self')
   or jsonb_typeof(ctx->'can_read_friends') is distinct from 'boolean'
   or ctx->'can_read_friends' is distinct from to_jsonb(ctx->>'relationship'='accepted')
   or (ctx->>'relationship'='self') is distinct from (ctx->>'actor_member_id'=ctx->>'owner_member_id')
   or jsonb_typeof(ctx->'relationship_revision') is distinct from 'number' or (ctx->>'relationship_revision')!~'^[0-9]+$'
   or (ctx->>'relationship_revision')::numeric>9007199254740991 then raise exception 'TARGET_MISMATCH'; end if;
  started:=(p_args->>'read_started_at')::timestamptz;deadline:=(p_args->>'deadline')::timestamptz;
  stamp:=(ctx->>'authorized_at')::timestamptz;expires:=(ctx->>'expires_at')::timestamptz;
  if started is null or deadline is null or stamp is null or expires is null
   or stamp<started-interval '1 second' or stamp>clock_timestamp()+interval '1 second'
   or expires<=stamp or expires>stamp+interval '5 seconds'
   or deadline>expires-interval '1 second' or deadline>started+interval '4 seconds'
   or deadline>(s->>'expires_at')::timestamptz or deadline<=clock_timestamp() then raise exception 'READ_CONTEXT_EXPIRED'; end if;
 end if;
 return jsonb_build_object('mode',mode,'scope',scope,'includes_friends',scope='visible' and (mode='owner' or coalesce((ctx->>'can_read_friends')::boolean,false)), 'deadline',deadline);
end $$;

create function public.friend_visibility_status() returns jsonb
language sql security definer set search_path='' set lock_timeout='3s' set statement_timeout='3s' as $$
 select jsonb_build_object('friend_visibility_protocol',1,'friend_visibility_ready',ready,
  'friend_media_ready',media_ready,'friend_summary_ready',summary_ready,'friend_pages_ready',pages_ready,
  'owner_member_id',owner_member_id) from private.friend_visibility_state where singleton
$$;

create function public.member_content_read(p_action text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='3s' set statement_timeout='3s' as $$
declare selectors jsonb:=p_args->'selectors'; k text; kind text:=selectors->>'kind'; t text; columns text; ordering text;
 view jsonb; result jsonb; post_id uuid; folder uuid; month_date date; page integer:=1; size integer:=20;
 allowed text[]; deadline timestamptz;
begin
 if p_action is null or p_action not in ('list','detail') or kind is null or kind not in ('board','photos','diary')
  or jsonb_typeof(selectors) is distinct from 'object' then raise exception 'BAD_REQUEST'; end if;
 allowed:=case p_action when 'detail' then array['kind','id'] else array['kind','folder_id','page','size']||case kind when 'diary' then array['month'] else array[]::text[] end end;
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
  execute format('with filtered as materialized (select %s from public.%I where private.friend_content_visible(visibility,$1,$2,$3) and ($4::uuid is null or folder_id=$4) %s), paged as (select * from filtered order by %s offset $6 limit $7) select jsonb_build_object(''items'',coalesce((select jsonb_agg(to_jsonb(p) order by %s) from paged p),''[]''::jsonb),''count'',(select count(*) from filtered),''page'',$8,''size'',$7)',columns,t,case kind when 'diary' then 'and ($5::date is null or (entry_date >= $5 and entry_date < $5 + interval ''1 month''))' else 'and ($5::date is null)' end,ordering,ordering)
   into result using view->>'mode',view->>'scope',(view->>'includes_friends')::boolean,folder,month_date,(page-1)*size,size,page;
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
revoke all on function private.friend_canonical_json(jsonb),private.friend_content_visible(text,text,text,boolean),private.friend_read_authorize(text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.friend_visibility_status(),public.member_content_read(text,jsonb) from public,anon,authenticated;
grant execute on function public.friend_visibility_status(),public.member_content_read(text,jsonb) to service_role;
commit;
