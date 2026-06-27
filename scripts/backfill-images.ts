/**
 * 一次性 backfill：把 DB 现有 creators.avatar_url / videos.cover_url 里
 * 仍然是 http(s) 第三方链接的记录，下载到本地 /uploads/...，
 * 并写 avatar_source_url / cover_source_url。
 *
 * 用法：
 *   pnpm backfill:images
 *   UPLOADS_DIR=/var/data/gowith/uploads pnpm backfill:images
 *
 * 幂等：downloadImage 看到 sidecar `.source` 一致会跳过下载。
 */

import path from "node:path";
import { createDb } from "@gowith/db";
import { env } from "../apps/worker/src/env";
import { downloadImage } from "../apps/worker/src/services/image-downloader";

const UPLOADS_DIR = path.resolve(
  process.env.UPLOADS_DIR ?? path.join(process.cwd(), "apps", "api", "uploads"),
);

interface BackfillStats {
  creatorsScanned: number;
  creatorsDownloaded: number;
  creatorsSkipped: number;
  creatorsFailed: number;
  videosScanned: number;
  videosDownloaded: number;
  videosSkipped: number;
  videosFailed: number;
}

async function main() {
  const db = createDb();
  const stats: BackfillStats = {
    creatorsScanned: 0,
    creatorsDownloaded: 0,
    creatorsSkipped: 0,
    creatorsFailed: 0,
    videosScanned: 0,
    videosDownloaded: 0,
    videosSkipped: 0,
    videosFailed: 0,
  };

  try {
    // ---------- creators ----------
    const creators = await db
      .selectFrom("creators")
      .select(["id", "bilibili_uid", "name", "avatar_url"])
      .execute();
    stats.creatorsScanned = creators.length;

    for (const creator of creators) {
      const sourceUrl = creator.avatar_url;
      // 已是本地 /uploads/... 跳过
      if (!sourceUrl || sourceUrl.startsWith("/uploads/")) {
        stats.creatorsSkipped++;
        continue;
      }
      if (!/^https?:\/\//i.test(sourceUrl)) {
        stats.creatorsSkipped++;
        continue;
      }
      try {
        const result = await downloadImage(sourceUrl, "creators", creator.id, {
          uploadsDir: UPLOADS_DIR,
          allowedDomains: env.imageDownloadAllowedDomains,
          blockPrivateNetworks: env.imageDownloadBlockPrivateNetworks,
        });
        if (!result) {
          stats.creatorsSkipped++;
          continue;
        }
        await db
          .updateTable("creators")
          .set({
            avatar_url: result.url,
            avatar_source_url: result.sourceUrl,
            updated_at: new Date(),
          })
          .where("id", "=", creator.id)
          .execute();
        console.log(
          `[creator] ${creator.bilibili_uid} ${creator.name} → ${result.url}`,
        );
        stats.creatorsDownloaded++;
      } catch (err) {
        stats.creatorsFailed++;
        console.warn(
          `[creator] ${creator.bilibili_uid} ${creator.name} FAILED: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // ---------- videos ----------
    const videos = await db
      .selectFrom("videos")
      .select(["id", "bvid", "title", "cover_url", "cover_source_url"])
      .execute();
    stats.videosScanned = videos.length;

    for (const video of videos) {
      const sourceUrl = video.cover_url;
      // 同样的模式：主字段保持原始 B站 URL，仅补 cover_source_url 做审计。
      if (!sourceUrl) {
        stats.videosSkipped++;
        continue;
      }
      if (sourceUrl.startsWith("/uploads/")) {
        // 历史遗留的本地化记录，不动；如需还原可手动 SQL
        stats.videosSkipped++;
        continue;
      }
      if (!/^https?:\/\//i.test(sourceUrl)) {
        stats.videosSkipped++;
        continue;
      }
      if (!video.cover_source_url) {
        await db
          .updateTable("videos")
          .set({
            cover_source_url: sourceUrl,
            updated_at: new Date(),
          })
          .where("id", "=", video.id)
          .execute();
        stats.videosDownloaded++;
      } else {
        stats.videosSkipped++;
      }
      console.log(`[video] ${video.bvid} ${video.title} → source=${sourceUrl}`);
    }

    console.log("\n=== backfill 完成 ===");
    console.log(JSON.stringify(stats, null, 2));
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
