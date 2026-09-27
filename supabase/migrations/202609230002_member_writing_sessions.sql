begin;
-- The Edge Function is the only caller. Private tables retain no direct service
-- grants. Site configuration must first be provisioned by trusted migration SQL.
create function public.member_writing_session(p_action text, p_args jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cfg private.member_writing_site; s private.member_writing_sessions;
begin
  select * into cfg from private.member_writing_site where singleton;
  if cfg.site_id is null then return jsonb_build_object('failure','NOT_CONFIGURED'); end if;
  if p_action='site' then return to_jsonb(cfg); end if;
  if cfg.site_id is distinct from (p_args->>'site_id')::uuid then return jsonb_build_object('failure','TARGET_MISMATCH'); end if;
  if p_action='create' then
    insert into private.member_writing_sessions(id,site_id,member_id,central_session_id,proof_id,token_hash,central_grant,display_name,homepage_url,expires_at)
    values(gen_random_uuid(),cfg.site_id,(p_args->>'member_id')::uuid,(p_args->>'central_session_id')::uuid,(p_args->>'proof_id')::uuid,
      p_args->>'token_hash',p_args->>'central_grant',p_args->>'display_name',p_args->>'homepage_url',(p_args->>'expires_at')::timestamptz)
    returning * into s;
    if s.expires_at<=clock_timestamp() then raise exception 'Expired session' using errcode='23514'; end if;
    return to_jsonb(s);
  end if;
  if p_action not in ('current','revoke') then return jsonb_build_object('failure','BAD_REQUEST'); end if;
  select * into s from private.member_writing_sessions where token_hash=p_args->>'token_hash' and site_id=cfg.site_id for update;
  if not found then return jsonb_build_object('failure','AUTH_REQUIRED'); end if;
  -- Return the grant to the trusted Edge caller on repeated revoke too: a failed
  -- central revocation can be retried after the local session is already disabled.
  if p_action='revoke' then
    update private.member_writing_sessions set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=s.id returning * into s;
    return to_jsonb(s);
  end if;
  if s.revoked_at is not null then return jsonb_build_object('failure','SESSION_REVOKED'); end if;
  if s.expires_at<=clock_timestamp() then return jsonb_build_object('failure','SESSION_EXPIRED'); end if;
  return to_jsonb(s);
end;
$$;
revoke all on function public.member_writing_session(text,jsonb) from public,anon,authenticated;
grant execute on function public.member_writing_session(text,jsonb) to service_role;
commit;
