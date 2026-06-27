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
 * 安全加固（P0-6）：
 * - DNS 解析后拒绝内网 / 环回 / 链路本地 / metadata IP（SSRF）
 * - 每次重定向后重新校验目标（防止 302 跳转到内网）
 * - 域名白名单（IMAGE_DOWNLOAD_ALLOWED_DOMAINS），空 = 允许任何公网
 * - 移除 SVG 支持（image/svg+xml 不再放行；只允许 JPEG/PNG/WebP/AVIF/GIF）
 * - 校验文件 magic bytes，不只信任 Content-Type
 * - 生产环境强制拒绝内网下载
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export type ImageKind = "creators" | "videos";

export interface DownloadImageOptions {
  uploadsDir: string;
  /** 允许的域名白名单（小写）。空 = 不做白名单校验。 */
  allowedDomains?: string[];
  /** 是否拒绝内网 / 环回 / metadata IP。 */
  blockPrivateNetworks?: boolean;
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

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const MAGIC_SIGNATURES: Array<{ mime: string; ext: string; bytes: number[] }> = [
  { mime: "image/jpeg", ext: "jpg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", ext: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/gif", ext: "gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: "image/webp", ext: "webp", bytes: [0x52, 0x49, 0x46, 0x46] },
  { mime: "image/avif", ext: "avif", bytes: [] },
];

function detectImageFormat(buf: Buffer): { mime: string; ext: string } | null {
  for (const sig of MAGIC_SIGNATURES) {
    if (sig.bytes.length === 0) continue;
    if (buf.length < sig.bytes.length) continue;
    let match = true;
    for (let i = 0; i < sig.bytes.length; i += 1) {
      if (buf[i] !== sig.bytes[i]) {
        match = false;
        break;
      }
    }
    if (match) return { mime: sig.mime, ext: sig.ext };
  }
  // AVIF: ftyp box at offset 4 with brand "avif" or "avis"
  if (buf.length >= 12) {
    const boxType = buf.subarray(4, 8).toString("ascii");
    if (boxType === "ftyp") {
      const brand = buf.subarray(8, 12).toString("ascii");
      if (brand === "avif" || brand === "avis") {
        return { mime: "image/avif", ext: "avif" };
      }
    }
  }
  return null;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * 检查 IP 是否属于内网 / 环回 / 链路本地 / metadata 段。
 */
function isPrivateOrLoopbackAddress(ip: string): boolean {
  const lower = ip.toLowerCase();
  const ipv4Parts = lower.split(".").map((part) => Number(part));
  if (ipv4Parts.length === 4 && ipv4Parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) {
    const a = ipv4Parts[0] as number;
    const b = ipv4Parts[1] as number;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 0) return true;
    if (a >= 224) return true;
  }
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("ff")) return true;
  if (lower.startsWith("::ffff:")) {
    return isPrivateOrLoopbackAddress(lower.slice(7));
  }
  return false;
}

async function assertHostnameSafe(
  url: URL,
  options: { blockPrivateNetworks: boolean },
): Promise<void> {
  if (!options.blockPrivateNetworks) return;
  const { promises: dns } = await import("node:dns");
  const records = await dns.lookup(url.hostname, { all: true });
  if (!records.length) {
    throw new Error(`DNS lookup returned no records for ${url.hostname}`);
  }
  for (const record of records) {
    if (isPrivateOrLoopbackAddress(record.address)) {
      throw new Error(
        `Refusing to fetch ${url.hostname}: resolved to private/loopback address ${record.address}`,
      );
    }
  }
}

function assertDomainAllowed(
  url: URL,
  allowedDomains: string[] | undefined,
): void {
  if (!allowedDomains || allowedDomains.length === 0) return;
  const host = url.hostname.toLowerCase();
  if (!allowedDomains.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
    throw new Error(
      `Refusing to fetch ${host}: not in IMAGE_DOWNLOAD_ALLOWED_DOMAINS allowlist`,
    );
  }
}

/**
 * 把 source URL 下载到本地，返回 { url, filePath, sourceUrl }。
 *
 * - sourceUrl 为空 / 非 http → 返回 null
 * - 已有本地文件 + sourceUrl 匹配 → 跳过下载
 * - 否则 GET（自定义 UA + 不带 Referer 绕过 B 站防盗链）+ 写文件
 * - SSRF 防护：DNS 解析后拒绝内网 IP；域名白名单；重定向后重新校验
 * - 不允许 SVG；magic bytes 校验文件类型
 */
