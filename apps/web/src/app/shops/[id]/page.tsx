import Link from "next/link";
import {
  AlertTriangle,
  ExternalLink,
  MapPin,
  RotateCcw,
  Star,
  MessageSquareText,
  ShieldAlert,
  Utensils,
} from "lucide-react";
import { TopNav } from "@/components/top-nav";
import { ExternalPlatformLink } from "@/components/external-platform-link";
import {
  apiFetch,
  formatRecommendationScore,
  type ShopCardData,
} from "@/lib/api";

interface ShopMention {
  video_id: string;
  title: string;
  source_url: string;
  bvid: string;
  cover_url: string | null;
  creator_name: string;
}

interface ShopEvidence {
  id: string;
  source: string;
  text_excerpt: string;
  start_sec?: number | null;
  end_sec?: number | null;
  confidence?: number | null;
}

interface ShopDetailPayload {
  shop: ShopCardData;
  mentions: ShopMention[];
  evidence_count: number;
  evidence: ShopEvidence[];
}

type ReviewDimension = {
  sentiment?: string;
  summary?: string;
  confidence?: number | string;
};

const REVIEW_LABELS: Record<string, string> = {
  taste: "口味",
  dish_recommendation: "菜品推荐",
  value_for_money: "性价比",
  service: "服务",
  environment: "环境",
  queue: "排队",
};
const INLINE_EVIDENCE_ID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function cleanReviewText(value: string) {
  return value
    .replace(INLINE_EVIDENCE_ID_RE, "")
    .replace(/（[、，,\s]*）/g, "")
    .replace(/([、，,]\s*){2,}/g, "、")
    .trim();
}

