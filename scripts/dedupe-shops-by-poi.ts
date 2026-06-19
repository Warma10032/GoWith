/**
 * 一次性 cleanup：把同一个 primary_poi_id 上的多个 shops 行合并成一个。
 *
 * 背景：BV1fPEC6PE6Y 等视频多次 AI 重跑后，promote 流程会按 (provider,
 * provider_poi_id) 去重 POI，但同一个 POI 可能被多次 promote 成多个 shops
 * 行（已 published 的店 promote 不会创建新行，但 draft 状态或同 POI 多次
 * 通过不同 candidate 进入 promote 仍会建新行）。本脚本把同 POI 的多余 shop
 * 合并到最早/已发布的那条，并把 mentions/snapshots/candidates FK 全部
 * 重新指向 canonical，再删除多余 shop。
 *
 * 用法：
 *   pnpm tsx scripts/dedupe-shops-by-poi.ts           # 默认 dry-run
 *   pnpm tsx scripts/dedupe-shops-by-poi.ts --apply   # 实际执行合并
 *
 * 幂等：跑完后再跑一次找不到多余 shop 就直接退出。
 */

import { createDb } from "@gowith/db";

interface DuplicateGroup {
  primaryPoiId: string;
  canonicalShopId: string;
  duplicateShopIds: string[];
}

async function findDuplicateGroups(
  db: ReturnType<typeof createDb>,
): Promise<DuplicateGroup[]> {
  const rows = await db
    .selectFrom("shops")
    .select(["id", "primary_poi_id", "status", "created_at"])
    .where("primary_poi_id", "is not", null)
    .orderBy("primary_poi_id")
    .orderBy("created_at", "asc")
    .execute();

  const groups = new Map<string, Array<(typeof rows)[number]>>();
  for (const row of rows) {
    const list = groups.get(row.primary_poi_id) ?? [];
    list.push(row);
    groups.set(row.primary_poi_id, list);
  }

  const STATUS_RANK: Record<string, number> = {
    published: 0,
    approved: 1,
    draft: 2,
    needs_recheck: 3,
    hidden: 4,
    rejected: 5,
    merged: 6,
  };

  const result: DuplicateGroup[] = [];
  for (const [poiId, shops] of groups.entries()) {
    if (shops.length < 2) continue;
    // canonical：按 status 优先级 + 同优先级内取 created_at 最早
    const sorted = [...shops].sort((a, b) => {
      const ra = STATUS_RANK[a.status] ?? 99;
      const rb = STATUS_RANK[b.status] ?? 99;
      if (ra !== rb) return ra - rb;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    const canonical = sorted[0]!;
    const duplicates = sorted.slice(1).map((shop) => shop.id);
    result.push({
      primaryPoiId: poiId,
      canonicalShopId: canonical.id,
      duplicateShopIds: duplicates,
    });
  }
  return result;
}

async function mergeGroup(
  db: ReturnType<typeof createDb>,
  group: DuplicateGroup,
): Promise<{
  mentionsMoved: number;
  snapshotsMoved: number;
  candidatesRepointed: number;
  deleted: number;
}> {
  return db.transaction().execute(async (trx) => {
    let mentionsMoved = 0;
    let snapshotsMoved = 0;
    let candidatesRepointed = 0;

    for (const duplicateId of group.duplicateShopIds) {
      // 1) shop_video_mentions: (shop_id=duplicate) → canonical
      const mentionRows = await trx
        .selectFrom("shop_video_mentions")
        .select(["id"])
        .where("shop_id", "=", duplicateId)
        .execute();
      for (const mention of mentionRows) {
        await trx
          .updateTable("shop_video_mentions")
          .set({ shop_id: group.canonicalShopId })
          .where("id", "=", mention.id)
          .execute();
        mentionsMoved++;
      }

      // 2) published_shop_snapshots: 重新分配 version，避免 (shop_id, version) 冲突
      const snapshotRows = await trx
        .selectFrom("published_shop_snapshots")
        .select(["id"])
        .where("shop_id", "=", duplicateId)
        .orderBy("version", "asc")
        .execute();
      let nextVersion = await trx
        .selectFrom("published_shop_snapshots")
        .select((eb) => eb.fn.max<number>("version").as("v"))
        .where("shop_id", "=", group.canonicalShopId)
        .executeTakeFirst();
      let versionCounter = Number(nextVersion?.v ?? 0) + 1;
      for (const snap of snapshotRows) {
        await trx
          .updateTable("published_shop_snapshots")
          .set({
            shop_id: group.canonicalShopId,
            version: versionCounter++,
            is_current: false,
          })
          .where("id", "=", snap.id)
          .execute();
        snapshotsMoved++;
      }

      // 3) shop_candidates.merged_shop_id: 指向 duplicate 的重新指向 canonical
      const candResult = await trx
        .updateTable("shop_candidates")
        .set({ merged_shop_id: group.canonicalShopId })
        .where("merged_shop_id", "=", duplicateId)
        .executeTakeFirst();
      candidatesRepointed += Number(candResult.numUpdatedRows ?? 0);

      // 4) review_events 不动（entity_id 不是 FK，保留审计轨迹）

      // 5) 删 duplicate shop；CASCADE 处理 review_tasks / recommendation_items /
      //    user_favorites / user_events 等依赖表。
      await trx.deleteFrom("shops").where("id", "=", duplicateId).execute();
    }

    return {
      mentionsMoved,
      snapshotsMoved,
      candidatesRepointed,
      deleted: group.duplicateShopIds.length,
    };
  });
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = createDb();
  try {
    const groups = await findDuplicateGroups(db);
    if (groups.length === 0) {
      console.log("✓ 没有发现同 POI 的重复 shops，无需清理");
      return;
    }
    const totalDuplicates = groups.reduce(
      (sum, group) => sum + group.duplicateShopIds.length,
      0,
    );
    console.log(
      `发现 ${groups.length} 个 POI 共有 ${totalDuplicates} 个重复 shops 行${
        apply ? "" : " (dry-run，加 --apply 实际执行)"
      }`,
    );
    for (const group of groups) {
      console.log(
        `  POI=${group.primaryPoiId} → canonical=${group.canonicalShopId}, duplicates=[${group.duplicateShopIds.join(", ")}]`,
      );
    }

    if (!apply) {
      console.log("\n这是 dry-run，未做任何修改。");
      return;
    }

    let totalMentions = 0;
    let totalSnapshots = 0;
    let totalCandidates = 0;
    let totalDeleted = 0;
    for (const group of groups) {
      const stats = await mergeGroup(db, group);
      totalMentions += stats.mentionsMoved;
      totalSnapshots += stats.snapshotsMoved;
      totalCandidates += stats.candidatesRepointed;
      totalDeleted += stats.deleted;
      console.log(
        `  POI=${group.primaryPoiId}: 移动 mentions=${stats.mentionsMoved}, snapshots=${stats.snapshotsMoved}, candidates=${stats.candidatesRepointed}, 删除 shops=${stats.deleted}`,
      );
    }
    console.log(
      `\n=== 完成 ===\n  删除 shops: ${totalDeleted}\n  移动 mentions: ${totalMentions}\n  移动 snapshots: ${totalSnapshots}\n  重指 candidates: ${totalCandidates}`,
    );
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});