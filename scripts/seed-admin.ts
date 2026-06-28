import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { createDb } from "@gowith/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function loadDotEnv() {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const envPath = process.env.ENV_FILE
    ? path.resolve(rootDir, process.env.ENV_FILE)
    : path.join(rootDir, `.env.${nodeEnv}`);
  const fallbackEnvPath = path.join(rootDir, ".env");
  for (const filePath of [envPath, fallbackEnvPath]) {
    if (!existsSync(filePath)) continue;
    loadDotEnvFile(filePath);
  }
}

function loadDotEnvFile(envPath: string) {
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

async function main() {
  loadDotEnv();
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_INITIAL_PASSWORD are required");
  }

  const db = createDb();
  try {
    const existing = await db
      .selectFrom("users")
      .select(["id", "email"])
      .where("email", "=", email)
      .executeTakeFirst();

    if (existing) {
      console.log(`admin already exists: ${email}`);
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await db
      .insertInto("users")
      .values({
        id: crypto.randomUUID(),
        email,
        role: "admin",
        status: "active",
        password_hash: passwordHash,
        display_name: "GoWith Admin",
        phone: null,
        username: null,
        avatar_url: null,
        avatar_source_url: null,
        last_login_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();

    console.log(`admin created: ${email}`);
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
