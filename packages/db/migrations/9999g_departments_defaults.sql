-- Default départements for every existing parish, including "Affermissement" (client request of 11/10/2026).
-- New parishes get them from seedDepartmentDefaults; this list mirrors DEFAULT_DEPARTMENTS in @church/shared.
-- Names are compared without case or accents, so a parish that already has "Écodim" does not get "Ecodim" too.

-- departments has forced RLS and this runs as the owner: scope the transaction to every parish.
select set_config('app.parish_ids', coalesce((select string_agg(id::text, ',') from parishes), ''), true);

insert into departments (parish_id, name)
select p.id, v.name
from parishes p
cross join (values
  (1, 'Intercession'), (2, 'Evangélisation'), (3, 'Chorale'), (4, 'Protocole'), (5, 'Ecodim'), (6, '13-17'),
  (7, 'Jeunesse'), (8, 'Grand jeune'), (9, 'Partenariat'), (10, 'Femme'), (11, 'Nettoyage et décoration'),
  (12, 'Social'), (13, 'Secrétariat & adm'), (14, 'Affermissement')
) as v(ord, name)
where not exists (
  select 1 from departments d
  where d.parish_id = p.id
    and translate(lower(trim(d.name)), 'éèêëàâäîïôöùûüç', 'eeeeaaaiioouuuc') = translate(lower(v.name), 'éèêëàâäîïôöùûüç', 'eeeeaaaiioouuuc')
)
order by p.id, v.ord;
