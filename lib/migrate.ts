// Migration runner. Reads SQL files from the migrations/ folder, tracks which
// have been applied in s2m_migrations, and runs the rest in alphabetical order.
//
// Idempotent and safe to run on every startup. Existing installs will only run
// migrations they haven't seen before.

import fs from "node:fs";
import path from "node:path";
import { query } from "@/lib/db";

interface MigrationRecord {
  id: string;
  applied_at: Date;
}

const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");

async function ensureMigrationsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS s2m_migrations (
      id          TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function listAppliedMigrations(): Promise<Set<string>> {
  const rows = await query<MigrationRecord>(
    `SELECT id FROM s2m_migrations ORDER BY id ASC`
  );
  return new Set(rows.map((r) => r.id));
}

function listMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // alphabetical = numerical for nnn_name.sql format
}

async function runMigration(filename: string): Promise<void> {
  const filepath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filepath, "utf-8");
  await query(sql);
  await query(
    `INSERT INTO s2m_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [filename]
  );
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

// Run all pending migrations. Returns the list of migrations that were applied
// in this run and the ones that were already up to date.
export async function runMigrations(): Promise<MigrationResult> {
  await ensureMigrationsTable();
  const applied = await listAppliedMigrations();
  const all = listMigrationFiles();

  const result: MigrationResult = { applied: [], skipped: [] };

  for (const file of all) {
    if (applied.has(file)) {
      result.skipped.push(file);
      continue;
    }
    try {
      await runMigration(file);
      result.applied.push(file);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Migration ${file} failed: ${message}`);
    }
  }

  return result;
}

// For existing installs whose schema was created via scripts/init-db.sql before
// the migrations system existed: mark 001_init as applied so we don't try to
// re-run it. Detected by checking if s2m_chats table exists.
export async function backfillExistingInstall(): Promise<boolean> {
  const exists = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 's2m_chats'
     ) AS exists`
  );
  if (exists[0]?.exists) {
    await ensureMigrationsTable();
    await query(
      `INSERT INTO s2m_migrations (id) VALUES ('001_init.sql') ON CONFLICT DO NOTHING`
    );
    return true;
  }
  return false;
}
