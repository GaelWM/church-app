-- Safeguards for the inventory tables added in 0004. Runs after 9999d on fresh and existing databases alike.

alter table asset_inventories enable row level security;
alter table asset_inventories force row level security;
create policy parish_scope on asset_inventories
  using (parish_id = any (app_parish_ids())) with check (parish_id = any (app_parish_ids()));

-- Lines inherit their scope from their inventory.
alter table asset_inventory_lines enable row level security;
alter table asset_inventory_lines force row level security;
create policy parish_scope on asset_inventory_lines
  using (exists (select 1 from asset_inventories i where i.id = inventory_id and i.parish_id = any (app_parish_ids())))
  with check (exists (select 1 from asset_inventories i where i.id = inventory_id and i.parish_id = any (app_parish_ids())));

-- INV-KIN01-2026-000001: per parish and year, like the ledger and request references (and, like them, no RLS on the counter).
create table if not exists inventory_counters (
  parish_id uuid not null, year int not null, last_value int not null default 0,
  primary key (parish_id, year)
);
create or replace function next_inventory_reference(p_parish uuid, p_year int) returns text
language plpgsql as $$
declare v int; c text;
begin
  insert into inventory_counters as r (parish_id, year, last_value) values (p_parish, p_year, 1)
  on conflict (parish_id, year) do update set last_value = r.last_value + 1
  returning last_value into v;
  select code into c from parishes where id = p_parish;
  return 'INV-' || c || '-' || p_year || '-' || lpad(v::text, 6, '0');
end $$;

-- An inventory is never deleted, and once closed it never changes.
create trigger asset_inventories_no_delete before delete on asset_inventories
  for each row execute function forbid_delete();

create or replace function guard_asset_inventories() returns trigger
language plpgsql as $$
begin
  if old.status = 'cloture' then
    raise exception 'Inventaire clôturé: modification interdite';
  end if;
  if new.id <> old.id or new.parish_id <> old.parish_id or new.reference <> old.reference
     or new.created_by <> old.created_by or new.started_on <> old.started_on
     or new.location_id is distinct from old.location_id then
    raise exception 'Identité de l''inventaire non modifiable';
  end if;
  return new;
end $$;
create trigger asset_inventories_guard before update on asset_inventories
  for each row execute function guard_asset_inventories();

-- Lines: frozen with their inventory; the théorique (what the register said at the start) is never rewritten, and a
-- line of the théorique is never removed (only a find that is not in the register can be taken back).
create or replace function guard_asset_inventory_lines() returns trigger
language plpgsql as $$
declare inv_status text;
begin
  select status into inv_status from asset_inventories where id = coalesce(new.inventory_id, old.inventory_id);
  if inv_status = 'cloture' then
    raise exception 'Inventaire clôturé: modification interdite';
  end if;
  if tg_op = 'UPDATE' and (
       new.inventory_id <> old.inventory_id or new.asset_id is distinct from old.asset_id
       or new.expected_code is distinct from old.expected_code or new.expected_description is distinct from old.expected_description
       or new.expected_location_id is distinct from old.expected_location_id or new.expected_etat is distinct from old.expected_etat) then
    raise exception 'Situation théorique de l''inventaire non modifiable';
  end if;
  if tg_op = 'DELETE' and old.asset_id is not null then
    raise exception 'Une ligne de la situation théorique ne peut pas être supprimée';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger asset_inventory_lines_guard before insert or update or delete on asset_inventory_lines
  for each row execute function guard_asset_inventory_lines();
