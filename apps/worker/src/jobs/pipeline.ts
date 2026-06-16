import crypto from "node:crypto";
import type { Job } from "bullmq";
import type { Kysely } from "kysely";
import type { DB } from "@gowith/db";
import {
  commentSignalExtractionSchema,
  videoClassificationResultSchema,
  videoStructuredAnalysisSchema,
} from "@gowith/shared";
import { fetchCreatorVideos } from "../adapters/bilibili";
import { classifyVideo, extractCommentSignals, structureVideo } from "../adapters/ai";
import { searchAmapPoi } from "../adapters/poi";
import { pipelineQueue } from "../queue";

export async function handlePipelineJob(db: Kysely<DB>, job: Job) {
  switch (job.name) {
    case "sync_creator_videos":
      return syncCreatorVideos(db, job);
    case "classify_video":
      return classifyVideoJob(db, job);
    case "extract_comment_signals":
      return commentSignalsJob(db, job);
    case "structure_video":
      return structureVideoJob(db, job);
    case "match_poi":
      return matchPoiJob(db, job);
    default:
      return { skipped: true, job: job.name };
  }
}

async function syncCreatorVideos(db: Kysely<DB>, job: Job) {
  const { entityId, bilibili_uid } = job.data as { entityId: string; bilibili_uid: string };
  const payload = await fetchCreatorVideos(bilibili_uid);

  await db
    .updateTable("creators")
    .set({
      name: payload.name,
      avatar_url: payload.avatar_url,
      bio: payload.bio,
      follower_count: payload.follower_count,
      last_synced_at: new Date(),
      updated_at: new Date(),
    })
    .where("id", "=", entityId)
    .execute();

  for (const video of payload.videos) {
    const row = await db
      .insertInto("videos")
      .values({
        id: crypto.randomUUID(),
        creator_id: entityId,
        bvid: video.bvid,
        aid: null,
        cid: null,
        title: video.title,
        description: video.description,
        cover_url: video.cover_url,
        source_url: video.source_url,
        duration_sec: video.duration_sec,
        published_at: new Date(video.published_at),
        tags: video.tags,
        category: video.category,
        stats: video.stats,
        workflow_status: "metadata_synced",
        is_shop_visit: null,
        content_type: null,
        classification_confidence: null,
        risk_flags: [],
        raw_payload_id: null,
        last_synced_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict((oc) =>
        oc.column("bvid").doUpdateSet({
          title: video.title,
          description: video.description,
          cover_url: video.cover_url,
          stats: video.stats,
          workflow_status: "metadata_synced",
          last_synced_at: new Date(),
          updated_at: new Date(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    const text = video.transcript.map((segment) => segment.text).join("\n");
    const hash = crypto.createHash("sha256").update(text).digest("hex");
    const [asset] = await db
      .insertInto("video_text_assets")
      .values({
        id: crypto.randomUUID(),
        video_id: row.id,
        source: "subtitle",
        language: "zh-CN",
        content_text: text,
        content_sha256: hash,
        segments: video.transcript,
        model_provider: null,
        model_name: null,
        status: "ready",
        error_message: null,
        object_key: null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict((oc) => oc.columns(["video_id", "source", "content_sha256"]).doNothing())
      .returningAll()
      .execute();

    const assetId = asset?.id;
    if (assetId) {
      for (const [index, segment] of video.transcript.entries()) {
        await db
          .insertInto("video_text_segments")
          .values({
            id: crypto.randomUUID(),
            asset_id: assetId,
            video_id: row.id,
            segment_index: index,
            start_sec: segment.start_sec,
            end_sec: segment.end_sec,
            text: segment.text,
            confidence: 0.99,
            created_at: new Date(),
          })
          .execute();
      }
    }

    for (const comment of video.comments) {
      await db
        .insertInto("video_comments")
        .values({
          id: crypto.randomUUID(),
          video_id: row.id,
          platform_comment_id: comment.id,
          parent_comment_id: null,
          content: comment.content,
          content_sha256: crypto.createHash("sha256").update(comment.content).digest("hex"),
          user_hash: null,
          like_count: comment.like_count,
          reply_count: null,
          published_at: new Date(),
          sample_type: comment.sample_type,
          contains_location_signal: /哪|路|地址|附近|搬|闭/.test(comment.content),
          contains_shop_signal: /店|面|餐|咖啡|火锅|牛肉/.test(comment.content),
          raw_payload_id: null,
          created_at: new Date(),
        })
        .onConflict((oc) => oc.column("platform_comment_id").doNothing())
        .execute();
    }

    await pipelineQueue.add("classify_video", { entityType: "video", entityId: row.id }, { attempts: 3 });
  }

  return { videos: payload.videos.length };
}

async function classifyVideoJob(db: Kysely<DB>, job: Job) {
  const { entityId } = job.data as { entityId: string };
  const video = await db.selectFrom("videos").selectAll().where("id", "=", entityId).executeTakeFirstOrThrow();
  const result = videoClassificationResultSchema.parse(await classifyVideo(video));
  const aiRun = await db
    .insertInto("ai_runs")
    .values({
      id: crypto.randomUUID(),
      stage: "classify_video",
      entity_type: "video",
      entity_id: video.id,
      provider: "mock",
      model: "mock-classifier",
      prompt_version: "classify_video.v1",
      input_hash: crypto.createHash("sha256").update(video.title).digest("hex"),
      input_payload: { title: video.title, bvid: video.bvid },
      output_payload: result,
      raw_output_text: null,
      usage: {},
      status: "success",
      error_message: null,
      started_at: new Date(),
      finished_at: new Date(),
      created_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await db
    .insertInto("video_classifications")
    .values({
      id: crypto.randomUUID(),
      video_id: video.id,
      ai_run_id: aiRun.id,
      is_shop_visit: result.is_shop_visit,
      content_type: result.content_type,
      confidence: result.confidence,
      reason_codes: result.reason_codes,
      risk_flags: result.risk_flags,
      need_manual_review: result.need_manual_review,
      evidence_ids: [],
      created_at: new Date(),
    })
    .execute();
  await db
    .updateTable("videos")
    .set({
      is_shop_visit: result.is_shop_visit,
      content_type: result.content_type,
      classification_confidence: result.confidence,
      risk_flags: result.risk_flags,
      workflow_status: result.is_shop_visit ? "classified" : "non_shop_visit",
      updated_at: new Date(),
    })
    .where("id", "=", video.id)
    .execute();

  if (result.is_shop_visit) {
    await pipelineQueue.add("extract_comment_signals", { entityType: "video", entityId: video.id }, { attempts: 3 });
    await pipelineQueue.add("structure_video", { entityType: "video", entityId: video.id }, { attempts: 3 });
  }
  return result;
}

async function commentSignalsJob(db: Kysely<DB>, job: Job) {
  const { entityId } = job.data as { entityId: string };
  const result = commentSignalExtractionSchema.parse(await extractCommentSignals(entityId));
  const aiRun = await db
    .insertInto("ai_runs")
    .values({
      id: crypto.randomUUID(),
      stage: "comment_signal",
      entity_type: "video",
      entity_id: entityId,
      provider: "mock",
      model: "mock-comment-signal",
      prompt_version: "comment_signal.v1",
      input_hash: entityId,
      input_payload: { video_id: entityId },
      output_payload: result,
      raw_output_text: null,
      usage: {},
      status: "success",
      error_message: null,
      started_at: new Date(),
      finished_at: new Date(),
      created_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await db
    .insertInto("comment_signal_extractions")
    .values({
      id: crypto.randomUUID(),
      video_id: entityId,
      ai_run_id: aiRun.id,
      sample_strategy: result.sample_strategy,
      shop_name_mentions: result.shop_name_mentions,
      address_mentions: result.address_mentions,
      status_mentions: result.status_mentions,
      aspect_sentiments: result.aspect_sentiments,
      risk_flags: result.risk_flags,
      created_at: new Date(),
    })
    .execute();
  return result;
}

async function structureVideoJob(db: Kysely<DB>, job: Job) {
  const { entityId } = job.data as { entityId: string };
  const video = await db.selectFrom("videos").selectAll().where("id", "=", entityId).executeTakeFirstOrThrow();
  const result = videoStructuredAnalysisSchema.parse(await structureVideo(video));
  const aiRun = await db
    .insertInto("ai_runs")
    .values({
      id: crypto.randomUUID(),
      stage: "structure_video",
      entity_type: "video",
      entity_id: video.id,
      provider: "mock",
      model: "mock-structure-video",
      prompt_version: "structure_video.v1",
      input_hash: crypto.createHash("sha256").update(video.title).digest("hex"),
      input_payload: { title: video.title },
      output_payload: result,
      raw_output_text: null,
      usage: {},
      status: "success",
      error_message: null,
      started_at: new Date(),
      finished_at: new Date(),
      created_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const analysis = await db
    .insertInto("ai_video_analyses")
    .values({
      id: crypto.randomUUID(),
      video_id: video.id,
      ai_run_id: aiRun.id,
      schema_version: result.schema_version,
      analysis_json: result,
      overall_summary: result.video.overall_summary,
      analysis_confidence: result.video.analysis_confidence,
      shop_candidate_count: result.shop_candidates.length,
      risk_flags: result.video.risk_flags,
      validation_status: result.video.risk_flags.length ? "needs_review" : "valid",
      validation_errors: [],
      created_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  for (const candidate of result.shop_candidates) {
    const row = await db
      .insertInto("shop_candidates")
      .values({
        id: crypto.randomUUID(),
        video_id: video.id,
        creator_id: video.creator_id,
        ai_video_analysis_id: analysis.id,
        candidate_name: candidate.candidate_name,
        normalized_name: candidate.normalized_name,
        alias_names: candidate.alias_names,
        candidate_type: candidate.candidate_type,
        category_primary: candidate.category.primary,
        category_secondary: candidate.category.secondary,
        province: candidate.location_hints.province ?? null,
        city: candidate.location_hints.city ?? null,
        district: candidate.location_hints.district ?? null,
        business_area: candidate.location_hints.business_area ?? null,
        address_hint: candidate.location_hints.address_text ?? null,
        landmarks: candidate.location_hints.landmarks,
        time_start_sec: candidate.time_range?.start_sec ?? null,
        time_end_sec: candidate.time_range?.end_sec ?? null,
        name_confidence: candidate.name_confidence,
        location_confidence: candidate.location_hints.confidence,
        summary_confidence: candidate.comment_summary.confidence,
        card_payload: candidate.card_payload,
        review_dimensions: candidate.review_dimensions,
        comment_summary: candidate.comment_summary,
        missing_fields: candidate.missing_fields,
        risk_flags: candidate.risk_flags,
        status: candidate.candidate_name ? "extracted" : "name_missing",
        selected_poi_id: null,
        merged_shop_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await db
      .insertInto("review_tasks")
      .values({
        id: crypto.randomUUID(),
        task_type: candidate.risk_flags.length ? "poi_review" : "shop_candidate_review",
        entity_type: "shop_candidate",
        entity_id: row.id,
        title: `审核候选店铺：${candidate.candidate_name ?? "店名未知"}`,
        reason: candidate.manual_review_reasons.join("；") || "AI 候选店铺需要审核",
        priority: candidate.risk_flags.length ? 80 : 50,
        status: "open",
        risk_flags: candidate.risk_flags,
        payload: { video_id: video.id, bvid: video.bvid },
        assigned_to: null,
        resolved_by: null,
        resolved_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();

    await pipelineQueue.add("match_poi", { entityType: "shop_candidate", entityId: row.id }, { attempts: 3 });
  }

  await db.updateTable("videos").set({ workflow_status: "ai_structured", updated_at: new Date() }).where("id", "=", video.id).execute();
  return result;
}

async function matchPoiJob(db: Kysely<DB>, job: Job) {
  const { entityId } = job.data as { entityId: string };
  const result = await searchAmapPoi(entityId);
  const selected = result.selected_poi;
  if (!selected) return result;

  const poi = await db
    .insertInto("pois")
    .values({
      id: crypto.randomUUID(),
      provider: "amap",
      provider_poi_id: selected.provider_poi_id,
      name: selected.name,
      address: selected.address ?? null,
      province: selected.province ?? null,
      city: selected.city ?? null,
      district: selected.district ?? null,
      business_area: selected.business_area ?? null,
      category: selected.category ?? null,
      category_code: null,
      lng: selected.location.lng,
      lat: selected.location.lat,
      coord_type: selected.location.coord_type,
      phone: null,
      business_hours: null,
      raw_payload_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .onConflict((oc) =>
      oc.columns(["provider", "provider_poi_id"]).doUpdateSet({
        name: selected.name,
        address: selected.address ?? null,
        updated_at: new Date(),
      }),
    )
    .returningAll()
    .executeTakeFirstOrThrow();

  const attempt = await db
    .insertInto("poi_match_attempts")
    .values({
      id: crypto.randomUUID(),
      shop_candidate_id: entityId,
      provider: "amap",
      query_strategy: "city_name_keyword",
      query_payload: { mock: true },
      status: "success",
      raw_payload_id: null,
      error_message: null,
      created_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await db
    .insertInto("poi_match_candidates")
    .values({
      id: crypto.randomUUID(),
      attempt_id: attempt.id,
      shop_candidate_id: entityId,
      poi_id: poi.id,
      rank: 1,
      match_features: result.candidates[0]?.match_features ?? {},
      match_score: result.match_score,
      match_status: result.match_score >= 0.9 && !result.risk_flags.length ? "selected" : "candidate",
      created_at: new Date(),
    })
    .execute();

  await db
    .updateTable("shop_candidates")
    .set({
      selected_poi_id: result.match_score >= 0.9 && !result.risk_flags.length ? poi.id : null,
      status: result.match_score >= 0.9 && !result.risk_flags.length ? "poi_matched" : "poi_match_need_review",
      updated_at: new Date(),
    })
    .where("id", "=", entityId)
    .execute();

  return result;
}