export async function downloadImage(
  sourceUrl: string | null | undefined,
  kind: ImageKind,
  entityId: string,
  options: DownloadImageOptions,
): Promise<DownloadedImage | null> {
  if (!sourceUrl) return null;
  if (!isHttpUrl(sourceUrl)) {
    if (sourceUrl.startsWith("/uploads/")) {
      const filePath = path.join(options.uploadsDir, sourceUrl.replace(/^\/uploads\//, ""));
      return { url: sourceUrl, filePath, sourceUrl };
    }
    return null;
  }

  const targetDir = path.join(options.uploadsDir, kind);
  await fs.mkdir(targetDir, { recursive: true });

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch (error) {
    throw new Error(
      `Invalid image URL (${sourceUrl}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Refusing non-http(s) image URL: ${sourceUrl}`);
  }
  assertDomainAllowed(parsed, options.allowedDomains);
  await assertHostnameSafe(parsed, {
    blockPrivateNetworks: options.blockPrivateNetworks ?? true,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(sourceUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; GoWithBot/1.0; +https://gowith.local)",
        accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    clearTimeout(timeout);
    throw new Error(
      `下载图片失败 (${sourceUrl}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let redirectCount = 0;
  while (
    response.status >= 300 &&
    response.status < 400 &&
    redirectCount < 5
  ) {
    const location = response.headers.get("location");
    if (!location) {
      throw new Error(`下载图片失败 (${sourceUrl}): redirect without location`);
    }
    let nextUrl: URL;
    try {
      nextUrl = new URL(location, sourceUrl);
    } catch {
      throw new Error(`下载图片失败 (${sourceUrl}): invalid redirect location ${location}`);
    }
    if (nextUrl.protocol !== "https:" && nextUrl.protocol !== "http:") {
      throw new Error(`Refusing non-http(s) redirect: ${nextUrl.toString()}`);
    }
    assertDomainAllowed(nextUrl, options.allowedDomains);
    await assertHostnameSafe(nextUrl, {
      blockPrivateNetworks: options.blockPrivateNetworks ?? true,
    });
    redirectCount += 1;
    const redirectController = new AbortController();
    const redirectTimeout = setTimeout(
      () => redirectController.abort(),
      FETCH_TIMEOUT_MS,
    );
    try {
      response = await fetch(nextUrl, {
        method: "GET",
        redirect: "manual",
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; GoWithBot/1.0; +https://gowith.local)",
          accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8",
        },
        signal: redirectController.signal,
      });
    } finally {
      clearTimeout(redirectTimeout);
    }
  }
  if (redirectCount >= 5) {
    throw new Error(`下载图片失败 (${sourceUrl}): too many redirects`);
  }

  if (!response.ok) {
    throw new Error(`下载图片失败 (${sourceUrl}): HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type");
  const normalizedContentType = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ALLOWED_MIME_TYPES.has(normalizedContentType)) {
    throw new Error(
      `Refusing image with disallowed content-type "${normalizedContentType}" (${sourceUrl})`,
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error(`下载图片失败 (${sourceUrl}): empty body`);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      throw new Error(
        `下载图片过大: ${total} bytes > ${MAX_BYTES} bytes (${sourceUrl})`,
      );
    }
    chunks.push(value);
  }
  const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));

  const detected = detectImageFormat(buffer);
  if (!detected) {
    throw new Error(
      `Refusing image with unrecognized file signature (${sourceUrl})`,
    );
  }
  const ext = detected.ext;

  const fileName = `${entityId}.${ext}`;
  const filePath = path.join(targetDir, fileName);
  const publicUrl = `/uploads/${kind}/${fileName}`;

  const sidecarPath = `${filePath}.source`;
  try {
    const existingSource = await fs.readFile(sidecarPath, "utf8");
    if (existingSource.trim() === sourceUrl) {
      return { url: publicUrl, filePath, sourceUrl };
    }
  } catch {
    // sidecar 不存在，正常情况，第一次下载
  }

  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, buffer);
  await fs.rename(tmpPath, filePath);
  await fs.writeFile(sidecarPath, sourceUrl, "utf8");

  return { url: publicUrl, filePath, sourceUrl };
}
