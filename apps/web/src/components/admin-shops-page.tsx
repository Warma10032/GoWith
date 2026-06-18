"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { AdminShell, adminFetch } from "./admin-shell";

type ShopRow = {
  id: string;
  display_name: string;
  city: string | null;
  district: string | null;
  business_area: string | null;
  status: string;
  avg_price_hint: string | null;
  card_payload: Record<string, unknown>;
  quality: Record<string, unknown> | null;
  published_at: string | null;
  last_reviewed_at: string | null;
  created_at: string;
};

const SHOP_STATUS_OPTIONS = ["approved", "published", "draft", "hidden", "rejected"];

export function AdminShopsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("approved");
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const params = new URLSearchParams({ limit: "100" });
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    const payload = await adminFetch<{ shops: ShopRow[] }>(`/api/admin/shops?${params.toString()}`);
    setShops(payload.shops);
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "加载失败"));
  }, [status]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void load().catch((err) => setError(err instanceof Error ? err.message : "搜索失败"));
  }

  return (
    <AdminShell
      title="店铺管理"
      description="按状态查看店铺：approved 为已通过审核，published 为已发布；点击进入详情查看 AI 评分、评论分析等。"
    >
      <section className="rounded-lg border border-line bg-white p-4">
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-2">
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            className="min-w-64 flex-1 rounded-lg border border-line px-3 py-2 text-sm"
            placeholder="搜索店名"
          />
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded-lg border border-line px-3 py-2 text-sm"
          >
            <option value="">全部状态</option>
            {SHOP_STATUS_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium">
            <Search size={16} />
            搜索
          </button>
        </form>
        {error ? (
          <div className="mt-3 rounded-lg border border-[#f2c7bd] bg-[#fff1ee] px-3 py-2 text-sm text-[#9a341f]">
            {error}
          </div>
        ) : null}
        <div className="mt-4 divide-y divide-line">
          {shops.map((shop) => {
            const card = (shop.card_payload ?? {}) as {
              title?: string;
              subtitle?: string;
              recommend_reason?: string;
              avg_price_hint?: string;
            };
            const qualityScore =
              shop.quality && typeof (shop.quality as { shop_confidence?: number }).shop_confidence === "number"
                ? ((shop.quality as { shop_confidence: number }).shop_confidence * 100).toFixed(0)
                : "—";
            return (
              <div key={shop.id} className="flex gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Link
                      href={`/admin/shops/${shop.id}`}
                      className="line-clamp-1 font-semibold hover:text-brand"
                    >
                      {shop.display_name}
                    </Link>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        shop.status === "published"
                          ? "bg-[#dff5e7] text-[#1a7a3d]"
                          : shop.status === "approved"
                            ? "bg-[#e6efff] text-[#1a4f9a]"
                            : "bg-[#f1f3f6] text-[#5a6776]"
                      }`}
                    >
                      {shop.status}
                    </span>
                    <span className="text-[11px] text-muted">AI 评分 {qualityScore}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {[shop.city, shop.district, shop.business_area].filter(Boolean).join(" · ") || "位置待确认"}
                    {shop.avg_price_hint ? ` · ${shop.avg_price_hint}` : ""}
                    {card.recommend_reason ? ` · ${card.recommend_reason.slice(0, 60)}${card.recommend_reason.length > 60 ? "…" : ""}` : ""}
                  </div>
                </div>
                <Link
                  href={`/admin/shops/${shop.id}`}
                  className="self-center rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-white"
                >
                  详情
                </Link>
              </div>
            );
          })}
          {!shops.length ? (
            <div className="rounded-lg border border-dashed border-line p-5 text-sm text-muted">
              当前状态下暂无店铺。
            </div>
          ) : null}
        </div>
      </section>
    </AdminShell>
  );
}
