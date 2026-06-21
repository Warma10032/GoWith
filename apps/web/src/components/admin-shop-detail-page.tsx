"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Send,
  ThumbsUp,
  X,
} from "lucide-react";
import { AdminShell } from "./admin-shell";
import { adminFetch } from "@/lib/admin-api";
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
  avg_price_hint: string | null;
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

function readNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === "number" ? v : null;
}

function readArray(obj: Record<string, unknown>, key: string): unknown[] {
  const v = obj[key];
  return Array.isArray(v) ? v : [];
}

export function AdminShopDetailPage({ shopId }: { shopId: string }) {
  const [data, setData] = useState<ShopResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedReviewAspect, setSelectedReviewAspect] = useState<
    string | null
  >(null);

  const load = useCallback(async () => {
    try {
      const payload = await adminFetch<ShopResponse>(
        `/api/admin/shops/${shopId}`,
      );
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }, [shopId]);

  useEffect(() => {
    void load();
  }, [load]);
  useAdminRealtimeRefresh(load);

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
  const card = (shop.card_payload ?? {}) as {
    display_title?: string;
    subtitle?: string;
    recommend_reason?: string;
    recommendation_score?: number | null;
    recommendation_score_evidence_ids?: string[];
    avg_price_hint?: string;
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
  const creatorCount = (() => {
    const stats = readArray(shop.source_stats, "creator_count");
    return typeof stats[0] === "number" ? stats[0] : null;
  })();
  const videoCount = (() => {
    const stats = readArray(shop.source_stats, "video_count");
    return typeof stats[0] === "number" ? stats[0] : null;
  })();
  const commentCount = (() => {
    const stats = readArray(shop.source_stats, "comment_signal_count");
    return typeof stats[0] === "number" ? stats[0] : null;
  })();

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

      <section className="mt-4 rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold text-ink">
          AI 识别的店铺基本信息
        </h2>
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
            label="人均"
            value={shop.avg_price_hint ?? card.avg_price_hint ?? "—"}
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
            <button
              key={aspect}
              type="button"
              onClick={() => setSelectedReviewAspect(aspect)}
              className="rounded-lg border border-line p-3 text-left transition-colors hover:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
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
              <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-brand">
                <MessageSquareText size={12} />
                查看{" "}
                {(info.evidence_ids ?? []).filter((id) =>
                  traceableCommentEvidenceIds.has(id),
                ).length}{" "}
                条原评论
              </span>
            </button>
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
        <h2 className="text-sm font-semibold text-ink">完整 JSON（开发者参考）</h2>
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
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium"
          disabled={!!busy}
        >
          <RefreshCw size={14} />
          刷新
        </button>
      </section>
    </AdminShell>
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
