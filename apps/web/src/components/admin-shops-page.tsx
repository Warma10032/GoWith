"use client";

import Link from "next/link";
import { useState } from "react";
import { Search } from "lucide-react";
import { AdminShell, adminFetch } from "./admin-shell";
import { ListState } from "./admin-list-state";
import { useDebouncedEffect } from "@/lib/use-debounced-effect";
import { useAdminRealtimeRefresh } from "./admin-realtime-provider";
import { SHOP_STATUS_LABELS, lookupLabel } from "@/lib/labels";

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

const SHOP_STATUS_OPTIONS = [
  "approved",
  "published",
  "draft",
  "hidden",
  "rejected",
];

export function AdminShopsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (q.trim()) params.set("q", q.trim());
      if (status) params.set("status", status);
      const payload = await adminFetch<{ shops: ShopRow[] }>(
        `/api/admin/shops?${params.toString()}`,
      );
      setShops(payload.shops);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useDebouncedEffect(load, [q, status], 350);
  useAdminRealtimeRefresh(load);

  const isFiltered = q.trim() !== "" || status !== "";
  const showInitialLoading = loading && shops.length === 0;
  const showInlineLoading = loading && shops.length > 0;

  return (
    <AdminShell
      title="店铺管理"
      description="按状态查看店铺：approved 为已通过审核，published 为已发布；点击进入详情查看 AI 评分、评论分析等。"
    >
      <section className="rounded-lg border border-line bg-white p-4">
        <div className="flex flex-wrap gap-2">
          <label className="relative min-w-64 flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm focus:border-brand focus:outline-none"
              placeholder="搜索店名"
            />
          </label>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded-lg border border-line px-3 py-2 text-sm"
          >
            <option value="">全部状态</option>
            {SHOP_STATUS_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {lookupLabel(SHOP_STATUS_LABELS, item)}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4">
          {showInitialLoading ? (
            <ListState
              loading
              error={null}
              isEmpty={false}
              isFiltered={false}
              onRetry={() => undefined}
            />
          ) : error ? (
            <ListState
              loading={false}
              error={error}
              isEmpty={false}
              isFiltered={false}
              onRetry={load}
            />
          ) : shops.length === 0 ? (
            <ListState
              loading={false}
              error={null}
              isEmpty
              isFiltered={isFiltered}
              onRetry={load}
              emptyHint={{
                initial:
                  "当前状态下没有店铺；先在视频处理中触发 AI 工作流，再回到这里查看候选。",
                filtered: "没有匹配该关键字或状态的店铺。",
              }}
            />
          ) : (
            <div
              className={
                showInlineLoading
                  ? "divide-y divide-line opacity-60"
                  : "divide-y divide-line"
              }
            >
              {shops.map((shop) => {
                const card = (shop.card_payload ?? {}) as {
                  title?: string;
                  subtitle?: string;
                  recommend_reason?: string;
                  avg_price_hint?: string;
                };
                const rawConfidence = shop.quality?.shop_confidence;
                const qualityScore =
                  typeof rawConfidence === "number"
                    ? (rawConfidence * 100).toFixed(0)
                    : typeof rawConfidence === "string" &&
                        rawConfidence.trim() !== ""
                      ? (Number(rawConfidence) * 100).toFixed(0)
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
                          {lookupLabel(SHOP_STATUS_LABELS, shop.status)}
                        </span>
                        <span className="text-[11px] text-muted">
                          AI 评分 {qualityScore}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {[shop.city, shop.district, shop.business_area]
                          .filter(Boolean)
                          .join(" · ") || "位置待确认"}
                        {shop.avg_price_hint ? ` · ${shop.avg_price_hint}` : ""}
                        {card.recommend_reason
                          ? ` · ${card.recommend_reason.slice(0, 60)}${card.recommend_reason.length > 60 ? "…" : ""}`
                          : ""}
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
            </div>
          )}
        </div>
      </section>
    </AdminShell>
  );
}
