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
  name: z.string().min(1).optional(),
});

export const createUserEventSchema = z.object({
  event_name: z.string().min(1),
  entity_type: z.string().optional(),
  entity_id: z.string().uuid().optional(),
  shop_id: z.string().uuid().optional(),
  creator_id: z.string().uuid().optional(),
  video_id: z.string().uuid().optional(),
  recommendation_request_id: z.string().uuid().optional(),
  recommendation_item_id: z.string().uuid().optional(),
  surface: z.string().min(1),
  event_payload: z.record(z.unknown()).default({}),
  client_type: z.enum(["web", "miniapp", "app"]).default("web"),
  anonymous_id: z.string().optional(),
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

