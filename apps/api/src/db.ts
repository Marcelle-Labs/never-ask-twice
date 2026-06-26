import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../../../src/db/schema.js";

const { Pool } = pg;

let _db: NodePgDatabase<typeof schema> | null = null;
let _pool: InstanceType<typeof Pool> | null = null;

export function getDb(): NodePgDatabase<typeof schema> {
  if (_db) return _db;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  _pool = new Pool({ connectionString: url });
  _db = drizzle(_pool, { schema });
  return _db;
}

export { schema };
