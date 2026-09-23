begin;
create or replace function private.guard_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare limits private.comment_write_limits; write_now timestamptz := clock_timestamp();
begin
  if new.author_kind='member' then
    if current_setting('role') not in ('service_role','none') then raise exception 'Member writes require the server'; end if;
    if tg_op='UPDATE' then new.revision:=old.revision+1;new.updated_at:=write_now;end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    new.revision := old.revision + 1;
    new.updated_at := write_now;
  elsif not public.is_minihompy_admin() then
    insert into private.comment_write_limits values (auth.uid(), '-infinity', write_now, 0)
      on conflict (user_id) do nothing;
    select * into limits from private.comment_write_limits where user_id = auth.uid() for update;
    if limits.last_write > write_now - interval '10 seconds' then raise exception '댓글은 10초에 한 번 작성할 수 있습니다.'; end if;
    if limits.window_start <= write_now - interval '24 hours' then limits.window_start := write_now; limits.writes := 0; end if;
    if limits.writes >= 100 then raise exception '24시간 동안 작성 가능한 댓글 수를 초과했습니다.'; end if;
    update private.comment_write_limits set last_write = write_now, window_start = limits.window_start, writes = limits.writes + 1 where user_id = auth.uid();
  end if;
  return new;
end;
$$;

create function public.member_comments(p_action text,p_args jsonb)
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
  if parent_row is null or (v_kind='guestbook' and parent_row->>'visibility'='private' and mode<>'owner'
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
