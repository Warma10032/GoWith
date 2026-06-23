import crypto from "node:crypto";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import {
  SYSTEM_TASK_ENTITY_ID,
  tryAcquireTaskStartLock,
  type DB,
  type Json,
  type TaskLockKey,
} from "@gowith/db";
import {
  collectCandidateEvidenceIds,
  createCreatorRequestSchema,
} from "@gowith/shared";
import { HttpError } from "../lib/http";
import { encryptSecret } from "../services/crypto";
import { requireAdmin } from "../services/auth";
import { enqueuePipelineRunJob } from "../services/queue";
import {
  InvalidDianpingUrlError,
  parseDianpingUrl,
} from "../services/shop-external-links";

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const listQuerySchema = paginationSchema.extend({
  q: z.string().trim().optional(),
  status: z.string().trim().optional(),
  content_type: z.string().trim().optional(),
  creator_id: z.string().uuid().optional(),
  stage: z.string().trim().optional(),
});

const changesQuerySchema = z.object({
  since: z.coerce.date(),
});

function acceptedTask(
  reply: FastifyReply,
  run: {
    id: string;
    run_type: string;
    entity_type: string;
    entity_id: string;
    status: string;
  },
  jobId: string | undefined,
) {
  return reply.code(202).send(acceptedTaskPayload(run, jobId));
}

function acceptedTaskPayload(
  run: {
    id: string;
    run_type: string;
    entity_type: string;
    entity_id: string;
    status: string;
  },
  jobId: string | undefined,
) {
  return {
    run_id: run.id,
    job_id: jobId ?? null,
    run_type: run.run_type,
    entity_type: run.entity_type,
    entity_id: run.entity_id,
    status: run.status,
  };
}

const bilibiliAuthSchema = z.object({
  label: z.string().min(1),
  cookie: z.string().min(10),
  csrf_token: z.string().optional(),
});

