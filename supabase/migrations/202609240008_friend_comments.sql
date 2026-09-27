begin;
alter table private.member_writing_requests add column parent_kind text check(parent_kind in ('board','photos','diary')), add column parent_id uuid;
alter table private.member_writing_requests add constraint member_request_parent_pair check((parent_kind is null)=(parent_id is null));
-- Private operation engine. Caller must have already locked and verified the read context.
create function private.friend_comment_operation(p_action text,p_args jsonb)
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
  if parent_row is null or (v_kind<>'guestbook' and not private.friend_content_visible(parent_row->>'visibility',mode,p_args->>'read_scope',coalesce((p_args->>'can_read_friends')::boolean,false)))
    or (v_kind='guestbook' and parent_row->>'visibility'='private' and mode<>'owner'
    and not coalesce(mode='member' and parent_row->>'author_kind'='member' and (parent_row->>'author_member_id')::uuid=actor,false)) then
    return jsonb_build_object('failure','NOT_FOUND');
  end if;
  if p_action='list' then
    page:=(p_args->>'page')::integer;size:=(p_args->>'size')::integer;
    if page is null or size is null or page<1 or page>100000 or size<1 or size>100 then return jsonb_build_object('failure','BAD_REQUEST'); end if;
    execute format('with rows as materialized (select * from public.post_comments where %I=$1), paged as (select * from rows order by created_at,id offset $2 limit $3) select (select count(*) from rows),coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object(''can_edit'',coalesce((author_kind=''member'' and $4=''member'' and author_member_id=$5) or (author_kind=''local'' and $4=''owner'' and author_id=$5),false),''can_delete'',coalesce($4=''owner'' or (author_kind=''member'' and $4=''member'' and author_member_id=$5),false)) order by created_at,id) from paged c),''[]''::jsonb)',parent_column)
      into total,items using parent_id,(page-1)*size,size,mode,actor;
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
  insert into private.member_writing_requests(site_id,actor_kind,member_id,request_id,operation,payload_hash,resource_id,result_revision,parent_kind,parent_id)
    values(cfg.site_id,mode,actor,v_request_id,'comment.'||p_action,hash,resource,item.revision,v_kind,parent_id);
  return jsonb_build_object('id',resource,'revision',item.revision,'deleted',p_action='delete','replayed',false);
end;
$$;

revoke all on function private.friend_comment_operation(text,jsonb) from public,anon,authenticated,service_role;

create function public.friend_comments_status() returns jsonb
language sql security definer set search_path='' set lock_timeout='3s' set statement_timeout='3s' as $$
 select jsonb_build_object('protocol',1,'ready',ready) from private.friend_visibility_state where singleton
$$;

