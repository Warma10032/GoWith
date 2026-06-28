import { spawn } from "node:child_process";
import path from "node:path";
import {
  loadEnvFile,
  projectRootFromScriptsDir,
  requireEnv,
} from "./env-utils.mjs";

const rootDir = projectRootFromScriptsDir(import.meta.url);
loadEnvFile(rootDir);

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") {
  throw new Error("Usage: node scripts/run-next.mjs <dev|start>");
}

const nextBin = path.join(
  rootDir,
  "apps",
  "web",
  "node_modules",
  ".bin",
  "next",
);
const command = process.platform === "win32" ? `${nextBin}.cmd` : nextBin;
const child = spawn(
  command,
  [mode, "-p", requireEnv("WEB_PORT"), "-H", requireEnv("WEB_HOST")],
  {
    cwd: path.join(rootDir, "apps", "web"),
    env: process.env,
    stdio: "inherit",
    shell: false,
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
