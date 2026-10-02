-- Safeguards for the tables added in 0002 (budget, fixed assets, newcomers).
-- Runs after 9999b_workflows_rls.sql (sorts after it), on fresh and existing databases alike.

do $$
declare t text;
begin
  foreach t in array array[
    'budget_expense_lines','budget_investments','fixed_assets','newcomers'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy parish_scope on %I using (parish_id = any (app_parish_ids())) with check (parish_id = any (app_parish_ids()))', t);
  end loop;
end $$;

-- Asset register codes: IMMO-001, IMMO-002 ... (per parish, never reset by year).
create table if not exists asset_counters (
  parish_id uuid primary key, last_value int not null default 0
);
create or replace function next_asset_code(p_parish uuid) returns text
language plpgsql as $$
declare v int;
begin
  insert into asset_counters as r (parish_id, last_value) values (p_parish, 1)
  on conflict (parish_id) do update set last_value = r.last_value + 1
  returning last_value into v;
  return 'IMMO-' || case when v < 1000 then lpad(v::text, 3, '0') else v::text end;
end $$;
