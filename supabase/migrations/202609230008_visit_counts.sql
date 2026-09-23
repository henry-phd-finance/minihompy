begin;
create table if not exists private.visit_total(singleton boolean primary key default true check(singleton),total bigint not null default 0 check(total between 0 and 9007199254740991),window_start timestamptz,requests integer not null default 0,new_visits integer not null default 0,cleaned_on date);
insert into private.visit_total(singleton) values(true) on conflict do nothing;
create table if not exists private.visit_days(day date primary key,total bigint not null check(total between 0 and 9007199254740991));
create table if not exists private.visit_keys(day date not null,digest text not null check(digest ~ '^[0-9a-f]{64}$'),window_start timestamptz not null,requests integer not null,primary key(day,digest));
revoke all on private.visit_total,private.visit_days,private.visit_keys from public,anon,authenticated,service_role;
alter table private.visit_total enable row level security;
alter table private.visit_days enable row level security;
alter table private.visit_keys enable row level security;

create or replace function private.visit_stats_at(p_now timestamptz) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('version',1,'date',(p_now at time zone 'Asia/Seoul')::date,'timezone','Asia/Seoul','today',coalesce((select total from private.visit_days where day=(p_now at time zone 'Asia/Seoul')::date),0),'total',(select total from private.visit_total where singleton))
$$;
revoke all on function private.visit_stats_at(timestamptz) from public,anon,authenticated,service_role;
create or replace function public.visit_stats() returns jsonb language sql stable security definer set search_path='' as $$select private.visit_stats_at(statement_timestamp())$$;
revoke all on function public.visit_stats() from public,anon,authenticated;
grant execute on function public.visit_stats() to service_role;

create or replace function private.visit_record_at(p_day date,p_digest text,p_now timestamptz) returns jsonb
language plpgsql set search_path='' as $$
declare d date:=(p_now at time zone 'Asia/Seoul')::date; minute timestamptz:=date_trunc('minute',p_now); t private.visit_total; k private.visit_keys; existing boolean;
begin
 if p_day is null or p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then raise exception 'Invalid visit' using errcode='22023';end if;
 if p_day<>d then return jsonb_build_object('failure','DAY_CHANGED');end if;
 -- One short transaction serializes counters and deduplication across workers.
 select * into t from private.visit_total where singleton for update;
 if t.cleaned_on is distinct from d then
  delete from private.visit_keys where day<d-2;
  update private.visit_total set cleaned_on=d where singleton;
 end if;
 if t.window_start is distinct from minute then
  update private.visit_total set window_start=minute,requests=0,new_visits=0 where singleton;
  t.requests:=0;t.new_visits:=0;
 end if;
 if t.requests>=600 then return jsonb_build_object('failure','RATE_LIMITED');end if;
 update private.visit_total set requests=requests+1 where singleton;
 select * into k from private.visit_keys where day=d and digest=p_digest;existing:=found;
 if existing then
  if k.window_start=minute and k.requests>=60 then return jsonb_build_object('failure','RATE_LIMITED');end if;
  update private.visit_keys set window_start=minute,requests=case when window_start=minute then requests+1 else 1 end where day=d and digest=p_digest;
 else
  if t.new_visits>=120 then return jsonb_build_object('failure','RATE_LIMITED');end if;
  if t.total>=9007199254740991 then raise exception 'Visit counter capacity reached' using errcode='22003';end if;
  insert into private.visit_keys values(d,p_digest,minute,1);
  insert into private.visit_days values(d,1) on conflict(day) do update set total=private.visit_days.total+1;
  update private.visit_total set total=total+1,new_visits=new_visits+1 where singleton;
 end if;
 return private.visit_stats_at(p_now)||jsonb_build_object('counted',not existing);
end;
$$;
revoke all on function private.visit_record_at(date,text,timestamptz) from public,anon,authenticated,service_role;
create or replace function public.visit_record(p_day date,p_digest text) returns jsonb language sql security definer set search_path='' as $$select private.visit_record_at(p_day,p_digest,clock_timestamp())$$;
revoke all on function public.visit_record(date,text) from public,anon,authenticated;
grant execute on function public.visit_record(date,text) to service_role;
commit;
