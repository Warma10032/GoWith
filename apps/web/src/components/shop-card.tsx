import Link from "next/link";
import { ExternalLink, MapPin, Navigation, Star } from "lucide-react";
import { formatRecommendationScore, type ShopCardData } from "@/lib/api";
import { ExternalPlatformLink } from "./external-platform-link";

export function ShopCard({
  shop,
  surface = "home",
  recommendationRequestId,
}: {
  shop: ShopCardData;
  surface?: "home" | "creator_page";
  recommendationRequestId?: string;
}) {
  const card = shop.card_payload ?? {};
  const recommendationScore = card.recommendation_score;
  const sourceVideo = shop.source_videos?.[0];
  const dianpingLink = shop.external_links?.find(
    (link) => link.platform === "dianping",
  );
  const providerPrice = shop.poi_business?.avg_cost;
  const priceLabel =
    card.avg_price_hint ??
    (providerPrice !== null && providerPrice !== undefined
      ? `高德人均 ¥${Math.round(providerPrice)}`
      : "人均待确认");

  return (
    <article className="rounded-lg border border-line bg-white p-4 shadow-card">
      <div className="flex gap-4">
        <div className="grid size-24 shrink-0 place-items-center rounded-lg bg-[#f0e7dc] text-sm font-semibold text-brand">
          店铺
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Link
                href={`/shops/${shop.id}`}
                className="text-lg font-semibold leading-tight hover:text-brand"
              >
                {shop.display_name}
              </Link>
              <p className="mt-1 text-sm text-muted">
                {card.subtitle ?? "AI 已整理为可审核店铺卡片"}
              </p>
            </div>
            <span className="shrink-0 rounded-md bg-[#f7efe8] px-2 py-1 text-xs font-medium text-brand">
              {priceLabel}
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-ink">
            {card.recommend_reason ?? "等待 AI 总结与人工审核。"}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <MapPin size={14} />
              {[shop.city, shop.district].filter(Boolean).join(" · ") ||
                "位置待确认"}
            </span>
            <span className="inline-flex items-center gap-1">
              <Star size={14} />
              AI 评分 {formatRecommendationScore(recommendationScore)}
            </span>
            {sourceVideo ? (
              <a
                href={sourceVideo.source_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 font-medium text-brand"
                title={sourceVideo.title}
              >
                <ExternalLink size={14} />
                <span className="max-w-[160px] truncate">原视频</span>
              </a>
            ) : null}
            {dianpingLink ? (
              <ExternalPlatformLink
                href={dianpingLink.url}
                linkId={dianpingLink.id}
                shopId={shop.id}
                surface={surface}
                recommendationRequestId={recommendationRequestId}
                recommendationItemId={shop.recommendation_item_id}
                className="inline-flex items-center gap-1 font-medium text-brand"
              >
                <ExternalLink size={14} />
                大众点评
              </ExternalPlatformLink>
            ) : null}
            <Link
              href={`/shops/${shop.id}`}
              className="ml-auto inline-flex items-center gap-1 font-medium text-brand"
            >
              <Navigation size={14} />
              详情
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
