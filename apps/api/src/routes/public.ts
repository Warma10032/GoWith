import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import {
  citiesForProvinceInput,
  createUserEventSchema,
  favoriteRequestSchema,
  provinceForRegionInput,
  regionNameVariants,
  shopCategoryOptions,
  wgs84ToGcj02,
} from "@gowith/shared";
import { HttpError } from "../lib/http";
import { checkRateLimit } from "../services/rate-limit";
import {
  getRequestClientIp,
  getUserFromRequest,
  requireUser,
} from "../services/auth";

type SourceVideo = {
  video_id: string;
  title: string;
  source_url: string;
  bvid: string;
  cover_url: string | null;
  creator_name: string;
};

type ShopExternalLink = {
  id: string;
  platform: "dianping" | "meituan";
  url: string;
};

type PoiPhoto = {
  title?: string | null;
  url: string;
};

type PoiBusiness = {
  provider: "amap" | "tencent" | "baidu";
  rating: number | null;
  avg_cost: number | null;
  phone: string | null;
  business_hours: string | null;
  tags: string[];
  photos: PoiPhoto[];
};

type ShopSupplement = {
  external_links: ShopExternalLink[];
  poi_business: PoiBusiness | null;
};

type RecommendedShopRow = Record<string, unknown> & {
  id: string;
  distance_m: number | null;
  recommendation_score: number | null;
  poi_avg_cost: number | null;
  poi_rating: number | null;
  has_dianping_link: boolean;
  quality: unknown;
  published_at: Date | null;
};

const recommendedSortSchema = z.enum([
  "recommended",
  "distance",
  "latest",
  "ai_score",
  "amap_rating",
  "price_asc",
  "price_desc",
]);
const recommendedCategorySchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}, z.enum(shopCategoryOptions).optional());

const optionalTrimmedString = z
  .string()
  .trim()
  .transform((value) => (value ? value : undefined))
  .optional();

const booleanQuerySchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return value;
}, z.boolean().optional());

const optionalNonNegativeNumber = z.preprocess((value) => {
  if (value === "") return undefined;
  return value;
}, z.coerce.number().min(0).optional());

export const recommendedQuerySchema = z
  .object({
    anonymous_id: z.string().optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    coord_type: z.enum(["wgs84", "gcj02"]).default("wgs84"),
    sort: recommendedSortSchema.default("recommended"),
    city: optionalTrimmedString,
    category: recommendedCategorySchema,
    creator_id: z.string().uuid().optional(),
    min_avg_cost: optionalNonNegativeNumber,
    max_avg_cost: optionalNonNegativeNumber,
    has_dianping: booleanQuerySchema,
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .superRefine((value, context) => {
    if ((value.lng === undefined) !== (value.lat === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "lng and lat must be provided together",
      });
    }
    if (
      value.min_avg_cost !== undefined &&
      value.max_avg_cost !== undefined &&
      value.min_avg_cost > value.max_avg_cost
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "min_avg_cost must be less than or equal to max_avg_cost",
        path: ["min_avg_cost"],
      });
    }
  });

// P1-6: 地图 / 搜索 query 的 Zod schema，约束坐标范围、查询词长度。
const trimmedQueryString = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .optional();

export const shopMapQuerySchema = z
  .object({
    min_lng: z.coerce.number().min(-180).max(180).default(70),
    min_lat: z.coerce.number().min(-90).max(90).default(15),
    max_lng: z.coerce.number().min(-180).max(180).default(140),
    max_lat: z.coerce.number().min(-90).max(90).default(55),
    limit: z.coerce.number().int().min(1).max(500).default(500),
    q: trimmedQueryString,
    creator_id: z.string().uuid().optional(),
    category: z.string().trim().min(1).max(80).optional(),
  })
  .superRefine((value, context) => {
    if (value.min_lng > value.max_lng) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "min_lng must be <= max_lng",
        path: ["min_lng"],
      });
    }
    if (value.min_lat > value.max_lat) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "min_lat must be <= max_lat",
        path: ["min_lat"],
      });
    }
    // 面积上限：避免超长 bbox 拉爆 PostGIS / trigram
    const lngSpan = value.max_lng - value.min_lng;
    const latSpan = value.max_lat - value.min_lat;
    if (lngSpan * latSpan > 360 * 180) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "bbox too large",
        path: ["max_lng"],
      });
    }
  });

