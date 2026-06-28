function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const apiBaseUrl = requireEnv("NEXT_PUBLIC_API_BASE_URL");

function getServerApiBaseUrl() {
  return process.env.API_BASE_URL ?? requireEnv("NEXT_PUBLIC_API_BASE_URL");
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
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
}

export interface ShopCardData {
  id: string;
  display_name: string;
  city?: string | null;
  district?: string | null;
  address?: string | null;
  category_primary?: string | null;
  category_secondary?: string | null;
  lng?: number | string | null;
  lat?: number | string | null;
  card_payload?: {
    display_title?: string;
    subtitle?: string;
    recommend_reason?: string;
    recommendation_score?: number | null;
    recommendation_score_evidence_ids?: string[];
    recommended_dishes?: Array<{ name?: string; reason?: string }>;
    avoid_points?: Array<{ text?: string; reason?: string }>;
  };
  quality?: Record<string, unknown>;
  aggregated_review?: Record<string, unknown>;
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
  distance_m?: number | string | null;
  external_links?: Array<{
    id: string;
    platform: "dianping" | "meituan";
    url: string;
  }>;
  poi_business?: {
    provider: "amap" | "tencent" | "baidu";
    rating: number | null;
    avg_cost: number | null;
    phone: string | null;
    business_hours: string | null;
    tags: string[];
    photos: Array<{ title?: string | null; url: string }>;
  } | null;
}

export function formatRecommendationScore(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.round(value * 100));
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return String(Math.round(parsed * 100));
  }
  return "暂无";
}
