begin;

-- Home stays public-only, including for the personal administrator.
create or replace function private.home_summary_at(p_menus text[], p_as_of timestamptz)
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
   -- The public wrapper runs as definer: RLS cannot enforce public-only here.
   -- Filter parents before recent items, totals and comment aggregation.
   select 'board'::text kind,id,created_at from public.board_posts where 'board'=any(menus) and visibility='public' and created_at<=p_as_of
   union all select 'photos',id,created_at from public.photo_posts where 'photos'=any(menus) and visibility='public' and created_at<=p_as_of
   union all select 'diary',id,created_at from public.diary_entries where 'diary'=any(menus) and visibility='public' and created_at<=p_as_of
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
revoke all on function private.home_summary_at(text[],timestamptz) from public,anon,authenticated,service_role;

commit;
