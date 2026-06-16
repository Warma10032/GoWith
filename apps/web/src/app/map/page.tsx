import { TopNav } from "@/components/top-nav";
import { apiFetch, fallbackShops, type ShopCardData } from "@/lib/api";
import { MapPin } from "lucide-react";

export default async function MapPage() {
  const data = await apiFetch<{ shops: ShopCardData[] }>("/api/shops/map", undefined, { shops: fallbackShops });

  return (
    <main>
      <TopNav />
      <section className="mx-auto grid max-w-7xl gap-4 px-4 py-6 lg:grid-cols-[1fr_380px]">
        <div className="relative min-h-[620px] overflow-hidden rounded-lg border border-line bg-map">
          <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(#d5ded1_1px,transparent_1px),linear-gradient(90deg,#d5ded1_1px,transparent_1px)] [background-size:42px_42px]" />
          <div className="absolute left-[54%] top-[44%] rounded-full bg-brand px-3 py-2 text-sm font-semibold text-white shadow-card">
            {data.shops.length} 店
          </div>
          <div className="absolute left-6 top-6 rounded-lg bg-white/95 p-4 shadow-card">
            <h1 className="text-lg font-semibold">全国探店地图</h1>
            <p className="mt-1 text-sm text-muted">高德地图接入位已预留，MVP 使用发布店铺坐标驱动 pin。</p>
          </div>
        </div>
        <aside className="rounded-lg border border-line bg-white p-4">
          <h2 className="font-semibold">当前范围店铺</h2>
          <div className="mt-4 space-y-3">
            {data.shops.map((shop) => (
              <a key={shop.id} href={`/shops/${shop.id}`} className="block rounded-lg border border-line p-3 hover:border-brand">
                <div className="flex items-center gap-2 font-medium">
                  <MapPin size={16} className="text-brand" />
                  {shop.display_name}
                </div>
                <p className="mt-1 text-sm text-muted">{shop.address ?? [shop.city, shop.district].filter(Boolean).join(" · ")}</p>
              </a>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}

