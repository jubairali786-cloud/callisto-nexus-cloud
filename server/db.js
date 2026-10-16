// Thin wrapper around Bun's built-in Postgres client.
// DATABASE_URL example: postgres://callisto:callisto@localhost:5432/callisto_cloud

const DATABASE_URL = process.env.DATABASE_URL || "postgres://callisto:callisto@localhost:5432/callisto_cloud";

export const sql = new Bun.SQL(DATABASE_URL);

export async function migrate() {
  await sql`create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())`;
  const dir = new URL("../migrations/", import.meta.url);
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const migrationsDir = fileURLToPath(dir);
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const already = await sql`select 1 from _migrations where name = ${file}`;
    if (already.length) continue;
    const text = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    console.log(`[migrate] applying ${file} ...`);
    await sql.unsafe(text);
    await sql`insert into _migrations (name) values (${file})`;
    console.log(`[migrate] applied ${file}`);
  }
}
