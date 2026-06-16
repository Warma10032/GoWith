import { TopNav } from "@/components/top-nav";
import { ShopCard } from "@/components/shop-card";
import { apiFetch, fallbackShops, type ShopCardData } from "@/lib/api";

export default async function CreatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await apiFetch<{ creator?: { name?: string; bilibili_uid?: string }; shops: ShopCardData[] }>(
    `/api/creators/${id}`,
    undefined,
    { creator: { name: "示例博主", bilibili_uid: id }, shops: fallbackShops },
  );

  return (
    <main>
      <TopNav />
      <section className="mx-auto max-w-7xl px-4 py-6">
        <div className="rounded-lg border border-line bg-white p-6">
          <h1 className="text-2xl font-semibold">{data.creator?.name ?? "博主地图"}</h1>
          <p className="mt-2 text-sm text-muted">UID：{data.creator?.bilibili_uid ?? id}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Stat label="已发布店铺" value={data.shops.length} />
            <Stat label="视频来源" value="待同步" />
            <Stat label="审核状态" value="MVP" />
          </div>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="min-h-[360px] rounded-lg border border-line bg-map p-4">
            <h2 className="font-semibold">博主探店地图</h2>
            <p className="mt-2 text-sm text-muted">按该博主关联店铺过滤地图 pin。</p>
          </div>
          <div className="space-y-3">
            {data.shops.map((shop) => (
              <ShopCard key={shop.id} shop={shop} />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-line p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-sm text-muted">{label}</div>
    </div>
  );
}

