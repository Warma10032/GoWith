import crypto from "node:crypto";
import type { Job } from "bullmq";
import type { ExpressionBuilder, ExpressionWrapper, Kysely } from "kysely";
import type { SqlBool } from "kysely";
import { findActiveTaskWithLock, type DB, type Json } from "@gowith/db";
import {
  commentSignalExtractionSchema,
  videoClassificationResultSchema,
  videoStructuredAnalysisSchema,
} from "@gowith/shared";
import {
  checkBilibiliCookiePool,
  fetchCreatorProfile,
  fetchCreatorVideos,
  fetchVideoAudioForAsr,
  type TranscriptSegment,
} from "../adapters/bilibili";
import {
  AiWorkerRequestError,
  buildVideoAnalysisRequest,
  classifyVideo,
  extractCommentSignals,
  structureVideo,
  transcribeAudioFile,
  type AiResponseEnvelope,
  type AiCallTrace,
  type CommentSample,
  type VideoAnalysisRequest,
} from "../adapters/ai";
import { searchAmapPoi } from "../adapters/poi";
import { env } from "../env";
import { pipelineQueue } from "../queue";

export async function handlePipelineJob(db: Kysely<DB>, job: Job) {
  if (await jobTargetsDeletedEntity(db, job)) {
    const result = { skipped: true, reason: "entity_deleted" };
    await finishRunIfTerminal(db, job, result);
    return result;
  }
  switch (job.name) {
    case "check_bilibili_auth_pool":
      return checkBilibiliAuthPoolJob(db, job);
    case "sync_creator_profile":
      return syncCreatorProfile(db, job);
    case "sync_creator_videos":
      return syncCreatorVideos(db, job);
    case "process_video":
      return processVideoJob(db, job);
    case "run_asr":
      return runAsrJob(db, job);
    case "classify_video":
      return classifyVideoJob(db, job);
    case "extract_comment_signals":
      return commentSignalsJob(db, job);
    case "structure_video":
      return structureVideoJob(db, job);
    case "match_poi":
      return matchPoiJob(db, job);
    default:
      throw new Error(`Unsupported pipeline job: ${job.name}`);
  }
}

async function jobTargetsDeletedEntity(db: Kysely<DB>, job: Job) {
  const entityId = (job.data as { entityId?: string }).entityId;
  if (!entityId) return false;
  if (["sync_creator_profile", "sync_creator_videos"].includes(job.name)) {
    const creator = await db
      .selectFrom("creators")
      .select("deleted_at")
      .where("id", "=", entityId)
      .executeTakeFirst();
    return Boolean(creator?.deleted_at);
  }
  if (
    [
      "process_video",
      "run_asr",
      "classify_video",
      "extract_comment_signals",
      "structure_video",
    ].includes(job.name)
  ) {
    const video = await db
      .selectFrom("videos")
      .select("deleted_at")
      .where("id", "=", entityId)
      .executeTakeFirst();
    return Boolean(video?.deleted_at);
  }
  if (job.name === "match_poi") {
    const candidate = await db
      .selectFrom("shop_candidates")
      .innerJoin("videos", "videos.id", "shop_candidates.video_id")
      .select("videos.deleted_at")
      .where("shop_candidates.id", "=", entityId)
      .executeTakeFirst();
    return Boolean(candidate?.deleted_at);
  }
  return false;
}

function effectiveVideoRow<T extends {
  title: string;
  title_override: string | null;
  description: string | null;
  description_override: string | null;
  tags: string[];
  tags_override: string[] | null;
  category: string | null;
  category_override: string | null;
}>(video: T): T {
  return {
    ...video,
    title: video.title_override ?? video.title,
    description: video.description_override ?? video.description,
    tags: video.tags_override ?? video.tags,
    category: video.category_override ?? video.category,
  };
}

async function videoWasDeleted(db: Kysely<DB>, videoId: string) {
  const video = await db
    .selectFrom("videos")
    .select("deleted_at")
    .where("id", "=", videoId)
    .executeTakeFirst();
  return Boolean(video?.deleted_at);
}

function runIdFromJob(job: Job): string | null {
  return typeof job.data?.run_id === "string" ? job.data.run_id : null;
}

function dbJobIdFromJob(job: Job): string | null {
  return typeof job.data?.db_job_id === "string" ? job.data.db_job_id : null;
}

async function emitPipelineEvent(
  db: Kysely<DB>,
  job: Job,
  input: {
    stage?: string;
    eventType:
      | "queued"
      | "started"
      | "progress"
      | "ai_request_prepared"
      | "ai_response_validated"
      | "saved"
      | "skipped"
      | "failed"
      | "completed";
    level?: "info" | "success" | "warning" | "error";
    title: string;
    message?: string | null;
    progressPercent?: number | null;
    detail?: Record<string, unknown>;
    aiRunId?: string | null;
    entityType?: string;
    entityId?: string;
  },
) {
  const runId = runIdFromJob(job);
  if (!runId) return;
  const entityType =
    input.entityType ??
    (typeof job.data?.entityType === "string"
      ? job.data.entityType
      : "unknown");
  const entityId =
    input.entityId ??
    (typeof job.data?.entityId === "string"
      ? job.data.entityId
      : crypto.randomUUID());
  await db
    .insertInto("pipeline_events")
    .values({
      run_id: runId,
      job_id: dbJobIdFromJob(job),
      entity_type: entityType,
      entity_id: entityId,
      stage: input.stage ?? job.name,
      event_type: input.eventType,
      level: input.level ?? "info",
      title: input.title,
      message: input.message ?? null,
      progress_percent: input.progressPercent ?? null,
      detail_json: (input.detail ?? {}) as Json,
      ai_run_id: input.aiRunId ?? null,
      created_at: new Date(),
    })
    .execute();
}

