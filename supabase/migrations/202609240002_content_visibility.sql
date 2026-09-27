begin;

alter table public.board_posts add column visibility text not null default 'public' check(visibility in ('public','private'));
alter table public.photo_posts add column visibility text not null default 'public' check(visibility in ('public','private'));
alter table public.diary_entries add column visibility text not null default 'public' check(visibility in ('public','private'));

create table private.photo_media_state (
 singleton boolean primary key default true check(singleton), ready boolean not null default false
);
insert into private.photo_media_state default values;
create table private.content_visibility_requests (
 actor uuid not null, kind text not null check(kind in ('board','photos','diary')), request_id uuid not null,
 payload jsonb not null, result jsonb not null, created_at timestamptz not null default clock_timestamp(),
 primary key(actor,kind,request_id)
);
alter table private.photo_media_state enable row level security;
alter table private.content_visibility_requests enable row level security;
revoke all on private.photo_media_state,private.content_visibility_requests from public,anon,authenticated,service_role;

create function private.guard_content_visibility() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (tg_op='INSERT' or new.visibility is distinct from old.visibility) and not public.is_minihompy_admin()
   and current_setting('role') not in ('none','service_role') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if tg_table_name='photo_posts' and new.visibility='private'
   and not coalesce((select ready from private.photo_media_state where singleton for share),false) then
   raise exception 'MEDIA_NOT_READY' using errcode='23514';
 end if;
 return new;
end;
$$;
revoke all on function private.guard_content_visibility() from public,anon,authenticated,service_role;

do $$
declare t text;
begin
 foreach t in array array['board_posts','photo_posts','diary_entries'] loop
  execute format('drop policy %I on public.%I',t||'_read',t);
  execute format('create policy %I on public.%I for select to anon,authenticated using(visibility=''public'' or public.is_minihompy_admin())',t||'_read',t);
  execute format('create policy content_visible_update on public.%I as restrictive for update to authenticated using(visibility=''public'' or public.is_minihompy_admin()) with check(visibility=''public'' or public.is_minihompy_admin())',t);
  execute format('create policy content_visible_delete on public.%I as restrictive for delete to authenticated using(visibility=''public'' or public.is_minihompy_admin())',t);
  execute format('grant insert(visibility),update(visibility) on public.%I to authenticated',t);
  execute format('create trigger content_visibility_guard before insert or update on public.%I for each row execute function private.guard_content_visibility()',t);
 end loop;
end;
$$;

-- Local comment DML checks and locks the parent BEFORE locking the comment row
-- (USING for UPDATE/DELETE), so hide/delete cannot race an old RLS snapshot.
-- SELECT keeps the original invoker helper and does not take write locks.
create function public.can_write_comment_parent(board_id uuid,photo_id uuid,diary_id uuid,guestbook_id uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare parent jsonb; table_name text; parent_id uuid;
begin
 if auth.uid() is null or num_nonnulls(board_id,photo_id,diary_id,guestbook_id)<>1 then return false; end if;
 table_name:=case when board_id is not null then 'board_posts' when photo_id is not null then 'photo_posts' when diary_id is not null then 'diary_entries' else 'guestbook_posts' end;
 parent_id:=coalesce(board_id,photo_id,diary_id,guestbook_id);
 execute format('select to_jsonb(p) from public.%I p where id=$1 for share',table_name) into parent using parent_id;
 if parent is null then return false; end if;
 return parent->>'visibility'='public' or public.is_minihompy_admin()
   or (table_name='guestbook_posts' and parent->>'author_kind'='local' and (parent->>'author_id')::uuid=auth.uid());
end;
$$;
revoke all on function public.can_write_comment_parent(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.can_write_comment_parent(uuid,uuid,uuid,uuid) to authenticated;

drop policy comments_insert on public.post_comments;
drop policy comments_update on public.post_comments;
drop policy comments_delete on public.post_comments;
create policy comments_insert on public.post_comments for insert to authenticated
 with check(author_id=auth.uid() and public.can_write_comment_parent(board_post_id,photo_post_id,diary_entry_id,guestbook_post_id));
create policy comments_update on public.post_comments for update to authenticated
 using(author_id=auth.uid() and public.can_write_comment_parent(board_post_id,photo_post_id,diary_entry_id,guestbook_post_id))
 with check(author_id=auth.uid() and public.can_write_comment_parent(board_post_id,photo_post_id,diary_entry_id,guestbook_post_id));
create policy comments_delete on public.post_comments for delete to authenticated
 using((author_id=auth.uid() or public.is_minihompy_admin()) and public.can_write_comment_parent(board_post_id,photo_post_id,diary_entry_id,guestbook_post_id));

-- INSERT's WITH CHECK happens after BEFORE triggers: lock/check before quota writes too.
create function private.guard_local_comment_parent() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role') not in ('none','service_role') and not public.can_write_comment_parent(new.board_post_id,new.photo_post_id,new.diary_entry_id,new.guestbook_post_id) then
  raise exception 'NOT_FOUND' using errcode='42501';
 end if;
 return new;
end;
$$;
revoke all on function private.guard_local_comment_parent() from public,anon,authenticated,service_role;
create trigger comment_parent_guard before insert or update on public.post_comments
 for each row execute function private.guard_local_comment_parent();

-- Administrator-only metadata change, including posts whose original author is gone.
-- Existing body/author RLS is unchanged. No caller-supplied owner identity is accepted.
create function public.set_content_visibility(p_kind text,p_id uuid,p_visibility text,p_expected_version text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); t text; row_data jsonb; previous private.content_visibility_requests;
 payload jsonb; result jsonb; matches boolean;
begin
 if v_actor is null then return jsonb_build_object('failure','AUTH_REQUIRED'); end if;
 if not public.is_minihompy_admin() then return jsonb_build_object('failure','FORBIDDEN'); end if;
 begin
  if p_kind is null or p_kind not in ('board','photos','diary') or p_visibility is null or p_visibility not in ('public','private')
    or p_id is null or p_request_id is null or p_expected_version is null then raise exception 'BAD_REQUEST'; end if;
  t:=case p_kind when 'board' then 'board_posts' when 'photos' then 'photo_posts' else 'diary_entries' end;
  perform pg_advisory_xact_lock(240001,case p_kind when 'board' then 1 when 'photos' then 2 else 3 end);
  if not public.is_minihompy_admin() then raise exception 'FORBIDDEN'; end if;
  execute format('select to_jsonb(p) from public.%I p where id=$1 for update',t) into row_data using p_id;
  if row_data is null then raise exception 'NOT_FOUND'; end if;
  if p_kind='photos' and p_visibility='private' and not coalesce((select ready from private.photo_media_state where singleton for share),false) then
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
   if sqlerrm='MEDIA_NOT_READY' then return jsonb_build_object('failure','MEDIA_NOT_READY'); end if;
   raise;
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
   return jsonb_build_object('failure','BAD_REQUEST');
 end;
end;
$$;
revoke all on function public.set_content_visibility(text,uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.set_content_visibility(text,uuid,text,text,uuid) to authenticated;

-- Preserve quotas, actor ownership and tombstones; check ordinary parent privacy before all actions/replays.
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
  if parent_row is null or (v_kind<>'guestbook' and parent_row->>'visibility'='private' and mode<>'owner')
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
commit;
