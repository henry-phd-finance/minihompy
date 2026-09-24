begin;

-- A menu's structural revision is private: it includes private post counts.
create table private.content_folder_state (
  menu text primary key check (menu in ('board','photos','diary')),
  revision bigint not null default 0 check (revision between 0 and 9007199254740991)
);
insert into private.content_folder_state(menu) values ('board'),('photos'),('diary');
create table private.content_folder_requests (
  actor uuid not null,
  menu text not null references private.content_folder_state(menu),
  request_id uuid not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(actor,menu,request_id)
);
alter table private.content_folder_state enable row level security;
alter table private.content_folder_requests enable row level security;
revoke all on private.content_folder_state,private.content_folder_requests from public,anon,authenticated,service_role;

-- Acquire before any post/folder row lock, including direct PostgREST writes.
create function private.lock_content_folder_menu() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(240001,case tg_argv[0] when 'board' then 1 when 'photos' then 2 when 'diary' then 3 end);
  return null;
end;
$$;
create function private.bump_content_folder_revision() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_argv[1]='post' and tg_op='UPDATE' then
    if new.folder_id is not distinct from old.folder_id then return null; end if;
  end if;
  if tg_argv[1]='folder' and tg_op='UPDATE' then
    if to_jsonb(new)=to_jsonb(old) then return null; end if;
  end if;
  update private.content_folder_state set revision=revision+1 where menu=tg_argv[0];
  return null;
end;
$$;
-- Board's legacy author-only UPDATE policy must not grant ex-owners folder management.
create function private.guard_content_folder_move() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.folder_id is distinct from old.folder_id and not public.is_minihompy_admin() then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_content_folder_move() from public,anon,authenticated,service_role;
revoke all on function private.lock_content_folder_menu(),private.bump_content_folder_revision() from public,anon,authenticated,service_role;

do $$
declare m text; folders text; posts text;
begin
  foreach m in array array['board','photos','diary'] loop
    folders:=case m when 'board' then 'board_folders' when 'photos' then 'photo_folders' else 'diary_folders' end;
    posts:=case m when 'board' then 'board_posts' when 'photos' then 'photo_posts' else 'diary_entries' end;
    execute format('create trigger content_folder_lock before insert or update or delete on public.%I for each statement execute function private.lock_content_folder_menu(%L)',folders,m);
    execute format('create trigger content_folder_revision after insert or update or delete on public.%I for each row execute function private.bump_content_folder_revision(%L,%L)',folders,m,'folder');
    execute format('create trigger content_folder_lock before insert or update or delete on public.%I for each statement execute function private.lock_content_folder_menu(%L)',posts,m);
    execute format('create trigger content_folder_revision after insert or update or delete on public.%I for each row execute function private.bump_content_folder_revision(%L,%L)',posts,m,'post');
    execute format('create trigger content_folder_move_guard before update on public.%I for each row execute function private.guard_content_folder_move()',posts);
    -- Table-level REVOKE alone does not remove existing column grants.
    execute format('revoke insert,update,delete,truncate,references,trigger on public.%I from public,anon,authenticated',folders);
    if m='diary' then
      execute format('revoke insert(label,sort_order),update(label,sort_order) on public.%I from public,anon,authenticated',folders);
    else
      execute format('revoke insert(kind,label,description,sort_order),update(label,description,sort_order) on public.%I from public,anon,authenticated',folders);
    end if;
  end loop;
end;
$$;

-- Board uses updated_at, unlike the integer revisions on photos/diary.
create or replace function private.touch_board_post() returns trigger
language plpgsql set search_path='' as $$
begin
  new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
  return new;
end;
$$;
revoke all on function private.touch_board_post() from public,anon,authenticated,service_role;

