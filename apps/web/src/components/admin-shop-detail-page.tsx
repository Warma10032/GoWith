"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  EyeOff,
  ExternalLink,
  Link2,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  RefreshCw,
  Search,
  Send,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { AdminShell } from "./admin-shell";
import { adminFetch } from "@/lib/admin-api";
import { buildDianpingSearchUrl } from "@/lib/dianping-search";
import { useAdminRealtimeRefresh } from "./admin-realtime-provider";
import {
  COORD_TYPE_LABELS,
  MENTION_TYPE_LABELS,
  SENTIMENT_LABELS,
  SHOP_STATUS_LABELS,
  lookupLabel,
} from "@/lib/labels";

const INLINE_EVIDENCE_ID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function cleanReviewText(value: string) {
  return value
    .replace(INLINE_EVIDENCE_ID_RE, "")
    .replace(/（[、，,\s]*）/g, "")
    .replace(/([、，,]\s*){2,}/g, "、")
    .trim();
}

type ShopDetail = {
  id: string;
  display_name: string;
  canonical_name: string;
  status: string;
  city: string | null;
  district: string | null;
  business_area: string | null;
  address: string | null;
  category_primary: string | null;
  category_secondary: string | null;
  lng: number;
  lat: number;
  coord_type: string;
  card_payload: Record<string, unknown>;
  aggregated_review: Record<string, unknown>;
  quality: Record<string, unknown>;
  source_stats: Record<string, unknown>;
  published_at: string | null;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

type ShopMention = {
  id: string;
  video_id: string;
  creator_id: string;
  mention_type: string;
  sentiment: string;
  // numeric(4,3) in SQL -> pg returns as string to avoid precision loss.
  confidence: string;
  summary: string | null;
};

type ShopVideo = {
  id: string;
  bvid: string;
  title: string;
  cover_url: string | null;
  source_url: string;
  published_at: string | null;
  creator_id: string;
};

type ShopCreator = {
  id: string;
  bilibili_uid: string;
  name: string;
  avatar_url: string | null;
};

type ShopResponse = {
  shop: ShopDetail;
  mentions: ShopMention[];
  videos: ShopVideo[];
  creators: ShopCreator[];
  review_comments: ReviewComment[];
  external_links: ShopExternalLink[];
  poi_business: PoiBusiness | null;
};

type ShopExternalLink = {
  id: string;
  platform: "dianping" | "meituan";
  external_shop_id: string | null;
  external_url: string;
  source: "manual" | "official_api";
  status: "confirmed" | "removed";
  confirmed_at: string | null;
};

type PoiBusiness = {
  provider: "amap" | "tencent" | "baidu";
  rating: number | string | null;
  avg_cost: number | string | null;
  phone: string | null;
  business_hours: string | null;
  tags: string[];
  photos: Array<{ title?: string | null; url: string }>;
  provider_updated_at: string | null;
};

type ReviewComment = {
  evidence_id: string;
  id: string;
  content: string;
  user_hash: string | null;
  author_name: string | null;
  author_avatar_url: string | null;
  image_urls: string[];
  like_count: number | null;
  reply_count: number | null;
  published_at: string | null;
};

type ShopSummaryEditTarget = {
  display_name: string;
  display_title: string;
  subtitle: string;
  recommend_reason: string;
  category_primary: string;
  category_secondary: string;
  city: string;
  district: string;
  business_area: string;
  address: string;
  suitable_scenes: string;
};

type ShopSummaryEditValues = ShopSummaryEditTarget;

type ReviewAspectEditTarget = {
  aspect: string;
  summary: string;
  sentiment: string;
  confidence: string;
};

type ReviewAspectEditValues = ReviewAspectEditTarget;

function readNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === "number" ? v : null;
}

