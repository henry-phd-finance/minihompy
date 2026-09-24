begin;
-- Content and retry/authorization metadata are separate; neither is directly exposed.
create table private.friend_reviews (
 id uuid primary key default gen_random_uuid(), site_id uuid not null,
 author_member_id uuid not null, display_name text not null,
 body text not null check(char_length(body) between 1 and 200),
 created_at timestamptz not null default clock_timestamp()
);
create index friend_reviews_page on private.friend_reviews(site_id,created_at desc,id desc);
create table private.friend_review_operations (
 site_id uuid not null, actor_kind text not null check(actor_kind in ('member','owner')),
 actor_id uuid not null, operation_id uuid not null, action text not null check(action in ('create','delete')),
 fingerprint text not null, review_id uuid not null,
 permit_id uuid unique, owner_member_id uuid, central_session_id uuid, relationship_revision bigint,
 authorized_at timestamptz, expires_at timestamptz,
 primary key(site_id,actor_kind,actor_id,operation_id)
);
create table private.friend_review_limits (
 bucket text not null, window_start timestamptz not null, count integer not null,
 primary key(bucket,window_start)
);
create index friend_review_limits_cleanup on private.friend_review_limits(window_start);
alter table private.friend_reviews enable row level security;
alter table private.friend_review_operations enable row level security;
alter table private.friend_review_limits enable row level security;
revoke all on private.friend_reviews,private.friend_review_operations,private.friend_review_limits from public,anon,authenticated,service_role;

