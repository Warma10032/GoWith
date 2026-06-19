import {
  AlertTriangle,
  Compass,
  MapPin,
  Store,
  UserRound,
  Video,
} from "lucide-react";
import { TopNav } from "@/components/top-nav";
import { ShopCard } from "@/components/shop-card";
import { HomeFilters } from "@/components/home-filters";
import { apiFetch, type ShopCardData } from "@/lib/api";

interface RecommendedShopsPayload {
  recommendation_request_id?: string;
  shops: ShopCardData[];
}

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
  const [recommended, stats] = await Promise.all([
    apiFetch<RecommendedShopsPayload>("/api/shops/recommended"),
    apiFetch<StatsPayload>("/api/stats").catch(() => null),
  ]);

  const isFallback = !recommended.recommendation_request_id;
  const shops = recommended.shops;
  const isEmpty = shops.length === 0;

  return (
    <main>
      <TopNav />
      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[280px_1fr]">
        <HomeFilters />

        <section className="space-y-4">
          {stats ? <SiteMetrics stats={stats} /> : null}

          {isFallback ? <FallbackBanner /> : null}

          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold">店铺卡片流</h2>
              <p className="mt-1 text-sm text-muted">
                每张卡片都应该追溯到视频、评论或人工审核。
              </p>
            </div>
            <span className="rounded-md bg-white px-3 py-2 text-sm text-muted">
              {isEmpty ? "暂无推荐" : `${shops.length} 家店铺`}
            </span>
          </div>

          {isEmpty ? (
            <EmptyState />
          ) : (
            <div className="space-y-3">
              {shops.map((shop) => (
                <ShopCard key={shop.id} shop={shop} />
              ))}
            </div>
          )}
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

function FallbackBanner() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[#f2c7bd] bg-[#fff7f4] px-4 py-3 text-sm text-[#9a341f]">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold">当前展示示例数据</p>
        <p className="mt-1 leading-6">
          API 服务暂未连接。下面是 fallback
          卡片，等后端恢复后会切换为真实推荐流。
        </p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-line bg-white p-10 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-[#f7efe8] text-brand">
        <Compass size={20} />
      </div>
      <h3 className="mt-4 text-lg font-semibold">还没有可推荐的店铺</h3>
      <p className="mt-2 text-sm leading-7 text-muted">
        发布第一批探店视频后，AI 解析 + 人工审核通过的店铺会出现在这里。
      </p>
      <p className="mt-4 inline-flex items-center gap-1 text-xs text-muted">
        <MapPin size={12} />
        也可以先去
        <a href="/map" className="font-medium text-brand hover:underline">
          地图页
        </a>
        看看已发布的店铺。
      </p>
    </div>
  );
}
