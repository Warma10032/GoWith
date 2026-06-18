import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import { createUserEventSchema, favoriteRequestSchema } from "@gowith/shared";
import { HttpError } from "../lib/http";
import { getUserFromRequest, requireUser } from "../services/auth";

type SourceVideo = {
  video_id: string;
  title: string;
  source_url: string;
  bvid: string;
  cover_url: string | null;
  creator_name: string;
};

async function getSourceVideosByShopIds(app: Parameters<FastifyPluginAsync>[0], shopIds: string[]) {
  if (!shopIds.length) return new Map<string, SourceVideo[]>();
  const rows = await app.db
    .selectFrom("shop_video_mentions")
    .innerJoin("videos", "videos.id", "shop_video_mentions.video_id")
    .innerJoin("creators", "creators.id", "shop_video_mentions.creator_id")
    .select([
      "shop_video_mentions.shop_id",
      "videos.id as video_id",
      "videos.title",
      "videos.source_url",
      "videos.bvid",
      "videos.cover_url",
      "creators.name as creator_name",
    ])
    .where("shop_video_mentions.shop_id", "in", shopIds)
    .orderBy("videos.published_at", "desc")
    .execute();

  const videosByShop = new Map<string, SourceVideo[]>();
  for (const row of rows) {
    const videos = videosByShop.get(row.shop_id) ?? [];
    if (videos.length < 3) {
      videos.push({
        video_id: row.video_id,
        title: row.title,
        source_url: row.source_url,
        bvid: row.bvid,
        cover_url: row.cover_url,
        creator_name: row.creator_name,
      });
    }
    videosByShop.set(row.shop_id, videos);
  }
  return videosByShop;
}

function attachSourceVideos<T extends { id: string }>(shops: T[], videosByShop: Map<string, SourceVideo[]>) {
  return shops.map((shop) => ({ ...shop, source_videos: videosByShop.get(shop.id) ?? [] }));
}

