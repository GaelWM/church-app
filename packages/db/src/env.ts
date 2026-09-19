/**
 * Fail fast with an actionable message instead of letting postgres.js silently fall back to
 * localhost:5432 when DATABASE_URL is empty (which is what an unset GitHub secret produces).
 */
export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error(
      [
        "✖ DATABASE_URL is not set (or is empty).",
        "  Local:  run `bun run dev:setup`, or export DATABASE_URL=postgres://…",
        "  CI:     add the secret DATABASE_URL under GitHub → Settings → Environments → <staging|production> → Secrets",
        "          (the Neon *direct* connection string of the owner role).",
      ].join("\n"),
    );
    process.exit(1);
  }
  return url;
}
