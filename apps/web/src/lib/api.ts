export const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

function getServerApiBaseUrl() {
  return process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

export async function apiFetch<T>(path: string, init?: RequestInit, fallback?: T): Promise<T> {
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

export const fallbackShops: ShopCardData[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    display_name: "某某牛肉面",
    city: "上海市",
    district: "黄浦区",
    address: "南京东路附近",
    lng: 121.4826,
    lat: 31.2382,
    card_payload: {
      subtitle: "适合一人食的日常面馆",
      recommend_reason: "牛肉分量足，汤底浓，适合顺路吃一顿。",
      avg_price_hint: "约30元",
      tags: ["一人食", "分量足", "排队"],
    },
    quality: {
      shop_confidence: 0.86,
      review_status: "approved",
    },
    source_videos: [
      {
        title: "示例探店视频",
        source_url: "https://www.bilibili.com",
        bvid: "BV_SAMPLE",
        creator_name: "示例博主",
      },
    ],
  },
];

export const fallbackShop = fallbackShops[0]!;
