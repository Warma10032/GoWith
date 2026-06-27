import { z } from "zod";

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const createCreatorRequestSchema = z.object({
  bilibili_uid: z.string().min(1),
});

// P1-4: 限制 event_name / surface / entity_type 为枚举；event_payload 限制
// 大小、字段数、嵌套深度，避免被用来撑爆数据库或污染训练样本。
const MAX_PAYLOAD_BYTES = 4096;
const MAX_PAYLOAD_KEYS = 20;
const MAX_PAYLOAD_DEPTH = 3;
const EVENT_NAME_OPTIONS = [
  "shop_card_impression",
  "shop_card_click",
  "shop_detail_view",
  "map_pin_click",
  "creator_filter_apply",
  "favorite_shop",
  "want_to_go",
  "navigation_click",
  "video_source_click",
  "negative_feedback",
  "session_start",
  "session_end",
] as const;
const SURFACE_OPTIONS = [
  "home",
  "map",
  "shop_detail",
  "creator",
  "creator_page",
  "search",
  "admin",
] as const;
const ENTITY_TYPE_OPTIONS = [
  "shop",
  "creator",
  "video",
  "recommendation_request",
  "recommendation_item",
] as const;

const limitedPayloadSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .record(
      z.string().max(64),
      z.union([
        z.string().max(512),
        z.number().finite(),
        z.boolean(),
        z.null(),
        limitedPayloadSchema,
      ]),
    )
    .refine(
      (value) => JSON.stringify(value).length <= MAX_PAYLOAD_BYTES,
      `event_payload must be <= ${MAX_PAYLOAD_BYTES} bytes`,
    )
    .refine(
      (value) => Object.keys(value).length <= MAX_PAYLOAD_KEYS,
      `event_payload must have <= ${MAX_PAYLOAD_KEYS} keys`,
    )
    .refine(
      (value) => measureDepth(value) <= MAX_PAYLOAD_DEPTH,
      `event_payload must be <= ${MAX_PAYLOAD_DEPTH} levels deep`,
    ),
);

function measureDepth(value: unknown, current = 1): number {
  if (value === null || typeof value !== "object") return current;
  let max = current;
  for (const item of Object.values(value as Record<string, unknown>)) {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      const d = measureDepth(item, current + 1);
      if (d > max) max = d;
    }
  }
  return max;
}

export const createUserEventSchema = z.object({
  event_name: z.enum(EVENT_NAME_OPTIONS),
  entity_type: z.enum(ENTITY_TYPE_OPTIONS).optional(),
  entity_id: z.string().uuid().optional(),
  shop_id: z.string().uuid().optional(),
  creator_id: z.string().uuid().optional(),
  video_id: z.string().uuid().optional(),
  recommendation_request_id: z.string().uuid().optional(),
  recommendation_item_id: z.string().uuid().optional(),
  surface: z.enum(SURFACE_OPTIONS),
  event_payload: limitedPayloadSchema.default({}),
  client_type: z.enum(["web", "miniapp", "app"]).default("web"),
  anonymous_id: z.string().min(1).max(64).optional(),
});

export const favoriteRequestSchema = z.object({
  shop_id: z.string().uuid(),
  action_type: z.enum(["favorite", "want_to_go", "visited"]),
  note: z.string().optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type CreateCreatorRequest = z.infer<typeof createCreatorRequestSchema>;
export type CreateUserEvent = z.infer<typeof createUserEventSchema>;
export type FavoriteRequest = z.infer<typeof favoriteRequestSchema>;
