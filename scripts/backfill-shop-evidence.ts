/**
 * Backfill precise evidence links for shop mentions created before the promote
 * flow persisted shop_video_mentions.evidence_ids.
 *
 * Usage:
 *   pnpm backfill:evidence          # dry-run
 *   pnpm backfill:evidence --apply  # persist updates
 */

import { createDb } from "@gowith/db";
import { collectCandidateEvidenceIds } from "@gowith/shared";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    process.env[key] ??= value.replace(/^["']|["']$/g, "");
  }
}

async function main() {
  loadDotEnv();
  const apply = process.argv.includes("--apply");
  const db = createDb();
  try {
    const mentions = await db
      .selectFrom("shop_video_mentions")
      .innerJoin(
        "shop_candidates",
        "shop_candidates.id",
        "shop_video_mentions.shop_candidate_id",
      )
      .select([
        "shop_video_mentions.id",
        "shop_video_mentions.evidence_ids",
        "shop_candidates.card_payload",
        "shop_candidates.review_dimensions",
        "shop_candidates.comment_summary",
      ])
      .execute();

    let changed = 0;
    for (const mention of mentions) {
      const evidenceIds = collectCandidateEvidenceIds(mention);
      const current = [...mention.evidence_ids].sort();
      const next = [...evidenceIds].sort();
      if (JSON.stringify(current) === JSON.stringify(next)) continue;
      changed += 1;
      if (apply) {
        await db
          .updateTable("shop_video_mentions")
          .set({ evidence_ids: next })
          .where("id", "=", mention.id)
          .execute();
      }
    }

    console.log(
      `${apply ? "Updated" : "Would update"} ${changed} shop evidence mention(s).`,
    );
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