export const registerPublicRoutes: FastifyPluginAsync = async (app) => {
  app.get("/creators", async () => {
    const creators = await app.db
      .selectFrom("creators")
      .select(["id", "bilibili_uid", "name", "avatar_url", "profile_url", "bio", "follower_count", "status"])
      .where("status", "=", "active")
      .orderBy("created_at", "desc")
      .limit(100)
      .execute();
    return { creators };
  });

  app.get("/creators/:id", async (request) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) throw new HttpError(400, "invalid_creator_id", "Creator id must be a uuid");
    const creator = await app.db.selectFrom("creators").selectAll().where("id", "=", params.data.id).executeTakeFirst();
    if (!creator) throw new HttpError(404, "creator_not_found", "Creator not found");
    // Sort shops by the latest video that mentioned them. DISTINCT ON
    // collapses the inner-join fan-out (one shop can have many mentions)
    // and keeps only the most recent mention per shop, which is what
    // the public creator page renders as the sort key.
    const shops = await app.db
      .selectFrom("shops")
      .innerJoin("shop_video_mentions", "shop_video_mentions.shop_id", "shops.id")
      .innerJoin("videos", "videos.id", "shop_video_mentions.video_id")
      .select([
        "shops.id",
        "shops.display_name",
        "shops.city",
        "shops.district",
        "shops.card_payload",
        "shops.status",
        "videos.published_at as latest_video_published_at",
        "videos.id as latest_video_id",
        "videos.title as latest_video_title",
        "videos.bvid as latest_video_bvid",
        "videos.source_url as latest_video_source_url",
      ])
      .where("shop_video_mentions.creator_id", "=", params.data.id)
      .where("shops.status", "=", "published")
      .distinctOn("shops.id")
      .orderBy("shops.id")
      .orderBy("videos.published_at", "desc")
      .limit(100)
      .execute();
    const videosByShop = await getSourceVideosByShopIds(app, shops.map((shop) => shop.id));
    return {
      creator,
      shops: attachSourceVideos(shops, videosByShop).map((shop) => ({
        ...shop,
        latest_video: {
          id: shop.latest_video_id,
          title: shop.latest_video_title,
          bvid: shop.latest_video_bvid,
          source_url: shop.latest_video_source_url,
          published_at: shop.latest_video_published_at,
        },
      })),
    };
  });

  app.get("/shops/recommended", async (request) => {
    const user = await getUserFromRequest(app.db, request);
    const requestId = crypto.randomUUID();
    await app.db
      .insertInto("recommendation_requests")
      .values({
        id: requestId,
        user_id: user?.id ?? null,
        anonymous_id: (request.query as { anonymous_id?: string }).anonymous_id ?? null,
        surface: "home",
        request_context: request.query as never,
        algorithm: "rule_v0",
        model_version: null,
        created_at: new Date(),
      })
      .execute();

    const shops = await app.db
      .selectFrom("shops")
      .selectAll()
      .where("status", "=", "published")
      .orderBy("published_at", "desc")
      .limit(30)
      .execute();

    const items = [];
    for (const [index, shop] of shops.entries()) {
      const itemId = crypto.randomUUID();
      const score = 1 / (index + 1);
      await app.db
        .insertInto("recommendation_items")
        .values({
          id: itemId,
          request_id: requestId,
          shop_id: shop.id,
          rank: index + 1,
          score,
          reason_codes: ["published_recently", "rule_v0"],
          feature_snapshot: {
            shop_confidence: (shop.quality as Record<string, unknown>)?.shop_confidence ?? null,
            published_at: shop.published_at,
          },
          created_at: new Date(),
        })
        .execute();
      items.push({ ...shop, recommendation_item_id: itemId, score });
    }

    const videosByShop = await getSourceVideosByShopIds(app, items.map((shop) => shop.id));
    return { recommendation_request_id: requestId, shops: attachSourceVideos(items, videosByShop) };
  });

  app.get("/shops/map", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const minLng = Number(query.min_lng ?? 70);
    const minLat = Number(query.min_lat ?? 15);
    const maxLng = Number(query.max_lng ?? 140);
    const maxLat = Number(query.max_lat ?? 55);
    const limit = Math.min(500, Math.max(1, Number(query.limit ?? 500)));
    const q = query.q?.trim();
    const creatorId = query.creator_id?.trim();
    const category = query.category?.trim();
    const shops = await sql`
      SELECT DISTINCT shops.id, shops.display_name, shops.city, shops.district, shops.address, shops.lng, shops.lat, shops.coord_type, shops.card_payload, shops.quality, shops.published_at
      FROM shops
      ${creatorId ? sql`INNER JOIN shop_video_mentions svm_filter ON svm_filter.shop_id = shops.id` : sql``}
      WHERE shops.status = 'published'
        AND shops.geom && ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)
        ${q ? sql`AND (shops.display_name ILIKE ${`%${q}%`} OR shops.address ILIKE ${`%${q}%`} OR shops.city ILIKE ${`%${q}%`} OR shops.district ILIKE ${`%${q}%`} OR shops.display_name % ${q})` : sql``}
        ${creatorId ? sql`AND svm_filter.creator_id = ${creatorId}` : sql``}
        ${category ? sql`AND (shops.category_primary = ${category} OR shops.category_secondary = ${category})` : sql``}
      ORDER BY shops.published_at DESC NULLS LAST
      LIMIT ${limit}
    `.execute(app.db);
    const mapShops = shops.rows as Array<{ id: string }>;
    const videosByShop = await getSourceVideosByShopIds(app, mapShops.map((shop) => shop.id));
    return { shops: attachSourceVideos(mapShops, videosByShop) };
  });

  app.get("/shops/search", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const q = query.q?.trim();
    const limit = Math.min(50, Math.max(1, Number(query.limit ?? 20)));
    if (!q) return { shops: [] };
    const shops = await sql`
      SELECT id, display_name, city, district, address, lng, lat, coord_type, card_payload, quality,
        GREATEST(
          similarity(display_name, ${q}),
          similarity(COALESCE(address, ''), ${q}),
          CASE WHEN display_name ILIKE ${`%${q}%`} THEN 1 ELSE 0 END
        ) AS rank_score
      FROM shops
      WHERE status = 'published'
        AND (
          display_name ILIKE ${`%${q}%`}
          OR address ILIKE ${`%${q}%`}
          OR city ILIKE ${`%${q}%`}
          OR district ILIKE ${`%${q}%`}
          OR display_name % ${q}
          OR COALESCE(address, '') % ${q}
        )
      ORDER BY rank_score DESC, shops.published_at DESC NULLS LAST
      LIMIT ${limit}
    `.execute(app.db);
    const searchShops = shops.rows as Array<{ id: string }>;
    const videosByShop = await getSourceVideosByShopIds(app, searchShops.map((shop) => shop.id));
    return { shops: attachSourceVideos(searchShops, videosByShop) };
  });

  app.get("/shops/:id", async (request) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) throw new HttpError(400, "invalid_shop_id", "Shop id must be a uuid");
    const shop = await app.db.selectFrom("shops").selectAll().where("id", "=", params.data.id).where("status", "=", "published").executeTakeFirst();
    if (!shop) throw new HttpError(404, "shop_not_found", "Shop not found");
    const [mentions, evidence] = await Promise.all([
      app.db
        .selectFrom("shop_video_mentions")
        .innerJoin("videos", "videos.id", "shop_video_mentions.video_id")
        .innerJoin("creators", "creators.id", "shop_video_mentions.creator_id")
        .select(["videos.id as video_id", "videos.title", "videos.source_url", "videos.bvid", "videos.cover_url", "creators.name as creator_name"])
        .where("shop_video_mentions.shop_id", "=", params.data.id)
        .execute(),
      app.db.selectFrom("evidence").select(["source", "text_excerpt", "start_sec", "end_sec", "confidence"]).where("shop_id", "=", params.data.id).limit(20).execute(),
    ]);
    return { shop, mentions, evidence };
  });

  app.post("/users/events", async (request) => {
    const user = await getUserFromRequest(app.db, request);
    const body = createUserEventSchema.parse(request.body);
    await app.db
      .insertInto("user_events")
      .values({
        id: crypto.randomUUID(),
        user_id: user?.id ?? null,
        anonymous_id: body.anonymous_id ?? null,
        event_name: body.event_name,
        entity_type: body.entity_type ?? null,
        entity_id: body.entity_id ?? null,
        shop_id: body.shop_id ?? null,
        creator_id: body.creator_id ?? null,
        video_id: body.video_id ?? null,
        recommendation_request_id: body.recommendation_request_id ?? null,
        recommendation_item_id: body.recommendation_item_id ?? null,
        surface: body.surface,
        event_payload: body.event_payload as never,
        client_type: body.client_type,
        created_at: new Date(),
      })
      .execute();
    return { ok: true };
  });

  app.post("/users/favorites", async (request) => {
    const user = await requireUser(app.db, request);
    const body = favoriteRequestSchema.parse(request.body);
    await app.db
      .insertInto("user_favorites")
      .values({
        id: crypto.randomUUID(),
        user_id: user.id,
        shop_id: body.shop_id,
        action_type: body.action_type,
        note: body.note ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict((oc) =>
        oc.columns(["user_id", "shop_id", "action_type"]).doUpdateSet({
          note: body.note ?? null,
          updated_at: new Date(),
        }),
      )
      .execute();
    return { ok: true };
  });
};
