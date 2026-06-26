import process from "node:process";
import { Client } from "pg";

import { initialMigrationSql } from "../src/db/migrationSql.js";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for pnpm migrate");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    await client.query(initialMigrationSql);
    console.log("migrate: ok");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
