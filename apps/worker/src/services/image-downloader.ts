/**
 * 图片下载服务：把 B 站 / 高德 / 其它第三方图片下载到本地 uploads 目录，
 * 数据库只存 /uploads/... 路径（apps/api 用 @fastify/static 暴露）。
 *
 * 关键能力：
 * - 断点续传：source URL 没变 + 本地文件已存在 → 直接返回，零网络请求
 * - 原子写：先写 .tmp，再 fs.rename，避免 worker 崩溃留半截文件
 * - 扩展名推断：从响应 content-type 推导 .jpg / .png / .webp
 * - 大小限制：默认 10 MB，防止恶意超大数据撑爆磁盘
 * - Referer 防 403：B 站 CDN 默认拒绝非 B 站 Referer，所以用自定义 UA + 不带 Referer
 *
 * 注意：uploadsDir 由调用方传入（worker 用 env，scripts 用 process.env），
 * 这样脚本和 worker 都能复用同一份逻辑，不需要重复实现。
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export type ImageKind = "creators" | "videos";

export interface DownloadImageOptions {
  uploadsDir: string;
}

export interface DownloadedImage {
  /** 写到数据库的公开 URL：/uploads/creators/<uuid>.jpg */
  url: string;
  /** 本地磁盘绝对路径，便于调试 / 删除 */
  filePath: string;
  /** 原始第三方 source URL（写 DB 的 avatar_source_url / cover_source_url） */
  sourceUrl: string;
}

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const FETCH_TIMEOUT_MS = 15_000;

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

function extensionFor(contentType: string | null | undefined): string {
  if (!contentType) return "bin";
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_TO_EXT[normalized] ?? "bin";
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * 把 source URL 下载到本地，返回 { url, filePath, sourceUrl }。
 *
 * - sourceUrl 为空 / 非 http → 返回 null（调用方继续存 null）
 * - 已有本地文件 + sourceUrl 匹配 → 跳过下载，直接返回现 url
 * - 否则 GET（自定义 UA + 不带 Referer 绕过 B 站防盗链）+ 写文件
 */
export async function downloadImage(
  sourceUrl: string | null | undefined,
  kind: ImageKind,
  entityId: string,
  options: DownloadImageOptions,
): Promise<DownloadedImage | null> {
  if (!sourceUrl) return null;
  if (!isHttpUrl(sourceUrl)) {
    // 已经是 /uploads/... 这种本地路径，跳过
    if (sourceUrl.startsWith("/uploads/")) {
      const filePath = path.join(options.uploadsDir, sourceUrl.replace(/^\/uploads\//, ""));
      return { url: sourceUrl, filePath, sourceUrl };
    }
    return null;
  }

  const targetDir = path.join(options.uploadsDir, kind);
  await fs.mkdir(targetDir, { recursive: true });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(sourceUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        // 自定义 UA + 不带 Referer 是绕过 B 站 hdslb.com CDN Referer 白名单的关键
        "user-agent":
          "Mozilla/5.0 (compatible; GoWithBot/1.0; +https://gowith.local)",
        accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    throw new Error(
      `下载图片失败 (${sourceUrl}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`下载图片失败 (${sourceUrl}): HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type");
  const ext = extensionFor(contentType);
  const fileName = `${entityId}.${ext}`;
  const filePath = path.join(targetDir, fileName);
  const publicUrl = `/uploads/${kind}/${fileName}`;

  // 检查现有文件是否同 source（用 sidecar 记录 source URL）
  const sidecarPath = `${filePath}.source`;
  try {
    const existingSource = await fs.readFile(sidecarPath, "utf8");
    if (existingSource.trim() === sourceUrl) {
      return { url: publicUrl, filePath, sourceUrl };
    }
  } catch {
    // sidecar 不存在，正常情况，第一次下载
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_BYTES) {
    throw new Error(
      `下载图片过大: ${arrayBuffer.byteLength} bytes > ${MAX_BYTES} bytes (${sourceUrl})`,
    );
  }
  const buffer = Buffer.from(arrayBuffer);

  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, buffer);
  await fs.rename(tmpPath, filePath);
  await fs.writeFile(sidecarPath, sourceUrl, "utf8");

  return { url: publicUrl, filePath, sourceUrl };
}