export function AdminShopDetailPage({ shopId }: { shopId: string }) {
  const [data, setData] = useState<ShopResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dianpingUrl, setDianpingUrl] = useState("");
  const [selectedReviewAspect, setSelectedReviewAspect] = useState<
    string | null
  >(null);
  const [deleteReviewTarget, setDeleteReviewTarget] = useState<{
    aspect: string;
    summary: string;
  } | null>(null);
  const [summaryEditTarget, setSummaryEditTarget] = useState<ShopSummaryEditTarget | null>(
    null,
  );
  const [reviewEditTarget, setReviewEditTarget] =
    useState<ReviewAspectEditTarget | null>(null);
  const [unpublishDialogOpen, setUnpublishDialogOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const payload = await adminFetch<ShopResponse>(
        `/api/admin/shops/${shopId}`,
      );
      setData(payload);
      setDianpingUrl(
        payload.external_links.find(
          (link) => link.platform === "dianping" && link.status === "confirmed",
        )?.external_url ?? "",
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }, [shopId]);

  useEffect(() => {
    void load();
  }, [load]);
  useAdminRealtimeRefresh(load);

  // 必须在 `if (!data) return ...` 之前调用，否则 hooks 顺序在两次 render 之间不一致。
  const dianpingSearchUrl = useMemo(
    () => buildDianpingSearchUrl(data?.shop.city, data?.shop.display_name),
    [data?.shop.city, data?.shop.display_name],
  );

  async function runAction(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(`${label} 已提交`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} 失败`);
    } finally {
      setBusy(null);
    }
  }

  async function deleteReviewAspect(aspect: string) {
    await runAction("删除评论观点", async () => {
      await adminFetch(
        `/api/admin/shops/${shopId}/review-aspects/${encodeURIComponent(aspect)}`,
        {
          method: "DELETE",
          body: JSON.stringify({
            expected_updated_at: data?.shop.updated_at,
          }),
        },
      );
      setSelectedReviewAspect((current) => (current === aspect ? null : current));
      setDeleteReviewTarget(null);
    });
  }

  async function updateShopSummary(values: ShopSummaryEditValues) {
    await runAction("编辑店铺总结", async () => {
      await adminFetch(`/api/admin/shops/${shopId}`, {
        method: "PATCH",
        body: JSON.stringify({
          expected_updated_at: data?.shop.updated_at,
          display_name: values.display_name,
          category_primary: values.category_primary || null,
          category_secondary: values.category_secondary || null,
          city: values.city || null,
          district: values.district || null,
          business_area: values.business_area || null,
          address: values.address || null,
          card_payload: {
            display_title: values.display_title,
            subtitle: values.subtitle || null,
            recommend_reason: values.recommend_reason || null,
            suitable_scenes: values.suitable_scenes
              .split(/[、,\n]/)
              .map((item) => item.trim())
              .filter(Boolean),
          },
        }),
      });
      setSummaryEditTarget(null);
    });
  }

  async function updateReviewAspect(values: ReviewAspectEditValues) {
    if (!reviewEditTarget) return;
    await runAction("编辑评论观点", async () => {
      await adminFetch(
        `/api/admin/shops/${shopId}/review-aspects/${encodeURIComponent(reviewEditTarget.aspect)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            expected_updated_at: data?.shop.updated_at,
            summary: values.summary,
            sentiment: values.sentiment,
            confidence: values.confidence === "" ? null : Number(values.confidence),
          }),
        },
      );
      setReviewEditTarget(null);
    });
  }

  async function unpublishShop() {
    await runAction("下架店铺", async () => {
      await adminFetch(`/api/admin/shops/${shopId}/unpublish`, {
        method: "POST",
        body: JSON.stringify({
          expected_updated_at: data?.shop.updated_at,
        }),
      });
      setUnpublishDialogOpen(false);
    });
  }

  if (!data) {
    return (
      <AdminShell
        title="店铺详情"
        description="AI 识别信息、评分、评论分析、证据链"
      >
        <section className="rounded-lg border border-line bg-white p-6 text-sm text-muted">
          {error ?? "加载中…"}
        </section>
      </AdminShell>
    );
  }

  const { shop, mentions, videos, creators } = data;
  const dianpingLink = data.external_links.find(
    (link) => link.platform === "dianping" && link.status === "confirmed",
  );
  const card = (shop.card_payload ?? {}) as {
    display_title?: string;
    subtitle?: string;
    recommend_reason?: string;
    recommendation_score?: number | null;
    recommendation_score_evidence_ids?: string[];
    recommended_dishes?: { name: string; reason?: string }[];
    avoid_points?: { text: string }[];
    suitable_scenes?: string[];
  };
  const aggregatedReview = (shop.aggregated_review ?? {}) as Record<
    string,
    unknown
  >;
  const traceableCommentEvidenceIds = new Set(
    data.review_comments.map((comment) => comment.evidence_id),
  );
  const review = Object.entries(aggregatedReview).flatMap(([aspect, info]) => {
    if (
      ["comment_summary", "comment_signals"].includes(aspect) ||
      typeof info !== "object" ||
      info === null
    ) {
      return [];
    }
    const dimension = info as {
      sentiment?: string;
      summary?: string;
      confidence?: number;
      evidence_ids?: string[];
    };
    const hasTraceableComment = (dimension.evidence_ids ?? []).some((id) =>
      traceableCommentEvidenceIds.has(id),
    );
    return typeof dimension.summary === "string" &&
      Number(dimension.confidence ?? 0) > 0.4 &&
      !dimension.summary.includes("无明确评价") &&
      hasTraceableComment
      ? [[aspect, dimension] as const]
      : [];
  });
  const selectedReview = review.find(
    ([aspect]) => aspect === selectedReviewAspect,
  );
  const selectedEvidenceIds = new Set(selectedReview?.[1].evidence_ids ?? []);
  const selectedComments = data.review_comments.filter((comment) =>
    selectedEvidenceIds.has(comment.evidence_id),
  );
  const recommendationScore = readNumber(card, "recommendation_score");
  const creatorCount = readNumber(shop.source_stats, "creator_count");
  const videoCount = readNumber(shop.source_stats, "video_count");
  const commentCount = readNumber(shop.source_stats, "comment_signal_count");

  const videoById = new Map(videos.map((v) => [v.id, v]));
  const creatorById = new Map(creators.map((c) => [c.id, c]));

  return (
    <AdminShell
      title={shop.display_name}
      description={`状态：${lookupLabel(SHOP_STATUS_LABELS, shop.status)} · ${shop.city ?? "?"} / ${shop.district ?? "?"}${shop.business_area ? " / " + shop.business_area : ""}`}
    >
      {busy ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-[#f0c674] bg-[#fff5e1] px-3 py-2 text-sm text-[#7a4f00]">
          <LoaderCircle size={14} className="animate-spin" />
          正在执行：{busy}（其它操作按钮已禁用）
        </div>
      ) : null}
      <section className="grid gap-3 md:grid-cols-3">
        <SummaryCard
          label="AI 评分"
          value={
            recommendationScore !== null
              ? (recommendationScore * 100).toFixed(0)
              : "—"
          }
          hint="博主观点与评论综合推荐度"
        />
        <SummaryCard
          label="覆盖博主"
          value={creatorCount !== null ? String(creatorCount) : "—"}
          hint="覆盖博主数量"
        />
        <SummaryCard
          label="覆盖视频"
          value={videoCount !== null ? String(videoCount) : "—"}
          hint="覆盖视频数量"
        />
        <SummaryCard
          label="评论线索"
          value={commentCount !== null ? String(commentCount) : "—"}
          hint="被采纳为证据的评论条数"
        />
        <SummaryCard
          label="发布于"
          value={
            shop.published_at
              ? new Date(shop.published_at).toLocaleString("zh-CN")
              : "—"
          }
          hint="前台首次发布时间"
        />
        <SummaryCard
          label="最近审核"
          value={
            shop.last_reviewed_at
              ? new Date(shop.last_reviewed_at).toLocaleString("zh-CN")
              : "—"
          }
          hint="最近一次人工审核时间"
        />
      </section>

      <section className="mt-4 flex flex-wrap gap-2 rounded-lg border border-line bg-white p-4">
        {shop.status === "draft" ? (
          <button
            onClick={() =>
              void runAction("通过审核", async () => {
                await adminFetch(`/api/admin/shops/${shop.id}/approve`, {
                  method: "POST",
                });
              })
            }
            className="inline-flex items-center gap-2 rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white"
            disabled={!!busy}
          >
            {busy === "通过审核" ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <CheckCircle2 size={14} />
            )}
            通过审核
          </button>
        ) : null}
        {shop.status === "approved" ? (
          <button
            onClick={() =>
              void runAction("发布", async () => {
                await adminFetch(`/api/admin/shops/${shop.id}/publish`, {
                  method: "POST",
                });
              })
            }
            className="inline-flex items-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white"
            disabled={!!busy}
          >
            {busy === "发布" ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            发布
          </button>
        ) : null}
        {shop.status === "published" ? (
          <button
            onClick={() => setUnpublishDialogOpen(true)}
            className="inline-flex items-center gap-2 rounded-md border border-[#f2c7bd] px-3 py-2 text-sm font-semibold text-[#9a341f]"
            disabled={!!busy}
          >
            {busy === "下架店铺" ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <EyeOff size={14} />
            )}
            下架店铺
          </button>
        ) : null}
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium"
          disabled={!!busy}
        >
          <RefreshCw size={14} />
          刷新
        </button>
      </section>

      <section className="mt-4 rounded-lg border border-line bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">大众点评门店链接</h2>
            <p className="mt-1 text-xs leading-5 text-muted">
              仅保存管理员确认的 HTTPS 点评链接，不请求或抓取页面数据。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {dianpingSearchUrl ? (
              <a
                href={dianpingSearchUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:border-brand hover:text-brand"
              >
                <Search size={12} />
                在大众点评搜索「{shop.display_name}」
                <ExternalLink size={10} />
              </a>
            ) : (
              <span
                title={
                  shop.city
                    ? `暂未配置城市「${shop.city}」的大众点评 ID，请联系研发补全 cityId 字典。`
                    : "店铺尚未写入城市信息，无法构造搜索 URL。"
                }
                className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-dashed border-line bg-white px-2.5 py-1.5 text-xs font-medium text-muted"
              >
                <Search size={12} />
                缺少城市信息
              </span>
            )}
            {dianpingLink ? (
              <a
                href={dianpingLink.external_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-brand"
              >
                打开当前链接
                <ExternalLink size={12} />
              </a>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="url"
            value={dianpingUrl}
            onChange={(event) => setDianpingUrl(event.target.value)}
            placeholder="https://www.dianping.com/shop/..."
            className="min-w-0 flex-1 rounded-md border border-line px-3 py-2 text-sm"
            disabled={!!busy}
          />
          <button
            type="button"
            onClick={() =>
              void runAction("绑定大众点评", async () => {
                await adminFetch(
                  `/api/admin/shops/${shop.id}/external-links/dianping`,
                  {
                    method: "PUT",
                    body: JSON.stringify({ url: dianpingUrl }),
                  },
                );
              })
            }
            className="inline-flex items-center justify-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!!busy || !dianpingUrl.trim()}
          >
            {busy === "绑定大众点评" ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <Link2 size={14} />
            )}
            {dianpingLink ? "更新链接" : "绑定链接"}
          </button>
          {dianpingLink ? (
            <button
              type="button"
              onClick={() =>
                void runAction("移除大众点评", async () => {
                  await adminFetch(
                    `/api/admin/shops/${shop.id}/external-links/dianping`,
                    { method: "DELETE" },
                  );
                })
              }
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[#f2c7bd] px-3 py-2 text-sm font-medium text-[#9a341f] disabled:opacity-50"
              disabled={!!busy}
            >
              {busy === "移除大众点评" ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} />
              )}
              移除
            </button>
          ) : null}
        </div>
        {dianpingLink?.external_shop_id ? (
          <p className="mt-2 text-xs text-muted">
            点评店铺 ID：{dianpingLink.external_shop_id}
          </p>
        ) : null}
      </section>

      <section className="mt-4 rounded-lg border border-line bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">
              AI 识别的店铺基本信息
            </h2>
            <p className="mt-1 text-xs text-muted">
              当前展示内容可人工修订；高德 POI、坐标、评分、人均等来源字段保持只读。
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setSummaryEditTarget({
                display_name: shop.display_name,
                display_title: card.display_title ?? shop.display_name,
                subtitle: card.subtitle ?? "",
                recommend_reason: card.recommend_reason ?? "",
                category_primary: shop.category_primary ?? "",
                category_secondary: shop.category_secondary ?? "",
                city: shop.city ?? "",
                district: shop.district ?? "",
                business_area: shop.business_area ?? "",
                address: shop.address ?? "",
                suitable_scenes: Array.isArray(card.suitable_scenes)
                  ? card.suitable_scenes.join("、")
                  : "",
              })
            }
            className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!!busy || shop.status === "published"}
            title={shop.status === "published" ? "已发布店铺需先下架，才能编辑展示总结" : "编辑 AI 总结中的错误"}
          >
            <Pencil size={14} />
            编辑总结
          </button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="店名" value={card.display_title ?? shop.display_name} />
          <Field label="副标题" value={card.subtitle ?? "—"} />
          <Field label="推荐理由" value={card.recommend_reason ?? "—"} wide />
          <Field
            label="品类"
            value={
              [shop.category_primary, shop.category_secondary]
                .filter(Boolean)
                .join(" / ") || "—"
            }
          />
          <Field label="地址" value={shop.address ?? "—"} />
          <Field
            label="坐标"
            value={`${shop.lng}, ${shop.lat} · ${lookupLabel(COORD_TYPE_LABELS, shop.coord_type)}`}
          />
          <Field
            label="高德评分"
            value={
              data.poi_business?.rating !== null &&
              data.poi_business?.rating !== undefined
                ? String(data.poi_business.rating)
                : "—"
            }
          />
          <Field
            label="高德人均"
            value={
              data.poi_business?.avg_cost !== null &&
              data.poi_business?.avg_cost !== undefined
                ? `¥${Math.round(Number(data.poi_business.avg_cost))}`
                : "—"
            }
          />
          <Field label="高德电话" value={data.poi_business?.phone ?? "—"} />
          <Field
            label="高德营业时间"
            value={data.poi_business?.business_hours ?? "—"}
          />
        </div>
        {Array.isArray(card.recommended_dishes) &&
        card.recommended_dishes.length > 0 ? (
          <div className="mt-3">
            <h3 className="text-xs font-semibold text-ink">推荐菜</h3>
            <ul className="mt-1 space-y-1 text-sm">
              {card.recommended_dishes.map((dish, i) => (
                <li key={i}>
                  <span className="font-medium">{dish.name}</span>
                  {dish.reason ? (
                    <span className="text-muted"> · {dish.reason}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {Array.isArray(card.avoid_points) && card.avoid_points.length > 0 ? (
          <div className="mt-3">
            <h3 className="text-xs font-semibold text-ink">避雷点</h3>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {card.avoid_points.map((p, i) => (
                <li key={i}>{p.text}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {Array.isArray(card.suitable_scenes) &&
        card.suitable_scenes.length > 0 ? (
          <div className="mt-3">
            <h3 className="text-xs font-semibold text-ink">适合场景</h3>
            <p className="mt-1 text-sm">{card.suitable_scenes.join("、")}</p>
          </div>
        ) : null}
      </section>

      <section className="mt-4 rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold text-ink">
          评论分析（按维度聚合）
        </h2>
        <p className="mt-1 text-xs text-muted">
          按维度聚合评论正负面，置信度越高质量越好。
        </p>
        <div className="card-scroll-md mt-3 grid gap-2 md:grid-cols-2 pr-1">
          {review.map(([aspect, info]) => (
            <article
              key={aspect}
              className="rounded-lg border border-line p-3 transition-colors hover:border-brand"
            >
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold text-ink">{aspect}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    info.sentiment === "positive"
                      ? "bg-[#dff5e7] text-[#1a7a3d]"
                      : info.sentiment === "negative"
                        ? "bg-[#ffe2dc] text-[#9a341f]"
                        : "bg-[#f1f3f6] text-[#5a6776]"
                  }`}
                >
                  {info.sentiment
                    ? lookupLabel(SENTIMENT_LABELS, info.sentiment)
                    : "暂无评价"}
                </span>
              </div>
              <p className="mt-1 text-sm">
                {cleanReviewText(info.summary ?? "") || "—"}
              </p>
              {typeof info.confidence === "number" ||
              typeof info.confidence === "string" ? (
                <p className="mt-1 text-[11px] text-muted">
                  置信度 {(Number(info.confidence) * 100).toFixed(0)}%
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedReviewAspect(aspect)}
                  className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-brand"
                  disabled={!!busy}
                >
                  <MessageSquareText size={12} />
                  查看{" "}
                  {
                    (info.evidence_ids ?? []).filter((id) =>
                      traceableCommentEvidenceIds.has(id),
                    ).length
                  }{" "}
                  条原评论
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setReviewEditTarget({
                      aspect,
                      summary: cleanReviewText(info.summary ?? "") || "",
                      sentiment: info.sentiment ?? "neutral",
                      confidence:
                        typeof info.confidence === "number" ||
                        typeof info.confidence === "string"
                          ? String(info.confidence)
                          : "",
                    })
                  }
                  className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!!busy || shop.status === "published"}
                  title={
                    shop.status === "published"
                      ? "已发布店铺需先下架，才能编辑展示观点"
                      : "编辑这个评论维度观点"
                  }
                >
                  <Pencil size={12} />
                  编辑观点
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDeleteReviewTarget({
                      aspect,
                      summary: cleanReviewText(info.summary ?? "") || "—",
                    })
                  }
                  className="inline-flex items-center gap-1 rounded-md border border-[#f2c7bd] px-2 py-1 text-[11px] font-semibold text-[#9a341f] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!!busy || shop.status === "published"}
                  title={
                    shop.status === "published"
                      ? "已发布店铺需先下架，才能删除展示观点"
                      : "删除当前展示内容中的这个评论维度观点"
                  }
                >
                  <Trash2 size={12} />
                  删除观点
                </button>
              </div>
            </article>
          ))}
          {!review.length ? (
            <p className="text-sm text-muted">暂无有效评论结论</p>
          ) : null}
        </div>
      </section>

      {selectedReview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <section className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-xl">
            <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h2 className="font-semibold text-ink">
                  {selectedReview[0]} · 原评论证据
                </h2>
                <p className="mt-1 text-xs text-muted">
                  {selectedComments.length} 条可追溯评论
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReviewAspect(null)}
                className="grid size-8 shrink-0 place-items-center rounded-md border border-line text-muted hover:text-ink"
                title="关闭"
                aria-label="关闭评论证据"
              >
                <X size={16} />
              </button>
            </header>
            <div className="max-h-[calc(85vh-76px)] space-y-3 overflow-y-auto p-5">
              {selectedComments.map((comment) => (
                <article
                  key={comment.evidence_id}
                  className="rounded-lg border border-line p-4"
                >
                  <div className="flex items-center gap-3">
                    {comment.author_avatar_url ? (
                      <img
                        src={comment.author_avatar_url}
                        alt=""
                        className="size-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="grid size-8 rounded-full bg-[#f0e7dc] text-xs font-semibold text-brand">
                        <span className="m-auto">评</span>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {comment.author_name ??
                          (comment.user_hash
                            ? `匿名用户 ${comment.user_hash.slice(0, 8)}`
                            : "匿名用户")}
                      </div>
                      <div className="text-xs text-muted">
                        {comment.published_at
                          ? new Date(comment.published_at).toLocaleString(
                              "zh-CN",
                            )
                          : "时间未知"}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted">
                      <span className="inline-flex items-center gap-1">
                        <ThumbsUp size={12} /> {comment.like_count ?? 0}
                      </span>
                      <span>{comment.reply_count ?? 0} 回复</span>
                    </div>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink">
                    {comment.content}
                  </p>
                  {comment.image_urls.length ? (
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {comment.image_urls.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <img
                            src={url}
                            alt="评论图片"
                            className="aspect-square w-full rounded-md border border-line object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
              {!selectedComments.length ? (
                <p className="py-8 text-center text-sm text-muted">
                  这些证据来自旧分析记录，暂未关联到可展示的原评论。
                </p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      <ReviewAspectDeleteDialog
        target={deleteReviewTarget}
        busy={busy}
        onCancel={() => setDeleteReviewTarget(null)}
        onConfirm={deleteReviewAspect}
      />
      <ShopSummaryEditDialog
        target={summaryEditTarget}
        busy={busy}
        onCancel={() => setSummaryEditTarget(null)}
        onConfirm={updateShopSummary}
      />
      <ReviewAspectEditDialog
        target={reviewEditTarget}
        busy={busy}
        onCancel={() => setReviewEditTarget(null)}
        onConfirm={updateReviewAspect}
      />
      <ShopUnpublishDialog
        open={unpublishDialogOpen}
        shopName={shop.display_name}
        busy={busy}
        onCancel={() => setUnpublishDialogOpen(false)}
        onConfirm={unpublishShop}
      />

      <section className="mt-4 rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold text-ink">来源视频与博主</h2>
        <p className="mt-1 text-xs text-muted">
          通过店铺-视频引用表关联。点击进入视频处理控制台查看证据链。
        </p>
        <div className="card-scroll-md mt-3 divide-y divide-line">
          {mentions.map((mention) => {
            const video = videoById.get(mention.video_id);
            const creator = video ? creatorById.get(video.creator_id) : null;
            return (
              <div
                key={mention.id}
                className="flex flex-wrap items-center gap-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <Link
                      href={`/admin/videos/${mention.video_id}`}
                      className="line-clamp-1 font-medium hover:text-brand"
                    >
                      {video?.title ?? mention.video_id}
                    </Link>
                    <span className="rounded bg-[#f1f3f6] px-1.5 py-0.5 text-[10px] font-semibold text-[#5a6776]">
                      {lookupLabel(MENTION_TYPE_LABELS, mention.mention_type)}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        mention.sentiment === "positive"
                          ? "bg-[#dff5e7] text-[#1a7a3d]"
                          : mention.sentiment === "negative"
                            ? "bg-[#ffe2dc] text-[#9a341f]"
                            : "bg-[#f1f3f6] text-[#5a6776]"
                      }`}
                    >
                      {lookupLabel(SENTIMENT_LABELS, mention.sentiment)}
                    </span>
                    {typeof mention.confidence === "string" ||
                    typeof mention.confidence === "number" ? (
                      <span className="text-[11px] text-muted">
                        置信度 {(Number(mention.confidence) * 100).toFixed(0)}%
                      </span>
                    ) : null}
                  </div>
                  {creator ? (
                    <div className="mt-1 text-xs text-muted">
                      博主：{creator.name}（UID {creator.bilibili_uid}） · BV{" "}
                      {video?.bvid}
                    </div>
                  ) : null}
                  {mention.summary ? (
                    <p className="mt-1 text-xs text-muted">{mention.summary}</p>
                  ) : null}
                </div>
                {video ? (
                  <a
                    href={video.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium"
                  >
                    <ExternalLink size={12} />
                    B站
                  </a>
                ) : null}
              </div>
            );
          })}
          {!mentions.length ? (
            <p className="text-sm text-muted">暂无来源视频。</p>
          ) : null}
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold text-ink">
          完整 JSON（开发者参考）
        </h2>
        <p className="mt-1 text-xs text-muted">
          质量、来源统计、评论聚合的原始字段，便于排查。键名沿用数据库字段。
        </p>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-[#0d131a] p-3 text-[11px] leading-5 text-[#d9e1ea]">
          {JSON.stringify(
            {
              quality: shop.quality,
              source_stats: shop.source_stats,
              aggregated_review: shop.aggregated_review,
            },
            null,
            2,
          )}
        </pre>
      </section>

      {error ? (
        <div className="mt-4 rounded-lg border border-[#f2c7bd] bg-[#fff1ee] px-3 py-2 text-sm text-[#9a341f]">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="mt-4 rounded-lg border border-[#cfe5d6] bg-[#eef9f1] px-3 py-2 text-sm text-[#1a7a3d]">
          {message}
        </div>
      ) : null}
    </AdminShell>
  );
}

function ShopSummaryEditDialog({
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  target: ShopSummaryEditTarget | null;
  busy: string | null;
  onCancel: () => void;
  onConfirm: (values: ShopSummaryEditValues) => Promise<void>;
}) {
  const [values, setValues] = useState<ShopSummaryEditValues>(() => ({
    display_name: "",
    display_title: "",
    subtitle: "",
    recommend_reason: "",
    category_primary: "",
    category_secondary: "",
    city: "",
    district: "",
    business_area: "",
    address: "",
    suitable_scenes: "",
  }));

  useEffect(() => {
    if (!target) return;
    setValues(target);
  }, [target]);

  if (!target) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!values.display_name.trim() || !values.display_title.trim()) return;
    await onConfirm({
      ...values,
      display_name: values.display_name.trim(),
      display_title: values.display_title.trim(),
      subtitle: values.subtitle.trim(),
      recommend_reason: values.recommend_reason.trim(),
      category_primary: values.category_primary.trim(),
      category_secondary: values.category_secondary.trim(),
      city: values.city.trim(),
      district: values.district.trim(),
      business_area: values.business_area.trim(),
      address: values.address.trim(),
      suitable_scenes: values.suitable_scenes.trim(),
    });
  }

  function update<K extends keyof ShopSummaryEditValues>(
    key: K,
    value: ShopSummaryEditValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 px-4">
      <form
        onSubmit={submit}
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-line bg-white p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#f7efe8] px-3 py-1 text-xs font-semibold text-ink">
              <Pencil size={14} />
              编辑店铺 AI 总结
            </div>
            <h2 className="mt-3 text-lg font-semibold">修订当前展示内容</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              只修改店铺当前展示字段；高德评分、人均、坐标、图片等 POI 字段保持只读。
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-line p-2 text-muted hover:text-ink"
            disabled={!!busy}
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <TextInput label="展示店名" value={values.display_name} onChange={(value) => update("display_name", value)} required disabled={!!busy} />
          <TextInput label="卡片标题" value={values.display_title} onChange={(value) => update("display_title", value)} required disabled={!!busy} />
          <TextInput label="副标题" value={values.subtitle} onChange={(value) => update("subtitle", value)} disabled={!!busy} />
          <TextInput label="一级品类" value={values.category_primary} onChange={(value) => update("category_primary", value)} disabled={!!busy} />
          <TextInput label="二级品类" value={values.category_secondary} onChange={(value) => update("category_secondary", value)} disabled={!!busy} />
          <TextInput label="城市" value={values.city} onChange={(value) => update("city", value)} disabled={!!busy} />
          <TextInput label="区域" value={values.district} onChange={(value) => update("district", value)} disabled={!!busy} />
          <TextInput label="商圈" value={values.business_area} onChange={(value) => update("business_area", value)} disabled={!!busy} />
          <label className="md:col-span-2 text-sm font-medium">
            地址
            <input
              value={values.address}
              onChange={(event) => update("address", event.target.value)}
              className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand focus:outline-none"
              disabled={!!busy}
            />
          </label>
          <label className="md:col-span-2 text-sm font-medium">
            推荐理由
            <textarea
              value={values.recommend_reason}
              onChange={(event) => update("recommend_reason", event.target.value)}
              className="mt-1 min-h-28 w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand focus:outline-none"
              disabled={!!busy}
            />
          </label>
          <label className="md:col-span-2 text-sm font-medium">
            适合场景
            <input
              value={values.suitable_scenes}
              onChange={(event) => update("suitable_scenes", event.target.value)}
              className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand focus:outline-none"
              placeholder="朋友聚餐、约会、工作餐，可用顿号/逗号/换行分隔"
              disabled={!!busy}
            />
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-line px-3 py-2 text-sm font-medium"
            disabled={!!busy}
          >
            取消
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            disabled={!!busy || !values.display_name.trim() || !values.display_title.trim()}
          >
            {busy === "编辑店铺总结" ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <Pencil size={16} />
            )}
            保存修改
          </button>
        </div>
      </form>
    </div>
  );
}

function ReviewAspectEditDialog({
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  target: ReviewAspectEditTarget | null;
  busy: string | null;
  onCancel: () => void;
  onConfirm: (values: ReviewAspectEditValues) => Promise<void>;
}) {
  const [values, setValues] = useState<ReviewAspectEditValues>(() => ({
    aspect: "",
    summary: "",
    sentiment: "neutral",
    confidence: "",
  }));

  useEffect(() => {
    if (!target) return;
    setValues(target);
  }, [target]);

  if (!target) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const confidence = values.confidence.trim();
    const confidenceNumber = confidence === "" ? null : Number(confidence);
    if (
      !values.summary.trim() ||
      (confidenceNumber !== null && (Number.isNaN(confidenceNumber) || confidenceNumber < 0 || confidenceNumber > 1))
    ) {
      return;
    }
    await onConfirm({
      ...values,
      summary: values.summary.trim(),
      confidence,
    });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-2xl border border-line bg-white p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#f7efe8] px-3 py-1 text-xs font-semibold text-ink">
              <Pencil size={14} />
              编辑评论观点
            </div>
            <h2 className="mt-3 text-lg font-semibold">{target.aspect}</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-line p-2 text-muted hover:text-ink"
            disabled={!!busy}
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <label className="mt-4 block text-sm font-medium">
          观点总结 <span className="text-[#9a341f]">*</span>
          <textarea
            value={values.summary}
            onChange={(event) =>
              setValues((current) => ({ ...current, summary: event.target.value }))
            }
            className="mt-2 min-h-28 w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand focus:outline-none"
            disabled={!!busy}
          />
        </label>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-sm font-medium">
            情绪
            <select
              value={values.sentiment}
              onChange={(event) =>
                setValues((current) => ({ ...current, sentiment: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
              disabled={!!busy}
            >
              <option value="positive">正面</option>
              <option value="neutral">中性</option>
              <option value="negative">负面</option>
              <option value="mixed">混合</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            置信度（0-1）
            <input
              value={values.confidence}
              onChange={(event) =>
                setValues((current) => ({ ...current, confidence: event.target.value }))
              }
              inputMode="decimal"
              placeholder="0.8"
              className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
              disabled={!!busy}
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-line px-3 py-2 text-sm font-medium"
            disabled={!!busy}
          >
            取消
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            disabled={!!busy || !values.summary.trim()}
          >
            {busy === "编辑评论观点" ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <Pencil size={16} />
            )}
            保存修改
          </button>
        </div>
      </form>
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  disabled,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  required?: boolean;
}) {
  return (
    <label className="text-sm font-medium">
      {label} {required ? <span className="text-[#9a341f]">*</span> : null}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand focus:outline-none"
        disabled={disabled}
      />
    </label>
  );
}

function ReviewAspectDeleteDialog({
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  target: { aspect: string; summary: string } | null;
  busy: string | null;
  onCancel: () => void;
  onConfirm: (aspect: string) => Promise<void>;
}) {
  if (!target) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const current = target;
    if (!current) return;
    await onConfirm(current.aspect);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-2xl border border-line bg-white p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#fff1ee] px-3 py-1 text-xs font-semibold text-[#9a341f]">
              <Trash2 size={14} />
              删除评论观点
            </div>
            <h2 className="mt-3 text-lg font-semibold">{target.aspect}</h2>
            <p className="mt-1 text-sm leading-6 text-muted">{target.summary}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-line p-2 text-muted hover:text-ink"
            disabled={!!busy}
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <p className="mt-4 rounded-lg bg-[#fbfaf8] px-3 py-2 text-sm text-muted">
          删除后只会从当前店铺展示结论中移除该观点，不修改历史 AI JSON 或原始评论。
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-line px-3 py-2 text-sm font-medium"
            disabled={!!busy}
          >
            取消
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-[#9a341f] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            disabled={!!busy}
          >
            {busy === "删除评论观点" ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <Trash2 size={16} />
            )}
            确认删除
          </button>
        </div>
      </form>
    </div>
  );
}

function ShopUnpublishDialog({
  open,
  shopName,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  shopName: string;
  busy: string | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onConfirm();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-2xl border border-line bg-white p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#fff1ee] px-3 py-1 text-xs font-semibold text-[#9a341f]">
              <EyeOff size={14} />
              下架店铺
            </div>
            <h2 className="mt-3 text-lg font-semibold">下架「{shopName}」？</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              下架后店铺会从前台隐藏，状态变为 hidden；你可以继续编辑内容，再提交复审发布。
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-line p-2 text-muted hover:text-ink"
            disabled={!!busy}
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <p className="mt-4 rounded-lg bg-[#fbfaf8] px-3 py-2 text-sm text-muted">
          下架后可继续编辑当前展示内容，再提交复审发布。
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-line px-3 py-2 text-sm font-medium"
            disabled={!!busy}
          >
            取消
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-[#9a341f] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            disabled={!!busy}
          >
            {busy === "下架店铺" ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <EyeOff size={16} />
            )}
            确认下架
          </button>
        </div>
      </form>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-ink">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted">{hint}</div>
    </div>
  );
}

function Field({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "md:col-span-2" : ""}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </div>
      <div className="mt-0.5 text-sm text-ink">{value}</div>
    </div>
  );
}
