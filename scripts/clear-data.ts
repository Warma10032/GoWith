/**
 * 一次性脚本：清空数据库所有业务表数据，保留 schema 与迁移历史。
 *
 * 用法：
 *   pnpm db:clear                 # dry-run 模式（只列出会清哪些表 + 行数，不动手）
 *   pnpm db:clear --apply         # 实际清空
 *   pnpm db:clear --apply --reseed   # 清空后提示手动跑 db:seed
 *
 * 保留：
 *   - schema_migrations（迁移历史）
 *   - PostGIS / pg_trgm / pgcrypto extension
 *
 * 清空：
 *   - public schema 下所有其它表（含 users），按 FK 依赖顺序 CASCADE
 *   - 重新跑 pnpm db:seed 可以重建默认管理员
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql, type Kysely } from "kysely";
import { createDb, type DB } from "@gowith/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function loadDotEnv() {
  const envPath = path.join(rootDir, ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    process.env[key] ??= value.replace(/^["']|["']$/g, "");
  }
}

const RESERVED_TABLES = new Set(["schema_migrations"]);

interface TableInfo {
  schema: string;
  name: string;
  rowCount: number;
}

async function listUserTables(
  db: Kysely<DB>,
): Promise<TableInfo[]> {
  const rows = await sql<{
    schemaname: string;
    tablename: string;
    row_count: string;
  }>`SELECT
       schemaname,
       tablename,
       (xpath('/row/cnt/text()', xml_count))[1]::text::bigint AS row_count
     FROM (
       SELECT schemaname, tablename,
              query_to_xml(format('SELECT count(*) AS cnt FROM %I.%I',
                                  schemaname, tablename), false, true, '') AS xml_count
       FROM pg_tables
       WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
     ) t
     ORDER BY schemaname, tablename`.execute(db);
  return rows.rows.map((r) => ({
    schema: r.schemaname,
    name: r.tablename,
    rowCount: Number(r.row_count),
  }));
}

async function clearTables(
  db: Kysely<DB>,
  tables: TableInfo[],
): Promise<void> {
  if (tables.length === 0) return;
  // CASCADE 让 FK 依赖自动级联；RESTART IDENTITY 顺手把序列归零；
  // 一个语句搞定所有表，事务保证原子性。
  const qualifiedNames = tables
    .map((t) => `"${t.schema}"."${t.name}"`)
    .join(", ");
  await sql`TRUNCATE ${sql.raw(qualifiedNames)} RESTART IDENTITY CASCADE`.execute(
    db,
  );
}

async function main() {
  const apply = process.argv.includes("--apply");
  const reseed = process.argv.includes("--reseed");
  if (reseed && !apply) {
    throw new Error("--reseed requires --apply");
  }

  loadDotEnv();
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const db = createDb();
  try {
    const all = await listUserTables(db);
    const targets = all.filter((t) => !RESERVED_TABLES.has(t.name));

    console.log(
      `发现 ${all.length} 张表（保留 ${RESERVED_TABLES.size} 张：${[...RESERVED_TABLES].join(", ")}），将清空 ${targets.length} 张：`,
    );
    let totalRows = 0;
    for (const t of targets) {
      console.log(`  ${t.schema}.${t.name.padEnd(36)} ${t.rowCount} 行`);
      totalRows += t.rowCount;
    }
    console.log(`合计 ${totalRows} 行`);

    if (!apply) {
      console.log("\n这是 dry-run，未做任何修改。加 --apply 实际清空。");
      return;
    }

    console.log("\n开始清空...");
    await clearTables(db, targets);

    // 验证
    const after = await listUserTables(db);
    const stillNonEmpty = after.filter(
      (t) => !RESERVED_TABLES.has(t.name) && t.rowCount > 0,
    );
    if (stillNonEmpty.length > 0) {
      console.warn(`⚠️  清空后仍有非空表：`);
      for (const t of stillNonEmpty) {
        console.warn(`  ${t.schema}.${t.name} ${t.rowCount} 行`);
      }
    } else {
      console.log("✓ 所有业务表已清空");
    }

    if (reseed) {
      console.log("\n请运行 `pnpm db:seed` 重建默认管理员账号。");
    } else {
      console.log(
        "\n提示：如需重建管理员账号，运行 `pnpm db:seed`（或加 --reseed 提示）。",
      );
    }
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
