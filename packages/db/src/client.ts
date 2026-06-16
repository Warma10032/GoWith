import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DB } from "./schema";

const { Pool } = pg;

export function createDb(databaseUrl = process.env.DATABASE_URL): Kysely<DB> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: databaseUrl,
        max: 10,
      }),
    }),
  });
}

export async function closeDb(db: Kysely<DB>): Promise<void> {
  await db.destroy();
}

