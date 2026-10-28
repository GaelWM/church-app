-- Baptêmes and mariages: Pasteur assistant → Pasteur titulaire circuit (columns added in 0005).
-- A draft or a rejected entry is free to edit and delete. Once submitted, only the circuit columns change:
-- the application moves the status and stamps the signatures; the entry itself is frozen.

create or replace function guard_registry_records() returns trigger
language plpgsql as $$
declare
  wf text[] := array['status','submitted_at','n1_skipped','n2_skipped','validator1_id','validator1_at',
                     'validator2_id','validator2_at','rejection_reason'];
begin
  if tg_op = 'INSERT' then
    if new.status <> 'brouillon' then raise exception 'Un enregistrement est créé en brouillon'; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status in ('brouillon', 'rejetee') then return old; end if;
    raise exception 'Enregistrement soumis ou validé: suppression interdite';
  end if;

  if new.id <> old.id or new.parish_id <> old.parish_id or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'Identité de l''enregistrement non modifiable';
  end if;
  if old.status in ('brouillon', 'rejetee') then
    -- Leaving a draft is a submission: straight to 'validee' would skip every signature.
    if new.status = 'validee' then raise exception 'Un enregistrement ne peut pas être validé sans passer par le circuit'; end if;
    return new;
  end if;
  if old.status = 'validee' and new.status not in ('validee', 'rejetee') then
    raise exception 'Un enregistrement validé ne peut qu''être renvoyé en correction';
  end if;
  if (to_jsonb(new) - wf) = (to_jsonb(old) - wf) then return new; end if;
  raise exception 'Enregistrement soumis ou validé: modification interdite';
end $$;

create trigger baptisms_guard before insert or update or delete on baptisms
  for each row execute function guard_registry_records();
create trigger marriages_guard before insert or update or delete on marriages
  for each row execute function guard_registry_records();
