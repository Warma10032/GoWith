import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..", "..");

/**
 * 加载项目根 .env（AMAP / DB / Redis 等共享配置）。
 * Next.js 默认只读工作目录 .env，monorepo 子 package 不复制一份根 .env 容易踩坑。
 * 这里不用 @next/env/dotenv —— 那两个在 next.config 上下文里有诡异的
 * cached combinedEnv 行为（_NEXT_PROCESSED_ENV 标志位 + 第二次调用
 * 直接返回首次的空结果），独立 node 跑能 load 但 next dev 里永远 []。
 * 手写 20 行解析器最稳：覆盖 KEY=VALUE、# 注释、单/双引号、已存在
 * 的 env 变量不覆盖。
 */
function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf("=");
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim();
    let value = line.slice(sep + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv(path.join(projectDir, ".env"));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@gowith/shared"],
};

export default nextConfig;

