"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import { ShopCard } from "./shop-card";
import { CreatorMiniMap } from "./creator-mini-map";
import { SafeImage } from "./safe-image";
import { apiFetch, type ShopCardData } from "@/lib/api";
import { CREATOR_STATUS_LABELS, lookupLabel } from "@/lib/labels";

type LatestVideo = {
  id: string;
  title: string;
  bvid: string;
  source_url: string;
  published_at: string;
};

type CreatorItem = {
  id: string;
  bilibili_uid: string;
  name: string;
  avatar_url?: string | null;
  profile_url: string;
  bio?: string | null;
  follower_count?: number | null;
  status: string;
};

type CreatorDetail = {
  creator: CreatorItem;
  shops: Array<ShopCardData & { latest_video: LatestVideo }>;
};

type Props = {
  initialId: string;
  initialDetail: CreatorDetail;
  initialSelector: CreatorItem[];
};

export function CreatorPageClient({
  initialId,
  initialDetail,
  initialSelector,
}: Props) {
  const router = useRouter();
  const [detail, setDetail] = useState<CreatorDetail>(initialDetail);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const switchTo = useCallback(
    async (creatorId: string) => {
      if (creatorId === detail.creator.id || switching) return;
      setSwitching(creatorId);
      setError(null);
      try {
        const next = await apiFetch<CreatorDetail>(
          `/api/creators/${creatorId}`,
        );
        setDetail(next);
        // Update the URL without a full reload so the back button works.
        router.replace(`/creators/${creatorId}`, { scroll: false });
      } catch (err) {
        setError(err instanceof Error ? err.message : "切换失败");
      } finally {
        setSwitching(null);
      }
    },
    [detail.creator.id, switching, router],
  );

  const { creator, shops } = detail;
  const shopCount = shops.length;
  const cityCount = new Set(shops.map((s) => s.city ?? "未知")).size;
  // shops 已经按 latest_video 时间倒序，第一条就是最近探店。
  const latestShop = shops[0];

  return (
    <section className="mx-auto max-w-7xl px-4 py-6">
      {/* Top: creator selector chips */}
      <div className="rounded-lg border border-line bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">切换博主</h2>
          <span className="text-[11px] text-muted">
            共 {initialSelector.length} 位
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {initialSelector.map((c) => {
            const active = c.id === creator.id;
            return (
              <button
                key={c.id}
                onClick={() => void switchTo(c.id)}
                disabled={!!switching}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? "border-brand bg-brand text-white"
                    : "border-line bg-white text-ink/80 hover:border-brand hover:text-brand"
                } ${switching === c.id ? "animate-pulse" : ""}`}
                title={`UID ${c.bilibili_uid} · ${c.follower_count ?? "?"} 粉`}
              >
                {c.avatar_url ? (
                  <SafeImage
                    src={c.avatar_url}
                    alt=""
                    className="size-5 rounded-full object-cover"
                  />
                ) : (
                  <span className="grid size-5 place-items-center rounded-full bg-[#f7efe8] text-[10px]">
                    {c.name.slice(0, 1)}
                  </span>
                )}
                {c.name}
              </button>
            );
          })}
        </div>
        {error ? (
          <div className="mt-3 rounded-lg border border-[#f2c7bd] bg-[#fff1ee] px-3 py-2 text-xs text-[#9a341f]">
            {error}
          </div>
        ) : null}
      </div>

      {/* Creator header */}
      <div className="mt-4 rounded-lg border border-line bg-white p-6">
        <div className="flex flex-wrap items-start gap-4">
          {creator.avatar_url ? (
            <SafeImage
              src={creator.avatar_url}
              alt=""
              className="size-20 rounded-lg object-cover"
            />
          ) : (
            <div className="grid size-20 place-items-center rounded-lg bg-[#f7efe8] text-2xl font-semibold text-muted">
              {creator.name.slice(0, 1)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <h1 className="text-2xl font-semibold">{creator.name}</h1>
              <span
                className={`rounded px-2 py-0.5 text-xs font-semibold ${
                  creator.status === "active"
                    ? "bg-[#dff5e7] text-[#1a7a3d]"
                    : "bg-[#f1f3f6] text-[#5a6776]"
                }`}
              >
                {lookupLabel(CREATOR_STATUS_LABELS, creator.status)}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted">
              UID {creator.bilibili_uid} · 粉丝{" "}
              {creator.follower_count?.toLocaleString() ?? "—"}
            </p>
            {creator.bio ? (
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink/80">
                {creator.bio}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={creator.profile_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-line px-3 py-1.5 text-xs font-medium"
              >
                <ExternalLink size={12} />B 站主页
              </a>
              <Link
                href={`/map?creator_id=${creator.id}`}
                className="inline-flex items-center gap-1 rounded-md border border-line px-3 py-1.5 text-xs font-medium"
              >
                <MapPin size={12} />
                在地图视图中查看
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <Stat label="已发布店铺" value={shopCount} hint="published" />
            <Stat label="覆盖城市" value={cityCount} hint="distinct cities" />
            <Stat
              label="最近探店"
              value={formatShortDate(latestShop?.latest_video?.published_at)}
              hint="latest video"
              text
            />
          </div>
        </div>
      </div>

      {/* Left map placeholder + right shop cards */}
      <div className="mt-5 grid gap-4 lg:grid-cols-[400px_1fr]">
        <aside className="space-y-3">
          <section className="rounded-lg border border-line bg-white">
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold">博主探店地图</h2>
              <span className="text-[11px] text-muted">{shopCount} 个 pin</span>
            </header>
            <CreatorMiniMap shops={shops} creatorId={creator.id} />
          </section>
          <section className="rounded-lg border border-line bg-white p-4">
            <h3 className="text-sm font-semibold">覆盖城市</h3>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {Array.from(new Set(shops.map((s) => s.city ?? "未知"))).map(
                (city) => (
                  <li
                    key={city}
                    className="rounded-full bg-[#eef7ed] px-2.5 py-0.5 text-[11px] font-medium text-[#2d6330]"
                  >
                    {city}
                  </li>
                ),
              )}
              {!shops.length ? (
                <li className="text-xs text-muted">暂无</li>
              ) : null}
            </ul>
          </section>
        </aside>

        <section>
          <header className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">
              探店店铺 <span className="text-muted">· 按视频时间倒序</span>
            </h2>
            <span className="text-[11px] text-muted">{shopCount} 家</span>
          </header>
          {shops.length ? (
            <div className="space-y-3">
              {shops.map((shop) => (
                <div key={shop.id} className="space-y-1">
                  <ShopCard shop={shop} />
                  {shop.latest_video?.published_at ? (
                    <p className="px-1 text-[11px] text-muted">
                      出自视频 · {formatTime(shop.latest_video.published_at)} ·{" "}
                      <a
                        href={shop.latest_video.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-brand"
                      >
                        {shop.latest_video.bvid}
                      </a>
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">
              暂无已发布的店铺。先到{" "}
              <Link href="/admin/videos" className="text-brand hover:underline">
                视频数据
              </Link>{" "}
              跑通 AI 工作流，或在{" "}
              <Link href="/admin/shops" className="text-brand hover:underline">
                店铺管理
              </Link>{" "}
              中查看草稿。
            </div>
          )}
        </section>
      </div>

      <footer className="mt-8 text-center text-xs text-muted">
        AI 总结，仅供参考 · 数据来源：B 站 / 高德地图
      </footer>
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  text = false,
}: {
  label: string;
  value: number | string;
  hint: string;
  text?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line px-3 py-3 text-center">
      <div
        className={
          text
            ? "text-base font-semibold"
            : "text-2xl font-semibold tabular-nums"
        }
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-muted">{label}</div>
      <div className="mt-0.5 text-[10px] text-muted">{hint}</div>
    </div>
  );
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