create function public.member_friend_reviews(p_action text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='5s' as $$
declare cfg private.member_writing_site; s private.member_writing_sessions; f private.member_writing_families; fid uuid;
 actor uuid; mode text:=p_args->>'mode'; op uuid; resource uuid; fingerprint text; prior private.friend_review_operations;
 permit jsonb:=p_args->'permit'; item private.friend_reviews; result jsonb; items jsonb; lim integer; boundary timestamptz; after_id uuid;
 v_bucket text; win timestamptz; used integer; auth_time timestamptz; deadline timestamptz;
begin
 select * into cfg from private.member_writing_site where singleton;
 if cfg.site_id is null then return jsonb_build_object('failure','NOT_CONFIGURED');end if;
 if cfg.site_id is distinct from (p_args->>'site_id')::uuid then return jsonb_build_object('failure','TARGET_MISMATCH');end if;
 if p_action='health' then return jsonb_build_object('friend_reviews_protocol',1);end if;
 if p_action='list' then
  if mode is distinct from 'public' then return jsonb_build_object('failure','FORBIDDEN');end if;
  lim:=coalesce((p_args->>'limit')::integer,20);
  if lim<1 or lim>50 or coalesce(p_args->>'peer_hash','')!~'^[0-9a-f]{64}$' then return jsonb_build_object('failure','BAD_REQUEST');end if;
  boundary:=(p_args->>'before_time')::timestamptz;after_id:=(p_args->>'before_id')::uuid;
  if (boundary is null)<>(after_id is null) then return jsonb_build_object('failure','BAD_REQUEST');end if;
  v_bucket:='public:'||cfg.site_id::text||':'||(p_args->>'peer_hash');win:=date_trunc('minute',clock_timestamp());
  insert into private.friend_review_limits values(v_bucket,win,1) on conflict(bucket,window_start) do update set count=private.friend_review_limits.count+1 returning count into used;
  if used>120 then raise exception 'RATE_LIMITED' using errcode='P0001';end if;
  delete from private.friend_review_limits where window_start<win-interval '1 minute';
  select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'author_member_id',v.author_member_id,'display_name',v.display_name,'body',v.body,'created_at',v.created_at) order by v.created_at desc,v.id desc),'[]'::jsonb) into items
   from (select * from private.friend_reviews r where r.site_id=cfg.site_id and (boundary is null or (r.created_at,r.id)<(boundary,after_id)) order by r.created_at desc,r.id desc limit lim+1) v;
  return jsonb_build_object('items',items);
 end if;
 if mode='member' then
  -- Match renewal/logout lock order: family, then token. Never invert it.
  select family_id into fid from private.member_writing_sessions where site_id=cfg.site_id and token_hash=p_args->>'token_hash';
  if fid is not null then
   select * into f from private.member_writing_families where id=fid for update;
   if f.revoked_at is not null then return jsonb_build_object('failure','SESSION_REVOKED');end if;
   if f.expires_at<=clock_timestamp() then return jsonb_build_object('failure','SESSION_EXPIRED');end if;
  end if;
  select * into s from private.member_writing_sessions where site_id=cfg.site_id and token_hash=p_args->>'token_hash' for update;
  if not found or s.revoked_at is not null then return jsonb_build_object('failure','SESSION_REVOKED');end if;
  if s.expires_at<=clock_timestamp() then return jsonb_build_object('failure','SESSION_EXPIRED');end if;
  actor:=s.member_id;
 elsif mode='owner' then
  actor:=(p_args->>'owner_id')::uuid;
  if not exists(select 1 from private.minihompy_admins where user_id=actor) then return jsonb_build_object('failure','FORBIDDEN');end if;
 else return jsonb_build_object('failure','FORBIDDEN');end if;
 if p_action not in ('create','lookup','delete','operations') then return jsonb_build_object('failure','BAD_REQUEST');end if;
 if mode='owner' and p_action in ('create','lookup') then return jsonb_build_object('failure','FORBIDDEN');end if;
 op:=(p_args->>'operation_id')::uuid;
 if op is null then return jsonb_build_object('failure','BAD_REQUEST');end if;
 perform pg_advisory_xact_lock(hashtextextended('friend-review:'||cfg.site_id::text||':'||mode||':'||actor::text,0));
 if mode='member' and (s.expires_at<=clock_timestamp() or (fid is not null and f.expires_at<=clock_timestamp())) then return jsonb_build_object('failure','SESSION_EXPIRED');end if;
 if p_action in ('create','lookup') then
  if p_args->>'body' is null or char_length(p_args->>'body') not between 1 and 200 or (p_args->>'body') ~ E'[\\x01-\\x09\\x0B-\\x1F\\x7F]' then return jsonb_build_object('failure','BAD_REQUEST');end if;
  fingerprint:=encode(sha256(convert_to(p_args->>'body','UTF8')),'hex');
 elsif p_action='delete' then
  resource:=(p_args->>'review_id')::uuid;if resource is null then return jsonb_build_object('failure','BAD_REQUEST');end if;
  fingerprint:=resource::text;
 end if;
 select * into prior from private.friend_review_operations where site_id=cfg.site_id and actor_kind=mode and actor_id=actor and operation_id=op;
 if found then
  if p_action<>'operations' and (prior.action<>case when p_action='lookup' then 'create' else p_action end or prior.fingerprint<>fingerprint) then return jsonb_build_object('failure','REQUEST_CONFLICT');end if;
  return jsonb_build_object('id',prior.review_id,'action',prior.action,'operation_id',op,'deleted',not exists(select 1 from private.friend_reviews where id=prior.review_id),'replayed',true);
 end if;
 if p_action in ('lookup','operations') then return jsonb_build_object('failure','NOT_FOUND');end if;
 if p_action='create' then
  if p_args->>'checked_at' is null or abs(extract(epoch from clock_timestamp()-(p_args->>'checked_at')::timestamptz))>5 then return jsonb_build_object('failure','IDENTITY_UNAVAILABLE');end if;
  if permit is null or jsonb_typeof(permit)<>'object' or not (permit ?& array['permit_id','actor_member_id','owner_member_id','site_id','central_session_id','operation_id','body_sha256','relationship_revision','authorized_at','expires_at']) then return jsonb_build_object('failure','BAD_REQUEST');end if;
  if (permit->>'actor_member_id')::uuid is distinct from actor or (permit->>'site_id')::uuid is distinct from cfg.site_id or (permit->>'central_session_id')::uuid is distinct from s.central_session_id or (permit->>'operation_id')::uuid is distinct from op or (permit->>'body_sha256') is distinct from fingerprint or (permit->>'owner_member_id')::uuid is null or (permit->>'owner_member_id')::uuid=actor or (permit->>'permit_id')::uuid is null or coalesce((permit->>'relationship_revision')::bigint,0)<1 then return jsonb_build_object('failure','TARGET_MISMATCH');end if;
  auth_time:=(permit->>'authorized_at')::timestamptz;deadline:=(permit->>'expires_at')::timestamptz;
  if auth_time is null or deadline is null or deadline<=auth_time or deadline>auth_time+interval '30 seconds' or auth_time>clock_timestamp()+interval '5 seconds' then return jsonb_build_object('failure','IDENTITY_UNAVAILABLE');end if;
  if deadline>s.expires_at or (fid is not null and deadline>f.expires_at) then return jsonb_build_object('failure','TARGET_MISMATCH');end if;
  if exists(select 1 from private.friend_review_operations where permit_id=(permit->>'permit_id')::uuid) then return jsonb_build_object('failure','REQUEST_CONFLICT');end if;
  -- Last deadline/session check is after every lock and immediately before INSERT.
  if deadline<=clock_timestamp() then return jsonb_build_object('failure','PERMIT_EXPIRED');end if;
  if s.expires_at<=clock_timestamp() or (fid is not null and f.expires_at<=clock_timestamp()) then return jsonb_build_object('failure','SESSION_EXPIRED');end if;
  insert into private.friend_reviews(site_id,author_member_id,display_name,body) values(cfg.site_id,actor,s.display_name,p_args->>'body') returning id into resource;
 else
  select * into item from private.friend_reviews where id=resource and site_id=cfg.site_id for update;
  if not found or (mode<>'owner' and item.author_member_id<>actor) then return jsonb_build_object('failure','NOT_FOUND');end if;
  if mode='member' and (s.expires_at<=clock_timestamp() or (fid is not null and f.expires_at<=clock_timestamp())) then return jsonb_build_object('failure','SESSION_EXPIRED');end if;
  v_bucket:='delete:'||cfg.site_id::text||':'||mode||':'||actor::text;win:=date_trunc('minute',clock_timestamp());
  insert into private.friend_review_limits values(v_bucket,win,1) on conflict(bucket,window_start) do update set count=private.friend_review_limits.count+1 returning count into used;
  if used>30 then raise exception 'RATE_LIMITED' using errcode='P0001';end if;
  delete from private.friend_reviews where id=resource;
 end if;
 insert into private.friend_review_operations(site_id,actor_kind,actor_id,operation_id,action,fingerprint,review_id,permit_id,owner_member_id,central_session_id,relationship_revision,authorized_at,expires_at)
 values(cfg.site_id,mode,actor,op,p_action,fingerprint,resource,(permit->>'permit_id')::uuid,(permit->>'owner_member_id')::uuid,(permit->>'central_session_id')::uuid,(permit->>'relationship_revision')::bigint,auth_time,deadline);
 return jsonb_build_object('id',resource,'action',p_action,'operation_id',op,'deleted',p_action='delete','replayed',false);
exception
 when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then return jsonb_build_object('failure','BAD_REQUEST');
 when unique_violation then return jsonb_build_object('failure','REQUEST_CONFLICT');
 when raise_exception then if sqlerrm='RATE_LIMITED' then return jsonb_build_object('failure','RATE_LIMITED','retry_after',60);else raise;end if;
end;
$$;
revoke all on function public.member_friend_reviews(text,jsonb) from public,anon,authenticated;
grant execute on function public.member_friend_reviews(text,jsonb) to service_role;
commit;
