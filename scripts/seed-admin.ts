import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { createDb } from "@gowith/db";

async function main() {
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

