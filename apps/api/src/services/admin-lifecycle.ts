import crypto from "node:crypto";
import { sql, type Transaction } from "kysely";
import type { DB } from "@gowith/db";

type EntityRef = { entityType: string; entityId: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function evidenceIds(value: unknown): string[] {
  const row = asRecord(value);
  return Array.isArray(row.evidence_ids)
    ? row.evidence_ids.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      )
    : [];
}

function visibleConclusionEvidenceGroups(
  cardPayload: unknown,
  aggregatedReview: unknown,
): string[][] {
  const card = asRecord(cardPayload);
  const groups: string[][] = [];
  const scoreIds = Array.isArray(card.recommendation_score_evidence_ids)
    ? card.recommendation_score_evidence_ids.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      )
    : [];
  if (scoreIds.length) groups.push(scoreIds);

  for (const key of ["recommended_dishes", "avoid_points"] as const) {
    const rows = Array.isArray(card[key]) ? card[key] : [];
    for (const row of rows) {
      const ids = evidenceIds(row);
      if (ids.length) groups.push(ids);
    }
  }

  for (const [key, value] of Object.entries(asRecord(aggregatedReview))) {
    if (key === "comment_summary" || key === "comment_signals") continue;
    const ids = evidenceIds(value);
    if (ids.length) groups.push(ids);
  }
  return groups;
}

export async function writeReviewEvent(
  trx: Transaction<DB>,
  input: {
    entityType: string;
    entityId: string;
    action: string;
    before: unknown;
    after: unknown;
    reason: string | null;
    reviewerId: string;
  },
) {
  await trx
    .insertInto("review_events")
    .values({
      id: crypto.randomUUID(),
      review_task_id: null,
      entity_type: input.entityType,
      entity_id: input.entityId,
      action: input.action,
      before_json: input.before,
      after_json: input.after,
      reason: input.reason,
      reviewer_id: input.reviewerId,
      created_at: new Date(),
    })
    .execute();
}

export async function cancelQueuedEntityWork(
  trx: Transaction<DB>,
  entities: EntityRef[],
) {
  for (const entity of entities) {
    await trx
      .updateTable("jobs")
      .set({ status: "cancelled", finished_at: new Date() })
      .where("entity_type", "=", entity.entityType)
      .where("entity_id", "=", entity.entityId)
      .where("status", "=", "queued")
      .execute();
    await trx
      .updateTable("pipeline_runs")
      .set({ status: "cancelled", finished_at: new Date() })
      .where("entity_type", "=", entity.entityType)
      .where("entity_id", "=", entity.entityId)
      .where("status", "=", "queued")
      .execute();
  }
}

export async function findAffectedShopIds(
  trx: Transaction<DB>,
  videoIds: string[],
) {
  if (!videoIds.length) return [];
  const rows = await trx
    .selectFrom("shop_video_mentions")
    .select("shop_id")
    .distinct()
    .where("video_id", "in", videoIds)
    .execute();
  return rows.map((row) => row.shop_id);
}

export async function revalidateAffectedShops(
  trx: Transaction<DB>,
  shopIds: string[],
  reviewerId: string,
  reason: string,
) {
  const results: Array<{
    shop_id: string;
    hidden: boolean;
    video_count: number;
    creator_count: number;
  }> = [];

  for (const shopId of [...new Set(shopIds)]) {
    const shop = await trx
      .selectFrom("shops")
      .selectAll()
      .where("id", "=", shopId)
      .executeTakeFirst();
    if (!shop || shop.deleted_at) continue;

    const counts = await sql<{
      video_count: string;
      creator_count: string;
    }>`
      SELECT
        COUNT(DISTINCT mention.video_id)::text AS video_count,
        COUNT(DISTINCT mention.creator_id)::text AS creator_count
      FROM shop_video_mentions AS mention
      JOIN videos AS video ON video.id = mention.video_id
      JOIN creators AS creator ON creator.id = mention.creator_id
      WHERE mention.shop_id = ${shopId}
        AND video.deleted_at IS NULL
        AND creator.deleted_at IS NULL
    `.execute(trx);
    const videoCount = Number(counts.rows[0]?.video_count ?? 0);
    const creatorCount = Number(counts.rows[0]?.creator_count ?? 0);

    const groups = visibleConclusionEvidenceGroups(
      shop.card_payload,
      shop.aggregated_review,
    );
    const allIds = [...new Set(groups.flat())];
    const activeEvidence = allIds.length
      ? await trx
          .selectFrom("evidence as evidence")
          .innerJoin("videos as video", "video.id", "evidence.video_id")
          .innerJoin("creators as creator", "creator.id", "video.creator_id")
          .select("evidence.id")
          .where("evidence.id", "in", allIds)
          .where("video.deleted_at", "is", null)
          .where("creator.deleted_at", "is", null)
          .execute()
      : [];
    const activeIds = new Set(activeEvidence.map((row) => row.id));
    const invalidatedConclusion = groups.some(
      (group) => !group.some((id) => activeIds.has(id)),
    );
    const shouldHide = videoCount === 0 || invalidatedConclusion;
    const nextStatus = shouldHide ? "hidden" : shop.status;
    const nextSourceStats = {
      ...asRecord(shop.source_stats),
      video_count: videoCount,
      creator_count: creatorCount,
    };

    await trx
      .updateTable("shops")
      .set({ source_stats: nextSourceStats, status: nextStatus })
      .where("id", "=", shopId)
      .execute();

    if (shouldHide && shop.status !== "hidden") {
      await writeReviewEvent(trx, {
        entityType: "shop",
        entityId: shopId,
        action: "auto_hide_source_loss",
        before: { status: shop.status, source_stats: shop.source_stats },
        after: {
          status: "hidden",
          source_stats: nextSourceStats,
          invalidated_conclusion: invalidatedConclusion,
        },
        reason,
        reviewerId,
      });
    }

    const existingTask = await trx
      .selectFrom("review_tasks")
      .select("id")
      .where("entity_type", "=", "shop")
      .where("entity_id", "=", shopId)
      .where("task_type", "=", "source_recheck")
      .where("status", "in", ["open", "in_progress"])
      .executeTakeFirst();
    if (!existingTask) {
      await trx
        .insertInto("review_tasks")
        .values({
          id: crypto.randomUUID(),
          task_type: "source_recheck",
          entity_type: "shop",
          entity_id: shopId,
          title: "来源变更后复核店铺",
          reason,
          priority: shouldHide ? 90 : 60,
          status: "open",
          risk_flags: shouldHide ? ["needs_manual_review"] : [],
          payload: {
            video_count: videoCount,
            creator_count: creatorCount,
            invalidated_conclusion: invalidatedConclusion,
          },
          assigned_to: null,
          resolved_by: null,
          resolved_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute();
    }

    results.push({
      shop_id: shopId,
      hidden: shouldHide,
      video_count: videoCount,
      creator_count: creatorCount,
    });
  }
  return results;
}
