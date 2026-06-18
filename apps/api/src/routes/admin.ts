import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import { createCreatorRequestSchema } from "@gowith/shared";
import { HttpError } from "../lib/http";
import { encryptSecret } from "../services/crypto";
import { requireAdmin } from "../services/auth";
import { enqueuePipelineJob } from "../services/queue";

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

const bilibiliAuthSchema = z.object({
  label: z.string().min(1),
  cookie: z.string().min(10),
  csrf_token: z.string().optional(),
});

async function createPipelineRun(
  app: Parameters<FastifyPluginAsync>[0],
  input: {
    runType: "creator_video_sync" | "video_processing" | "video_asr_retry" | "video_ai_retry" | "poi_match";
    entityType: string;
    entityId: string;
    triggeredBy: string;
    summary?: Record<string, unknown>;
  },
) {
  return app.db
    .insertInto("pipeline_runs")
    .values({
      id: crypto.randomUUID(),
      run_type: input.runType,
      entity_type: input.entityType,
      entity_id: input.entityId,
      status: "queued",
      triggered_by: input.triggeredBy,
      started_at: null,
      finished_at: null,
      summary_json: input.summary ?? {},
      created_at: new Date(),
      updated_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export const registerAdminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request) => {
    await requireAdmin(app.db, request);
  });

  app.get("/dashboard", async () => {
    const [creators, videos, candidates, reviews, shops, activeCookies, expiredCookies, riskCookies] = await Promise.all([
      app.db.selectFrom("creators").select((eb) => eb.fn.countAll<string>().as("count")).executeTakeFirst(),
      app.db.selectFrom("videos").select((eb) => eb.fn.countAll<string>().as("count")).executeTakeFirst(),
      app.db.selectFrom("shop_candidates").select((eb) => eb.fn.countAll<string>().as("count")).executeTakeFirst(),
      app.db.selectFrom("review_tasks").where("status", "=", "open").select((eb) => eb.fn.countAll<string>().as("count")).executeTakeFirst(),
      app.db.selectFrom("shops").where("status", "=", "published").select((eb) => eb.fn.countAll<string>().as("count")).executeTakeFirst(),
      app.db.selectFrom("bilibili_auth_accounts").where("status", "=", "active").select((eb) => eb.fn.countAll<string>().as("count")).executeTakeFirst(),
      app.db.selectFrom("bilibili_auth_accounts").where("status", "=", "expired").select((eb) => eb.fn.countAll<string>().as("count")).executeTakeFirst(),
      app.db.selectFrom("bilibili_auth_accounts").where("status", "=", "risk").select((eb) => eb.fn.countAll<string>().as("count")).executeTakeFirst(),
    ]);

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
        csrf_token_encrypted: body.csrf_token ? encryptSecret(body.csrf_token) : null,
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

  app.post("/bilibili-auth/check", async () => {
    const job = await enqueuePipelineJob(app.db, "check_bilibili_auth_pool", "system", crypto.randomUUID());
    return { job_id: job.id };
  });

  app.get("/creators", async (request) => {
    const query = listQuerySchema.parse(request.query);
    let builder = app.db
      .selectFrom("creators")
      .selectAll()
      .orderBy("created_at", "desc")
      .limit(query.limit)
      .offset(query.offset);
    if (query.status) builder = builder.where("status", "=", query.status as never);
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
    const creator = await app.db.selectFrom("creators").selectAll().where("id", "=", params.id).executeTakeFirst();
    if (!creator) throw new HttpError(404, "creator_not_found", "Creator not found");
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

  app.post("/creators", async (request) => {
    const body = createCreatorRequestSchema.parse(request.body);
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
    const job = await enqueuePipelineJob(app.db, "sync_creator_profile", "creator", creator.id, {
      bilibili_uid: creator.bilibili_uid,
    });
    return { creator, profile_job_id: job.id };
  });

  app.post("/creators/:id/sync", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const admin = await requireAdmin(app.db, request);
    const creator = await app.db.selectFrom("creators").selectAll().where("id", "=", params.id).executeTakeFirst();
    if (!creator) throw new HttpError(404, "creator_not_found", "Creator not found");
    const run = await createPipelineRun(app, {
      runType: "creator_video_sync",
      entityType: "creator",
      entityId: creator.id,
      triggeredBy: admin.id,
      summary: { bilibili_uid: creator.bilibili_uid },
    });
    const job = await enqueuePipelineJob(app.db, "sync_creator_videos", "creator", creator.id, {
      run_id: run.id,
      bilibili_uid: creator.bilibili_uid,
    });
    return { run_id: run.id, job_id: job.data.db_job_id ?? job.id };
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
    if (query.status) builder = builder.where("workflow_status", "=", query.status);
    if (query.content_type) builder = builder.where("content_type", "=", query.content_type);
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
    if (query.creator_id) builder = builder.where("videos.creator_id", "=", query.creator_id);
    if (query.status) builder = builder.where("videos.workflow_status", "=", query.status);
    if (query.content_type) builder = builder.where("videos.content_type", "=", query.content_type);
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
    const video = await app.db.selectFrom("videos").selectAll().where("id", "=", params.id).executeTakeFirst();
    if (!video) throw new HttpError(404, "video_not_found", "Video not found");
    const [assets, segments, comments, candidates, reviews, aiRuns, latestRun] = await Promise.all([
      app.db.selectFrom("video_text_assets").selectAll().where("video_id", "=", params.id).orderBy("created_at", "desc").execute(),
      app.db.selectFrom("video_text_segments").selectAll().where("video_id", "=", params.id).orderBy("segment_index").limit(200).execute(),
      app.db.selectFrom("video_comments").selectAll().where("video_id", "=", params.id).orderBy("like_count", "desc").limit(80).execute(),
      app.db.selectFrom("shop_candidates").selectAll().where("video_id", "=", params.id).orderBy("created_at", "desc").execute(),
      app.db.selectFrom("review_tasks").selectAll().where("entity_id", "=", params.id).orderBy("created_at", "desc").execute(),
      app.db.selectFrom("ai_runs").selectAll().where("entity_type", "=", "video").where("entity_id", "=", params.id).orderBy("created_at", "desc").limit(20).execute(),
      app.db
        .selectFrom("pipeline_runs")
        .selectAll()
        .where("entity_type", "=", "video")
        .where("entity_id", "=", params.id)
        .orderBy("created_at", "desc")
        .executeTakeFirst(),
    ]);
    return { video, assets, segments, comments, candidates, reviews, ai_runs: aiRuns, latest_run: latestRun ?? null };
  });

  app.post("/videos/:id/process", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const admin = await requireAdmin(app.db, request);
    const video = await app.db.selectFrom("videos").select(["id", "title"]).where("id", "=", params.id).executeTakeFirst();
    if (!video) throw new HttpError(404, "video_not_found", "Video not found");
    const run = await createPipelineRun(app, {
      runType: "video_processing",
      entityType: "video",
      entityId: params.id,
      triggeredBy: admin.id,
      summary: { title: video.title },
    });
    const job = await enqueuePipelineJob(app.db, "process_video", "video", params.id, { run_id: run.id });
    return { run_id: run.id, job_id: job.data.db_job_id ?? job.id };
  });

  app.post("/videos/:id/retry-asr", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const admin = await requireAdmin(app.db, request);
    const run = await createPipelineRun(app, { runType: "video_asr_retry", entityType: "video", entityId: params.id, triggeredBy: admin.id });
    const job = await enqueuePipelineJob(app.db, "run_asr", "video", params.id, { run_id: run.id });
    return { run_id: run.id, job_id: job.data.db_job_id ?? job.id };
  });

  app.post("/videos/:id/retry-ai", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const admin = await requireAdmin(app.db, request);
    const run = await createPipelineRun(app, { runType: "video_ai_retry", entityType: "video", entityId: params.id, triggeredBy: admin.id });
    const job = await enqueuePipelineJob(app.db, "classify_video", "video", params.id, { run_id: run.id });
    return { run_id: run.id, job_id: job.data.db_job_id ?? job.id };
  });

  app.post("/videos/:id/mark-non-shop", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await app.db
      .updateTable("videos")
      .set({ is_shop_visit: false, content_type: "non_shop_visit", workflow_status: "non_shop_visit" })
      .where("id", "=", params.id)
      .execute();
    return { ok: true };
  });

  app.get("/pipeline-runs", async (request) => {
    const query = listQuerySchema.parse(request.query);
    let builder = app.db.selectFrom("pipeline_runs").selectAll().orderBy("created_at", "desc").limit(query.limit).offset(query.offset);
    if (query.status) builder = builder.where("status", "=", query.status as never);
    const rawQuery = request.query as Record<string, string | undefined>;
    if (rawQuery.entity_type) builder = builder.where("entity_type", "=", rawQuery.entity_type);
    if (rawQuery.entity_id) builder = builder.where("entity_id", "=", rawQuery.entity_id);
    const runs = await builder.execute();
    return { runs };
  });

  app.get("/pipeline-runs/:id/events", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const [run, events] = await Promise.all([
      app.db.selectFrom("pipeline_runs").selectAll().where("id", "=", params.id).executeTakeFirst(),
      app.db.selectFrom("pipeline_events").selectAll().where("run_id", "=", params.id).orderBy("created_at", "asc").execute(),
    ]);
    if (!run) throw new HttpError(404, "run_not_found", "Pipeline run not found");
    return { run, events };
  });

  app.get("/ai-runs", async (request) => {
    const query = listQuerySchema.parse(request.query);
    let builder = app.db.selectFrom("ai_runs").selectAll().orderBy("created_at", "desc").limit(query.limit).offset(query.offset);
    const rawQuery = request.query as Record<string, string | undefined>;
    if (query.status) builder = builder.where("status", "=", query.status as never);
    if (query.stage) builder = builder.where("stage", "=", query.stage);
    if (rawQuery.entity_type) builder = builder.where("entity_type", "=", rawQuery.entity_type);
    if (rawQuery.entity_id) builder = builder.where("entity_id", "=", rawQuery.entity_id);
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
    const candidate = await app.db.selectFrom("shop_candidates").selectAll().where("id", "=", params.id).executeTakeFirst();
    if (!candidate) throw new HttpError(404, "candidate_not_found", "Shop candidate not found");
    const [evidence, poiCandidates] = await Promise.all([
      app.db.selectFrom("evidence").selectAll().where("shop_candidate_id", "=", params.id).execute(),
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

  app.post("/shop-candidates/:id/search-poi", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        keywords: z.string().trim().min(1).max(80).optional(),
        region: z.string().trim().min(1).max(80).optional(),
        types: z.string().trim().min(1).max(80).optional(),
      })
      .partial()
      .parse(request.body ?? {});
    const job = await enqueuePipelineJob(app.db, "match_poi", "shop_candidate", params.id, body);
    return { job_id: job.id };
  });

  app.post("/shop-candidates/:id/select-poi", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ poi_id: z.string().uuid() }).parse(request.body);
    const admin = await requireAdmin(app.db, request);
    const result = await app.db.transaction().execute(async (trx) => {
      const before = await trx.selectFrom("shop_candidates").selectAll().where("id", "=", params.id).executeTakeFirst();
      if (!before) throw new HttpError(404, "candidate_not_found", "Shop candidate not found");
      const poi = await trx.selectFrom("pois").selectAll().where("id", "=", body.poi_id).executeTakeFirst();
      if (!poi) throw new HttpError(404, "poi_not_found", "POI not found");
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
        .set({ selected_poi_id: body.poi_id, status: "poi_matched", updated_at: new Date() })
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
      if (openReview) {
        await trx
          .updateTable("review_tasks")
          .set({ status: "resolved", resolved_by: admin.id, resolved_at: new Date(), updated_at: new Date() })
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
          before_json: { selected_poi_id: before.selected_poi_id, status: before.status },
          after_json: { selected_poi_id: body.poi_id, status: "poi_matched", poi_name: poi.name },
          reason: "Admin selected POI candidate",
          reviewer_id: admin.id,
          created_at: new Date(),
        })
        .execute();
      return updated;
    });
    return { ok: true, candidate: result };
  });

  app.post("/shop-candidates/:id/reject", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await app.db.updateTable("shop_candidates").set({ status: "rejected" }).where("id", "=", params.id).execute();
    return { ok: true };
  });

  app.get("/shops", async (request) => {
    const query = paginationSchema.parse(request.query);
    const shops = await app.db.selectFrom("shops").selectAll().orderBy("created_at", "desc").limit(query.limit).offset(query.offset).execute();
    return { shops };
  });

  app.patch("/shops/:id", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        display_name: z.string().optional(),
        status: z.string().optional(),
        avg_price_hint: z.string().nullable().optional(),
        card_payload: z.record(z.unknown()).optional(),
      })
      .parse(request.body);
    const [shop] = await app.db.updateTable("shops").set({ ...body, updated_at: new Date() }).where("id", "=", params.id).returningAll().execute();
    return { shop };
  });

  app.post("/shops/:id/publish", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const admin = await requireAdmin(app.db, request);
    const result = await app.db.transaction().execute(async (trx) => {
      const shop = await trx.selectFrom("shops").selectAll().where("id", "=", params.id).executeTakeFirst();
      if (!shop) throw new HttpError(404, "shop_not_found", "Shop not found");
      const current = await trx
        .selectFrom("published_shop_snapshots")
        .select((eb) => eb.fn.max<number>("version").as("version"))
        .where("shop_id", "=", params.id)
        .executeTakeFirst();
      const version = Number(current?.version ?? 0) + 1;
      await trx.updateTable("published_shop_snapshots").set({ is_current: false }).where("shop_id", "=", params.id).execute();
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
        .set({ status: "published", published_at: new Date(), updated_at: new Date() })
        .where("id", "=", params.id)
        .returningAll()
        .execute();
      return published;
    });
    return { shop: result };
  });

  app.post("/shops/merge", async () => {
    return { ok: true, message: "Merge task placeholder created for MVP skeleton" };
  });
};
