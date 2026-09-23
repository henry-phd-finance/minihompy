begin;
create table private.member_writing_families (
 id uuid primary key default gen_random_uuid(),
 site_id uuid not null references private.member_writing_site(site_id),
 member_id uuid not null, central_session_id uuid not null, proof_id uuid not null unique,
 renewal_hash text not null unique check(renewal_hash ~ '^[0-9a-f]{64}$'),
 central_delegation text not null unique check(central_delegation ~ '^[A-Za-z0-9_-]{43}$'),
 issued_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 revoked_at timestamptz, cleanup_pending boolean not null default false,
 check(expires_at>issued_at)
);
alter table private.member_writing_families enable row level security;
revoke all on private.member_writing_families from public,anon,authenticated,service_role;
create index member_writing_families_central on private.member_writing_families(central_session_id);
alter table private.member_writing_sessions drop constraint member_writing_sessions_proof_id_key;
alter table private.member_writing_sessions add column family_id uuid references private.member_writing_families(id);
create unique index member_writing_v1_proof on private.member_writing_sessions(proof_id) where family_id is null;
create index member_writing_sessions_family on private.member_writing_sessions(family_id);

alter function public.member_writing_session(text,jsonb) rename to member_writing_session_v1;
-- Only the wrapper is an externally callable session API.
revoke all on function public.member_writing_session_v1(text,jsonb) from public,anon,authenticated,service_role;
create function public.member_writing_session(p_action text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg private.member_writing_site; f private.member_writing_families; s private.member_writing_sessions; fid uuid;
begin
 select * into cfg from private.member_writing_site where singleton;
 if cfg.site_id is null then return jsonb_build_object('failure','NOT_CONFIGURED'); end if;
 if p_action='site' then return to_jsonb(cfg); end if;
 if cfg.site_id is distinct from (p_args->>'site_id')::uuid then return jsonb_build_object('failure','TARGET_MISMATCH'); end if;
 if p_action in ('family','renew_create','cleanup_done') then
  select id into fid from private.member_writing_families where site_id=cfg.site_id and renewal_hash=p_args->>'renewal_hash';
  if not found then return jsonb_build_object('failure','AUTH_REQUIRED'); end if;
 elsif p_action in ('current','revoke') then
  select family_id into fid from private.member_writing_sessions where site_id=cfg.site_id and token_hash=p_args->>'token_hash';
  if fid is null and p_action='revoke' then
   select id into fid from private.member_writing_families where site_id=cfg.site_id and renewal_hash=p_args->>'token_hash';
  end if;
 end if;
 -- Lock family BEFORE session rows for every v2 path. Content RPCs lock only
 -- session rows, so revoke can mark all tokens without inverted lock ordering.
 if fid is not null then
  select * into f from private.member_writing_families where id=fid for update;
  if p_action='revoke' then
   update private.member_writing_families set revoked_at=coalesce(revoked_at,clock_timestamp()),cleanup_pending=true where id=f.id returning * into f;
   update private.member_writing_sessions set revoked_at=coalesce(revoked_at,clock_timestamp()) where family_id=f.id;
   return to_jsonb(f);
  end if;
  if p_action='cleanup_done' then
   update private.member_writing_families set cleanup_pending=false where id=f.id and revoked_at is not null;
   return jsonb_build_object('cleaned',true);
  end if;
  if f.revoked_at is not null then return jsonb_build_object('failure','SESSION_REVOKED'); end if;
  if f.expires_at<=clock_timestamp() then return jsonb_build_object('failure','SESSION_EXPIRED'); end if;
  if p_action='family' then return to_jsonb(f); end if;
 end if;
 if p_action='create_v2' then
  if (p_args->>'expires_at')::timestamptz > (p_args->>'renewal_expires_at')::timestamptz then return jsonb_build_object('failure','SESSION_EXPIRED'); end if;
  insert into private.member_writing_families(site_id,member_id,central_session_id,proof_id,renewal_hash,central_delegation,expires_at)
  values(cfg.site_id,(p_args->>'member_id')::uuid,(p_args->>'central_session_id')::uuid,(p_args->>'proof_id')::uuid,p_args->>'renewal_hash',p_args->>'central_delegation',(p_args->>'renewal_expires_at')::timestamptz) returning * into f;
 elsif p_action='renew_create' then
  if f.member_id is distinct from (p_args->>'member_id')::uuid or f.central_session_id is distinct from (p_args->>'central_session_id')::uuid or f.proof_id is distinct from (p_args->>'proof_id')::uuid then return jsonb_build_object('failure','FORBIDDEN'); end if;
  if (p_args->>'expires_at')::timestamptz>f.expires_at then return jsonb_build_object('failure','SESSION_EXPIRED'); end if;
  -- Renewals may leave old still-valid tokens usable; family revoke disables all.
  delete from private.member_writing_sessions where family_id=f.id and expires_at<=clock_timestamp();
 end if;
 if p_action in ('create_v2','renew_create') then
  insert into private.member_writing_sessions(id,site_id,member_id,central_session_id,proof_id,token_hash,central_grant,display_name,homepage_url,expires_at,family_id)
  values(gen_random_uuid(),cfg.site_id,f.member_id,f.central_session_id,f.proof_id,p_args->>'token_hash',p_args->>'central_grant',p_args->>'display_name',p_args->>'homepage_url',(p_args->>'expires_at')::timestamptz,f.id) returning * into s;
  if s.expires_at<=clock_timestamp() then raise exception 'Expired session' using errcode='23514'; end if;
  return to_jsonb(s);
 end if;
 if p_action in ('create','current','revoke') then return public.member_writing_session_v1(p_action,p_args); end if;
 return jsonb_build_object('failure','BAD_REQUEST');
end;
$$;
revoke all on function public.member_writing_session(text,jsonb) from public,anon,authenticated;
grant execute on function public.member_writing_session(text,jsonb) to service_role;
commit;