export const shopSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const EVENTS_RATE_LIMIT_MAX = 60;
const EVENTS_RATE_LIMIT_WINDOW_MS = 60 * 1000;

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return value !== null && value !== "" && Number.isFinite(parsed)
    ? parsed
    : null;
}

function poiPhotos(value: unknown): PoiPhoto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const photo = item as Record<string, unknown>;
    if (typeof photo.url !== "string" || !photo.url.trim()) return [];
    let url: URL;
    try {
      url = new URL(photo.url);
    } catch {
      return [];
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return [];
    return [
      {
        title: typeof photo.title === "string" ? photo.title : null,
        url: url.toString(),
      },
    ];
  });
}

async function getShopSupplementsByIds(
  app: Parameters<FastifyPluginAsync>[0],
  shopIds: string[],
) {
  const supplements = new Map<string, ShopSupplement>();
  if (!shopIds.length) return supplements;
  const [links, poiRows] = await Promise.all([
    app.db
      .selectFrom("shop_external_links")
      .select(["id", "shop_id", "platform", "external_url"])
      .where("shop_id", "in", shopIds)
      .where("status", "=", "confirmed")
      .execute(),
    app.db
      .selectFrom("shops")
      .innerJoin("pois", "pois.id", "shops.primary_poi_id")
      .select([
        "shops.id as shop_id",
        "pois.provider",
        "pois.rating",
        "pois.avg_cost",
        "pois.phone",
        "pois.business_hours",
        "pois.tags",
        "pois.photos",
      ])
      .where("shops.id", "in", shopIds)
      .execute(),
  ]);

  for (const shopId of shopIds) {
    supplements.set(shopId, { external_links: [], poi_business: null });
  }
  for (const link of links) {
    supplements.get(link.shop_id)?.external_links.push({
      id: link.id,
      platform: link.platform,
      url: link.external_url,
    });
  }
  for (const poi of poiRows) {
    const supplement = supplements.get(poi.shop_id);
    if (!supplement) continue;
    supplement.poi_business = {
      provider: poi.provider,
      rating: finiteNumber(poi.rating),
      avg_cost: finiteNumber(poi.avg_cost),
      phone: poi.phone,
      business_hours: poi.business_hours,
      tags: poi.tags,
      photos: poiPhotos(poi.photos),
    };
  }
  return supplements;
}

