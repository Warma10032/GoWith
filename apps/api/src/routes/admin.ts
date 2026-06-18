import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
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

const bilibiliAuthSchema = z.object({
  label: z.string().min(1),
  cookie: z.string().min(10),
  csrf_token: z.string().optional(),
});

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
    const query = paginationSchema.parse(request.query);
    const creators = await app.db
      .selectFrom("creators")
      .selectAll()
      .orderBy("created_at", "desc")
      .limit(query.limit)
      .offset(query.offset)
      .execute();
    return { creators };
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
    const creator = await app.db.selectFrom("creators").selectAll().where("id", "=", params.id).executeTakeFirst();
    if (!creator) throw new HttpError(404, "creator_not_found", "Creator not found");
    const job = await enqueuePipelineJob(app.db, "sync_creator_videos", "creator", creator.id, {
      bilibili_uid: creator.bilibili_uid,
    });
    return { job_id: job.id };
  });

  app.get("/videos", async (request) => {
    const query = paginationSchema.parse(request.query);
    const videos = await app.db
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
      .offset(query.offset)
      .execute();
    return { videos };
  });

  app.get("/videos/:id", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const video = await app.db.selectFrom("videos").selectAll().where("id", "=", params.id).executeTakeFirst();
    if (!video) throw new HttpError(404, "video_not_found", "Video not found");
    const [segments, candidates, reviews] = await Promise.all([
      app.db.selectFrom("video_text_segments").selectAll().where("video_id", "=", params.id).orderBy("segment_index").limit(200).execute(),
      app.db.selectFrom("shop_candidates").selectAll().where("video_id", "=", params.id).orderBy("created_at", "desc").execute(),
      app.db.selectFrom("review_tasks").selectAll().where("entity_id", "=", params.id).orderBy("created_at", "desc").execute(),
    ]);
    return { video, segments, candidates, reviews };
  });

  app.post("/videos/:id/retry-asr", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const job = await enqueuePipelineJob(app.db, "run_asr", "video", params.id);
    return { job_id: job.id };
  });

  app.post("/videos/:id/retry-ai", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const job = await enqueuePipelineJob(app.db, "classify_video", "video", params.id);
    return { job_id: job.id };
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
          "pois.name",
          "pois.address",
          "pois.city",
          "pois.district",
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
    const job = await enqueuePipelineJob(app.db, "match_poi", "shop_candidate", params.id);
    return { job_id: job.id };
  });

  app.post("/shop-candidates/:id/select-poi", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ poi_id: z.string().uuid() }).parse(request.body);
    await app.db
      .updateTable("shop_candidates")
      .set({ selected_poi_id: body.poi_id, status: "poi_matched", updated_at: new Date() })
      .where("id", "=", params.id)
      .execute();
    return { ok: true };
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