create function public.manage_content_folders(p_action text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  m text; folders text; posts text; rid uuid; item_id uuid; destination uuid;
  expected bigint; current_revision bigint; v_actor uuid:=auth.uid(); previous private.content_folder_requests;
  payload jsonb; result jsonb; item jsonb; items jsonb; kind text; label text; description text;
  total bigint; moved bigint:=0; real_folders bigint; next_order integer; allowed text[]; key text;
  order_ids uuid[]; has_bad boolean;
begin
  if v_actor is null then return jsonb_build_object('failure','AUTH_REQUIRED'); end if;
  if not public.is_minihompy_admin() then return jsonb_build_object('failure','FORBIDDEN'); end if;
  -- The nested block rolls back all mutations before returning a domain error.
  begin
    if p_args is null or jsonb_typeof(p_args)<>'object' or p_action is null then raise exception 'BAD_REQUEST'; end if;
    m:=p_args->>'menu';
    if m is null or m not in ('board','photos','diary') then raise exception 'BAD_REQUEST'; end if;
    folders:=case m when 'board' then 'board_folders' when 'photos' then 'photo_folders' else 'diary_folders' end;
    posts:=case m when 'board' then 'board_posts' when 'photos' then 'photo_posts' else 'diary_entries' end;
    allowed:=case p_action
      when 'snapshot' then array['menu']
      when 'create' then array['menu','request_id','expected_revision','id','kind','label','description']
      when 'rename' then array['menu','request_id','expected_revision','id','label','description']
      when 'reorder' then array['menu','request_id','expected_revision','ids']
      when 'delete' then array['menu','request_id','expected_revision','id','destination_id']
      else null end;
    if allowed is null then raise exception 'BAD_REQUEST'; end if;
    for key in select jsonb_object_keys(p_args) loop
      if not key=any(allowed) then raise exception 'BAD_REQUEST'; end if;
    end loop;
    perform pg_catalog.pg_advisory_xact_lock(240001,case m when 'board' then 1 when 'photos' then 2 else 3 end);
    -- Recheck after a lock wait: administrator membership may have been revoked.
    if not public.is_minihompy_admin() then raise exception 'FORBIDDEN'; end if;
    select revision into current_revision from private.content_folder_state where menu=m;
    if p_action='snapshot' then
      execute format('select coalesce(jsonb_agg(to_jsonb(f)||jsonb_build_object(''count'',(select count(*) from public.%I p where p.folder_id=f.id)) order by f.sort_order,f.id),''[]''::jsonb) from public.%I f',posts,folders) into items;
      return jsonb_build_object('items',items,'menu_revision',current_revision);
    end if;
    if jsonb_typeof(p_args->'request_id') is distinct from 'string'
      or jsonb_typeof(p_args->'expected_revision') is distinct from 'number'
      or (p_args->>'expected_revision') !~ '^(0|[1-9][0-9]*)$' then raise exception 'BAD_REQUEST'; end if;
    rid:=(p_args->>'request_id')::uuid; expected:=(p_args->>'expected_revision')::bigint;
    if expected not between 0 and 9007199254740991 then raise exception 'BAD_REQUEST'; end if;
    payload:=jsonb_build_object('action',p_action,'args',p_args);
    -- Keep a full day of retry receipts; prune only this actor/menu after taking its lock.
    delete from private.content_folder_requests r where r.menu=m and r.actor=v_actor and created_at<clock_timestamp()-interval '24 hours';
    select * into previous from private.content_folder_requests r where r.actor=v_actor and r.menu=m and r.request_id=rid;
    if found then
      if previous.payload<>payload then raise exception 'REQUEST_CONFLICT'; end if;
      return previous.result;
    end if;
    if expected<>current_revision then raise exception 'CONFLICT'; end if;
    if p_action<>'reorder' then
      if jsonb_typeof(p_args->'id') is distinct from 'string' then raise exception 'BAD_REQUEST'; end if;
      item_id:=(p_args->>'id')::uuid;
    end if;
    if p_action in ('create','rename') then
      if jsonb_typeof(p_args->'label') is distinct from 'string' then raise exception 'BAD_REQUEST'; end if;
      label:=btrim(p_args->>'label'); description:=coalesce(p_args->>'description','');
      if p_args?'description' and (m='diary' or jsonb_typeof(p_args->'description') is distinct from 'string') then raise exception 'BAD_REQUEST'; end if;
      if char_length(label)>40 or char_length(description)>300 then raise exception 'BAD_REQUEST'; end if;
    end if;
    if p_action='create' then
      if jsonb_typeof(p_args->'kind') is distinct from 'string' then raise exception 'BAD_REQUEST'; end if;
      kind:=p_args->>'kind';
      if kind not in ('folder','divider') or (m='diary' and kind<>'folder') or (kind='folder' and label='')
        or (kind='divider' and (label<>'' or description<>'')) then raise exception 'BAD_REQUEST'; end if;
      execute format('select coalesce(max(sort_order),-1)+1 from public.%I',folders) into next_order;
      if m='diary' then
        execute format('insert into public.%I(id,label,sort_order) values($1,$2,$3)',folders) using item_id,label,next_order;
      else
        execute format('insert into public.%I(id,kind,label,description,sort_order) values($1,$2,$3,$4,$5)',folders) using item_id,kind,label,description,next_order;
      end if;
    elsif p_action='reorder' then
      if jsonb_typeof(p_args->'ids') is distinct from 'array' then raise exception 'BAD_REQUEST'; end if;
      select exists(select 1 from jsonb_array_elements(p_args->'ids') v where jsonb_typeof(v)<>'string') into has_bad;
      if has_bad then raise exception 'BAD_REQUEST'; end if;
      select coalesce(array_agg(v::uuid),'{}'::uuid[]) into order_ids from jsonb_array_elements_text(p_args->'ids') v;
      if cardinality(order_ids)<>(select count(distinct x) from unnest(order_ids) x) then raise exception 'BAD_REQUEST'; end if;
      execute format('select count(*) from public.%I',folders) into total;
      if cardinality(order_ids)<>total then raise exception 'BAD_REQUEST'; end if;
      execute format('select count(*) from public.%I where id=any($1)',folders) into total using order_ids;
      if total<>cardinality(order_ids) then raise exception 'BAD_REQUEST'; end if;
      execute format('update public.%I f set sort_order=u.position-1 from unnest($1::uuid[]) with ordinality u(id,position) where f.id=u.id and f.sort_order<>u.position-1',folders) using order_ids;
    else
      execute format('select to_jsonb(f) from public.%I f where id=$1',folders) into item using item_id;
      if item is null then raise exception 'NOT_FOUND'; end if;
      kind:=coalesce(item->>'kind','folder');
      if p_action='rename' then
        if not (p_args?'description') then description:=coalesce(item->>'description',''); end if;
        if (kind='folder' and label='') or (kind='divider' and m='board' and (label<>'' or description<>'')) then raise exception 'BAD_REQUEST'; end if;
        if m='diary' then
          execute format('update public.%I set label=$2 where id=$1',folders) using item_id,label;
        else
          execute format('update public.%I set label=$2,description=$3 where id=$1',folders) using item_id,label,description;
        end if;
      else
        execute format('select count(*) from public.%I f where coalesce(to_jsonb(f)->>''kind'',''folder'')=''folder''',folders) into real_folders;
        if kind='folder' and real_folders<=1 then raise exception 'LAST_FOLDER'; end if;
        if p_args?'destination_id' and p_args->'destination_id'<>'null'::jsonb then
          if jsonb_typeof(p_args->'destination_id')<>'string' then raise exception 'BAD_REQUEST'; end if;
          destination:=(p_args->>'destination_id')::uuid;
          if destination=item_id or kind='divider' then raise exception 'BAD_REQUEST'; end if;
          execute format('select to_jsonb(f) from public.%I f where id=$1',folders) into item using destination;
          if item is null or coalesce(item->>'kind','folder')<>'folder' then raise exception 'BAD_REQUEST'; end if;
        end if;
        execute format('select count(*) from public.%I where folder_id=$1',posts) into moved using item_id;
        if moved>0 and destination is null then raise exception 'DESTINATION_REQUIRED'; end if;
        if moved>0 then
          execute format('update public.%I set folder_id=$2 where folder_id=$1',posts) using item_id,destination;
        end if;
        execute format('delete from public.%I where id=$1',folders) using item_id;
      end if;
    end if;
    select revision into current_revision from private.content_folder_state where menu=m;
    result:=jsonb_build_object('request_id',rid,'menu_revision',current_revision,'affected_id',item_id,'moved_count',moved);
    insert into private.content_folder_requests(actor,menu,request_id,payload,result) values(v_actor,m,rid,payload,result);
    return result;
  exception
    when raise_exception then
      if sqlerrm=any(array['FORBIDDEN','BAD_REQUEST','NOT_FOUND','CONFLICT','REQUEST_CONFLICT','LAST_FOLDER','DESTINATION_REQUIRED']) then
        return jsonb_build_object('failure',sqlerrm);
      end if;
      raise;
    when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then
      return jsonb_build_object('failure','BAD_REQUEST');
    when unique_violation or foreign_key_violation then
      return jsonb_build_object('failure','CONFLICT');
  end;
end;
$$;
revoke all on function public.manage_content_folders(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.manage_content_folders(text,jsonb) to authenticated;
comment on function public.manage_content_folders(text,jsonb) is 'Admin-only folder management v1; revisions, atomic move/delete, 24h retry receipts. No visibility activation.';
commit;
