import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function projectRootFromScriptsDir(metaUrl) {
  return path.resolve(path.dirname(fileURLToPath(metaUrl)), "..");
}

export function resolveEnvFile(rootDir) {
  if (process.env.ENV_FILE) return path.resolve(rootDir, process.env.ENV_FILE);
  const nodeEnv = process.env.NODE_ENV || "development";
  const candidates = [
    path.join(rootDir, `.env.${nodeEnv}`),
    path.join(rootDir, ".env"),
  ];
  return (
    candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
  );
}

export function loadEnvFile(rootDir) {
  const envFile = resolveEnvFile(rootDir);
  if (!fs.existsSync(envFile)) return;

  const text = fs.readFileSync(envFile, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
