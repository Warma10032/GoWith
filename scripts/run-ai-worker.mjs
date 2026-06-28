import { spawn } from "node:child_process";
import path from "node:path";
import {
  loadEnvFile,
  projectRootFromScriptsDir,
  requireEnv,
} from "./env-utils.mjs";

const rootDir = projectRootFromScriptsDir(import.meta.url);
loadEnvFile(rootDir);

const reload = process.argv.includes("--reload");
const args = [
  "run",
  "--project",
  "apps/ai-worker",
  "--link-mode=copy",
  "uvicorn",
  "app.main:app",
  "--app-dir",
  "apps/ai-worker",
  "--host",
  requireEnv("AI_WORKER_HOST"),
  "--port",
  requireEnv("AI_WORKER_PORT"),
];
if (reload) args.push("--reload");

const child = spawn("uv", args, {
  cwd: rootDir,
  env: process.env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
