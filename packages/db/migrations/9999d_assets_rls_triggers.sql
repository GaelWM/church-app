-- Safeguards for the Immobilisations tables added in 0003 (spec "Compta CEPD MBUDI").
-- Runs after 9999c (it sorts after it) on fresh and existing databases alike.
-- Do NOT create a policy on fixed_assets here: 9999c already did, and 0003 only altered the table.

-- Seeds below write into forced-RLS tables as the owner, so scope this transaction to every parish.
select set_config('app.parish_ids', coalesce((select string_agg(id::text, ',') from parishes), ''), true);

-- ---- Row-level security on the new tables -------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'asset_code_prefixes','asset_locations','asset_suppliers','asset_requests','asset_condition_history'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy parish_scope on %I using (parish_id = any (app_parish_ids())) with check (parish_id = any (app_parish_ids()))', t);
  end loop;
end $$;

-- asset_request_events inherit their scope from the request.
alter table asset_request_events enable row level security;
alter table asset_request_events force row level security;
create policy parish_scope on asset_request_events
  using (exists (select 1 from asset_requests r where r.id = request_id and r.parish_id = any (app_parish_ids())))
  with check (exists (select 1 from asset_requests r where r.id = request_id and r.parish_id = any (app_parish_ids())));

-- ---- Append-only history ------------------------------------------------------------------------------
-- (forbid_change / forbid_delete come from 9999 and 9999b.) The état history, the request events and the
-- requests themselves can never be rewritten or deleted, even by the table owner.
create trigger asset_condition_history_append_only before update or delete on asset_condition_history
  for each row execute function forbid_change();
create trigger asset_request_events_append_only before update or delete on asset_request_events
  for each row execute function forbid_change();
create trigger asset_requests_no_delete before delete on asset_requests
  for each row execute function forbid_delete();

-- ---- Asset codes: "MI 202610 00001" -------------------------------------------------------------------
-- The previous IMMO-NNN counter is replaced. (On a fresh database 9999c has just created it.)
drop function if exists next_asset_code(uuid);
drop table if exists asset_counters;

-- One sequence per (parish, acronym, month); like the other counters it has no RLS.
create table if not exists asset_code_counters (
  parish_id uuid not null, acronym text not null, period text not null, last_value int not null default 0,
  primary key (parish_id, acronym, period)
);

-- Atomic: concurrent callers serialize on the counter row and a rollback undoes the increment. A code that is already taken
-- (an exceptional, approved code change can move an asset onto a future number) is skipped, so creation never gets stuck on it.
-- The sequence is zero-padded to 5 digits and simply grows past 99999 (lpad would truncate it).
create or replace function next_asset_code(p_parish uuid, p_acronym text, p_period text) returns text
language plpgsql as $$
declare v int; candidate text;
begin
  loop
    insert into asset_code_counters as r (parish_id, acronym, period, last_value) values (p_parish, p_acronym, p_period, 1)
    on conflict (parish_id, acronym, period) do update set last_value = r.last_value + 1
    returning last_value into v;
    candidate := p_acronym || ' ' || p_period || ' ' || case when v < 100000 then lpad(v::text, 5, '0') else v::text end;
    exit when not exists (select 1 from fixed_assets where parish_id = p_parish and code = candidate);
  end loop;
  return candidate;
end $$;

