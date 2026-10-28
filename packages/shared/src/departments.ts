/** Départements seeded for every parish (migration 9999g seeds existing parishes; seedDepartmentDefaults new ones). */
export const DEFAULT_DEPARTMENTS: readonly string[] = [
  "Intercession", "Evangélisation", "Chorale", "Protocole", "Ecodim", "13-17", "Jeunesse", "Grand jeune",
  "Partenariat", "Femme", "Nettoyage et décoration", "Social", "Secrétariat & adm", "Affermissement",
];

/** Compare department names without case or accents, so « Écodim » and « Ecodim » are the same department. */
export const normalizeDepartmentName = (name: string) =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
