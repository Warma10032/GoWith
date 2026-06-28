import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

function loadEnvFile() {
  const rootDir = __dirname;
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const envFile = process.env.ENV_FILE
    ? path.resolve(rootDir, process.env.ENV_FILE)
    : path.join(rootDir, `.env.${nodeEnv}`);
  for (const filePath of [envFile, path.join(rootDir, ".env")]) {
    if (!fs.existsSync(filePath)) continue;
    const text = fs.readFileSync(filePath, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      const value = line
        .slice(separator + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      process.env[key] ??= value;
    }
  }
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

loadEnvFile();

const webUrl =
  process.env.PLAYWRIGHT_BASE_URL ?? requireEnv("NEXT_PUBLIC_SITE_URL");

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: webUrl,
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm --filter @gowith/web dev",
    url: webUrl,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
});
