-- Safeguards for the tables added in 0001 (registers, change requests, settings, releases).
-- Runs after 9999_rls_triggers.sql (sorts after it), on fresh and existing databases alike.

do $$
declare t text;
begin
  foreach t in array array[
    'settings','change_requests','engagement_releases','workers',
    'child_dedications','baptisms','marriages','record_files'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy parish_scope on %I using (parish_id = any (app_parish_ids())) with check (parish_id = any (app_parish_ids()))', t);
  end loop;
end $$;

-- change_request_events inherit scope from their request.
alter table change_request_events enable row level security;
alter table change_request_events force row level security;
create policy parish_scope on change_request_events
  using (exists (select 1 from change_requests r where r.id = request_id and r.parish_id = any (app_parish_ids())))
  with check (exists (select 1 from change_requests r where r.id = request_id and r.parish_id = any (app_parish_ids())));

create trigger change_request_events_append_only before update or delete on change_request_events
  for each row execute function forbid_change();

-- Change requests may never be deleted (rejected ones stay in the history).
create or replace function forbid_delete() returns trigger language plpgsql as $$
begin raise exception '% est en ajout seul', tg_table_name; end $$;
create trigger change_requests_no_delete before delete on change_requests
  for each row execute function forbid_delete();

-- Automatic reference for change requests: DEM-KIN01-2026-000012 (separate counter from the ledger).
create table if not exists request_counters (
  parish_id uuid not null, year int not null, last_value int not null default 0,
  primary key (parish_id, year)
);
create or replace function next_request_reference(p_parish uuid, p_year int) returns text
language plpgsql as $$
declare v int; c text;
begin
  insert into request_counters as r (parish_id, year, last_value) values (p_parish, p_year, 1)
  on conflict (parish_id, year) do update set last_value = r.last_value + 1
  returning last_value into v;
  select code into c from parishes where id = p_parish;
  return 'DEM-' || c || '-' || p_year || '-' || lpad(v::text, 6, '0');
end $$;

-- Validated (and cancelled) entries stay frozen, except:
--  * reconciliation stamping, and
--  * changes executed by an approved change request (the application sets app.change_request_exec
--    for the duration of that single transaction; every such change is audited).
create or replace function guard_transactions() returns trigger
language plpgsql as $$
declare
  target record;
  closed boolean;
  executing boolean := coalesce(current_setting('app.change_request_exec', true), '') = 'on';
begin
  if tg_op = 'DELETE' then target := old; else target := new; end if;

  if tg_op in ('UPDATE','DELETE') and old.status in ('validee','annulee') then
    if tg_op = 'UPDATE' and (to_jsonb(new) - 'reconciled_at') = (to_jsonb(old) - 'reconciled_at') then
      return new;
    end if;
    if tg_op = 'UPDATE' and executing then
      return new;
    end if;
    raise exception 'Écriture validée: modification ou suppression interdite (utiliser une demande de modification/annulation)';
  end if;

  select exists (
    select 1 from periods p
    where p.parish_id = target.parish_id
      and p.year = extract(year from target.date)
      and p.month = extract(month from target.date)
      and p.closed_at is not null
  ) into closed;
  if closed and not executing then
    raise exception 'Période clôturée: aucune écriture possible';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
