-- Foundation only. No member write endpoint or browser grants are enabled here.
begin;

alter table public.guestbook_posts
  add column author_kind text not null default 'local',
  add column author_member_id uuid,
  add column author_homepage_url text,
  add constraint guestbook_author_identity check (
    (author_kind = 'local' and author_member_id is null and author_homepage_url is null)
    or (author_kind = 'member' and author_id is null and author_member_id is not null
        and author_homepage_url is not null
        and length(author_homepage_url) between 10 and 2048
        and author_homepage_url ~ '^https://[^[:space:]]+$')
  );
alter table public.post_comments
  add column author_kind text not null default 'local',
  add column author_member_id uuid,
  add column author_homepage_url text,
  add constraint comment_author_identity check (
    (author_kind = 'local' and author_member_id is null and author_homepage_url is null)
    or (author_kind = 'member' and author_id is null and author_member_id is not null
        and author_homepage_url is not null
        and length(author_homepage_url) between 10 and 2048
        and author_homepage_url ~ '^https://[^[:space:]]+$')
  );
-- No FK to local auth.users: a central member is a different identity namespace.
-- Local author_id may already be NULL after deletion of a local auth account.
create index guestbook_member_author on public.guestbook_posts(author_member_id, created_at desc, id)
  where author_kind = 'member';
create index comments_member_author on public.post_comments(author_member_id, created_at, id)
  where author_kind = 'member';

-- Existing column INSERT/UPDATE grants remain unchanged. Restrictive policies also
-- prevent the old administrator/anonymous paths from mutating a member-owned row.
create policy guestbook_local_insert_only on public.guestbook_posts as restrictive
  for insert to authenticated with check (author_kind = 'local');
create policy guestbook_local_update_only on public.guestbook_posts as restrictive
  for update to authenticated using (author_kind = 'local') with check (author_kind = 'local');
create policy guestbook_local_delete_only on public.guestbook_posts as restrictive
  for delete to authenticated using (author_kind = 'local');
create policy comments_local_insert_only on public.post_comments as restrictive
  for insert to authenticated with check (author_kind = 'local');
create policy comments_local_update_only on public.post_comments as restrictive
  for update to authenticated using (author_kind = 'local') with check (author_kind = 'local');
create policy comments_local_delete_only on public.post_comments as restrictive
  for delete to authenticated using (author_kind = 'local');

-- Ownership cannot be reassigned even by a future privileged content function.
-- auth.users ON DELETE SET NULL still works for existing local authors.
create function private.keep_member_author_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.author_kind is distinct from old.author_kind
     or new.author_member_id is distinct from old.author_member_id
     or new.author_homepage_url is distinct from old.author_homepage_url
     or (old.author_kind = 'member' and (new.author_id is distinct from old.author_id
         or new.author_name is distinct from old.author_name)) then
    raise exception '작성자 식별 정보는 변경할 수 없습니다.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.keep_member_author_identity() from public, anon, authenticated;
create trigger keep_guestbook_member_author before update on public.guestbook_posts
  for each row execute function private.keep_member_author_identity();
create trigger keep_comment_member_author before update on public.post_comments
  for each row execute function private.keep_member_author_identity();

-- Empty until trusted provisioning in Step 3/7; never inferred from a browser body.
create table private.member_writing_site (
  singleton boolean primary key default true check (singleton),
  site_id uuid not null unique,
  central_api_url text not null check (central_api_url ~ '^https://[^[:space:]]+$')
);

create table private.member_writing_sessions (
  id uuid primary key,
  site_id uuid not null references private.member_writing_site(site_id),
  member_id uuid not null,
  central_session_id uuid not null,
  proof_id uuid not null unique,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Central introspection credential; NEVER returned by public RPCs or logged.
  central_grant text not null unique check (central_grant ~ '^[A-Za-z0-9_-]{43}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 20
    and display_name !~ '[[:cntrl:]]'),
  homepage_url text not null check (length(homepage_url) between 10 and 2048
    and homepage_url ~ '^https://[^[:space:]]+$'),
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > issued_at and expires_at <= issued_at + interval '15 minutes'),
  check (revoked_at is null or revoked_at >= issued_at)
);
create index member_writing_sessions_member on private.member_writing_sessions(member_id, site_id);
create index member_writing_sessions_central on private.member_writing_sessions(central_session_id);
create index member_writing_sessions_expiry on private.member_writing_sessions(expires_at);

-- Limits survive session replacement, logout and content deletion.
create table private.member_writing_limits (
  site_id uuid not null references private.member_writing_site(site_id),
  member_id uuid not null,
  kind text not null check (kind in ('guestbook', 'comment')),
  last_write timestamptz not null,
  window_start timestamptz not null,
  writes integer not null check (writes >= 0),
  primary key (site_id, member_id, kind)
);

-- Idempotency tombstones survive content deletion. No content/response plaintext.
create table private.member_writing_requests (
  site_id uuid not null references private.member_writing_site(site_id),
  member_id uuid not null,
  request_id uuid not null,
  operation text not null check (operation in (
    'guestbook.create', 'guestbook.update', 'guestbook.private', 'guestbook.delete',
    'comment.create', 'comment.update', 'comment.delete')),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  resource_id uuid not null,
  result_revision integer not null check (result_revision >= 1),
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, member_id, request_id)
);

alter table private.member_writing_site enable row level security;
alter table private.member_writing_sessions enable row level security;
alter table private.member_writing_limits enable row level security;
alter table private.member_writing_requests enable row level security;
-- Explicitly revoke Supabase default privileges too. Later SECURITY DEFINER RPCs
-- expose only checked operations to service_role; no browser or raw service DML.
revoke all on private.member_writing_site, private.member_writing_sessions,
  private.member_writing_limits, private.member_writing_requests from public, anon, authenticated, service_role;
commit;
