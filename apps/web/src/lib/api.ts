export const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

function getServerApiBaseUrl() {
  return (
    process.env.API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://localhost:4000"
  );
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  fallback?: T,
): Promise<T> {
  try {
    const response = await fetch(`${getServerApiBaseUrl()}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`API ${response.status}`);
    return (await response.json()) as T;
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

export interface ShopCardData {
  id: string;
  display_name: string;
  city?: string | null;
  district?: string | null;
  address?: string | null;
  lng?: number | string | null;
  lat?: number | string | null;
  card_payload?: {
    display_title?: string;
    title?: string;
    subtitle?: string;
    recommend_reason?: string;
    avg_price_hint?: string;
    tags?: string[];
    recommended_dishes?: Array<{ name?: string; text?: string }>;
    avoid_points?: Array<{ text?: string }>;
  };
  quality?: Record<string, unknown>;
  source_videos?: Array<{
    video_id?: string;
    title: string;
    source_url: string;
    bvid?: string;
    cover_url?: string | null;
    creator_name?: string;
  }>;
  recommendation_item_id?: string;
  score?: number;
}

/**
 * 把 jsonb 里可能混存的 number / string 数字统一格式化。pg numeric
 * 列会被 Kysely 当字符串返回（4dfbe65 留下的 gotcha），jsonb 字段则
 * 视 producer 而定；调用方读 quality.shop_confidence 时两种都可能拿到。
 */
export function formatConfidence(value: unknown, fractionDigits = 2): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(fractionDigits);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed.toFixed(fractionDigits);
  }
  return "待评估";
}
