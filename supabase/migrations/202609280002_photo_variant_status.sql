begin;
create function public.photo_variant_status() returns jsonb
language sql security definer set search_path='' as $$
 select case when exists(select 1 from private.photo_media_state where singleton and mode='protected' and ready)
  and to_regclass('private.photo_asset_variants') is not null
  and to_regprocedure('public.photo_variant(text,jsonb)') is not null
 then '{"photo_variant_protocol":1,"photo_variant_recipe":"display-v1"}'::jsonb else '{}'::jsonb end
$$;
revoke all on function public.photo_variant_status() from public,anon,authenticated,service_role;
grant execute on function public.photo_variant_status() to service_role;
commit;
