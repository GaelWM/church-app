-- Hand-written safeguards, applied after the drizzle-generated tables.
-- The application role must not be a superuser or BYPASSRLS; FORCE covers the table owner.

create or replace function app_parish_ids() returns uuid[]
language sql stable as $$
  select case
    when coalesce(current_setting('app.parish_ids', true), '') = '' then array[]::uuid[]
    else string_to_array(current_setting('app.parish_ids', true), ',')::uuid[]
  end
$$;

-- Row-level security: every parish-scoped table filtered by the request's parish list.
do $$
declare t text;
begin
  foreach t in array array[
    'departments','accounts','members','pledges','commitments','transactions',
    'attachments','attendance_records','periods'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy parish_scope on %I using (parish_id = any (app_parish_ids())) with check (parish_id = any (app_parish_ids()))', t);
  end loop;
end $$;

-- transaction_events inherit scope from their transaction.
alter table transaction_events enable row level security;
alter table transaction_events force row level security;
create policy parish_scope on transaction_events
  using (exists (select 1 from transactions x where x.id = transaction_id and x.parish_id = any (app_parish_ids())))
  with check (exists (select 1 from transactions x where x.id = transaction_id and x.parish_id = any (app_parish_ids())));

-- Frozen rows: validated transactions and anything in a closed period are immutable.
create or replace function guard_transactions() returns trigger
language plpgsql as $$
declare
  target record;
  closed boolean;
begin
  if tg_op = 'DELETE' then target := old; else target := new; end if;

  if tg_op in ('UPDATE','DELETE') and old.status = 'validee' then
    -- Only reconciliation stamping is allowed on validated rows.
    if tg_op = 'UPDATE' and (to_jsonb(new) - 'reconciled_at') = (to_jsonb(old) - 'reconciled_at') then
      return new;
    end if;
    raise exception 'Écriture validée: modification ou suppression interdite (utiliser une contre-passation)';
  end if;

  select exists (
    select 1 from periods p
    where p.parish_id = target.parish_id
      and p.year = extract(year from target.date)
      and p.month = extract(month from target.date)
      and p.closed_at is not null
  ) into closed;
  if closed then
    raise exception 'Période clôturée: aucune écriture possible';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger transactions_guard
  before insert or update or delete on transactions
  for each row execute function guard_transactions();

-- Audit and event history are append-only.
create or replace function forbid_change() returns trigger language plpgsql as $$
begin raise exception '% est en ajout seul', tg_table_name; end $$;

create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function forbid_change();
-- Events are append-only, except that a never-submitted draft may be deleted with its events
-- (the deletion itself is recorded in audit_log).
create or replace function guard_tx_events() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and exists (select 1 from transactions t where t.id = old.transaction_id and t.status = 'brouillon') then
    return old;
  end if;
  raise exception 'transaction_events est en ajout seul';
end $$;
create trigger tx_events_append_only before update or delete on transaction_events
  for each row execute function guard_tx_events();

-- Per-parish, per-year reference numbers: KIN01-2026-000123.
create table if not exists reference_counters (
  parish_id uuid not null, year int not null, last_value int not null default 0,
  primary key (parish_id, year)
);

create or replace function next_reference(p_parish uuid, p_year int) returns text
language plpgsql as $$
declare v int; c text;
begin
  insert into reference_counters as r (parish_id, year, last_value) values (p_parish, p_year, 1)
  on conflict (parish_id, year) do update set last_value = r.last_value + 1
  returning last_value into v;
  select code into c from parishes where id = p_parish;
  return c || '-' || p_year || '-' || lpad(v::text, 6, '0');
end $$;
