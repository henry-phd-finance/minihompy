begin;
-- Keep retry identities distinct even if a local owner's UUID equals a member ID.
alter table private.member_writing_requests add column actor_kind text not null default 'member' check(actor_kind in ('member','owner'));
alter table private.member_writing_requests drop constraint member_writing_requests_pkey;
alter table private.member_writing_requests add primary key(site_id,actor_kind,member_id,request_id);

create or replace function private.guard_guestbook_post() returns trigger
language plpgsql security definer set search_path = '' as $$
declare limits private.guestbook_write_limits; write_now timestamptz := clock_timestamp();
begin
  if new.author_kind='member' then
    -- PostgreSQL's SET ROLE is privilege checked, unlike caller-defined GUCs.
    -- Browser DML is also blocked by column grants and restrictive RLS policies.
    if current_setting('role') not in ('service_role','none') then raise exception 'Member writes require the server'; end if;
    if tg_op='UPDATE' then
      if old.visibility='private' and new.visibility<>'private' then raise exception '비공개 방명록은 다시 공개할 수 없습니다.'; end if;
      new.revision:=old.revision+1;new.updated_at:=write_now;
    end if;
    return new;
  end if;
  if tg_op='UPDATE' then
    if old.visibility='private' and new.visibility<>'private' then raise exception '비공개 방명록은 다시 공개할 수 없습니다.'; end if;
    if old.author_id is distinct from auth.uid() and new.body is distinct from old.body then raise exception '다른 사람의 방명록 본문은 수정할 수 없습니다.'; end if;
    new.revision:=old.revision+1;new.updated_at:=write_now;
  elsif not public.is_minihompy_admin() then
    insert into private.guestbook_write_limits values(auth.uid(),'-infinity',write_now,0) on conflict(user_id) do nothing;
    select * into limits from private.guestbook_write_limits where user_id=auth.uid() for update;
    if limits.last_write>write_now-interval '1 minute' then raise exception '방명록은 1분에 한 번 작성할 수 있습니다.'; end if;
    if limits.window_start<=write_now-interval '24 hours' then limits.window_start:=write_now;limits.writes:=0;end if;
    if limits.writes>=20 then raise exception '24시간 동안 작성 가능한 방명록 수를 초과했습니다.'; end if;
    update private.guestbook_write_limits set last_write=write_now,window_start=limits.window_start,writes=limits.writes+1 where user_id=auth.uid();
  end if;
  return new;
end;
$$;