async function getSourceVideosByShopIds(
  app: Parameters<FastifyPluginAsync>[0],
  shopIds: string[],
) {
  if (!shopIds.length) return new Map<string, SourceVideo[]>();
  const rows = await app.db
    .selectFrom("shop_video_mentions")
    .innerJoin("videos", "videos.id", "shop_video_mentions.video_id")
    .innerJoin("creators", "creators.id", "shop_video_mentions.creator_id")
    .select([
      "shop_video_mentions.shop_id",
      "videos.id as video_id",
      sql<string>`COALESCE(videos.title_override, videos.title)`.as("title"),
      "videos.source_url",
      "videos.bvid",
      "videos.cover_url",
      sql<string>`COALESCE(creators.name_override, creators.name)`.as(
        "creator_name",
      ),
    ])
    .where("shop_video_mentions.shop_id", "in", shopIds)
    .where("videos.deleted_at", "is", null)
    .where("creators.deleted_at", "is", null)
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

function attachSourceVideos<T extends { id: string }>(
  shops: T[],
  videosByShop: Map<string, SourceVideo[]>,
) {
  return shops.map((shop) => ({
    ...shop,
    source_videos: videosByShop.get(shop.id) ?? [],
  }));
}

function attachShopSupplements<T extends { id: string }>(
  shops: T[],
  supplements: Map<string, ShopSupplement>,
) {
  return shops.map((shop) => ({
    ...shop,
    ...(supplements.get(shop.id) ?? {
      external_links: [],
      poi_business: null,
    }),
  }));
}

export const registerPublicRoutes: FastifyPluginAsync = async (app) => {
  app.get("/creators", async () => {
    const creators = await app.db
      .selectFrom("creators")
      .leftJoin(
        "shop_video_mentions",
        "shop_video_mentions.creator_id",
        "creators.id",
      )
      .leftJoin("shops", (join) =>
        join
          .onRef("shops.id", "=", "shop_video_mentions.shop_id")
          .on("shops.status", "=", "published")
          .on("shops.deleted_at", "is", null),
      )
      .select([
        "creators.id",
        "creators.bilibili_uid",
        sql<string>`COALESCE(creators.name_override, creators.name)`.as("name"),
        "creators.avatar_url",
        "creators.profile_url",
        sql<string | null>`COALESCE(creators.bio_override, creators.bio)`.as(
          "bio",
        ),
        "creators.follower_count",
        "creators.status",
        "creators.last_synced_at",
        (eb) => eb.fn.count<number>("shops.id").distinct().as("shop_count"),
      ])
      .where("creators.status", "=", "active")
      .where("creators.deleted_at", "is", null)
      .groupBy("creators.id")
      .orderBy("creators.created_at", "desc")
      .limit(100)
      .execute();
    return {
      creators: creators.map((creator) => ({
        ...creator,
        shop_count: Number(creator.shop_count ?? 0),
      })),
    };
  });

  app.get("/creators/:id", async (request) => {
    const params = z
      .object({ id: z.string().uuid() })
      .safeParse(request.params);
    if (!params.success)
      throw new HttpError(
        400,
        "invalid_creator_id",
        "Creator id must be a uuid",
      );
    const creator = await app.db
      .selectFrom("creators")
      .selectAll()
      .where("id", "=", params.data.id)
      .where("status", "=", "active")
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!creator)
      throw new HttpError(404, "creator_not_found", "Creator not found");
    // Sort shops by the latest video that mentioned them. DISTINCT ON
    // collapses the inner-join fan-out (one shop can have many mentions)
    // and keeps only the most recent mention per shop, which is what
    // the public creator page renders as the sort key.
    const shops = await app.db
      .selectFrom("shops")
      .innerJoin(
        "shop_video_mentions",
        "shop_video_mentions.shop_id",
        "shops.id",
      )
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
        sql<string>`COALESCE(videos.title_override, videos.title)`.as(
          "latest_video_title",
        ),
        "videos.bvid as latest_video_bvid",
        "videos.source_url as latest_video_source_url",
      ])
      .where("shop_video_mentions.creator_id", "=", params.data.id)
      .where("shops.status", "=", "published")
      .where("shops.deleted_at", "is", null)
      .where("videos.deleted_at", "is", null)
      .distinctOn("shops.id")
      .orderBy("shops.id")
      .orderBy("videos.published_at", "desc")
      .limit(100)
      .execute();
    const shopIds = shops.map((shop) => shop.id);
    const [videosByShop, supplements] = await Promise.all([
      getSourceVideosByShopIds(app, shopIds),
      getShopSupplementsByIds(app, shopIds),
    ]);
    return {
      creator: {
        ...creator,
        name: creator.name_override ?? creator.name,
        bio: creator.bio_override ?? creator.bio,
      },
      shops: attachShopSupplements(
        attachSourceVideos(shops, videosByShop),
        supplements,
      ).map((shop) => ({
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

  app.get("/stats", async () => {
    const [shops, creators, videos, candidates, distinctCities] =
      await Promise.all([
        app.db
          .selectFrom("shops")
          .where("status", "=", "published")
          .where("deleted_at", "is", null)
          .select((eb) => eb.fn.countAll<string>().as("count"))
          .executeTakeFirst(),
        app.db
          .selectFrom("creators")
          .where("status", "=", "active")
          .where("deleted_at", "is", null)
          .select((eb) => eb.fn.countAll<string>().as("count"))
          .executeTakeFirst(),
        app.db
          .selectFrom("videos")
          .where("deleted_at", "is", null)
          .select((eb) => eb.fn.countAll<string>().as("count"))
          .executeTakeFirst(),
        app.db
          .selectFrom("shop_candidates")
          .select((eb) => eb.fn.countAll<string>().as("count"))
          .executeTakeFirst(),
        sql<{
          count: string;
        }>`SELECT COUNT(DISTINCT city) AS count FROM shops WHERE status = 'published' AND deleted_at IS NULL AND city IS NOT NULL`.execute(
          app.db,
        ),
      ]);
    const citiesRow = (distinctCities as { rows?: Array<{ count: string }> })
      .rows?.[0];
    return {
      counts: {
        shops_published: Number(shops?.count ?? 0),
        creators_active: Number(creators?.count ?? 0),
        videos_total: Number(videos?.count ?? 0),
        shops_in_review: Number(candidates?.count ?? 0),
        cities_covered: Number(citiesRow?.count ?? 0),
      },
      last_updated_at: new Date().toISOString(),
    };
  });

  app.get("/shops/recommended", async (request) => {
    const query = recommendedQuerySchema.parse(request.query);
    const hasLocation = query.lng !== undefined && query.lat !== undefined;
    const gcjLocation = hasLocation
      ? query.coord_type === "wgs84"
        ? wgs84ToGcj02({ lng: query.lng!, lat: query.lat! })
        : { lng: query.lng!, lat: query.lat! }
      : null;
    const usesDistanceRanking =
      Boolean(gcjLocation) &&
      (query.sort === "distance" ||
        (query.sort === "recommended" && hasLocation));
    const distanceSql = gcjLocation
      ? sql<
          number | null
        >`CASE WHEN shops.coord_type = 'gcj02' THEN ST_DistanceSphere(shops.geom, ST_SetSRID(ST_MakePoint(${gcjLocation.lng}, ${gcjLocation.lat}), 4326)) ELSE NULL END`
      : sql<null>`NULL`;
    const recommendationScoreSql = sql<
      number | null
    >`CASE WHEN jsonb_typeof(shops.card_payload->'recommendation_score') = 'number' THEN (shops.card_payload->>'recommendation_score')::numeric ELSE NULL END`;
    const hasDianpingSql = sql<boolean>`EXISTS (
      SELECT 1
      FROM shop_external_links dianping_filter
      WHERE dianping_filter.shop_id = shops.id
        AND dianping_filter.platform = 'dianping'
        AND dianping_filter.status = 'confirmed'
    )`;
    const provinceInput = query.city
      ? provinceForRegionInput(query.city)
      : null;
    const regionVariants = query.city ? regionNameVariants(query.city) : [];
    const provinceVariants = provinceInput
      ? regionNameVariants(provinceInput)
      : [];
    const provinceCityVariants = query.city
      ? citiesForProvinceInput(query.city).flatMap((city) =>
          regionNameVariants(city),
        )
      : [];
    const locationTerms = Array.from(
      new Set([
        ...regionVariants.map((value) => `city:${value}`),
        ...regionVariants.map((value) => `province:${value}`),
        ...provinceVariants.map((value) => `province:${value}`),
        ...provinceCityVariants.map((value) => `city:${value}`),
      ]),
    ).map((term) => {
      const separatorIndex = term.indexOf(":");
      const field = term.slice(0, separatorIndex);
      const value = term.slice(separatorIndex + 1);
      return field === "province"
        ? sql`shops.province ILIKE ${`%${value}%`}`
        : sql`shops.city ILIKE ${`%${value}%`}`;
    });
    const locationFilterSql =
      query.city && locationTerms.length > 0
        ? sql`AND (${sql.join(locationTerms, sql` OR `)})`
        : sql``;
    const orderSql =
      query.sort === "distance"
        ? sql`distance_m ASC NULLS LAST, shops.published_at DESC NULLS LAST`
        : query.sort === "latest"
          ? sql`shops.published_at DESC NULLS LAST`
          : query.sort === "ai_score"
            ? sql`recommendation_score DESC NULLS LAST, shops.published_at DESC NULLS LAST`
            : query.sort === "amap_rating"
              ? sql`pois.rating DESC NULLS LAST, shops.published_at DESC NULLS LAST`
              : query.sort === "price_asc"
                ? sql`pois.avg_cost ASC NULLS LAST, shops.published_at DESC NULLS LAST`
                : query.sort === "price_desc"
                  ? sql`pois.avg_cost DESC NULLS LAST, shops.published_at DESC NULLS LAST`
                  : gcjLocation
                    ? sql`distance_m ASC NULLS LAST, shops.published_at DESC NULLS LAST`
                    : sql`shops.published_at DESC NULLS LAST`;
    const user = await getUserFromRequest(app.db, request);
    const requestId = crypto.randomUUID();
    await app.db
      .insertInto("recommendation_requests")
      .values({
        id: requestId,
        user_id: user?.id ?? null,
        anonymous_id: query.anonymous_id ?? null,
        surface: "home",
        request_context: {
          ...(hasLocation
            ? {
                lng: query.lng,
                lat: query.lat,
                coord_type: query.coord_type,
              }
            : {}),
          sort: query.sort,
          filters: {
            city: query.city ?? null,
            category: query.category ?? null,
            creator_id: query.creator_id ?? null,
            min_avg_cost: query.min_avg_cost ?? null,
            max_avg_cost: query.max_avg_cost ?? null,
            has_dianping: query.has_dianping ?? null,
          },
          limit: query.limit,
        },
        algorithm: usesDistanceRanking
          ? "distance_v1"
          : `rule_${query.sort}_v1`,
        model_version: null,
        created_at: new Date(),
      })
      .execute();

    const shopsResult = await sql`
      SELECT
        shops.*,
        ${distanceSql} AS distance_m,
        ${recommendationScoreSql} AS recommendation_score,
        pois.avg_cost AS poi_avg_cost,
        pois.rating AS poi_rating,
        ${hasDianpingSql} AS has_dianping_link
      FROM shops
      LEFT JOIN pois ON pois.id = shops.primary_poi_id
      WHERE shops.status = 'published'
        AND shops.deleted_at IS NULL
        ${locationFilterSql}
        ${
          query.category
            ? sql`AND (shops.category_primary = ${query.category} OR shops.category_secondary = ${query.category})`
            : sql``
        }
        ${
          query.creator_id
            ? sql`AND EXISTS (
                SELECT 1
                FROM shop_video_mentions svm_filter
                WHERE svm_filter.shop_id = shops.id
                  AND svm_filter.creator_id = ${query.creator_id}
              )`
            : sql``
        }
        ${
          query.min_avg_cost !== undefined
            ? sql`AND pois.avg_cost >= ${query.min_avg_cost}`
            : sql``
        }
        ${
          query.max_avg_cost !== undefined
            ? sql`AND pois.avg_cost <= ${query.max_avg_cost}`
            : sql``
        }
        ${query.has_dianping ? sql`AND ${hasDianpingSql}` : sql``}
      ORDER BY ${orderSql}
      LIMIT ${query.limit}
    `.execute(app.db);
    const shops = shopsResult.rows as RecommendedShopRow[];

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
          reason_codes: usesDistanceRanking
            ? ["nearby", "distance_v1"]
            : [`sort_${query.sort}`, "rule_v1"],
          feature_snapshot: {
            shop_confidence:
              (shop.quality as Record<string, unknown>)?.shop_confidence ??
              null,
            published_at: shop.published_at,
            distance_m: shop.distance_m,
            avg_cost: shop.poi_avg_cost,
            rating: shop.poi_rating,
            filters: {
              city: query.city ?? null,
              category: query.category ?? null,
              creator_id: query.creator_id ?? null,
              min_avg_cost: query.min_avg_cost ?? null,
              max_avg_cost: query.max_avg_cost ?? null,
              has_dianping: query.has_dianping ?? null,
              has_dianping_link: shop.has_dianping_link,
            },
          },
          created_at: new Date(),
        })
        .execute();
      items.push({ ...shop, recommendation_item_id: itemId, score });
    }

    const shopIds = items.map((shop) => shop.id);
    const [videosByShop, supplements] = await Promise.all([
      getSourceVideosByShopIds(app, shopIds),
      getShopSupplementsByIds(app, shopIds),
    ]);
    return {
      recommendation_request_id: requestId,
      shops: attachShopSupplements(
        attachSourceVideos(items, videosByShop),
        supplements,
      ),
    };
  });

  app.get("/shops/map", async (request) => {
    const query = shopMapQuerySchema.parse(request.query);
    const { min_lng: minLng, min_lat: minLat, max_lng: maxLng, max_lat: maxLat, limit, q, creator_id: creatorId, category } = query;
    const shops = await sql`
      SELECT DISTINCT ON (shops.primary_poi_id)
        shops.id, shops.display_name, shops.city, shops.district, shops.address, shops.lng, shops.lat, shops.coord_type, shops.card_payload, shops.quality, shops.published_at
      FROM shops
      ${creatorId ? sql`INNER JOIN shop_video_mentions svm_filter ON svm_filter.shop_id = shops.id` : sql``}
      WHERE shops.status = 'published'
        AND shops.deleted_at IS NULL
        AND shops.geom && ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)
        ${q ? sql`AND (shops.display_name ILIKE ${`%${q}%`} OR shops.address ILIKE ${`%${q}%`} OR shops.city ILIKE ${`%${q}%`} OR shops.district ILIKE ${`%${q}%`} OR shops.display_name % ${q})` : sql``}
        ${creatorId ? sql`AND svm_filter.creator_id = ${creatorId}` : sql``}
        ${category ? sql`AND (shops.category_primary = ${category} OR shops.category_secondary = ${category})` : sql``}
      ORDER BY shops.primary_poi_id, shops.published_at DESC NULLS LAST
      LIMIT ${limit}
    `.execute(app.db);
    const mapShops = shops.rows as Array<{ id: string }>;
    const shopIds = mapShops.map((shop) => shop.id);
    const [videosByShop, supplements] = await Promise.all([
      getSourceVideosByShopIds(app, shopIds),
      getShopSupplementsByIds(app, shopIds),
    ]);
    return {
      shops: attachShopSupplements(
        attachSourceVideos(mapShops, videosByShop),
        supplements,
      ),
    };
  });

  app.get("/shops/search", async (request) => {
    const query = shopSearchQuerySchema.parse(request.query);
    const { q, limit } = query;
    if (!q) return { shops: [] };
    const shops = await sql`
      SELECT DISTINCT ON (primary_poi_id)
        id, display_name, city, district, address, lng, lat, coord_type, card_payload, quality,
        GREATEST(
          similarity(display_name, ${q}),
          similarity(COALESCE(address, ''), ${q}),
          CASE WHEN display_name ILIKE ${`%${q}%`} THEN 1 ELSE 0 END
        ) AS rank_score
      FROM shops
      WHERE status = 'published'
        AND deleted_at IS NULL
        AND (
          display_name ILIKE ${`%${q}%`}
          OR address ILIKE ${`%${q}%`}
          OR city ILIKE ${`%${q}%`}
          OR district ILIKE ${`%${q}%`}
          OR display_name % ${q}
          OR COALESCE(address, '') % ${q}
        )
      ORDER BY primary_poi_id, rank_score DESC, shops.published_at DESC NULLS LAST
      LIMIT ${limit}
    `.execute(app.db);
    const searchShops = shops.rows as Array<{ id: string }>;
    const shopIds = searchShops.map((shop) => shop.id);
    const [videosByShop, supplements] = await Promise.all([
      getSourceVideosByShopIds(app, shopIds),
      getShopSupplementsByIds(app, shopIds),
    ]);
    return {
      shops: attachShopSupplements(
        attachSourceVideos(searchShops, videosByShop),
        supplements,
      ),
    };
  });

  app.get("/shops/:id", async (request) => {
    const params = z
      .object({ id: z.string().uuid() })
      .safeParse(request.params);
    if (!params.success)
      throw new HttpError(400, "invalid_shop_id", "Shop id must be a uuid");
    const shop = await app.db
      .selectFrom("shops")
      .selectAll()
      .where("id", "=", params.data.id)
      .where("status", "=", "published")
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!shop) throw new HttpError(404, "shop_not_found", "Shop not found");
    const [mentions, supplements] = await Promise.all([
      app.db
        .selectFrom("shop_video_mentions")
        .innerJoin("videos", "videos.id", "shop_video_mentions.video_id")
        .innerJoin("creators", "creators.id", "shop_video_mentions.creator_id")
        .select([
          "videos.id as video_id",
          sql<string>`COALESCE(videos.title_override, videos.title)`.as(
            "title",
          ),
          "videos.source_url",
          "videos.bvid",
          "videos.cover_url",
          sql<string>`COALESCE(creators.name_override, creators.name)`.as(
            "creator_name",
          ),
        ])
        .where("shop_video_mentions.shop_id", "=", params.data.id)
        .where("videos.deleted_at", "is", null)
        .where("creators.deleted_at", "is", null)
        .execute(),
      getShopSupplementsByIds(app, [shop.id]),
    ]);
    return {
      shop: attachShopSupplements([shop], supplements)[0],
      mentions,
    };
  });

  app.post("/users/events", async (request, reply) => {
    // P1-4: 限速 — IP 维度 + anonymous_id 维度各 60/分钟，超出即拒绝。
    const ip = getRequestClientIp(request);
    const ipLimit = await checkRateLimit({
      scope: "events_ip",
      key: ip,
      max: EVENTS_RATE_LIMIT_MAX,
      windowMs: EVENTS_RATE_LIMIT_WINDOW_MS,
      lockoutMs: EVENTS_RATE_LIMIT_WINDOW_MS,
    });
    if (!ipLimit.allowed) {
      const seconds = Math.max(1, Math.ceil(ipLimit.retryAfterMs / 1000));
      reply.header("Retry-After", String(seconds));
      throw new HttpError(429, "rate_limited", "Too many events; slow down");
    }
    const body = createUserEventSchema.parse(request.body);
    if (body.anonymous_id) {
      const idLimit = await checkRateLimit({
        scope: "events_anon",
        key: body.anonymous_id,
        max: EVENTS_RATE_LIMIT_MAX,
        windowMs: EVENTS_RATE_LIMIT_WINDOW_MS,
        lockoutMs: EVENTS_RATE_LIMIT_WINDOW_MS,
      });
      if (!idLimit.allowed) {
        const seconds = Math.max(1, Math.ceil(idLimit.retryAfterMs / 1000));
        reply.header("Retry-After", String(seconds));
        throw new HttpError(429, "rate_limited", "Too many events; slow down");
      }
    }
    const user = await getUserFromRequest(app.db, request);
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
