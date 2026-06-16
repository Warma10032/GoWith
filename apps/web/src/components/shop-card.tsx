import Link from "next/link";
import { MapPin, Navigation, ShieldCheck, Star } from "lucide-react";
import type { ShopCardData } from "@/lib/api";

export function ShopCard({ shop }: { shop: ShopCardData }) {
  const card = shop.card_payload ?? {};
  const tags = card.tags ?? [];
  const confidence = shop.quality?.shop_confidence;

  return (
    <article className="rounded-lg border border-line bg-white p-4 shadow-card">
      <div className="flex gap-4">
        <div className="grid size-24 shrink-0 place-items-center rounded-lg bg-[#f0e7dc] text-sm font-semibold text-brand">
          店铺
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Link href={`/shops/${shop.id}`} className="text-lg font-semibold leading-tight hover:text-brand">
                {shop.display_name}
              </Link>
              <p className="mt-1 text-sm text-muted">{card.subtitle ?? "AI 已整理为可审核店铺卡片"}</p>
            </div>
            <span className="shrink-0 rounded-md bg-[#f7efe8] px-2 py-1 text-xs font-medium text-brand">
              {card.avg_price_hint ?? "人均待确认"}
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-ink">{card.recommend_reason ?? "等待 AI 总结与人工审核。"}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span key={tag} className="rounded-md border border-line px-2 py-1 text-xs text-muted">
                {tag}
              </span>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <MapPin size={14} />
              {[shop.city, shop.district].filter(Boolean).join(" · ") || "位置待确认"}
            </span>
            <span className="inline-flex items-center gap-1">
              <ShieldCheck size={14} />
              AI 总结，仅供参考
            </span>
            <span className="inline-flex items-center gap-1">
              <Star size={14} />
              置信度 {typeof confidence === "number" ? confidence.toFixed(2) : "待评估"}
            </span>
            <Link href={`/shops/${shop.id}`} className="ml-auto inline-flex items-center gap-1 font-medium text-brand">
              <Navigation size={14} />
              详情
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