async function enqueueWorkerPipelineJob(
  db: Kysely<DB>,
  jobName: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
) {
  const runId = typeof payload.run_id === "string" ? payload.run_id : null;
  const dbJob = await db.transaction().execute(async (trx) => {
    const active = await findActiveTaskWithLock(trx, {
      jobType: jobName,
      entityType,
      entityId,
    });
    if (active) return null;

    return trx
      .insertInto("jobs")
      .values({
        job_type: jobName,
        entity_type: entityType,
        entity_id: entityId,
        run_id: runId,
        payload: payload as Json,
        status: "queued",
        priority: 0,
        attempts: 0,
        max_attempts: 3,
        scheduled_at: new Date(),
        started_at: null,
        finished_at: null,
        error_code: null,
        error_message: null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();
  });
  if (!dbJob) {
    await emitPipelineEvent(
      db,
      { name: jobName, data: { run_id: runId } } as Job,
      {
        stage: jobName,
        eventType: "skipped",
        level: "warning",
        title: `任务已在运行中，跳过重复入队：${jobName}`,
        entityType,
        entityId,
      },
    );
    return;
  }
  if (runId && dbJob?.id) {
    await db
      .insertInto("pipeline_events")
      .values({
        run_id: runId,
        job_id: dbJob.id,
        entity_type: entityType,
        entity_id: entityId,
        stage: jobName,
        event_type: "queued",
        level: "info",
        title: `任务已入队：${jobName}`,
        message: null,
        progress_percent: null,
        detail_json: payload as Json,
        ai_run_id: null,
        created_at: new Date(),
      })
      .execute();
  }
  await pipelineQueue.add(
    jobName,
    { entityType, entityId, db_job_id: dbJob?.id, ...payload },
    { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
  );
}

async function finishRunIfTerminal(
  db: Kysely<DB>,
  job: Job,
  summary: Record<string, unknown>,
) {
  const runId = runIdFromJob(job);
  if (!runId) return;
  await db
    .updateTable("pipeline_runs")
    .set({
      status: "success",
      finished_at: new Date(),
      summary_json: summary as Json,
    })
    .where("id", "=", runId)
    .execute();
}

async function checkBilibiliAuthPoolJob(db: Kysely<DB>, job: Job) {
  const result = await checkBilibiliCookiePool(db);
  await finishRunIfTerminal(db, job, { checked: true });
  return result;
}

async function syncCreatorProfile(db: Kysely<DB>, job: Job) {
  const { entityId, bilibili_uid } = job.data as {
    entityId: string;
    bilibili_uid: string;
  };
  const payload = await fetchCreatorProfile(db, bilibili_uid);
  const refreshedAt = new Date();

  // 头像保持原始 B站 URL（与 videos.cover_url 一致的存储模式）。
  // 前端 SafeImage 的 referrerPolicy="no-referrer" 已绕过 hdslb.com CDN 防盗链，
  // 不需要再 downloadImage 到本地。原始 URL 同时写到 avatar_url 和
  // avatar_source_url，前者给前端展示，后者给后台审计。

  await db
    .updateTable("creators")
    .set({
      name: payload.name,
      avatar_url: payload.avatar_url,
      avatar_source_url: payload.avatar_url,
      bio: payload.bio,
      follower_count: payload.follower_count,
      raw_payload_id: payload.raw_payload_id,
      stats: {
        profile: {
          follower_count: payload.follower_count,
          refreshed_at: refreshedAt.toISOString(),
        },
      },
      updated_at: refreshedAt,
    })
    .where("id", "=", entityId)
    .where("deleted_at", "is", null)
    .execute();
  const result = { updated: true, creator_id: entityId };
  await finishRunIfTerminal(db, job, result);
  return result;
}

async function syncCreatorVideos(db: Kysely<DB>, job: Job) {
  const { entityId, bilibili_uid } = job.data as {
    entityId: string;
    bilibili_uid: string;
  };
  await emitPipelineEvent(db, job, {
    eventType: "progress",
    title: "开始同步博主视频基础信息",
    detail: { bilibili_uid },
    progressPercent: 5,
  });
  const payload = await fetchCreatorVideos(db, bilibili_uid);

  // 头像保持原始 B站 URL（与 creator 同步逻辑一致 + videos.cover_url 同样的模式）

  const creatorUpdate = await db
    .updateTable("creators")
    .set({
      name: payload.name,
      avatar_url: payload.avatar_url,
      avatar_source_url: payload.avatar_url,
      bio: payload.bio,
      follower_count: payload.follower_count,
      raw_payload_id: payload.raw_payload_id,
      last_synced_at: new Date(),
      updated_at: new Date(),
    })
    .where("id", "=", entityId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!creatorUpdate.numUpdatedRows) {
    return { skipped: true, reason: "entity_deleted" };
  }

  for (const video of payload.videos) {
    // 视频封面也保持原始 B站 URL，不再下载到 /uploads/videos/。前端 SafeImage 的
    // referrerPolicy="no-referrer" 已绕过防盗链。
    const row = await db
      .insertInto("videos")
      .values({
        id: crypto.randomUUID(),
        creator_id: entityId,
        bvid: video.bvid,
        aid: video.aid,
        cid: video.cid,
        title: video.title,
        description: video.description,
        cover_url: video.cover_url,
        cover_source_url: video.cover_url,
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
        raw_payload_id: video.raw_payload_id,
        last_synced_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict((oc) =>
        oc.column("bvid").doUpdateSet({
          title: video.title,
          description: video.description,
          cover_url: video.cover_url,
          cover_source_url: video.cover_url,
          aid: video.aid,
          cid: video.cid,
          source_url: video.source_url,
          duration_sec: video.duration_sec,
          published_at: new Date(video.published_at),
          tags: video.tags,
          category: video.category,
          stats: video.stats,
          workflow_status: "metadata_synced",
          raw_payload_id: video.raw_payload_id,
          last_synced_at: new Date(),
          updated_at: new Date(),
        }).where("videos.deleted_at", "is", null),
      )
      .returningAll()
      .executeTakeFirst();
    if (!row) continue;

    if (video.transcript.length > 0) {
      await saveTextAsset(db, {
        videoId: row.id,
        source: "subtitle",
        language: video.transcript_language ?? "zh-CN",
        segments: video.transcript,
        contentText: null,
        modelProvider: null,
        modelName: null,
      });
      await db
        .updateTable("videos")
        .set({ workflow_status: "subtitle_ready", updated_at: new Date() })
        .where("id", "=", row.id)
        .execute();
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
          content_sha256: crypto
            .createHash("sha256")
            .update(comment.content)
            .digest("hex"),
          user_hash: comment.user_hash,
          author_name: comment.author_name,
          author_avatar_url: comment.author_avatar_url,
          image_urls: comment.image_urls,
          like_count: comment.like_count,
          reply_count: comment.reply_count,
          published_at: comment.published_at
            ? new Date(comment.published_at)
            : null,
          sample_type: comment.sample_type,
          contains_location_signal: /哪|路|地址|附近|搬|闭/.test(
            comment.content,
          ),
          contains_shop_signal: /店|面|餐|咖啡|火锅|牛肉/.test(comment.content),
          raw_payload_id: comment.raw_payload_id,
          created_at: new Date(),
        })
        .onConflict((oc) => oc.column("platform_comment_id").doNothing())
        .execute();
    }

    await emitPipelineEvent(db, job, {
      eventType: "saved",
      title: "视频基础信息已保存",
      message: video.title,
      entityType: "video",
      entityId: row.id,
      detail: {
        bvid: video.bvid,
        has_subtitle: video.transcript.length > 0,
        comment_count: video.comments.length,
      },
    });
  }

  await emitPipelineEvent(db, job, {
    eventType: "completed",
    level: "success",
    title: "博主视频同步完成",
    message: `已同步 ${payload.videos.length} 个视频，AI 处理需在视频页手动启动。`,
    progressPercent: 100,
    detail: { video_count: payload.videos.length },
  });
  await finishRunIfTerminal(db, job, { video_count: payload.videos.length });
  return { videos: payload.videos.length };
}

async function processVideoJob(db: Kysely<DB>, job: Job) {
  const { entityId } = job.data as { entityId: string };
  const video = effectiveVideoRow(
    await db
      .selectFrom("videos")
      .selectAll()
      .where("id", "=", entityId)
      .where("deleted_at", "is", null)
      .executeTakeFirstOrThrow(),
  );
  const textAsset = await db
    .selectFrom("video_text_assets")
    .select(["id", "source"])
    .where("video_id", "=", entityId)
    .where("status", "=", "ready")
    .orderBy("created_at", "desc")
    .executeTakeFirst();
  await emitPipelineEvent(db, job, {
    eventType: "progress",
    title: "视频处理入口检查完成",
    message: textAsset
      ? `已有 ${textAsset.source} 文本，准备进入 AI 分析。`
      : "未发现可用字幕或 ASR，准备转写音频。",
    progressPercent: 10,
    detail: {
      bvid: video.bvid,
      workflow_status: video.workflow_status,
      has_text_asset: Boolean(textAsset),
      text_source: textAsset?.source ?? null,
    },
  });

  if (textAsset) {
    await enqueueWorkerPipelineJob(db, "classify_video", "video", entityId, {
      run_id: runIdFromJob(job),
    });
  } else if (env.bilibiliAsrEnabled) {
    await enqueueWorkerPipelineJob(db, "run_asr", "video", entityId, {
      run_id: runIdFromJob(job),
    });
  } else {
    await db
      .updateTable("videos")
      .set({ workflow_status: "text_unavailable", updated_at: new Date() })
      .where("id", "=", entityId)
      .execute();
    await emitPipelineEvent(db, job, {
      eventType: "failed",
      level: "warning",
      title: "无法开始 AI 处理",
      message: "没有可用文本且 ASR 未开启。",
      progressPercent: 100,
    });
  }
  return { next: textAsset ? "classify_video" : "run_asr" };
}

async function saveTextAsset(
  db: Kysely<DB>,
  input: {
    videoId: string;
    source: "subtitle" | "asr";
    language: string | null;
    segments: Array<TranscriptSegment & { confidence?: number | null }>;
    contentText: string | null;
    modelProvider: string | null;
    modelName: string | null;
  },
) {
  const text =
    input.contentText ??
    input.segments.map((segment) => segment.text).join("\n");
  if (!text.trim()) return null;
  const hash = crypto.createHash("sha256").update(text).digest("hex");
  const [asset] = await db
    .insertInto("video_text_assets")
    .values({
      id: crypto.randomUUID(),
      video_id: input.videoId,
      source: input.source,
      language: input.language,
      content_text: text,
      content_sha256: hash,
      segments: JSON.stringify(input.segments),
      model_provider: input.modelProvider,
      model_name: input.modelName,
      status: "ready",
      error_message: null,
      object_key: null,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .onConflict((oc) =>
      oc.columns(["video_id", "source", "content_sha256"]).doNothing(),
    )
    .returningAll()
    .execute();

  const assetId = asset?.id;
  if (!assetId) return null;
  for (const [index, segment] of input.segments.entries()) {
    await db
      .insertInto("video_text_segments")
      .values({
        id: crypto.randomUUID(),
        asset_id: assetId,
        video_id: input.videoId,
        segment_index: index,
        start_sec: segment.start_sec,
        end_sec: segment.end_sec,
        text: segment.text,
        confidence: normalizeSegmentConfidence(
          segment.confidence,
          input.source,
        ),
        created_at: new Date(),
      })
      .execute();
  }
  return asset;
}

function normalizeSegmentConfidence(
  value: number | null | undefined,
  source: "subtitle" | "asr",
): number | null {
  if (source === "subtitle") return 1;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

interface AnalysisInput {
  request: VideoAnalysisRequest;
  evidenceIds: Set<string>;
}

async function buildAnalysisInput(
  db: Kysely<DB>,
  video: {
    id: string;
    bvid: string;
    creator_id: string;
    title: string;
    description: string | null;
    tags: string[];
    category: string | null;
  },
  options: {
    commentSignals?: Record<string, unknown>;
    previousStageOutputs?: Record<string, unknown>;
  } = {},
): Promise<AnalysisInput> {
  const evidenceIds = new Set<string>();
  const transcriptSegments: Array<
    TranscriptSegment & { segment_id: string; confidence?: number | null }
  > = [];
  const commentSamples: CommentSample[] = [];
  const metadataEvidence: VideoAnalysisRequest["video_metadata"]["evidence"] =
    [];

  const titleEvidenceId = await addTextEvidence(db, evidenceIds, {
    videoId: video.id,
    source: "title",
    sourceRefId: `${video.id}:title`,
    text: video.title,
  });
  metadataEvidence.push({
    evidence_id: titleEvidenceId,
    source: "title",
    text: video.title,
  });
  if (video.description?.trim()) {
    const descriptionEvidenceId = await addTextEvidence(db, evidenceIds, {
      videoId: video.id,
      source: "description",
      sourceRefId: `${video.id}:description`,
      text: video.description,
    });
    metadataEvidence.push({
      evidence_id: descriptionEvidenceId,
      source: "description",
      text: video.description,
    });
  }
  for (const tag of video.tags.slice(0, 20)) {
    const tagEvidenceId = await addTextEvidence(db, evidenceIds, {
      videoId: video.id,
      source: "tag",
      sourceRefId: `${video.id}:tag:${tag}`,
      text: tag,
    });
    metadataEvidence.push({
      evidence_id: tagEvidenceId,
      source: "tag",
      text: tag,
    });
  }

  const textRows = await db
    .selectFrom("video_text_segments")
    .innerJoin(
      "video_text_assets",
      "video_text_assets.id",
      "video_text_segments.asset_id",
    )
    .select([
      "video_text_segments.id",
      "video_text_segments.start_sec",
      "video_text_segments.end_sec",
      "video_text_segments.text",
      "video_text_segments.confidence",
      "video_text_assets.source",
    ])
    .where("video_text_segments.video_id", "=", video.id)
    .orderBy("video_text_assets.source", "desc")
    .orderBy("video_text_segments.segment_index")
    .limit(240)
    .execute();

  const preferredSource = textRows.some((row) => row.source === "subtitle")
    ? "subtitle"
    : "asr";
  for (const row of textRows
    .filter((item) => item.source === preferredSource)
    .slice(0, 180)) {
    const evidenceId = await addTextEvidence(db, evidenceIds, {
      videoId: video.id,
      source: row.source,
      sourceRefId: row.id,
      text: row.text,
      startSec: row.start_sec,
      endSec: row.end_sec,
      confidence: row.confidence,
    });
    transcriptSegments.push({
      segment_id: evidenceId,
      start_sec: row.start_sec ?? 0,
      end_sec: row.end_sec ?? row.start_sec ?? 0,
      text: row.text,
      confidence: row.confidence,
    });
  }

  const comments = await db
    .selectFrom("video_comments")
    .selectAll()
    .where("video_id", "=", video.id)
    .orderBy("contains_shop_signal", "desc")
    .orderBy("contains_location_signal", "desc")
    .orderBy("like_count", "desc")
    .limit(80)
    .execute();

  for (const comment of comments) {
    const evidenceId = await addTextEvidence(db, evidenceIds, {
      videoId: video.id,
      source: "comment",
      sourceRefId: comment.id,
      text: comment.content,
      confidence: null,
    });
    commentSamples.push({
      comment_id: evidenceId,
      content: comment.content,
      like_count: comment.like_count,
      reply_count: comment.reply_count,
      sample_type: comment.sample_type,
      contains_location_signal: comment.contains_location_signal,
      contains_shop_signal: comment.contains_shop_signal,
    });
  }

  return {
    evidenceIds,
    request: buildVideoAnalysisRequest({
      video,
      transcriptSegments,
      commentSamples,
      commentSignals: options.commentSignals,
      previousStageOutputs: options.previousStageOutputs,
      metadataEvidence,
    }),
  };
}

async function addTextEvidence(
  db: Kysely<DB>,
  evidenceIds: Set<string>,
  input: {
    videoId: string;
    source: string;
    sourceRefId: string;
    text: string;
    startSec?: number | null;
    endSec?: number | null;
    confidence?: number | null;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .insertInto("evidence")
    .values({
      id,
      video_id: input.videoId,
      shop_candidate_id: null,
      shop_id: null,
      source: input.source,
      source_ref_id: input.sourceRefId,
      text_excerpt: input.text.slice(0, 500),
      start_sec: input.startSec ?? null,
      end_sec: input.endSec ?? null,
      confidence: input.confidence ?? null,
      metadata: JSON.stringify({ generated_for: "ai_input" }),
      created_at: new Date(),
    })
    .execute();
  evidenceIds.add(id);
  return id;
}

function validEvidenceIds(ids: string[], allowed: Set<string>): string[] {
  return ids.filter((id) => allowed.has(id));
}

function aiRunValues(
  stage: string,
  videoId: string,
  inputHash: string,
  inputPayload: Record<string, unknown>,
  envelope: AiResponseEnvelope<unknown>,
) {
  return {
    id: crypto.randomUUID(),
    parent_ai_run_id: null,
    call_index: null,
    stage,
    entity_type: "video",
    entity_id: videoId,
    provider: envelope.provider,
    model: envelope.model,
    prompt_version: envelope.prompt_version,
    input_hash: inputHash,
    input_payload: JSON.stringify(inputPayload),
    output_payload: JSON.stringify(envelope.output),
    raw_output_text: envelope.raw_output_text,
    usage: JSON.stringify(envelope.usage),
    status: "success" as const,
    error_message: null,
    started_at: new Date(),
    finished_at: new Date(),
    created_at: new Date(),
  };
}

async function saveAiSubcalls(
  db: Kysely<DB>,
  parentAiRunId: string,
  videoId: string,
  subcalls: AiCallTrace[],
) {
  if (!subcalls.length) return;
  await db
    .insertInto("ai_runs")
    .values(
      subcalls.map((call) => ({
        id: crypto.randomUUID(),
        parent_ai_run_id: parentAiRunId,
        call_index: call.call_index,
        stage: call.stage,
        entity_type: "video",
        entity_id: videoId,
        provider: call.provider,
        model: call.model,
        prompt_version: call.prompt_version,
        input_hash: call.input_hash,
        input_payload: JSON.stringify(call.input_payload),
        output_payload: call.output_payload
          ? JSON.stringify(call.output_payload)
          : null,
        raw_output_text: call.raw_output_text,
        usage: JSON.stringify(call.usage),
        status: call.status,
        error_message: call.error_message,
        started_at: new Date(),
        finished_at: new Date(),
        created_at: new Date(),
      })),
    )
    .execute();
}

async function saveFailedAiCalls(
  db: Kysely<DB>,
  stage: string,
  videoId: string,
  request: VideoAnalysisRequest,
  error: AiWorkerRequestError,
) {
  const parent = await db
    .insertInto("ai_runs")
    .values({
      id: crypto.randomUUID(),
      parent_ai_run_id: null,
      call_index: null,
      stage,
      entity_type: "video",
      entity_id: videoId,
      provider: "minimax",
      model: error.subcalls.at(-1)?.model ?? "unknown",
      prompt_version:
        error.subcalls.at(-1)?.prompt_version ?? `${stage}.failed`,
      input_hash: crypto
        .createHash("sha256")
        .update(JSON.stringify(request))
        .digest("hex"),
      input_payload: JSON.stringify({ request }),
      output_payload: null,
      raw_output_text: error.subcalls.at(-1)?.raw_output_text ?? null,
      usage: JSON.stringify({}),
      status: "failed",
      error_message: error.message,
      started_at: new Date(),
      finished_at: new Date(),
      created_at: new Date(),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await saveAiSubcalls(db, parent.id, videoId, error.subcalls);
  const existingReview = await db
    .selectFrom("review_tasks")
    .select("id")
    .where("task_type", "=", "shop_candidate_review")
    .where("entity_type", "=", "video")
    .where("entity_id", "=", videoId)
    .where("status", "in", ["open", "in_progress"])
    .executeTakeFirst();
  if (!existingReview) {
    await db
      .insertInto("review_tasks")
      .values({
        id: crypto.randomUUID(),
        task_type: "shop_candidate_review",
        entity_type: "video",
        entity_id: videoId,
        title: `AI 阶段失败：${stage}`,
        reason: error.message,
        priority: 80,
        status: "open",
        risk_flags: ["ai_output_incomplete"],
        payload: { ai_run_id: parent.id, stage },
        assigned_to: null,
        resolved_by: null,
        resolved_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();
  }
}

async function runAsrJob(db: Kysely<DB>, job: Job) {
  const { entityId } = job.data as { entityId: string };
  const video = effectiveVideoRow(
    await db
      .selectFrom("videos")
      .selectAll()
      .where("id", "=", entityId)
      .where("deleted_at", "is", null)
      .executeTakeFirstOrThrow(),
  );
  await emitPipelineEvent(db, job, {
    eventType: "progress",
    title: "准备进行 ASR 转写",
    message: video.title,
    progressPercent: 20,
    detail: { bvid: video.bvid, cid: video.cid },
  });
  const audio = await fetchVideoAudioForAsr(db, {
    bvid: video.bvid,
    cid: video.cid,
  });
  try {
    const result = await transcribeAudioFile(audio);
    if (await videoWasDeleted(db, video.id)) {
      return { skipped: true, reason: "entity_deleted" };
    }
    await saveTextAsset(db, {
      videoId: video.id,
      source: "asr",
      language: result.language,
      segments: result.segments.map((segment) => ({
        start_sec: segment.start_sec,
        end_sec: segment.end_sec,
        text: segment.text,
        confidence: segment.confidence,
      })),
      contentText: result.content_text,
      modelProvider: result.model_provider,
      modelName: result.model_name,
    });
    await db
      .updateTable("videos")
      .set({ workflow_status: "asr_ready", updated_at: new Date() })
      .where("id", "=", video.id)
      .where("deleted_at", "is", null)
      .execute();
    await emitPipelineEvent(db, job, {
      eventType: "saved",
      level: "success",
      title: "ASR 文本已保存",
      progressPercent: 35,
      detail: {
        segment_count: result.segments.length,
        language: result.language,
        model_provider: result.model_provider,
        model_name: result.model_name,
      },
    });
    await enqueueWorkerPipelineJob(db, "classify_video", "video", video.id, {
      run_id: runIdFromJob(job),
    });
    return result;
  } catch (error) {
    await db
      .updateTable("videos")
      .set({
        workflow_status: "text_unavailable",
        risk_flags: [
          ...video.risk_flags,
          "subtitle_missing",
          "asr_low_quality",
        ],
        updated_at: new Date(),
      })
      .where("id", "=", video.id)
      .execute();
    throw error;
  } finally {
    await audio.cleanup();
  }
}

async function classifyVideoJob(db: Kysely<DB>, job: Job) {
  const { entityId } = job.data as { entityId: string };
  const video = effectiveVideoRow(
    await db
      .selectFrom("videos")
      .selectAll()
      .where("id", "=", entityId)
      .where("deleted_at", "is", null)
      .executeTakeFirstOrThrow(),
  );
  const analysisInput = await buildAnalysisInput(db, video);
  await emitPipelineEvent(db, job, {
    eventType: "ai_request_prepared",
    title: "AI 分类请求已准备",
    progressPercent: 45,
    detail: {
      title: video.title,
      transcript_segments: analysisInput.request.transcript_segments.length,
      comment_samples: analysisInput.request.comment_samples.length,
      evidence_count: analysisInput.evidenceIds.size,
    },
  });
  let envelope: Awaited<ReturnType<typeof classifyVideo>>;
  try {
    envelope = await classifyVideo(analysisInput.request);
  } catch (error) {
    if (await videoWasDeleted(db, video.id)) {
      return { skipped: true, reason: "entity_deleted" };
    }
    if (error instanceof AiWorkerRequestError) {
      await saveFailedAiCalls(
        db,
        "classify_video",
        video.id,
        analysisInput.request,
        error,
      );
    }
    throw error;
  }
  if (await videoWasDeleted(db, video.id)) {
    return { skipped: true, reason: "entity_deleted" };
  }
  const result = videoClassificationResultSchema.parse(envelope.output);
  result.evidence_ids = validEvidenceIds(
    result.evidence_ids,
    analysisInput.evidenceIds,
  );
  const aiRun = await db
    .insertInto("ai_runs")
    .values(
      aiRunValues(
        "classify_video",
        video.id,
        crypto
          .createHash("sha256")
          .update(JSON.stringify(analysisInput.request))
          .digest("hex"),
        { request: analysisInput.request },
        { ...envelope, output: result },
      ),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
  await saveAiSubcalls(db, aiRun.id, video.id, envelope.subcalls);
  await emitPipelineEvent(db, job, {
    eventType: "ai_response_validated",
    level: "success",
    title: "AI 分类结果已校验",
    progressPercent: 55,
    detail: {
      provider: envelope.provider,
      model: envelope.model,
      prompt_version: envelope.prompt_version,
      is_shop_visit: result.is_shop_visit,
      content_type: result.content_type,
      confidence: result.confidence,
      risk_flags: result.risk_flags,
      usage: envelope.usage,
    },
    aiRunId: aiRun.id,
  });
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
      evidence_ids: result.evidence_ids,
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
    await enqueueWorkerPipelineJob(
      db,
      "extract_comment_signals",
      "video",
      video.id,
      { run_id: runIdFromJob(job) },
    );
  } else {
    await emitPipelineEvent(db, job, {
      eventType: "completed",
      level: "success",
      title: "视频被标记为非探店",
      message: "处理链已结束。",
      progressPercent: 100,
      detail: {
        content_type: result.content_type,
        confidence: result.confidence,
      },
      aiRunId: aiRun.id,
    });
    await finishRunIfTerminal(db, job, {
      is_shop_visit: false,
      content_type: result.content_type,
      confidence: result.confidence,
    });
  }
  return result;
}

async function commentSignalsJob(db: Kysely<DB>, job: Job) {
  const { entityId } = job.data as { entityId: string };
  const video = effectiveVideoRow(
    await db
      .selectFrom("videos")
      .selectAll()
      .where("id", "=", entityId)
      .where("deleted_at", "is", null)
      .executeTakeFirstOrThrow(),
  );
  const classification = await db
    .selectFrom("video_classifications")
    .selectAll()
    .where("video_id", "=", entityId)
    .orderBy("created_at", "desc")
    .executeTakeFirst();
  const analysisInput = await buildAnalysisInput(db, video, {
    previousStageOutputs: { classification },
  });
  await emitPipelineEvent(db, job, {
    eventType: "ai_request_prepared",
    title: "评论线索分析请求已准备",
    progressPercent: 62,
    detail: {
      transcript_segments: analysisInput.request.transcript_segments.length,
      comment_samples: analysisInput.request.comment_samples.length,
      evidence_count: analysisInput.evidenceIds.size,
    },
  });
  let envelope: Awaited<ReturnType<typeof extractCommentSignals>>;
  try {
    envelope = await extractCommentSignals(analysisInput.request);
  } catch (error) {
    if (await videoWasDeleted(db, video.id)) {
      return { skipped: true, reason: "entity_deleted" };
    }
    if (error instanceof AiWorkerRequestError) {
      await saveFailedAiCalls(
        db,
        "comment_signal",
        video.id,
        analysisInput.request,
        error,
      );
    }
    throw error;
  }
  if (await videoWasDeleted(db, video.id)) {
    return { skipped: true, reason: "entity_deleted" };
  }
  const result = commentSignalExtractionSchema.parse(envelope.output);
  for (const mention of result.shop_name_mentions)
    mention.evidence_ids = validEvidenceIds(
      mention.evidence_ids,
      analysisInput.evidenceIds,
    );
  for (const mention of result.address_mentions)
    mention.evidence_ids = validEvidenceIds(
      mention.evidence_ids,
      analysisInput.evidenceIds,
    );
  for (const question of result.location_questions)
    question.evidence_ids = validEvidenceIds(
      question.evidence_ids,
      analysisInput.evidenceIds,
    );
  for (const sentiment of Object.values(result.aspect_sentiments)) {
    sentiment.evidence_ids = validEvidenceIds(
      sentiment.evidence_ids,
      analysisInput.evidenceIds,
    );
  }
  const aiRun = await db
    .insertInto("ai_runs")
    .values(
      aiRunValues(
        "comment_signal",
        entityId,
        crypto
          .createHash("sha256")
          .update(JSON.stringify(analysisInput.request))
          .digest("hex"),
        { request: analysisInput.request },
        { ...envelope, output: result },
      ),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
  await saveAiSubcalls(db, aiRun.id, video.id, envelope.subcalls);
  await emitPipelineEvent(db, job, {
    eventType: "ai_response_validated",
    level: "success",
    title: "评论线索结果已校验",
    progressPercent: 70,
    detail: {
      provider: envelope.provider,
      model: envelope.model,
      prompt_version: envelope.prompt_version,
      shop_name_mentions: result.shop_name_mentions.length,
      address_mentions: result.address_mentions.length,
      risk_flags: result.risk_flags,
      usage: envelope.usage,
    },
    aiRunId: aiRun.id,
  });
  await db
    .insertInto("comment_signal_extractions")
    .values({
      id: crypto.randomUUID(),
      video_id: entityId,
      ai_run_id: aiRun.id,
      sample_strategy: JSON.stringify(result.sample_strategy),
      shop_name_mentions: JSON.stringify(result.shop_name_mentions),
      address_mentions: JSON.stringify(result.address_mentions),
      status_mentions: JSON.stringify(result.status_mentions),
      aspect_sentiments: JSON.stringify(result.aspect_sentiments),
      risk_flags: result.risk_flags,
      created_at: new Date(),
    })
    .execute();
  await enqueueWorkerPipelineJob(db, "structure_video", "video", entityId, {
    run_id: runIdFromJob(job),
  });
  return result;
}

async function structureVideoJob(db: Kysely<DB>, job: Job) {
  const { entityId } = job.data as { entityId: string };
  const video = effectiveVideoRow(
    await db
      .selectFrom("videos")
      .selectAll()
      .where("id", "=", entityId)
      .where("deleted_at", "is", null)
      .executeTakeFirstOrThrow(),
  );
  const commentSignals = await db
    .selectFrom("comment_signal_extractions")
    .selectAll()
    .where("video_id", "=", entityId)
    .orderBy("created_at", "desc")
    .executeTakeFirst();
  const classification = await db
    .selectFrom("video_classifications")
    .selectAll()
    .where("video_id", "=", entityId)
    .orderBy("created_at", "desc")
    .executeTakeFirst();
  const analysisInput = await buildAnalysisInput(db, video, {
    commentSignals: commentSignals ?? undefined,
    previousStageOutputs: { classification, commentSignals },
  });
  await emitPipelineEvent(db, job, {
    eventType: "ai_request_prepared",
    title: "结构化分析请求已准备",
    progressPercent: 78,
    detail: {
      transcript_segments: analysisInput.request.transcript_segments.length,
      comment_samples: analysisInput.request.comment_samples.length,
      evidence_count: analysisInput.evidenceIds.size,
      has_comment_signals: Boolean(commentSignals),
    },
  });
  let envelope: Awaited<ReturnType<typeof structureVideo>>;
  try {
    envelope = await structureVideo(analysisInput.request);
  } catch (error) {
    if (await videoWasDeleted(db, video.id)) {
      return { skipped: true, reason: "entity_deleted" };
    }
    if (error instanceof AiWorkerRequestError) {
      await saveFailedAiCalls(
        db,
        "structure_video",
        video.id,
        analysisInput.request,
        error,
      );
    }
    throw error;
  }
  if (await videoWasDeleted(db, video.id)) {
    return { skipped: true, reason: "entity_deleted" };
  }
  const result = videoStructuredAnalysisSchema.parse(envelope.output);
  result.video.evidence_ids = validEvidenceIds(
    result.video.evidence_ids,
    analysisInput.evidenceIds,
  );
  for (const candidate of result.shop_candidates) {
    candidate.card_payload.recommendation_score_evidence_ids = validEvidenceIds(
      candidate.card_payload.recommendation_score_evidence_ids,
      analysisInput.evidenceIds,
    );
    for (const dish of candidate.card_payload.recommended_dishes)
      dish.evidence_ids = validEvidenceIds(
        dish.evidence_ids,
        analysisInput.evidenceIds,
      );
    for (const avoidPoint of candidate.card_payload.avoid_points)
      avoidPoint.evidence_ids = validEvidenceIds(
        avoidPoint.evidence_ids,
        analysisInput.evidenceIds,
      );
    for (const dimension of Object.values(candidate.review_dimensions)) {
      dimension.evidence_ids = validEvidenceIds(
        dimension.evidence_ids,
        analysisInput.evidenceIds,
      );
    }
    candidate.comment_summary.evidence_ids = validEvidenceIds(
      candidate.comment_summary.evidence_ids,
      analysisInput.evidenceIds,
    );
  }
  const aiRun = await db
    .insertInto("ai_runs")
    .values(
      aiRunValues(
        "structure_video",
        video.id,
        crypto
          .createHash("sha256")
          .update(JSON.stringify(analysisInput.request))
          .digest("hex"),
        { request: analysisInput.request },
        { ...envelope, output: result },
      ),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
  await saveAiSubcalls(db, aiRun.id, video.id, envelope.subcalls);
  await emitPipelineEvent(db, job, {
    eventType: "ai_response_validated",
    level: "success",
    title: "结构化分析结果已校验",
    progressPercent: 86,
    detail: {
      provider: envelope.provider,
      model: envelope.model,
      prompt_version: envelope.prompt_version,
      shop_candidate_count: result.shop_candidates.length,
      analysis_confidence: result.video.analysis_confidence,
      risk_flags: result.video.risk_flags,
      usage: envelope.usage,
    },
    aiRunId: aiRun.id,
  });
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
      validation_status: result.video.risk_flags.length
        ? "needs_review"
        : "valid",
      validation_errors: [],
      created_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  for (const candidate of result.shop_candidates) {
    // 去重：同一视频 + 同一 normalized_name（或 candidate_name 兜底）的候选，
    // AI 重跑时覆盖写回而不是 INSERT 新行，避免一个视频下出现 N 条重复候选。
    // 都没名字的 AI 抽取（极少见）按全新候选处理。
    const existing = await db
      .selectFrom("shop_candidates")
      .select(["id", "selected_poi_id"])
      .where("video_id", "=", video.id)
      .where((eb) => {
        const conds: ExpressionWrapper<DB, "shop_candidates", SqlBool>[] = [];
        if (candidate.normalized_name) {
          conds.push(eb("normalized_name", "=", candidate.normalized_name));
        }
        if (candidate.candidate_name) {
          conds.push(eb("candidate_name", "=", candidate.candidate_name));
        }
        if (conds.length === 0) return eb.val(false);
        if (conds.length === 1) return conds[0]!;
        return eb.or(conds);
      })
      .orderBy("created_at", "asc")
      .executeTakeFirst();

    const row = existing
      ? await db
          .updateTable("shop_candidates")
          .set({
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
            // 已有 POI 匹配的回写保留 selected_poi_id 和 status，避免反复重跑 match_poi
            status: existing.selected_poi_id
              ? undefined
              : candidate.candidate_name
                ? "extracted"
                : "name_missing",
            updated_at: new Date(),
          })
          .where("id", "=", existing.id)
          .returningAll()
          .executeTakeFirstOrThrow()
      : await db
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

    // 已选过 POI 的旧候选被覆盖后无需重跑 match_poi；新候选或未选 POI 的入队。
    if (!existing?.selected_poi_id) {
      await db
        .insertInto("review_tasks")
        .values({
          id: crypto.randomUUID(),
          task_type: candidate.risk_flags.length
            ? "poi_review"
            : "shop_candidate_review",
          entity_type: "shop_candidate",
          entity_id: row.id,
          title: `审核候选店铺：${candidate.candidate_name ?? "店名未知"}`,
          reason: candidateReviewReason(candidate),
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

      await enqueueWorkerPipelineJob(
        db,
        "match_poi",
        "shop_candidate",
        row.id,
        {
          run_id: runIdFromJob(job),
        },
      );
    }
  }

  await db
    .updateTable("videos")
    .set({ workflow_status: "ai_structured", updated_at: new Date() })
    .where("id", "=", video.id)
    .execute();
  await emitPipelineEvent(db, job, {
    eventType: "saved",
    level: "success",
    title: "视频结构化结果已保存",
    progressPercent: result.shop_candidates.length ? 90 : 100,
    detail: {
      shop_candidate_count: result.shop_candidates.length,
      ai_video_analysis_id: analysis.id,
    },
    aiRunId: aiRun.id,
  });
  if (!result.shop_candidates.length) {
    await finishRunIfTerminal(db, job, {
      shop_candidate_count: 0,
      analysis_id: analysis.id,
    });
  }
  return result;
}

function candidateReviewReason(input: {
  risk_flags: string[];
  missing_fields: string[];
  candidate_name: string | null;
}) {
  const parts = [
    ...input.risk_flags.map((flag) => `风险：${flag}`),
    ...input.missing_fields.map((field) => `缺少：${field}`),
  ];
  if (parts.length) return parts.slice(0, 6).join("；");
  return input.candidate_name
    ? `候选店铺已生成：${input.candidate_name}`
    : "候选店铺缺少店名";
}

async function matchPoiJob(db: Kysely<DB>, job: Job) {
  const { entityId, keywords, region, types } = job.data as {
    entityId: string;
    keywords?: string;
    region?: string;
    types?: string;
  };
  // 读候选的视频 id，用于 POI 级去重判断。
  const selfRow = await db
    .selectFrom("shop_candidates")
    .select(["id", "video_id"])
    .where("id", "=", entityId)
    .executeTakeFirst();
  if (!selfRow) {
    throw new Error(`shop_candidate ${entityId} not found`);
  }
  await emitPipelineEvent(db, job, {
    eventType: "progress",
    title: "开始匹配高德 POI",
    progressPercent: 92,
    detail: {
      keywords: keywords ?? null,
      region: region ?? null,
      types: types ?? null,
    },
  });
  const result = await searchAmapPoi(db, entityId, { keywords, region, types });
  const selected = result.selected_poi;

  // Overwrite-on-search semantics: this candidate now keeps ONLY the latest
  // match attempt's candidates. The previous attempt rows in
  // poi_match_candidates are deleted (the attempt log row in
  // poi_match_attempts is preserved for audit). This avoids the
  // 'one POI appears N times because we ran search N times' problem
  // in the admin UI. Per AGENTS.md §3.4 + product decision "数据库不要
  // 保存多次结果". Re-running the job replaces both the candidate rows
  // and shop_candidates.selected_poi_id (set later in this fn).
  await db
    .deleteFrom("poi_match_candidates")
    .where("shop_candidate_id", "=", entityId)
    .execute();

  const attempt = await db
    .insertInto("poi_match_attempts")
    .values({
      id: crypto.randomUUID(),
      shop_candidate_id: entityId,
      provider: "amap",
      query_strategy: result.query_payload.forced_review
        ? "low_confidence_keyword"
        : "city_name_keyword",
      query_payload: result.query_payload as Json,
      status:
        result.match_status === "no_candidate" ? "no_candidate" : "success",
      raw_payload_id: result.raw_payload_id,
      error_message: null,
      created_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  let selectedPoiId: string | null = null;
  for (const [index, candidate] of result.candidates.entries()) {
    const poi = await db
      .insertInto("pois")
      .values({
        id: crypto.randomUUID(),
        provider: "amap",
        provider_poi_id: candidate.provider_poi_id,
        name: candidate.name,
        address: candidate.address ?? null,
        province: candidate.province ?? null,
        city: candidate.city ?? null,
        district: candidate.district ?? null,
        business_area: candidate.business_area ?? null,
        category: candidate.category ?? null,
        category_code: candidate.category_code ?? null,
        lng: candidate.location.lng,
        lat: candidate.location.lat,
        coord_type: candidate.location.coord_type,
        phone: candidate.phone ?? null,
        business_hours: candidate.business_hours ?? null,
        rating: candidate.rating ?? null,
        avg_cost: candidate.avg_cost ?? null,
        tags: candidate.tags,
        // node-postgres treats a JavaScript array as a PostgreSQL array. The
        // target column is jsonb, so serialize explicitly to keep the value a
        // valid JSON array instead of producing `{"..."},{"..."}`.
        photos: JSON.stringify(candidate.photos),
        provider_updated_at: new Date(),
        raw_payload_id: result.raw_payload_id,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict((oc) =>
        oc.columns(["provider", "provider_poi_id"]).doUpdateSet({
          name: candidate.name,
          address: candidate.address ?? null,
          province: candidate.province ?? null,
          city: candidate.city ?? null,
          district: candidate.district ?? null,
          business_area: candidate.business_area ?? null,
          category: candidate.category ?? null,
          category_code: candidate.category_code ?? null,
          phone: candidate.phone ?? null,
          business_hours: candidate.business_hours ?? null,
          rating: candidate.rating ?? null,
          avg_cost: candidate.avg_cost ?? null,
          tags: candidate.tags,
          photos: JSON.stringify(candidate.photos),
          provider_updated_at: new Date(),
          raw_payload_id: result.raw_payload_id,
          updated_at: new Date(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    const isSelected = Boolean(
      selected &&
      candidate.provider_poi_id === selected.provider_poi_id &&
      result.match_status === "auto_matched",
    );
    if (isSelected) selectedPoiId = poi.id;
    await db
      .insertInto("poi_match_candidates")
      .values({
        id: crypto.randomUUID(),
        attempt_id: attempt.id,
        shop_candidate_id: entityId,
        poi_id: poi.id,
        rank: index + 1,
        match_features: candidate.match_features as Json,
        match_score: candidate.match_score,
        match_status: isSelected ? "selected" : "candidate",
        created_at: new Date(),
      })
      .execute();
  }

  const nextStatus =
    result.match_status === "auto_matched"
      ? "poi_matched"
      : result.match_status === "low_confidence"
        ? "poi_match_low_confidence"
        : result.match_status === "no_candidate"
          ? "extracted"
          : "poi_match_need_review";

  // POI 级去重：若同视频已有其它候选也落到同一 POI，把当前候选标为 merged，
  // 避免 promote 时再为同一物理店铺建第二个 shop 行。
  if (selectedPoiId) {
    const olderSamePoi = await db
      .selectFrom("shop_candidates")
      .select(["id"])
      .where("video_id", "=", selfRow.video_id)
      .where("selected_poi_id", "=", selectedPoiId)
      .where("id", "!=", entityId)
      .orderBy("created_at", "asc")
      .executeTakeFirst();

    if (olderSamePoi) {
      await db
        .updateTable("shop_candidates")
        .set({
          status: "merged",
          selected_poi_id: null,
          updated_at: new Date(),
        })
        .where("id", "=", entityId)
        .execute();
      // 关闭对应的审核任务，避免管理员重复处理已合并的候选
      await db
        .updateTable("review_tasks")
        .set({
          status: "cancelled",
          resolved_at: new Date(),
          updated_at: new Date(),
        })
        .where("entity_type", "=", "shop_candidate")
        .where("entity_id", "=", entityId)
        .where("status", "in", ["open", "in_progress"])
        .execute();
      await emitPipelineEvent(db, job, {
        eventType: "completed",
        level: "info",
        title: "候选已合并到同 POI 的旧候选",
        message: `同视频已存在 POI 相同的候选 ${olderSamePoi.id}，本候选标记 merged`,
        progressPercent: 100,
        detail: {
          merged_into: olderSamePoi.id,
          selected_poi_id: selectedPoiId,
        },
      });
      return result;
    }
  }

  await db
    .updateTable("shop_candidates")
    .set({
      selected_poi_id: selectedPoiId,
      status: nextStatus,
      updated_at: new Date(),
    })
    .where("id", "=", entityId)
    .execute();

  await emitPipelineEvent(db, job, {
    eventType: "completed",
    level:
      result.match_status === "auto_matched"
        ? "success"
        : result.match_status === "no_candidate" ||
            result.match_status === "low_confidence"
          ? "warning"
          : "info",
    title: "POI 匹配完成",
    message: `匹配状态：${result.match_status}`,
    progressPercent: 100,
    detail: {
      candidate_count: result.candidates.length,
      match_score: result.match_score,
      match_status: result.match_status,
      risk_flags: result.risk_flags,
      next_status: nextStatus,
    },
  });
  await finishRunIfTerminal(db, job, {
    last_stage: "match_poi",
    match_status: result.match_status,
    match_score: result.match_score,
    poi_candidate_count: result.candidates.length,
  });
  return result;
}
