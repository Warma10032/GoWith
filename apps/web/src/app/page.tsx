import { MapPin, Store, UserRound, Video } from "lucide-react";
import { TopNav } from "@/components/top-nav";
import { HomeFilters } from "@/components/home-filters";
import { HomeShopFeed } from "@/components/home-shop-feed";
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
      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[280px_1fr]">
        <HomeFilters />

        <section className="space-y-4">
          {stats ? <SiteMetrics stats={stats} /> : null}
          <HomeShopFeed />
        </section>
      </section>
    </main>
  );
}

function SiteMetrics({ stats }: { stats: StatsPayload }) {
  const { counts } = stats;
  const cards = [
    {
      label: "已发布店铺",
      value: counts.shops_published,
      hint: "published",
      Icon: Store,
    },
    {
      label: "覆盖城市",
      value: counts.cities_covered,
      hint: "distinct cities",
      Icon: MapPin,
    },
    {
      label: "活跃博主",
      value: counts.creators_active,
      hint: "active creators",
      Icon: UserRound,
    },
    {
      label: "已索引视频",
      value: counts.videos_total,
      hint: "videos",
      Icon: Video,
    },
  ];
  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, hint, Icon }) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-lg border border-line bg-[#faf8f5] px-4 py-3"
          >
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-white text-brand">
              <Icon size={18} />
            </div>
            <div className="min-w-0">
              <div className="text-xl font-semibold tabular-nums leading-tight">
                {value}
              </div>
              <div className="mt-0.5 text-xs text-muted">{label}</div>
              <div className="text-[10px] text-muted">{hint}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-muted">
        更新于 {formatUpdatedAt(stats.last_updated_at)}
      </div>
    </div>
  );
}

function formatUpdatedAt(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