const POI_RESOLVED_RISK_FLAGS = new Set([
  "poi_no_candidate",
  "poi_low_confidence",
  "poi_many_same_name_candidates",
  "address_missing",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return asArray(value).filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function countCommentSignals(signal: unknown) {
  const row = asRecord(signal);
  const sentiments = asRecord(row.aspect_sentiments);
  return (
    asArray(row.shop_name_mentions).length +
    asArray(row.address_mentions).length +
    asArray(row.status_mentions).length +
    Object.values(sentiments).filter((item) => {
      const summary = asRecord(item).summary;
      return typeof summary === "string" && summary.trim().length > 0;
    }).length
  );
}

function reviewEvidenceIds(review: unknown) {
  const ids = new Set<string>();
  for (const [key, value] of Object.entries(asRecord(review))) {
    if (key === "comment_summary" || key === "comment_signals") continue;
    for (const id of stringArray(asRecord(value).evidence_ids)) ids.add(id);
  }
  return [...ids];
}

function mergeAggregatedReview(
  candidateCommentSummary: unknown,
  commentSignals: unknown,
) {
  const signals = asRecord(commentSignals);
  return {
    ...asRecord(signals.aspect_sentiments),
    comment_summary: candidateCommentSummary,
    comment_signals: {
      shop_name_mentions: signals.shop_name_mentions ?? [],
      address_mentions: signals.address_mentions ?? [],
      status_mentions: signals.status_mentions ?? [],
      risk_flags: signals.risk_flags ?? [],
    },
  };
}

function remainingRisksAfterPoiSelection(riskFlags: string[]) {
  return riskFlags.filter((flag) => !POI_RESOLVED_RISK_FLAGS.has(flag));
}

async function runAdminActionWithLock<T>(
  app: Parameters<FastifyPluginAsync>[0],
  key: TaskLockKey,
  action: (trx: Transaction<DB>) => Promise<T>,
) {
  return app.db.transaction().execute(async (trx) => {
    const acquired = await tryAcquireTaskStartLock(trx, key);
    if (!acquired) {
      throw new HttpError(
        409,
        "task_already_running",
        `Task '${key.jobType}' is already running for ${key.entityType}:${key.entityId}`,
      );
    }
    return action(trx);
  });
}

export const registerAdminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request) => {
    await requireAdmin(app.db, request);
  });

  app.get("/dashboard", async () => {
    const [
      creators,
      videos,
      candidates,
      reviews,
      shops,
      activeCookies,
      expiredCookies,
      riskCookies,
    ] = await Promise.all([
      app.db
        .selectFrom("creators")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .executeTakeFirst(),
      app.db
        .selectFrom("videos")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .executeTakeFirst(),
      app.db
        .selectFrom("shop_candidates")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .executeTakeFirst(),
      app.db
        .selectFrom("review_tasks")
        .where("status", "=", "open")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .executeTakeFirst(),
      app.db
        .selectFrom("shops")
        .where("status", "=", "published")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .executeTakeFirst(),
      app.db
        .selectFrom("bilibili_auth_accounts")
        .where("status", "=", "active")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .executeTakeFirst(),
      app.db
        .selectFrom("bilibili_auth_accounts")
        .where("status", "=", "expired")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .executeTakeFirst(),
      app.db
        .selectFrom("bilibili_auth_accounts")
        .where("status", "=", "risk")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .executeTakeFirst(),
    ]);

    // 最近活动：取最近 5 条 pipeline_runs + 5 条 ai_runs，合并按 created_at desc 取前 5。
    const [pipelineRows, aiRows] = await Promise.all([
      app.db
        .selectFrom("pipeline_runs")
        .select([
          "id",
          "run_type",
          "entity_type",
          "entity_id",
          "status",
          "created_at",
        ])
        .orderBy("created_at", "desc")
        .limit(5)
        .execute(),
      app.db
        .selectFrom("ai_runs")
        .select([
          "id",
          "stage as run_type",
          "entity_type",
          "entity_id",
          "status",
          "created_at",
        ])
        .orderBy("created_at", "desc")
        .limit(5)
        .execute(),
    ]);
    const recent_runs = [...pipelineRows, ...aiRows]
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      .slice(0, 5);

    return {
      counts: {
        creators: Number(creators?.count ?? 0),
        videos: Number(videos?.count ?? 0),
        shop_candidates: Number(candidates?.count ?? 0),
        open_reviews: Number(reviews?.count ?? 0),
        published_shops: Number(shops?.count ?? 0),
        active_bilibili_cookies: Number(activeCookies?.count ?? 0),
        expired_bilibili_cookies: Number(expiredCookies?.count ?? 0),
        risk_bilibili_cookies: Number(riskCookies?.count ?? 0),
      },
      recent_runs,
    };
  });

  app.get("/bilibili-auth", async () => {
    const accounts = await app.db
      .selectFrom("bilibili_auth_accounts")
      .select([
        "id",
        "label",
        "status",
        "last_health_check_at",
        "last_success_at",
        "last_error_code",
        "last_error_message",
        "created_at",
        "updated_at",
      ])
      .orderBy("created_at", "desc")
      .limit(50)
      .execute();
    return { accounts };
  });

  app.post("/bilibili-auth", async (request) => {
    const body = bilibiliAuthSchema.parse(request.body);
    const [account] = await app.db
      .insertInto("bilibili_auth_accounts")
      .values({
        id: crypto.randomUUID(),
        label: body.label,
        encrypted_cookie: encryptSecret(body.cookie),
        csrf_token_encrypted: body.csrf_token
          ? encryptSecret(body.csrf_token)
          : null,
        status: "active",
        last_health_check_at: null,
        last_success_at: null,
        last_error_code: null,
        last_error_message: null,
        rate_limit_policy: { min_interval_ms: 1200 },
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(["id", "label", "status", "created_at"])
      .execute();
    return { account };
  });

  app.post("/bilibili-auth/check", async (request, reply) => {
    const admin = await requireAdmin(app.db, request);
    const { run, job } = await enqueuePipelineRunJob(
      app.db,
      {
        runType: "bilibili_auth_check",
        entityType: "system",
        entityId: SYSTEM_TASK_ENTITY_ID,
        triggeredBy: admin.id,
      },
      "check_bilibili_auth_pool",
    );
    return acceptedTask(reply, run, job.data.db_job_id ?? job.id);
  });

  app.delete("/bilibili-auth/:id", async (request) => {
    // 删除单个 B站登录态账号。后续 worker / pipeline 进程不再使用它；
    // 历史 raw_ingest_payloads / jobs 仍保留以供审计。
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await app.db
      .deleteFrom("bilibili_auth_accounts")
      .where("id", "=", params.id)
      .executeTakeFirst();
    if (!result.numDeletedRows) {
      throw new HttpError(404, "该 Cookie 账号不存在或已被删除", "not_found");
    }
    return { deleted: true, id: params.id };
  });

  app.get("/creators", async (request) => {
    const query = listQuerySchema.parse(request.query);
    let builder = app.db
      .selectFrom("creators")
      .selectAll()
      .orderBy("created_at", "desc")
      .limit(query.limit)
      .offset(query.offset);
    if (query.status)
      builder = builder.where("status", "=", query.status as never);
    if (query.q) {
      builder = builder.where((eb) =>
        eb.or([
          eb("name", "ilike", `%${query.q}%`),
          eb("bilibili_uid", "ilike", `%${query.q}%`),
          sql<boolean>`name % ${query.q}`,
        ]),
      );
    }
    const creators = await builder.execute();
    return { creators };
  });

  app.get("/creators/:id", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const creator = await app.db
      .selectFrom("creators")
      .selectAll()
      .where("id", "=", params.id)
      .executeTakeFirst();
    if (!creator)
      throw new HttpError(404, "creator_not_found", "Creator not found");
    const [videoStats, latestRun] = await Promise.all([
      app.db
        .selectFrom("videos")
        .select([
          (eb) => eb.fn.countAll<string>().as("total"),
          (eb) => eb.fn.count<string>("is_shop_visit").as("classified"),
        ])
        .where("creator_id", "=", params.id)
        .executeTakeFirst(),
      app.db
        .selectFrom("pipeline_runs")
        .selectAll()
        .where("entity_type", "=", "creator")
        .where("entity_id", "=", params.id)
        .orderBy("created_at", "desc")
        .executeTakeFirst(),
    ]);
    return {
      creator,
      stats: {
        videos: Number(videoStats?.total ?? 0),
        classified: Number(videoStats?.classified ?? 0),
      },
      latest_run: latestRun ?? null,
    };
  });

  app.post("/creators", async (request, reply) => {
    const body = createCreatorRequestSchema.parse(request.body);
    const admin = await requireAdmin(app.db, request);
    const placeholderName = `B站 UID ${body.bilibili_uid}`;
    const creator = await app.db
      .insertInto("creators")
      .values({
        id: crypto.randomUUID(),
        bilibili_uid: body.bilibili_uid,
        name: placeholderName,
        avatar_url: null,
        profile_url: `https://space.bilibili.com/${body.bilibili_uid}`,
        bio: null,
        follower_count: null,
        status: "active",
        sync_mode: "full",
        last_synced_at: null,
        last_video_published_at: null,
        stats: {},
        raw_payload_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict((oc) =>
        oc.column("bilibili_uid").doUpdateSet({
          status: "active",
          updated_at: new Date(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    const { run, job } = await enqueuePipelineRunJob(
      app.db,
      {
        runType: "creator_profile_sync",
        entityType: "creator",
        entityId: creator.id,
        triggeredBy: admin.id,
        summary: { bilibili_uid: creator.bilibili_uid },
      },
      "sync_creator_profile",
      {
        bilibili_uid: creator.bilibili_uid,
      },
    );
    return reply.code(202).send({
      ...acceptedTaskPayload(run, job.data.db_job_id ?? job.id),
      creator,
    });
  });

  app.post("/creators/:id/sync", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const admin = await requireAdmin(app.db, request);
    const creator = await app.db
      .selectFrom("creators")
      .selectAll()
      .where("id", "=", params.id)
      .executeTakeFirst();
    if (!creator)
      throw new HttpError(404, "creator_not_found", "Creator not found");
    const { run, job } = await enqueuePipelineRunJob(
      app.db,
      {
        runType: "creator_video_sync",
        entityType: "creator",
        entityId: creator.id,
        triggeredBy: admin.id,
        summary: { bilibili_uid: creator.bilibili_uid },
      },
      "sync_creator_videos",
      {
        bilibili_uid: creator.bilibili_uid,
      },
    );
    return acceptedTask(reply, run, job.data.db_job_id ?? job.id);
  });

  app.get("/creators/:id/videos", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = listQuerySchema.parse(request.query);
    let builder = app.db
      .selectFrom("videos")
      .selectAll()
      .where("creator_id", "=", params.id)
      .orderBy("published_at", "desc")
      .limit(query.limit)
      .offset(query.offset);
    if (query.status)
      builder = builder.where("workflow_status", "=", query.status);
    if (query.content_type)
      builder = builder.where("content_type", "=", query.content_type);
    if (query.q) {
      builder = builder.where((eb) =>
        eb.or([
          eb("title", "ilike", `%${query.q}%`),
          eb("bvid", "ilike", `%${query.q}%`),
          sql<boolean>`title % ${query.q}`,
        ]),
      );
    }
    const videos = await builder.execute();
    return { videos };
  });

  app.get("/videos", async (request) => {
    const query = listQuerySchema.parse(request.query);
    let builder = app.db
      .selectFrom("videos")
      .innerJoin("creators", "creators.id", "videos.creator_id")
      .select([
        "videos.id",
        "videos.bvid",
        "videos.title",
        "videos.cover_url",
        "videos.source_url",
        "videos.workflow_status",
        "videos.is_shop_visit",
        "videos.content_type",
        "videos.risk_flags",
        "videos.published_at",
        "creators.name as creator_name",
      ])
      .orderBy("videos.created_at", "desc")
      .limit(query.limit)
      .offset(query.offset);
    if (query.creator_id)
      builder = builder.where("videos.creator_id", "=", query.creator_id);
    if (query.status)
      builder = builder.where("videos.workflow_status", "=", query.status);
    if (query.content_type)
      builder = builder.where("videos.content_type", "=", query.content_type);
    if (query.q) {
      builder = builder.where((eb) =>
        eb.or([
          eb("videos.title", "ilike", `%${query.q}%`),
          eb("videos.bvid", "ilike", `%${query.q}%`),
          sql<boolean>`videos.title % ${query.q}`,
        ]),
      );
    }
    const videos = await builder.execute();
    return { videos };
  });

  app.get("/videos/:id", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const video = await app.db
      .selectFrom("videos")
      .selectAll()
      .where("id", "=", params.id)
      .executeTakeFirst();
    if (!video) throw new HttpError(404, "video_not_found", "Video not found");
    const [assets, segments, comments, candidates, reviews, aiRuns, latestRun] =
      await Promise.all([
        app.db
          .selectFrom("video_text_assets")
          .selectAll()
          .where("video_id", "=", params.id)
          .orderBy("created_at", "desc")
          .execute(),
        app.db
          .selectFrom("video_text_segments")
          .selectAll()
          .where("video_id", "=", params.id)
          .orderBy("segment_index")
          .limit(200)
          .execute(),
        app.db
          .selectFrom("video_comments")
          .selectAll()
          .where("video_id", "=", params.id)
          .orderBy("like_count", "desc")
          .limit(80)
          .execute(),
        // 候选去重：相同 POI（已匹配）只保留一条；相同 (candidate_name, city) 也只保留一条
        // （防止 AI 重跑遗留的同名候选）。所有 status 默认都展示（包括 merged / rejected），
        // 让 admin 看完整历史；按 status 优先级 + created_at asc 在每组内取最早一条。
        app.db
          .selectFrom("shop_candidates")
          .selectAll()
          .where("video_id", "=", params.id)
          .distinctOn([
            sql`COALESCE(selected_poi_id::text, 'name:' || COALESCE(candidate_name, '') || '|' || COALESCE(city, ''))`,
          ])
          .orderBy(
            sql`COALESCE(selected_poi_id::text, 'name:' || COALESCE(candidate_name, '') || '|' || COALESCE(city, ''))`,
          )
          .orderBy(
            sql`CASE status
              WHEN 'poi_matched' THEN 0
              WHEN 'poi_match_need_review' THEN 1
              WHEN 'poi_match_low_confidence' THEN 2
              WHEN 'poi_candidates_found' THEN 3
              WHEN 'extracted' THEN 4
              WHEN 'name_missing' THEN 5
              WHEN 'merged' THEN 6
              WHEN 'rejected' THEN 7
              ELSE 99
            END`,
          )
          .orderBy("created_at", "asc")
          .execute(),
        app.db
          .selectFrom("review_tasks")
          .selectAll()
          .where("entity_id", "=", params.id)
          .orderBy("created_at", "desc")
          .execute(),
        app.db
          .selectFrom("ai_runs")
          .selectAll()
          .where("entity_type", "=", "video")
          .where("entity_id", "=", params.id)
          .orderBy("created_at", "desc")
          .limit(20)
          .execute(),
        app.db
          .selectFrom("pipeline_runs")
          .selectAll()
          .where("entity_type", "=", "video")
          .where("entity_id", "=", params.id)
          .orderBy("created_at", "desc")
          .executeTakeFirst(),
      ]);
    return {
      video,
      assets,
      segments,
      comments,
      candidates,
      reviews,
      ai_runs: aiRuns,
      latest_run: latestRun ?? null,
    };
  });

  app.post("/videos/:id/process", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const admin = await requireAdmin(app.db, request);
    const video = await app.db
      .selectFrom("videos")
      .select(["id", "title"])
      .where("id", "=", params.id)
      .executeTakeFirst();
    if (!video) throw new HttpError(404, "video_not_found", "Video not found");
    const { run, job } = await enqueuePipelineRunJob(
      app.db,
      {
        runType: "video_processing",
        entityType: "video",
        entityId: params.id,
        triggeredBy: admin.id,
        summary: { title: video.title },
      },
      "process_video",
    );
    return acceptedTask(reply, run, job.data.db_job_id ?? job.id);
  });

  app.post("/videos/:id/retry-asr", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const admin = await requireAdmin(app.db, request);
    const { run, job } = await enqueuePipelineRunJob(
      app.db,
      {
        runType: "video_asr_retry",
        entityType: "video",
        entityId: params.id,
        triggeredBy: admin.id,
      },
      "run_asr",
    );
    return acceptedTask(reply, run, job.data.db_job_id ?? job.id);
  });

  app.post("/videos/:id/retry-ai", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const admin = await requireAdmin(app.db, request);
    const { run, job } = await enqueuePipelineRunJob(
      app.db,
      {
        runType: "video_ai_retry",
        entityType: "video",
        entityId: params.id,
        triggeredBy: admin.id,
      },
      "classify_video",
    );
    return acceptedTask(reply, run, job.data.db_job_id ?? job.id);
  });

  app.post("/videos/:id/mark-non-shop", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await app.db
      .updateTable("videos")
      .set({
        is_shop_visit: false,
        content_type: "non_shop_visit",
        workflow_status: "non_shop_visit",
      })
      .where("id", "=", params.id)
      .execute();
    return { ok: true };
  });

  app.get("/pipeline-runs", async (request) => {
    const query = listQuerySchema.parse(request.query);
    let builder = app.db
      .selectFrom("pipeline_runs")
      .selectAll()
      .orderBy("created_at", "desc")
      .limit(query.limit)
      .offset(query.offset);
    if (query.status)
      builder = builder.where("status", "=", query.status as never);
    const rawQuery = request.query as Record<string, string | undefined>;
    if (rawQuery.entity_type)
      builder = builder.where("entity_type", "=", rawQuery.entity_type);
    if (rawQuery.entity_id)
      builder = builder.where("entity_id", "=", rawQuery.entity_id);
    const runs = await builder.execute();
    return { runs };
  });

  app.get("/pipeline-runs/changes", async (request) => {
    const { since } = changesQuerySchema.parse(request.query);
    const boundary = new Date();
    const [runs, events] = await Promise.all([
      app.db
        .selectFrom("pipeline_runs")
        .selectAll()
        .where("updated_at", ">", since)
        .where("updated_at", "<=", boundary)
        .orderBy("updated_at", "asc")
        .execute(),
      app.db
        .selectFrom("pipeline_events")
        .selectAll()
        .where("created_at", ">", since)
        .where("created_at", "<=", boundary)
        .orderBy("created_at", "asc")
        .execute(),
    ]);
    return { runs, events, next_cursor: boundary.toISOString() };
  });

  app.get("/task-stream", async (request, reply) => {
    await requireAdmin(app.db, request);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Origin": String(
        request.headers.origin ?? "http://127.0.0.1:13000",
      ),
    });
    reply.raw.write(
      `event: ready\ndata: ${JSON.stringify({ connected_at: new Date().toISOString() })}\n\n`,
    );
    const unsubscribe = app.taskEvents.subscribe((event) => {
      reply.raw.write(
        `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      );
    });
    const heartbeat = setInterval(() => {
      reply.raw.write(
        `event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`,
      );
    }, 15_000);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.get("/runs/:id", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const pipelineRun = await app.db
      .selectFrom("pipeline_runs")
      .selectAll()
      .where("id", "=", params.id)
      .executeTakeFirst();
    if (pipelineRun) {
      const events = await app.db
        .selectFrom("pipeline_events")
        .selectAll()
        .where("run_id", "=", pipelineRun.id)
        .orderBy("created_at", "asc")
        .execute();
      return { type: "pipeline" as const, run: pipelineRun, events };
    }
    const aiRun = await app.db
      .selectFrom("ai_runs")
      .selectAll()
      .where("id", "=", params.id)
      .executeTakeFirst();
    if (aiRun) {
      const events = await app.db
        .selectFrom("pipeline_events")
        .selectAll()
        .where("ai_run_id", "=", aiRun.id)
        .orderBy("created_at", "asc")
        .execute();
      return { type: "ai" as const, run: aiRun, events };
    }
    throw new HttpError(404, "run_not_found", "Run not found");
  });

  app.get("/ai-runs", async (request) => {
    const query = listQuerySchema.parse(request.query);
    let builder = app.db
      .selectFrom("ai_runs")
      .selectAll()
      .orderBy("created_at", "desc")
      .limit(query.limit)
      .offset(query.offset);
    const rawQuery = request.query as Record<string, string | undefined>;
    if (query.status)
      builder = builder.where("status", "=", query.status as never);
    if (query.stage) builder = builder.where("stage", "=", query.stage);
    if (rawQuery.entity_type)
      builder = builder.where("entity_type", "=", rawQuery.entity_type);
    if (rawQuery.entity_id)
      builder = builder.where("entity_id", "=", rawQuery.entity_id);
    const runs = await builder.execute();
    return { ai_runs: runs };
  });

  app.get("/shop-candidates", async (request) => {
    const query = paginationSchema.parse(request.query);
    const candidates = await app.db
      .selectFrom("shop_candidates")
      .innerJoin("videos", "videos.id", "shop_candidates.video_id")
      .innerJoin("creators", "creators.id", "shop_candidates.creator_id")
      .select([
        "shop_candidates.id",
        "shop_candidates.candidate_name",
        "shop_candidates.city",
        "shop_candidates.district",
        "shop_candidates.address_hint",
        "shop_candidates.status",
        "shop_candidates.risk_flags",
        "shop_candidates.name_confidence",
        "shop_candidates.location_confidence",
        "videos.title as video_title",
        "videos.source_url as video_source_url",
        "videos.bvid as video_bvid",
        "creators.name as creator_name",
      ])
      .orderBy("shop_candidates.created_at", "desc")
      .limit(query.limit)
      .offset(query.offset)
      .execute();
    return { candidates };
  });

  app.get("/shop-candidates/:id", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const candidate = await app.db
      .selectFrom("shop_candidates")
      .selectAll()
      .where("id", "=", params.id)
      .executeTakeFirst();
    if (!candidate)
      throw new HttpError(
        404,
        "candidate_not_found",
        "Shop candidate not found",
      );
    const [evidence, poiCandidates] = await Promise.all([
      app.db
        .selectFrom("evidence")
        .selectAll()
        .where("shop_candidate_id", "=", params.id)
        .execute(),
      app.db
        .selectFrom("poi_match_candidates")
        .innerJoin("pois", "pois.id", "poi_match_candidates.poi_id")
        .select([
          "poi_match_candidates.id",
          "poi_match_candidates.match_score",
          "poi_match_candidates.match_features",
          "poi_match_candidates.match_status",
          "pois.id as poi_id",
          "pois.provider",
          "pois.provider_poi_id",
          "pois.name",
          "pois.address",
          "pois.province",
          "pois.city",
          "pois.district",
          "pois.business_area",
          "pois.category",
          "pois.category_code",
          "pois.lng",
          "pois.lat",
          "pois.coord_type",
        ])
        .where("poi_match_candidates.shop_candidate_id", "=", params.id)
        .orderBy("poi_match_candidates.match_score", "desc")
        .execute(),
    ]);
    return { candidate, evidence, poi_candidates: poiCandidates };
  });

  app.patch("/shop-candidates/:id", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        candidate_name: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        district: z.string().nullable().optional(),
        business_area: z.string().nullable().optional(),
        address_hint: z.string().nullable().optional(),
        category_primary: z.string().nullable().optional(),
        status: z.string().optional(),
        risk_flags: z.array(z.string()).optional(),
      })
      .parse(request.body);
    const [candidate] = await app.db
      .updateTable("shop_candidates")
      .set({ ...body, updated_at: new Date() })
      .where("id", "=", params.id)
      .returningAll()
      .execute();
    return { candidate };
  });

  app.post("/shop-candidates/:id/search-poi", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        keywords: z.string().trim().min(1).max(80).optional(),
        region: z.string().trim().min(1).max(80).optional(),
        types: z.string().trim().min(1).max(80).optional(),
      })
      .partial()
      .parse(request.body ?? {});
    const admin = await requireAdmin(app.db, request);
    const { run, job } = await enqueuePipelineRunJob(
      app.db,
      {
        runType: "poi_match",
        entityType: "shop_candidate",
        entityId: params.id,
        triggeredBy: admin.id,
      },
      "match_poi",
      body,
    );
    return acceptedTask(reply, run, job.data.db_job_id ?? job.id);
  });

  app.post("/shop-candidates/:id/select-poi", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ poi_id: z.string().uuid() }).parse(request.body);
    const admin = await requireAdmin(app.db, request);
    const result = await runAdminActionWithLock(
      app,
      {
        jobType: "select_poi",
        entityType: "shop_candidate",
        entityId: params.id,
      },
      async (trx) => {
        const before = await trx
          .selectFrom("shop_candidates")
          .selectAll()
          .where("id", "=", params.id)
          .executeTakeFirst();
        if (!before)
          throw new HttpError(
            404,
            "candidate_not_found",
            "Shop candidate not found",
          );
        const poi = await trx
          .selectFrom("pois")
          .selectAll()
          .where("id", "=", body.poi_id)
          .executeTakeFirst();
        if (!poi) throw new HttpError(404, "poi_not_found", "POI not found");
        const remainingRisks = remainingRisksAfterPoiSelection(
          before.risk_flags,
        );
        const openReview = await trx
          .selectFrom("review_tasks")
          .select(["id"])
          .where("entity_type", "=", "shop_candidate")
          .where("entity_id", "=", params.id)
          .where("status", "=", "open")
          .orderBy("created_at", "desc")
          .executeTakeFirst();
        const updated = await trx
          .updateTable("shop_candidates")
          .set({
            selected_poi_id: body.poi_id,
            status: "poi_matched",
            updated_at: new Date(),
          })
          .where("id", "=", params.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx
          .updateTable("poi_match_candidates")
          .set({ match_status: "rejected" })
          .where("shop_candidate_id", "=", params.id)
          .where("match_status", "=", "selected")
          .execute();
        await trx
          .updateTable("poi_match_candidates")
          .set({ match_status: "selected" })
          .where("shop_candidate_id", "=", params.id)
          .where("poi_id", "=", body.poi_id)
          .execute();
        if (openReview && !remainingRisks.length) {
          await trx
            .updateTable("review_tasks")
            .set({
              status: "resolved",
              resolved_by: admin.id,
              resolved_at: new Date(),
              updated_at: new Date(),
            })
            .where("id", "=", openReview.id)
            .execute();
        }
        await trx
          .insertInto("review_events")
          .values({
            id: crypto.randomUUID(),
            review_task_id: openReview?.id ?? null,
            entity_type: "shop_candidate",
            entity_id: params.id,
            action: "select_poi",
            before_json: {
              selected_poi_id: before.selected_poi_id,
              status: before.status,
            },
            after_json: {
              selected_poi_id: body.poi_id,
              status: "poi_matched",
              poi_name: poi.name,
              remaining_risk_flags: remainingRisks,
            },
            reason: "Admin selected POI candidate",
            reviewer_id: admin.id,
            created_at: new Date(),
          })
          .execute();
        return updated;
      },
    );
    return { ok: true, candidate: result };
  });

  app.post("/shop-candidates/:id/promote", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const admin = await requireAdmin(app.db, request);
    const result = await runAdminActionWithLock(
      app,
      {
        jobType: "promote_shop_candidate",
        entityType: "shop_candidate",
        entityId: params.id,
      },
      async (trx) => {
        const candidate = await trx
          .selectFrom("shop_candidates")
          .selectAll()
          .where("id", "=", params.id)
          .executeTakeFirst();
        if (!candidate)
          throw new HttpError(
            404,
            "candidate_not_found",
            "Shop candidate not found",
          );
        if (candidate.status !== "poi_matched" || !candidate.selected_poi_id) {
          throw new HttpError(
            409,
            "candidate_not_ready",
            "Candidate must be in status='poi_matched' with a selected_poi_id before promote",
          );
        }
        const poi = await trx
          .selectFrom("pois")
          .selectAll()
          .where("id", "=", candidate.selected_poi_id)
          .executeTakeFirst();
        if (!poi)
          throw new HttpError(
            404,
            "poi_not_found",
            "Selected POI no longer exists",
          );

        const commentSignals = await trx
          .selectFrom("comment_signal_extractions")
          .selectAll()
          .where("video_id", "=", candidate.video_id)
          .orderBy("created_at", "desc")
          .executeTakeFirst();
        const commentSignalCount = countCommentSignals(commentSignals);
        const aggregatedReview = mergeAggregatedReview(
          candidate.comment_summary,
          commentSignals,
        );

        // Confidence: average of name / location / summary, fall back to 0 if null.
        const confidences = [
          toNumber(candidate.name_confidence),
          toNumber(candidate.location_confidence),
          toNumber(candidate.summary_confidence),
        ].filter((value): value is number => value !== null);
        const shopConfidence =
          confidences.length > 0
            ? confidences.reduce((sum, value) => sum + value, 0) /
              confidences.length
            : 0;

        const shopValues = {
          canonical_name:
            candidate.normalized_name ??
            candidate.candidate_name ??
            "未命名店铺",
          display_name:
            candidate.candidate_name ??
            candidate.normalized_name ??
            "未命名店铺",
          category_primary: candidate.category_primary,
          category_secondary: candidate.category_secondary,
          province: poi.province ?? candidate.province,
          city: poi.city ?? candidate.city,
          district: poi.district ?? candidate.district,
          business_area: poi.business_area ?? candidate.business_area,
          address: poi.address ?? candidate.address_hint,
          lng: poi.lng,
          lat: poi.lat,
          coord_type: poi.coord_type,
          card_payload: candidate.card_payload,
          aggregated_review: aggregatedReview as unknown as Json,
          quality: {
            shop_confidence: shopConfidence,
            poi_confidence: toNumber(candidate.location_confidence),
            summary_confidence: toNumber(candidate.summary_confidence),
            risk_flags: candidate.risk_flags,
          } as unknown as Json,
          source_stats: {
            creator_count: 1,
            video_count: 1,
            comment_signal_count: commentSignalCount,
          } as unknown as Json,
          last_reviewed_at: new Date(),
          updated_at: new Date(),
        };
        const existingShop = await trx
          .selectFrom("shops")
          .selectAll()
          .where("primary_poi_id", "=", poi.id)
          .orderBy("created_at", "asc")
          .executeTakeFirst();

        // 按 POI 合并：相同 POI = 同一个店铺；总是覆盖写 shops 的内容字段，
        // status / published_at 保留（admin 已审核过的发布状态不能被 promote 推翻），
        // 但 display_name / category / card_payload / aggregated_review / quality /
        // source_stats / last_reviewed_at 都用最新候选刷新。
        const shop = existingShop
          ? await trx
              .updateTable("shops")
              .set(shopValues)
              .where("id", "=", existingShop.id)
              .returningAll()
              .executeTakeFirstOrThrow()
          : await trx
              .insertInto("shops")
              .values({
                id: crypto.randomUUID(),
                primary_poi_id: poi.id,
                ...shopValues,
                status: "draft",
                published_at: null,
                created_at: new Date(),
              })
              .returningAll()
              .executeTakeFirstOrThrow();

        // Kysely 0.27 strips `| null` from Insertable even when the column is
        // declared `number | null` (a known Kysely limitation). We coalesce to
        // 0 (a valid timestamp / neutral confidence) and let downstream readers
        // treat 0 as "not captured" for time fields. SQL columns are unchanged.
        const mentionEvidenceIds = collectCandidateEvidenceIds(candidate);
        await trx
          .insertInto("shop_video_mentions")
          .values({
            id: crypto.randomUUID(),
            shop_id: shop.id,
            video_id: candidate.video_id,
            creator_id: candidate.creator_id,
            shop_candidate_id: candidate.id,
            mention_type: "main",
            sentiment: "unknown",
            summary: null,
            evidence_ids: mentionEvidenceIds,
            time_start_sec: candidate.time_start_sec ?? 0,
            time_end_sec: candidate.time_end_sec ?? 0,
            confidence: candidate.name_confidence ?? 0,
            created_at: new Date(),
          })
          .onConflict((conflict) =>
            conflict
              .columns(["shop_id", "video_id", "mention_type"])
              .doUpdateSet({
                shop_candidate_id: candidate.id,
                confidence: candidate.name_confidence ?? 0,
                evidence_ids: mentionEvidenceIds,
              }),
          )
          .execute();

        const updated = await trx
          .updateTable("shop_candidates")
          .set({
            status: "merged",
            merged_shop_id: shop.id,
            updated_at: new Date(),
          })
          .where("id", "=", params.id)
          .returningAll()
          .executeTakeFirstOrThrow();

        await trx
          .insertInto("review_events")
          .values({
            id: crypto.randomUUID(),
            review_task_id: null,
            entity_type: "shop_candidate",
            entity_id: params.id,
            action: "promote",
            before_json: {
              status: candidate.status,
              selected_poi_id: candidate.selected_poi_id,
            },
            after_json: {
              status: "merged",
              shop_id: shop.id,
              display_name: shop.display_name,
              refreshed_existing_shop: Boolean(existingShop),
            },
            reason: "Admin promoted candidate to shop",
            reviewer_id: admin.id,
            created_at: new Date(),
          })
          .execute();

        return { shop, candidate: updated };
      },
    );
    return { ok: true, shop: result.shop, candidate: result.candidate };
  });

  app.post("/shop-candidates/:id/reject", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await runAdminActionWithLock(
      app,
      {
        jobType: "reject_shop_candidate",
        entityType: "shop_candidate",
        entityId: params.id,
      },
      async (trx) => {
        await trx
          .updateTable("shop_candidates")
          .set({ status: "rejected" })
          .where("id", "=", params.id)
          .execute();
      },
    );
    return { ok: true };
  });

  app.get("/shops", async (request) => {
    const query = paginationSchema
      .extend({
        status: z.string().trim().optional(),
      })
      .parse(request.query);
    let qb = app.db.selectFrom("shops").selectAll();
    if (query.status) qb = qb.where("status", "=", query.status);
    const shops = await qb
      .orderBy("created_at", "desc")
      .limit(query.limit)
      .offset(query.offset)
      .execute();
    return { shops };
  });

  app.get("/shops/:id", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const shop = await app.db
      .selectFrom("shops")
      .selectAll()
      .where("id", "=", params.id)
      .executeTakeFirst();
    if (!shop) throw new HttpError(404, "shop_not_found", "Shop not found");
    const [externalLinks, poiBusiness] = await Promise.all([
      app.db
        .selectFrom("shop_external_links")
        .selectAll()
        .where("shop_id", "=", params.id)
        .orderBy("created_at", "asc")
        .execute(),
      app.db
        .selectFrom("pois")
        .select([
          "provider",
          "rating",
          "avg_cost",
          "phone",
          "business_hours",
          "tags",
          "photos",
          "provider_updated_at",
        ])
        .where("id", "=", shop.primary_poi_id)
        .executeTakeFirst(),
    ]);
    const reviewEvidenceIdList = reviewEvidenceIds(shop.aggregated_review);
    const reviewEvidence = reviewEvidenceIdList.length
      ? await app.db
          .selectFrom("evidence")
          .select(["id", "source_ref_id"])
          .where("id", "in", reviewEvidenceIdList)
          .where("source", "=", "comment")
          .execute()
      : [];
    const commentIds = reviewEvidence.flatMap((item) =>
      item.source_ref_id ? [item.source_ref_id] : [],
    );
    const reviewCommentRows = commentIds.length
      ? await app.db
          .selectFrom("video_comments")
          .select([
            "id",
            "content",
            "user_hash",
            "author_name",
            "author_avatar_url",
            "image_urls",
            "like_count",
            "reply_count",
            "published_at",
          ])
          .where("id", "in", commentIds)
          .execute()
      : [];
    const commentsById = new Map(
      reviewCommentRows.map((comment) => [comment.id, comment]),
    );
    const reviewComments = reviewEvidence.flatMap((item) => {
      if (!item.source_ref_id) return [];
      const comment = commentsById.get(item.source_ref_id);
      return comment ? [{ evidence_id: item.id, ...comment }] : [];
    });
    const mentions = await app.db
      .selectFrom("shop_video_mentions")
      .selectAll()
      .where("shop_id", "=", params.id)
      .orderBy("created_at", "desc")
      .execute();
    const videos = mentions.length
      ? await app.db
          .selectFrom("videos")
          .select([
            "id",
            "bvid",
            "title",
            "cover_url",
            "source_url",
            "published_at",
            "creator_id",
          ])
          .where(
            "id",
            "in",
            mentions.map((m) => m.video_id),
          )
          .execute()
      : [];
    const creators = videos.length
      ? await app.db
          .selectFrom("creators")
          .select(["id", "bilibili_uid", "name", "avatar_url"])
          .where(
            "id",
            "in",
            videos.map((v) => v.creator_id),
          )
          .execute()
      : [];
    return {
      shop,
      mentions,
      videos,
      creators,
      review_comments: reviewComments,
      external_links: externalLinks,
      poi_business: poiBusiness ?? null,
    };
  });

  app.put("/shops/:id/external-links/dianping", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ url: z.string() }).parse(request.body);
    const admin = await requireAdmin(app.db, request);
    let parsed: ReturnType<typeof parseDianpingUrl>;
    try {
      parsed = parseDianpingUrl(body.url);
    } catch (error) {
      if (error instanceof InvalidDianpingUrlError) {
        throw new HttpError(400, "invalid_dianping_url", error.message);
      }
      throw error;
    }

    const link = await runAdminActionWithLock(
      app,
      {
        jobType: "bind_shop_external_link",
        entityType: "shop",
        entityId: params.id,
      },
      async (trx) => {
        const shop = await trx
          .selectFrom("shops")
          .select(["id"])
          .where("id", "=", params.id)
          .executeTakeFirst();
        if (!shop) throw new HttpError(404, "shop_not_found", "Shop not found");

        const before = await trx
          .selectFrom("shop_external_links")
          .selectAll()
          .where("shop_id", "=", params.id)
          .where("platform", "=", "dianping")
          .executeTakeFirst();
        if (parsed.externalShopId) {
          const duplicate = await trx
            .selectFrom("shop_external_links")
            .select(["shop_id"])
            .where("platform", "=", "dianping")
            .where("external_shop_id", "=", parsed.externalShopId)
            .where("status", "=", "confirmed")
            .where("shop_id", "!=", params.id)
            .executeTakeFirst();
          if (duplicate) {
            throw new HttpError(
              409,
              "dianping_shop_already_bound",
              `Dianping shop is already bound to shop:${duplicate.shop_id}`,
            );
          }
        }

        const now = new Date();
        const saved = await trx
          .insertInto("shop_external_links")
          .values({
            id: crypto.randomUUID(),
            shop_id: params.id,
            platform: "dianping",
            external_shop_id: parsed.externalShopId,
            external_url: parsed.externalUrl,
            source: "manual",
            status: "confirmed",
            confirmed_by: admin.id,
            confirmed_at: now,
            last_verified_at: null,
            created_at: now,
            updated_at: now,
          })
          .onConflict((conflict) =>
            conflict.columns(["shop_id", "platform"]).doUpdateSet({
              external_shop_id: parsed.externalShopId,
              external_url: parsed.externalUrl,
              source: "manual",
              status: "confirmed",
              confirmed_by: admin.id,
              confirmed_at: now,
              last_verified_at: null,
              updated_at: now,
            }),
          )
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("review_events")
          .values({
            id: crypto.randomUUID(),
            review_task_id: null,
            entity_type: "shop",
            entity_id: params.id,
            action: before ? "replace_external_link" : "bind_external_link",
            before_json: before
              ? {
                  platform: before.platform,
                  external_shop_id: before.external_shop_id,
                  external_url: before.external_url,
                  status: before.status,
                }
              : null,
            after_json: {
              platform: saved.platform,
              external_shop_id: saved.external_shop_id,
              external_url: saved.external_url,
              status: saved.status,
            },
            reason: "Admin confirmed Dianping shop link",
            reviewer_id: admin.id,
            created_at: now,
          })
          .execute();
        return saved;
      },
    );
    return { link };
  });

  app.delete("/shops/:id/external-links/dianping", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const admin = await requireAdmin(app.db, request);
    const link = await runAdminActionWithLock(
      app,
      {
        jobType: "remove_shop_external_link",
        entityType: "shop",
        entityId: params.id,
      },
      async (trx) => {
        const before = await trx
          .selectFrom("shop_external_links")
          .selectAll()
          .where("shop_id", "=", params.id)
          .where("platform", "=", "dianping")
          .executeTakeFirst();
        if (!before) {
          throw new HttpError(
            404,
            "dianping_link_not_found",
            "Dianping link not found",
          );
        }
        const now = new Date();
        const removed = await trx
          .updateTable("shop_external_links")
          .set({ status: "removed", updated_at: now })
          .where("id", "=", before.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("review_events")
          .values({
            id: crypto.randomUUID(),
            review_task_id: null,
            entity_type: "shop",
            entity_id: params.id,
            action: "remove_external_link",
            before_json: {
              platform: before.platform,
              external_shop_id: before.external_shop_id,
              external_url: before.external_url,
              status: before.status,
            },
            after_json: {
              platform: removed.platform,
              external_shop_id: removed.external_shop_id,
              external_url: removed.external_url,
              status: removed.status,
            },
            reason: "Admin removed Dianping shop link",
            reviewer_id: admin.id,
            created_at: now,
          })
          .execute();
        return removed;
      },
    );
    return { link };
  });

  app.post("/shops/:id/approve", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const admin = await requireAdmin(app.db, request);
    const result = await runAdminActionWithLock(
      app,
      {
        jobType: "approve_shop",
        entityType: "shop",
        entityId: params.id,
      },
      async (trx) => {
        const shop = await trx
          .selectFrom("shops")
          .selectAll()
          .where("id", "=", params.id)
          .executeTakeFirst();
        if (!shop) throw new HttpError(404, "shop_not_found", "Shop not found");
        if (shop.status !== "draft") {
          throw new HttpError(
            409,
            "shop_not_ready_for_approve",
            `Shop is in status='${shop.status}'; expected 'draft'`,
          );
        }
        const updated = await trx
          .updateTable("shops")
          .set({
            status: "approved",
            last_reviewed_at: new Date(),
            updated_at: new Date(),
          })
          .where("id", "=", params.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("review_events")
          .values({
            id: crypto.randomUUID(),
            review_task_id: null,
            entity_type: "shop",
            entity_id: params.id,
            action: "approve",
            before_json: { status: shop.status },
            after_json: { status: "approved" },
            reason: "Admin approved shop for publication",
            reviewer_id: admin.id,
            created_at: new Date(),
          })
          .execute();
        return updated;
      },
    );
    return { shop: result };
  });

  app.patch("/shops/:id", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        display_name: z.string().optional(),
        status: z.string().optional(),
        card_payload: z.record(z.unknown()).optional(),
      })
      .parse(request.body);
    const [shop] = await app.db
      .updateTable("shops")
      .set({ ...body, updated_at: new Date() })
      .where("id", "=", params.id)
      .returningAll()
      .execute();
    return { shop };
  });

  app.post("/shops/:id/publish", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const admin = await requireAdmin(app.db, request);
    const result = await runAdminActionWithLock(
      app,
      {
        jobType: "publish_shop",
        entityType: "shop",
        entityId: params.id,
      },
      async (trx) => {
        const shop = await trx
          .selectFrom("shops")
          .selectAll()
          .where("id", "=", params.id)
          .executeTakeFirst();
        if (!shop) throw new HttpError(404, "shop_not_found", "Shop not found");
        // Per AGENTS.md §3.5: publish must follow an explicit approve step.
        if (shop.status !== "approved") {
          throw new HttpError(
            409,
            "shop_not_approved",
            `Shop is in status='${shop.status}'; call /approve before /publish`,
          );
        }
        const current = await trx
          .selectFrom("published_shop_snapshots")
          .select((eb) => eb.fn.max<number>("version").as("version"))
          .where("shop_id", "=", params.id)
          .executeTakeFirst();
        const version = Number(current?.version ?? 0) + 1;
        await trx
          .updateTable("published_shop_snapshots")
          .set({ is_current: false })
          .where("shop_id", "=", params.id)
          .execute();
        await trx
          .insertInto("published_shop_snapshots")
          .values({
            id: crypto.randomUUID(),
            shop_id: params.id,
            version,
            snapshot_json: {
              shop_id: shop.id,
              canonical_name: shop.canonical_name,
              display_name: shop.display_name,
              card: shop.card_payload,
              quality: shop.quality,
            },
            published_by: admin.id,
            published_at: new Date(),
            is_current: true,
          })
          .execute();
        const [published] = await trx
          .updateTable("shops")
          .set({
            status: "published",
            published_at: new Date(),
            updated_at: new Date(),
          })
          .where("id", "=", params.id)
          .returningAll()
          .execute();
        return published;
      },
    );
    return { shop: result };
  });

  app.post("/shops/merge", async () => {
    return {
      ok: true,
      message: "Merge task placeholder created for MVP skeleton",
    };
  });
};
