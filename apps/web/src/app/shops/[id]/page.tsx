import Link from "next/link";
import {
  AlertTriangle,
  ExternalLink,
  MapPin,
  RotateCcw,
  ShieldCheck,
  Star,
} from "lucide-react";
import { TopNav } from "@/components/top-nav";
import { apiFetch, formatConfidence, type ShopCardData } from "@/lib/api";

interface ShopMention {
  video_id: string;
  title: string;
  source_url: string;
  bvid: string;
  cover_url: string | null;
  creator_name: string;
}

interface ShopEvidence {
  source: string;
  text_excerpt: string;
  start_sec?: number | null;
  end_sec?: number | null;
  confidence?: number | null;
}

interface ShopDetailPayload {
  shop: ShopCardData;
  mentions: ShopMention[];
  evidence: ShopEvidence[];
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
  const confidence = data.shop.quality?.shop_confidence;
  const location = [data.shop.city, data.shop.district, data.shop.address]
    .filter(Boolean)
    .join(" · ");

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
              置信度 {formatConfidence(confidence)}
            </span>
          </div>
          <div className="mt-5 rounded-lg bg-[#f7efe8] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-brand">
              <ShieldCheck size={16} />
              AI 总结，仅供参考
            </div>
            <p className="mt-2 leading-7">
              {card.recommend_reason ?? "暂无推荐摘要。"}
            </p>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Info title="位置" icon={MapPin} value={location || "待确认"} />
            <Info title="人均" value={card.avg_price_hint ?? "待确认"} />
            <Info
              title="推荐标签"
              value={(card.tags ?? []).join(" / ") || "待生成"}
            />
            <Info title="证据条数" value={`${data.evidence.length} 条`} />
          </div>
        </article>

        <aside className="space-y-5">
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
                    key={`${evidence.source}-${index}`}
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