function reviewData(value: unknown) {
  const aggregated =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const dimensions = Object.entries(aggregated).flatMap(([key, item]) => {
    if (
      ["comment_summary", "comment_signals"].includes(key) ||
      typeof item !== "object" ||
      item === null
    ) {
      return [];
    }
    const dimension = item as ReviewDimension;
    const confidence = Number(dimension.confidence ?? 0);
    return dimension.summary &&
      confidence > 0.4 &&
      !dimension.summary.includes("无明确评价")
      ? [[key, dimension] as const]
      : [];
  });
  const summary =
    typeof aggregated.comment_summary === "object" &&
    aggregated.comment_summary !== null
      ? (aggregated.comment_summary as Record<string, unknown>)
      : {};
  const points = [
    "positive_points",
    "negative_points",
    "controversial_points",
    "recent_status_points",
  ].flatMap((key) =>
    Array.isArray(summary[key]) ? (summary[key] as string[]) : [],
  );
  return { dimensions, points };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ShopPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return (
      <main>
        <TopNav />
        <NotFound message="该 URL 的店铺 ID 不是合法的 UUID" />
      </main>
    );
  }

  let data: ShopDetailPayload;
  try {
    data = await apiFetch<ShopDetailPayload>(`/api/shops/${id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "加载失败";
    if (message.startsWith("API 404")) {
      return (
        <main>
          <TopNav />
          <NotFound message="该店铺不存在或还未通过审核发布" />
        </main>
      );
    }
    return (
      <main>
        <TopNav />
        <ErrorPanel message={message} />
      </main>
    );
  }

  const card = data.shop.card_payload ?? {};
  const recommendationScore = card.recommendation_score;
  const location = [data.shop.city, data.shop.district, data.shop.address]
    .filter(Boolean)
    .join(" · ");
  const category = [data.shop.category_primary, data.shop.category_secondary]
    .filter(Boolean)
    .join(" · ");
  const recommendedDishes = (card.recommended_dishes ?? []).filter((dish) =>
    Boolean(dish.name),
  );
  const avoidPoints = (card.avoid_points ?? []).filter((point) =>
    Boolean(point.text),
  );
  const review = reviewData(data.shop.aggregated_review);
  const poiBusiness = data.shop.poi_business;
  const dianpingLink = data.shop.external_links?.find(
    (link) => link.platform === "dianping",
  );

  return (
    <main>
      <TopNav />
      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-6 lg:grid-cols-[1fr_360px]">
        <article className="rounded-lg border border-line bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-3xl font-semibold">
                {data.shop.display_name}
              </h1>
              <p className="mt-2 text-muted">
                {card.subtitle ?? "审核通过后展示完整店铺摘要。"}
              </p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-md bg-[#f7efe8] px-2 py-1 text-xs font-medium text-brand">
              <Star size={13} />
              AI 评分 {formatRecommendationScore(recommendationScore)}
            </span>
          </div>
          <div className="mt-5 rounded-lg bg-[#f7efe8] p-4">
            <p className="leading-7">
              {card.recommend_reason ?? "暂无推荐摘要。"}
            </p>
          </div>
          {recommendedDishes.length ? (
            <section className="mt-6">
              <div className="flex items-center gap-2 font-semibold">
                <Utensils size={18} className="text-brand" />
                推荐菜
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {recommendedDishes.map((dish, index) => (
                  <div
                    key={`${dish.name}-${index}`}
                    className="rounded-xl border border-[#eed7c8] bg-[#fffaf6] p-5"
                  >
                    <div className="text-lg font-semibold text-ink">
                      {dish.name}
                    </div>
                    {dish.reason ? (
                      <p className="mt-2 text-sm leading-6 text-muted">
                        {dish.reason}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {avoidPoints.length ? (
            <section className="mt-6">
              <div className="flex items-center gap-2 font-semibold text-[#9a341f]">
                <ShieldAlert size={18} />
                避雷点
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {avoidPoints.map((point, index) => (
                  <div
                    key={`${point.text}-${index}`}
                    className="rounded-xl border border-[#f2c7bd] bg-[#fff7f4] p-4"
                  >
                    <div className="font-medium text-[#7f2f1d]">
                      {point.text}
                    </div>
                    {point.reason ? (
                      <p className="mt-2 text-sm leading-6 text-[#9a5a4a]">
                        {point.reason}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Info title="位置" icon={MapPin} value={location || "待确认"} />
            <Info title="品类" value={category || "暂无"} />
            <Info title="证据条数" value={`${data.evidence_count} 条`} />
            <Info
              title="高德评分"
              value={
                poiBusiness?.rating !== null &&
                poiBusiness?.rating !== undefined
                  ? String(poiBusiness.rating)
                  : "暂无"
              }
            />
            <Info
              title="高德人均"
              value={
                poiBusiness?.avg_cost !== null &&
                poiBusiness?.avg_cost !== undefined
                  ? `¥${Math.round(poiBusiness.avg_cost)}`
                  : "暂无"
              }
            />
            <Info title="电话" value={poiBusiness?.phone ?? "暂无"} />
            <Info
              title="营业时间"
              value={poiBusiness?.business_hours ?? "暂无"}
            />
          </div>
          {poiBusiness?.tags.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {poiBusiness.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-[#f7efe8] px-2 py-1 text-xs text-brand"
                >
                  高德 · {tag}
                </span>
              ))}
            </div>
          ) : null}
          {poiBusiness?.photos.length ? (
            <section className="mt-6 border-t border-line pt-5">
              <h2 className="font-semibold">高德店铺图片</h2>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {poiBusiness.photos.slice(0, 6).map((photo) => (
                  <a
                    key={photo.url}
                    href={photo.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      src={photo.url}
                      alt={photo.title ?? `${data.shop.display_name} 店铺图片`}
                      className="aspect-[4/3] w-full rounded-lg border border-line object-cover"
                    />
                  </a>
                ))}
              </div>
            </section>
          ) : null}
          <section className="mt-6 border-t border-line pt-5">
            <div className="flex items-center gap-2 font-semibold">
              <MessageSquareText size={17} />
              评论分析
            </div>
            {review.dimensions.length || review.points.length ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {review.dimensions.map(([key, dimension]) => (
                  <div key={key} className="rounded-lg border border-line p-3">
                    <div className="text-xs font-semibold text-muted">
                      {REVIEW_LABELS[key] ?? key}
                    </div>
                    <p className="mt-1 text-sm leading-6">
                      {cleanReviewText(dimension.summary ?? "")}
                    </p>
                  </div>
                ))}
                {review.points.length ? (
                  <ul className="rounded-lg border border-line p-3 pl-8 text-sm leading-6 sm:col-span-2">
                    {review.points.map((point) => (
                      <li key={point} className="list-disc">
                        {cleanReviewText(point)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">暂无有效评论结论。</p>
            )}
          </section>
        </article>

        <aside className="space-y-5">
          {dianpingLink ? (
            <section className="rounded-lg border border-line bg-white p-5">
              <h2 className="font-semibold">更多店铺信息</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                前往大众点评查看平台门店页；点评信息不参与 GoWith 的 AI 评分。
              </p>
              <ExternalPlatformLink
                href={dianpingLink.url}
                linkId={dianpingLink.id}
                shopId={data.shop.id}
                surface="shop_detail"
                className="mt-3 inline-flex items-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white"
              >
                <ExternalLink size={14} />
                去大众点评查看
              </ExternalPlatformLink>
            </section>
          ) : null}
          <section className="rounded-lg border border-line bg-white p-5">
            <h2 className="font-semibold">来源视频</h2>
            <div className="mt-3 space-y-3">
              {data.mentions.length ? (
                data.mentions.map((mention) => (
                  <a
                    key={mention.video_id ?? mention.source_url}
                    href={mention.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-lg border border-line p-3 text-sm hover:border-brand"
                  >
                    <span className="font-medium">{mention.title}</span>
                    <span className="mt-1 flex items-center gap-1 text-muted">
                      {[mention.creator_name, mention.bvid]
                        .filter(Boolean)
                        .join(" · ")}
                      <ExternalLink size={13} />
                    </span>
                  </a>
                ))
              ) : (
                <p className="text-sm text-muted">发布后会显示 B站来源视频。</p>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-5">
            <h2 className="font-semibold">证据片段</h2>
            <div className="mt-3 space-y-2 text-sm text-muted">
              {data.evidence.length ? (
                data.evidence.map((evidence, index) => (
                  <p
                    key={evidence.id ?? `${evidence.source}-${index}`}
                    className="rounded-lg border border-line p-3"
                  >
                    <span className="mr-2 rounded bg-[#f7efe8] px-1.5 py-0.5 text-xs font-medium text-brand">
                      {evidence.source}
                    </span>
                    {evidence.text_excerpt}
                  </p>
                ))
              ) : (
                <p>暂无可展示证据，后台审核后补齐。</p>
              )}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

function Info({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value?: string | null;
  icon?: typeof MapPin;
}) {
  return (
    <div className="rounded-lg border border-line p-4">
      <div className="flex items-center gap-1 text-sm text-muted">
        {Icon ? <Icon size={13} /> : null}
        {title}
      </div>
      <div className="mt-1 font-medium">{value || "待确认"}</div>
    </div>
  );
}

function NotFound({ message }: { message: string }) {
  return (
    <section className="mx-auto max-w-3xl px-4 py-12 text-center">
      <p className="text-2xl font-semibold text-ink">找不到这家店铺</p>
      <p className="mt-2 text-sm text-muted">{message}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium hover:text-brand"
        >
          返回推荐流
        </Link>
        <Link
          href="/map"
          className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium hover:text-brand"
        >
          打开地图
        </Link>
      </div>
    </section>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <div className="rounded-lg border border-[#f2c7bd] bg-[#fff1ee] px-4 py-4 text-sm text-[#9a341f]">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">店铺详情加载失败</p>
            <p className="mt-1 leading-6">错误：{message}</p>
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1 rounded-md border border-[#f2c7bd] bg-white px-3 py-1.5 text-xs font-medium text-[#9a341f]"
            >
              <RotateCcw size={13} />
              重新加载（请刷新页面）
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
