import Link from "next/link";
import { ExternalLink, MapPin, Navigation, Star } from "lucide-react";
import { formatDistance } from "@gowith/shared";
import { formatRecommendationScore, type ShopCardData } from "@/lib/api";
import { ExternalPlatformLink } from "./external-platform-link";
import { ShopCoverImage } from "./shop-cover-image";

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
  const providerRating = shop.poi_business?.rating;
  const coverUrl = shop.poi_business?.photos?.[0]?.url;
  const distanceLabel = formatDistance(
    shop.distance_m === null || shop.distance_m === undefined
      ? null
      : Number(shop.distance_m),
  );
  const priceLabel =
    providerPrice !== null && providerPrice !== undefined
      ? `高德人均 ¥${Math.round(providerPrice)}`
      : null;

  return (
    <article className="rounded-lg border border-line bg-white p-4 shadow-card">
      <div className="flex gap-4">
        <ShopCoverImage
          src={coverUrl}
          alt={`${shop.display_name} 店铺图片`}
          className="h-24 w-28 shrink-0 rounded-lg border border-line object-cover sm:w-32"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
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
            <div className="flex shrink-0 items-center gap-2 text-right text-xs text-muted">
              <span className="leading-none font-medium text-brand">
                AI 评分
              </span>
              <span className="text-base font-semibold leading-none tabular-nums text-brand">
                {formatRecommendationScore(recommendationScore)}
              </span>
              {providerRating !== null && providerRating !== undefined ? (
                <>
                  <span aria-hidden className="h-3 w-px bg-line" />
                  <span className="inline-flex items-center gap-0.5 leading-none font-medium text-[#9a5a16]">
                    <Star size={12} fill="currentColor" />
                    高德评分 {providerRating.toFixed(1)}
                  </span>
                </>
              ) : null}
              {priceLabel ? (
                <>
                  <span aria-hidden className="h-3 w-px bg-line" />
                  <span className="leading-none">{priceLabel}</span>
                </>
              ) : null}
            </div>
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
            {distanceLabel ? (
              <span className="font-medium text-brand">
                距离 {distanceLabel}
              </span>
            ) : null}
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
