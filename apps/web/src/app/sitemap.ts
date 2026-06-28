import type { MetadataRoute } from "next";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const siteUrl = requireEnv("NEXT_PUBLIC_SITE_URL");
const apiBaseUrl =
  process.env.API_BASE_URL ?? requireEnv("NEXT_PUBLIC_API_BASE_URL");

interface CreatorListItem {
  id: string;
  status: string;
  last_synced_at?: string | null;
}

interface ShopListItem {
  id: string;
  published_at?: string | null;
}

async function fetchIds<T>(path: string): Promise<T[]> {
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      // sitemap 编译期 fetch 可关 cache 让最新数据进索引
      cache: "no-store",
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      creators?: CreatorListItem[];
      shops?: ShopListItem[];
    };
    return (payload.creators ?? payload.shops ?? []) as T[];
  } catch {
    return [];
  }
}

/**
 * 站点地图。
 *
 * - 公共首页 / 地图 / 博主列表：固定静态条目
 * - 博主详情 / 店铺详情：动态从 API 拉取，限制最多 5000 条（sitemap 协议上限）
 * - 后台与 API 路由：在 robots.ts 禁爬，不进入 sitemap
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const [creators, shops] = await Promise.all([
    fetchIds<CreatorListItem>("/api/creators?limit=200"),
    fetchIds<ShopListItem>("/api/shops/recommended?limit=5000"),
  ]);

  return [
    {
      url: `${siteUrl}/`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${siteUrl}/map`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/creators`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    ...creators
      .filter((creator) => creator.status === "active")
      .map((creator) => ({
        url: `${siteUrl}/creators/${creator.id}`,
        lastModified: creator.last_synced_at
          ? new Date(creator.last_synced_at)
          : now,
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
    ...shops.map((shop) => ({
      url: `${siteUrl}/shops/${shop.id}`,
      lastModified: shop.published_at ? new Date(shop.published_at) : now,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
  ];
}
