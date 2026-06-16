import { TopNav } from "@/components/top-nav";
import { ShopCard } from "@/components/shop-card";
import { apiFetch, fallbackShops, type ShopCardData } from "@/lib/api";

export default async function HomePage() {
  const data = await apiFetch<{ recommendation_request_id?: string; shops: ShopCardData[] }>(
    "/api/shops/recommended",
    undefined,
    { shops: fallbackShops },
  );

  return (
    <main>
      <TopNav />
      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[280px_1fr]">
        <aside className="h-fit rounded-lg border border-line bg-white p-4">
          <h1 className="text-xl font-semibold">推荐店铺</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            以 B站探店博主为索引，展示已审核店铺卡片、视频来源和 AI 证据链。
          </p>
          <div className="mt-5 space-y-3 text-sm">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">城市</span>
              <input className="w-full rounded-lg border border-line px-3 py-2" placeholder="上海 / 北京 / 成都" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">博主</span>
              <input className="w-full rounded-lg border border-line px-3 py-2" placeholder="输入 UID 或昵称" />
            </label>
          </div>
        </aside>
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold">店铺卡片流</h2>
              <p className="mt-1 text-sm text-muted">每张卡片都应该追溯到视频、评论或人工审核。</p>
            </div>
            <span className="rounded-md bg-white px-3 py-2 text-sm text-muted">{data.shops.length} 家店铺</span>
          </div>
          <div className="space-y-3">
            {data.shops.map((shop) => (
              <ShopCard key={shop.id} shop={shop} />
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

