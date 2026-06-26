import { Suspense } from "react";
import { TopNav } from "@/components/top-nav";
import { HomeRecommendationShell } from "@/components/home-recommendation-shell";
import { apiFetch } from "@/lib/api";

interface StatsPayload {
  counts: {
    shops_published: number;
    creators_active: number;
    videos_total: number;
    shops_in_review: number;
    cities_covered: number;
  };
  last_updated_at: string;
}

export default async function HomePage() {
  // 推荐流与站点统计并发拉取；统计短暂挂掉也不阻塞主推荐流。
  const stats = await apiFetch<StatsPayload>("/api/stats").catch(() => null);

  return (
    <main>
      <TopNav />
      <Suspense
        fallback={
          <section className="mx-auto max-w-7xl px-4 py-6 text-sm text-muted">
            正在加载推荐筛选…
          </section>
        }
      >
        <HomeRecommendationShell stats={stats} />
      </Suspense>
    </main>
  );
}