-- ---- Frozen assets ------------------------------------------------------------------------------------
-- A draft (brouillon) is free to edit and delete. Any other asset is frozen: it only changes when the
-- application, inside the single transaction that executes an approved request, sets app.asset_request_exec
-- (every such change is audited), or when the état is synchronised from the history (trigger below).
create or replace function guard_fixed_assets() returns trigger
language plpgsql as $$
declare
  executing boolean := coalesce(current_setting('app.asset_request_exec', true), '') = 'on';
  etat_sync boolean := coalesce(current_setting('app.asset_etat_sync', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.statut <> 'brouillon' and not executing then
      raise exception 'Une immobilisation est créée en brouillon';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.statut = 'brouillon' then return old; end if;
    raise exception 'Immobilisation validée: suppression interdite (utiliser une demande d''annulation)';
  end if;

  if new.id <> old.id or new.parish_id <> old.parish_id or new.created_by <> old.created_by
     or new.registered_at <> old.registered_at then
    raise exception 'Identité de l''immobilisation non modifiable';
  end if;
  if old.statut = 'brouillon' then
    -- A draft is free to edit, but it only leaves that state by being submitted or abandoned: becoming "actif" (or anything else)
    -- is the execution of an approved request.
    if new.statut not in ('brouillon', 'en_attente_validation', 'annule') and not executing then
      raise exception 'Immobilisation validée: modification interdite (seule une demande approuvée valide une immobilisation)';
    end if;
    return new;
  end if;
  if executing then return new; end if;
  -- cost_minor is a generated column: Postgres computes it after BEFORE triggers, so NEW still holds a stale value here.
  if etat_sync and (to_jsonb(new) - 'etat' - 'updated_at' - 'cost_minor') = (to_jsonb(old) - 'etat' - 'updated_at' - 'cost_minor') then
    return new;
  end if;
  raise exception 'Immobilisation validée: modification interdite (utiliser une demande de modification)';
end $$;

create trigger fixed_assets_guard before insert or update or delete on fixed_assets
  for each row execute function guard_fixed_assets();

-- "L'état actuel affiché sur la fiche doit toujours correspondre au dernier état enregistré": the état on the
-- asset is only ever written from the history, by this trigger.
create or replace function sync_asset_etat() returns trigger
language plpgsql as $$
begin
  perform set_config('app.asset_etat_sync', 'on', true);
  update fixed_assets set etat = new.new_etat, updated_at = now() where id = new.asset_id;
  perform set_config('app.asset_etat_sync', 'off', true);
  return new;
end $$;

-- Entering or leaving Déclassé / Perdu is a sensitive change: it exists in the history only as the outcome of an approved request.
alter table asset_condition_history add constraint ach_sensitive_needs_request
  check (new_etat in ('bon', 'mauvais') or request_id is not null);

create trigger asset_condition_history_sync after insert on asset_condition_history
  for each row execute function sync_asset_etat();

-- ---- Seeds for the parishes that already exist --------------------------------------------------------
-- (New parishes are seeded by the application; the lists mirror packages/shared/src/asset-defaults.ts.
-- TE, BA, IN, IF, MS and AM are proposals: the client's spec only defines MB, MT, MI and MO.)
insert into asset_code_prefixes (parish_id, acronym, label, subaccount_codes)
select p.id, v.acronym, v.label, v.codes
from parishes p
cross join (values
  ('MB', 'Mobilier de bureau', array['24.4']),
  ('MT', 'Matériel de transport', array['24.2']),
  ('MI', 'Matériel informatique', array['24.5']),
  ('MO', 'Mobilier et objets de culte', array['24.4']),
  ('MS', 'Matériel technique et sonorisation', array['24.1']),
  ('TE', 'Terrains', array['22.1','22.2','22.3','22.8']),
  ('BA', 'Bâtiments et agencements', array['23.1','23.2','23.3','23.4']),
  ('IN', 'Immobilisations incorporelles', array['21.1','21.2','21.3']),
  ('IF', 'Immobilisations financières', array['27.4','27.5']),
  ('AM', 'Amortissements', array['28.1','28.2','28.4'])
) as v(acronym, label, codes)
on conflict (parish_id, acronym) do nothing;

insert into asset_locations (parish_id, name, sort_order)
select p.id, v.name, v.ord
from parishes p
cross join (values
  ('Temple principal', 1), ('Bureau pastoral', 2), ('Administration', 3), ('Presbytère', 4), ('École', 5),
  ('Salle de réunion', 6), ('Département', 7), ('Entrepôt', 8), ('Autre site', 9)
) as v(name, ord)
on conflict (parish_id, lower(name)) do nothing;
