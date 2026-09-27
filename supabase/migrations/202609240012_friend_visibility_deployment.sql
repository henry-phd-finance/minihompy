-- Privileged installer epoch: invalidate activation already in flight when preparing/recovering.
begin;
create table private.friend_visibility_deployment (
 singleton boolean primary key default true check(singleton),
 epoch uuid not null default gen_random_uuid(),
 pages_sha256 text check(pages_sha256 is null or pages_sha256 ~ '^[a-f0-9]{64}$'),
 changed_at timestamptz not null default clock_timestamp()
);
insert into private.friend_visibility_deployment default values;
alter table private.friend_visibility_deployment enable row level security;
revoke all on private.friend_visibility_deployment from public,anon,authenticated,service_role;
commit;
