begin;
create table public.home_greeting_history (
 id uuid primary key default gen_random_uuid(),
 body text not null,
 recorded_at timestamptz not null default clock_timestamp(),
 is_initial boolean not null default false
);
create index home_greeting_history_page on public.home_greeting_history(recorded_at desc,id desc);
alter table public.home_greeting_history enable row level security;
revoke all on public.home_greeting_history from public,anon,authenticated;
grant select on public.home_greeting_history to anon,authenticated;
grant delete on public.home_greeting_history to authenticated;
create policy home_greeting_history_read on public.home_greeting_history for select to anon,authenticated using(true);
create policy home_greeting_history_delete on public.home_greeting_history for delete to authenticated
 using((select public.is_minihompy_admin()));

-- This timestamp is the start of recording, not an invented historic edit date.
insert into public.home_greeting_history(body,is_initial)
 select payload#>>'{profile,introduction}',true from public.minihompy_settings;
create function private.record_home_greeting_history() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' or (new.payload#>>'{profile,introduction}') is distinct from (old.payload#>>'{profile,introduction}') then
  insert into public.home_greeting_history(body) values(new.payload#>>'{profile,introduction}');
 end if;
 return new;
end;
$$;
revoke all on function private.record_home_greeting_history() from public,anon,authenticated;
create trigger record_home_greeting_history after insert or update on public.minihompy_settings
 for each row execute function private.record_home_greeting_history();
commit;
