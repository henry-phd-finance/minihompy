begin;
-- Invoker rights: locate only among rows that this exact reader can see.
create or replace function public.post_location(p_kind text,p_id uuid,p_size integer)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare item record; position bigint;
begin
 if p_kind is null or p_kind not in ('board','photos','diary','guestbook') or p_id is null or p_size is null or p_size<1 or p_size>20 then raise exception 'Invalid post location' using errcode='22023';end if;
 if p_kind='board' then
  select * into item from public.board_posts where id=p_id;if not found then return null;end if;
  select count(*) into position from public.board_posts where folder_id=item.folder_id and (created_at,id)>(item.created_at,item.id);
 elsif p_kind='photos' then
  select * into item from public.photo_posts where id=p_id;if not found then return null;end if;
  select count(*) into position from public.photo_posts where folder_id=item.folder_id and (created_at,id)>(item.created_at,item.id);
 elsif p_kind='diary' then
  select * into item from public.diary_entries where id=p_id;if not found then return null;end if;
  select count(*) into position from public.diary_entries where folder_id=item.folder_id and entry_date=item.entry_date and (entry_time,id)<(item.entry_time,item.id);
 else
  select * into item from public.guestbook_posts where id=p_id;if not found then return null;end if;
  select count(*) into position from public.guestbook_posts where (created_at,id)>(item.created_at,item.id);
 end if;
 return jsonb_build_object('id',p_id,'page',position/p_size+1,'folder_id',to_jsonb(item)->'folder_id','entry_date',to_jsonb(item)->'entry_date');
end;
$$;
revoke all on function public.post_location(text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.post_location(text,uuid,integer) to anon,authenticated;
commit;
