-- Non-superuser application role: RLS applies to it (superusers bypass RLS).
do $$ begin
  if not exists (select from pg_roles where rolname = 'app_user') then
    create role app_user login password 'app' nosuperuser nobypassrls;
  end if;
end $$;
grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