create function public.member_content_comments(p_action text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='3s' set statement_timeout='3s' as $$
declare access jsonb:=p_args->'access'; op jsonb:=p_args->'operation'; selectors jsonb; view jsonb;
 mode text:=access->>'mode'; actor uuid; sess jsonb; k text; fields text[]; parent jsonb; tab text;
 result jsonb; receipt private.member_writing_requests; deadline timestamptz;
begin
 if p_action is null or p_action not in ('list','create','update','delete','operations')
  or jsonb_typeof(p_args) is distinct from 'object' or octet_length(p_args::text)>16384
  or (select array_agg(key order by key) from jsonb_object_keys(p_args) key) is distinct from array['access','operation']
  or jsonb_typeof(op) is distinct from 'object' or coalesce(op->>'kind','') not in ('board','photos','diary') then raise exception 'BAD_REQUEST'; end if;
 fields:=array['kind','parent_id']||case p_action when 'list' then array['page','size'] when 'operations' then array['request_id'] when 'create' then array['request_id','id','body'] when 'update' then array['request_id','id','revision','body'] else array['request_id','id','revision'] end;
 if not op ?& fields then raise exception 'BAD_REQUEST'; end if;
 for k in select jsonb_object_keys(op) loop
  if not k=any(fields) or jsonb_typeof(op->k)='null' then raise exception 'BAD_REQUEST'; end if;
  if k in ('id','parent_id','request_id') and (jsonb_typeof(op->k)<>'string' or (op->>k)!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then raise exception 'BAD_REQUEST'; end if;
  if k in ('page','size','revision') and (jsonb_typeof(op->k)<>'number' or (op->>k)!~'^[0-9]+$') then raise exception 'BAD_REQUEST'; end if;
 end loop;
 if p_action='list' and ((op->>'page')::integer not between 1 and 100000 or (op->>'size')::integer not between 1 and 100) then raise exception 'BAD_REQUEST'; end if;
 if p_action in ('update','delete') and (op->>'revision')::integer<1 then raise exception 'BAD_REQUEST'; end if;
 if p_action in ('create','update') and (jsonb_typeof(op->'body')<>'string' or char_length(op->>'body')>1000 or char_length(btrim(op->>'body',E' \n\r\t'))=0) then raise exception 'BAD_REQUEST'; end if;
 selectors:=jsonb_build_object('kind',op->>'kind','parent_id',op->>'parent_id')||case p_action when 'list' then jsonb_build_object('page',op->'page','size',op->'size') else jsonb_build_object('operation_id',op->>'request_id') end;
 if access->'selectors' is distinct from selectors or access->>'scope' is distinct from (case when mode='public' then 'public' else 'visible' end) then raise exception 'TARGET_MISMATCH'; end if;
 view:=private.friend_read_authorize('comments.'||p_action,access);deadline:=(view->>'deadline')::timestamptz;
 if mode='member' then
  sess:=public.member_writing_session('current',jsonb_build_object('site_id',access->>'site_id','token_hash',access->>'token_hash'));
  if sess?'failure' then raise exception '%',sess->>'failure'; end if;actor:=(sess->>'member_id')::uuid;
 elsif mode='owner' then actor:=(access->>'owner_id')::uuid; end if;
 if p_action='operations' then
  if mode='public' then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended((access->>'site_id')||':'||mode||':'||actor::text,0));
  tab:=case op->>'kind' when 'board' then 'board_posts' when 'photos' then 'photo_posts' else 'diary_entries' end;
  execute format('select to_jsonb(p) from public.%I p where id=$1 for share',tab) into parent using (op->>'parent_id')::uuid;
  if parent is null or not private.friend_content_visible(parent->>'visibility',mode,access->>'scope',(view->>'includes_friends')::boolean) then raise exception 'NOT_FOUND'; end if;
  select * into receipt from private.member_writing_requests where site_id=(access->>'site_id')::uuid and actor_kind=mode and member_id=actor and request_id=(op->>'request_id')::uuid;
  if not found or receipt.parent_kind is distinct from op->>'kind' or receipt.parent_id is distinct from (op->>'parent_id')::uuid or receipt.operation not in ('comment.create','comment.update','comment.delete') then raise exception 'NOT_FOUND'; end if;
  result:=jsonb_build_object('id',receipt.resource_id,'revision',receipt.result_revision,'deleted',receipt.operation='comment.delete','replayed',true,'operation',substr(receipt.operation,9));
 else
  result:=private.friend_comment_operation(p_action,op||jsonb_build_object('site_id',access->>'site_id','mode',mode,'token_hash',access->>'token_hash','owner_id',access->>'owner_id','read_scope',access->>'scope','can_read_friends',(view->>'includes_friends')::boolean));
  if result?'failure' then raise exception '%',result->>'failure'; end if;
 end if;
 -- Exception rolls back comment, quota AND receipt if authorization expires during SQL.
 if deadline is not null and deadline<=clock_timestamp() then raise exception 'READ_CONTEXT_EXPIRED'; end if;
 if octet_length(result::text)>1048576 then raise exception 'IDENTITY_UNAVAILABLE'; end if;
 return result;
exception
 when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return jsonb_build_object('failure','BAD_REQUEST');
 when raise_exception then
  if sqlerrm=any(array['BAD_REQUEST','AUTH_REQUIRED','FORBIDDEN','NOT_CONFIGURED','TARGET_MISMATCH','SESSION_REVOKED','SESSION_EXPIRED','READ_CONTEXT_EXPIRED','NOT_FOUND','IDENTITY_UNAVAILABLE','REQUEST_CONFLICT','REVISION_CONFLICT','RATE_LIMITED']) then return jsonb_build_object('failure',sqlerrm); end if;
  raise;
end $$;
revoke all on function public.friend_comments_status(),public.member_content_comments(text,jsonb) from public,anon,authenticated;
grant execute on function public.friend_comments_status(),public.member_content_comments(text,jsonb) to service_role;
commit;
