// CLI entry point for running migrations.
// Usage: npm run migrate
//
// Reads DATABASE_URL from .env.local and runs all pending migrations from
// the migrations/ folder. Safe to run repeatedly -- only applies new ones.

import dotenv from "dotenv";
import path from "node:path";
// Load .env.local first (Next.js convention), then fall back to .env
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

import { backfillExistingInstall, runMigrations } from "../lib/migrate";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("✗ DATABASE_URL is not set. Add it to .env.local");
    process.exit(1);
  }

  console.log("RecallMEM migrations\n");

  // For existing installs created via scripts/init-db.sql, mark 001 as applied
  // so we don't try to re-run it.
  const backfilled = await backfillExistingInstall();
  if (backfilled) {
    console.log("✓ Detected existing schema, backfilled migration tracker\n");
  }

  try {
    const result = await runMigrations();

    if (result.applied.length === 0) {
      console.log("✓ Database is up to date");
      if (result.skipped.length > 0) {
        console.log(`  ${result.skipped.length} migration(s) already applied`);
      }
    } else {
      console.log(`✓ Applied ${result.applied.length} migration(s):`);
      for (const file of result.applied) {
        console.log(`  + ${file}`);
      }
      if (result.skipped.length > 0) {
        console.log(`  (${result.skipped.length} already applied)`);
      }
    }

    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`✗ Migration failed: ${message}`);
    process.exit(1);
  }
}

main();