create function public.member_guestbook(p_action text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cfg private.member_writing_site; s private.member_writing_sessions;
  actor uuid; mode text:=p_args->>'mode'; item public.guestbook_posts;
  prior private.member_writing_requests; limits private.member_writing_limits;
  v_request_id uuid; resource uuid; expected integer; hash text; result jsonb;
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

  if p_action='list' then
    page:=(p_args->>'page')::integer;size:=(p_args->>'size')::integer;
    if page is null or size is null or page<1 or page>100000 or size<1 or size>20 then return jsonb_build_object('failure','BAD_REQUEST'); end if;
    select count(*) into total from public.guestbook_posts g where visibility='public' or mode='owner' or (author_kind='member' and author_member_id=actor);
    select coalesce(jsonb_agg(v.payload order by v.created_at desc,v.id desc),'[]'::jsonb) into items from (
      select g.id,g.created_at,to_jsonb(g)||jsonb_build_object(
        'can_edit', (g.author_kind='member' and mode='member' and g.author_member_id=actor) or (g.author_kind='local' and mode='owner' and g.author_id=actor),
        'can_delete',mode='owner' or (g.author_kind='member' and mode='member' and g.author_member_id=actor),
        'can_make_private',g.visibility='public' and (mode='owner' or (g.author_kind='member' and mode='member' and g.author_member_id=actor))) as payload
      from public.guestbook_posts g where visibility='public' or mode='owner' or (author_kind='member' and author_member_id=actor)
      order by created_at desc,id desc offset ((page-1)*size) limit size
    ) v;
    return jsonb_build_object('items',items,'count',total,'page',page,'size',size);
  end if;
  if mode='public' then return jsonb_build_object('failure','FORBIDDEN'); end if;
  if p_action not in ('create','update','private','delete') then return jsonb_build_object('failure','BAD_REQUEST'); end if;
  if mode='owner' and p_action not in ('private','delete') then return jsonb_build_object('failure','FORBIDDEN'); end if;
  v_request_id:=(p_args->>'request_id')::uuid;resource:=(p_args->>'id')::uuid;expected:=(p_args->>'revision')::integer;
  if v_request_id is null or resource is null or (p_action<>'create' and (expected is null or expected<1)) then return jsonb_build_object('failure','BAD_REQUEST'); end if;
  if p_action in ('create','update') and (p_args->>'body' is null or char_length(p_args->>'body')>5000 or char_length(btrim(p_args->>'body',E' \n\r\t'))=0) then return jsonb_build_object('failure','BAD_REQUEST'); end if;
  if p_action='create' and (p_args->>'visibility' is null or p_args->>'visibility' not in ('public','private')) then return jsonb_build_object('failure','BAD_REQUEST'); end if;
  -- Per-actor transaction lock serializes retries across distinct browser sessions.
  perform pg_advisory_xact_lock(hashtextextended(cfg.site_id::text||':'||mode||':'||actor::text,0));
  hash:=encode(sha256(convert_to(jsonb_build_object('operation',p_action,'id',resource,'revision',expected,'body',p_args->>'body','visibility',p_args->>'visibility')::text,'UTF8')),'hex');
  select * into prior from private.member_writing_requests where site_id=cfg.site_id and actor_kind=mode and member_id=actor and member_writing_requests.request_id=v_request_id;
  if found then
    if prior.payload_hash<>hash or prior.operation<>'guestbook.'||p_action then return jsonb_build_object('failure','REQUEST_CONFLICT'); end if;
    return jsonb_build_object('id',prior.resource_id,'revision',prior.result_revision,'deleted',p_action='delete','replayed',true);
  end if;
  select * into item from public.guestbook_posts where id=resource for update;
  if p_action='create' then
    if found then
      if item.author_kind<>'member' or item.author_member_id<>actor then return jsonb_build_object('failure','NOT_FOUND'); end if;
      return jsonb_build_object('failure','REQUEST_CONFLICT');
    end if;
    insert into private.member_writing_limits values(cfg.site_id,actor,'guestbook','-infinity',write_now,0) on conflict do nothing;
    select * into limits from private.member_writing_limits where site_id=cfg.site_id and member_id=actor and kind='guestbook' for update;
    if limits.window_start<=write_now-interval '24 hours' then limits.window_start:=write_now;limits.writes:=0;end if;
    if limits.last_write>write_now-interval '1 minute' or limits.writes>=20 then return jsonb_build_object('failure','RATE_LIMITED'); end if;
    insert into public.guestbook_posts(id,author_id,author_kind,author_member_id,author_homepage_url,author_name,body,visibility)
      values(resource,null,'member',actor,s.homepage_url,s.display_name,p_args->>'body',p_args->>'visibility') returning * into item;
    update private.member_writing_limits set last_write=write_now,window_start=limits.window_start,writes=limits.writes+1 where site_id=cfg.site_id and member_id=actor and kind='guestbook';
  else
    if not found or not (mode='owner' or (item.author_kind='member' and item.author_member_id=actor)) then return jsonb_build_object('failure','NOT_FOUND'); end if;
    if item.revision<>expected then return jsonb_build_object('failure','REVISION_CONFLICT'); end if;
    if p_action='update' then update public.guestbook_posts set body=p_args->>'body' where id=resource returning * into item;
    elsif p_action='private' then update public.guestbook_posts set visibility='private' where id=resource returning * into item;
    else delete from public.guestbook_posts where id=resource; end if;
  end if;
  insert into private.member_writing_requests(site_id,actor_kind,member_id,request_id,operation,payload_hash,resource_id,result_revision)
    values(cfg.site_id,mode,actor,v_request_id,'guestbook.'||p_action,hash,resource,item.revision);
  return jsonb_build_object('id',resource,'revision',item.revision,'deleted',p_action='delete','replayed',false);
end;
$$;
revoke all on function public.member_guestbook(text,jsonb) from public,anon,authenticated;
grant execute on function public.member_guestbook(text,jsonb) to service_role;
commit;
