import { z } from "zod";
import {
  contentTypes,
  evidenceSources,
  missingFields,
  poiMatchStatuses,
  riskFlags,
  sentiments,
} from "./enums";

export const uuidSchema = z.string().uuid();
export const confidenceSchema = z.number().min(0).max(1);

export const pipelineRunTypes = [
  "creator_video_sync",
  "creator_profile_sync",
  "bilibili_auth_check",
  "video_processing",
  "video_asr_retry",
  "video_ai_retry",
  "poi_match",
] as const;

export const taskAcceptedResponseSchema = z.object({
  run_id: uuidSchema,
  job_id: uuidSchema.nullable(),
  run_type: z.enum(pipelineRunTypes),
  entity_type: z.string(),
  entity_id: uuidSchema,
  status: z.enum(["queued", "running"]),
});

export const adminTaskEventSchema = z.object({
  type: z.enum(["run.created", "run.updated", "pipeline.event"]),
  run_id: uuidSchema,
  run_type: z.enum(pipelineRunTypes).optional(),
  entity_type: z.string(),
  entity_id: uuidSchema,
  status: z.enum(["queued", "running", "success", "failed", "cancelled"]).optional(),
  event_id: uuidSchema.optional(),
  stage: z.string().optional(),
  event_type: z.string().optional(),
  level: z.string().optional(),
  progress_percent: z.union([z.number(), z.string(), z.null()]).optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const evidenceSchema = z.object({
  id: z.string(),
  source: z.enum(evidenceSources),
  source_id: z.string().nullable().optional(),
  text: z.string().min(1),
  start_sec: z.number().nullable().optional(),
  end_sec: z.number().nullable().optional(),
  comment_id: z.string().nullable().optional(),
  confidence: confidenceSchema.nullable().optional(),
});

export const videoClassificationResultSchema = z.object({
  schema_version: z.literal("video_classification.v1"),
  video_id: z.string(),
  bvid: z.string(),
  is_shop_visit: z.boolean(),
  content_type: z.enum(contentTypes),
  confidence: confidenceSchema,
  primary_city_hints: z.array(z.string()).default([]),
  primary_category_hints: z.array(z.string()).default([]),
  reason_codes: z.array(z.string()).default([]),
  risk_flags: z.array(z.enum(riskFlags)).default([]),
  need_manual_review: z.boolean(),
  evidence_ids: z.array(z.string()).default([]),
});

export const commentSignalExtractionSchema = z.object({
  schema_version: z.literal("comment_signal.v1"),
  video_id: z.string(),
  sample_strategy: z
    .object({
      hot_comments_count: z.number().int().nonnegative().default(0),
      latest_comments_count: z.number().int().nonnegative().default(0),
      keyword_comments_count: z.number().int().nonnegative().default(0),
    })
    .default({}),
  location_questions: z
    .array(
      z.object({
        text_summary: z.string(),
        count: z.number().int().nonnegative(),
        evidence_ids: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  shop_name_mentions: z
    .array(
      z.object({
        candidate_name: z.string(),
        confidence: confidenceSchema,
        evidence_ids: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  address_mentions: z
    .array(
      z.object({
        text: z.string(),
        confidence: confidenceSchema,
        evidence_ids: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  status_mentions: z.array(z.record(z.unknown())).default([]),
  aspect_sentiments: z.record(
    z.object({
      sentiment: z.enum(sentiments),
      summary: z.string(),
      confidence: confidenceSchema,
      evidence_ids: z.array(z.string()).default([]),
    }),
  ).default({}),
  risk_flags: z.array(z.enum(riskFlags)).default([]),
});

const conclusionSchema = z.object({
  name: z.string().optional(),
  text: z.string().optional(),
  reason: z.string().optional(),
  confidence: confidenceSchema,
  evidence_ids: z.array(z.string()).default([]),
}).strict();

const reviewDimensionSchema = z.object({
  sentiment: z.enum(sentiments),
  summary: z.string(),
  confidence: confidenceSchema,
  evidence_ids: z.array(z.string()).default([]),
}).strict();

export const videoStructuredAnalysisSchema = z.object({
  schema_version: z.literal("video_structured_analysis.v1"),
  video: z.object({
    video_id: z.string(),
    bvid: z.string(),
    creator_id: z.string(),
    title: z.string(),
    content_type: z.enum(contentTypes),
    is_shop_visit: z.boolean(),
    overall_summary: z.string(),
    primary_city: z.string().nullable().optional(),
    primary_categories: z.array(z.string()).default([]),
    analysis_confidence: confidenceSchema,
    risk_flags: z.array(z.enum(riskFlags)).default([]),
    evidence_ids: z.array(z.string()).default([]),
  }).strict(),
  shop_candidates: z.array(
    z.object({
      candidate_id: z.string(),
      candidate_name: z.string().nullable(),
      normalized_name: z.string().nullable(),
      name_confidence: confidenceSchema,
      alias_names: z.array(z.string()).default([]),
      candidate_type: z.enum(["physical_shop", "unknown", "not_shop"]),
      category: z.object({
        primary: z.string().nullable(),
        secondary: z.string().nullable(),
        confidence: confidenceSchema,
      }).strict(),
      location_hints: z.object({
        country: z.string().nullable().optional(),
        province: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        district: z.string().nullable().optional(),
        business_area: z.string().nullable().optional(),
        address_text: z.string().nullable().optional(),
        landmarks: z.array(z.string()).default([]),
        confidence: confidenceSchema,
      }).strict(),
      time_range: z
        .object({
          start_sec: z.number().nullable().optional(),
          end_sec: z.number().nullable().optional(),
        }).strict()
        .nullable()
        .optional(),
      card_payload: z.object({
        display_title: z.string(),
        subtitle: z.string().nullable().optional(),
        recommend_reason: z.string(),
        avg_price_hint: z.string().nullable().optional(),
        cover_source: z.string().nullable().optional(),
        tags: z.array(z.string()).default([]),
        recommended_dishes: z.array(conclusionSchema).default([]),
        avoid_points: z.array(conclusionSchema).default([]),
        suitable_scenes: z.array(z.string()).default([]),
      }).strict(),
      review_dimensions: z.record(reviewDimensionSchema).default({}),
      comment_summary: z.object({
        positive_points: z.array(z.string()).default([]),
        negative_points: z.array(z.string()).default([]),
        controversial_points: z.array(z.string()).default([]),
        recent_status_points: z.array(z.string()).default([]),
        confidence: confidenceSchema,
        evidence_ids: z.array(z.string()).default([]),
      }).strict(),
      missing_fields: z.array(z.enum(missingFields)).default([]),
      risk_flags: z.array(z.enum(riskFlags)).default([]),
      manual_review_reasons: z.array(z.string()).default([]),
    }).strict(),
  ),
}).strict();

export const poiMatchResultSchema = z.object({
  schema_version: z.literal("poi_match.v1"),
  candidate_id: z.string(),
  provider: z.enum(["amap", "tencent", "baidu"]),
  selected_poi: z
    .object({
      provider_poi_id: z.string(),
      name: z.string(),
      address: z.string().nullable().optional(),
      province: z.string().nullable().optional(),
      city: z.string().nullable().optional(),
      district: z.string().nullable().optional(),
      business_area: z.string().nullable().optional(),
      location: z.object({
        lng: z.number(),
        lat: z.number(),
        coord_type: z.enum(["gcj02", "bd09", "wgs84"]),
      }),
      category: z.string().nullable().optional(),
      raw_provider_payload_id: z.string().nullable().optional(),
    })
    .nullable(),
  candidates: z.array(
    z.object({
      provider_poi_id: z.string(),
      name: z.string(),
      address: z.string().nullable().optional(),
      province: z.string().nullable().optional(),
      city: z.string().nullable().optional(),
      district: z.string().nullable().optional(),
      business_area: z.string().nullable().optional(),
      location: z.object({
        lng: z.number(),
        lat: z.number(),
        coord_type: z.enum(["gcj02", "bd09", "wgs84"]),
      }),
      category: z.string().nullable().optional(),
      category_code: z.string().nullable().optional(),
      match_features: z.record(z.number()).default({}),
      match_score: z.number().min(0).max(1),
    }),
  ).default([]),
  match_score: z.number().min(0).max(1),
  match_status: z.enum(poiMatchStatuses),
  risk_flags: z.array(z.enum(riskFlags)).default([]),
  manual_review_reasons: z.array(z.string()).default([]),
});

export const publishedShopSnapshotSchema = z.object({
  shop_id: z.string(),
  canonical_name: z.string(),
  display_name: z.string(),
  poi: z.object({
    provider: z.string(),
    provider_poi_id: z.string(),
    address: z.string().nullable().optional(),
    location: z.object({
      lng: z.number(),
      lat: z.number(),
      coord_type: z.enum(["gcj02", "bd09", "wgs84"]),
    }),
  }),
  category: z.object({
    primary: z.string().nullable().optional(),
    secondary: z.string().nullable().optional(),
  }),
  card: z.object({
    title: z.string(),
    subtitle: z.string().nullable().optional(),
    recommend_reason: z.string(),
    avg_price_hint: z.string().nullable().optional(),
    tags: z.array(z.string()).default([]),
    cover_url: z.string().url().nullable().optional(),
    source_creator_avatars: z.array(z.string()).default([]),
  }),
  aggregated_review: z.record(reviewDimensionSchema).default({}),
  source_stats: z.record(z.unknown()).default({}),
  quality: z.record(z.unknown()).default({}),
});

export const sourceVideoSchema = z.object({
  video_id: z.string().optional(),
  title: z.string(),
  source_url: z.string(),
  bvid: z.string().optional(),
  cover_url: z.string().nullable().optional(),
  creator_name: z.string().optional(),
});

export const mapShopSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  city: z.string().nullable().optional(),
  district: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  lng: z.union([z.number(), z.string()]).nullable().optional(),
  lat: z.union([z.number(), z.string()]).nullable().optional(),
  coord_type: z.enum(["gcj02", "bd09", "wgs84"]).optional(),
  card_payload: z.record(z.unknown()).nullable().optional(),
  quality: z.record(z.unknown()).nullable().optional(),
  source_videos: z.array(sourceVideoSchema).default([]),
});

export const shopSearchResultSchema = mapShopSchema.extend({
  rank_score: z.number().optional(),
});

export type VideoClassificationResult = z.infer<typeof videoClassificationResultSchema>;
export type CommentSignalExtraction = z.infer<typeof commentSignalExtractionSchema>;
export type VideoStructuredAnalysis = z.infer<typeof videoStructuredAnalysisSchema>;
export type PoiMatchResult = z.infer<typeof poiMatchResultSchema>;
export type PublishedShopSnapshot = z.infer<typeof publishedShopSnapshotSchema>;
export type MapShop = z.infer<typeof mapShopSchema>;
export type ShopSearchResult = z.infer<typeof shopSearchResultSchema>;
export type TaskAcceptedResponse = z.infer<typeof taskAcceptedResponseSchema>;
export type AdminTaskEvent = z.infer<typeof adminTaskEventSchema>;
