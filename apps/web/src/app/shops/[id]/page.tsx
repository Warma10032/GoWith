import { TopNav } from "@/components/top-nav";
import { apiFetch, fallbackShop, type ShopCardData } from "@/lib/api";
import { ExternalLink, ShieldCheck } from "lucide-react";

export default async function ShopPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await apiFetch<{ shop: ShopCardData; mentions?: Array<{ title: string; source_url: string; bvid?: string; creator_name: string }>; evidence?: Array<{ source: string; text_excerpt: string }> }>(
    `/api/shops/${id}`,
    undefined,
    { shop: fallbackShop, mentions: [], evidence: [] },
  );
  const card = data.shop.card_payload ?? {};

  return (
    <main>
      <TopNav />
      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-6 lg:grid-cols-[1fr_360px]">
        <article className="rounded-lg border border-line bg-white p-6">
          <h1 className="text-3xl font-semibold">{data.shop.display_name}</h1>
          <p className="mt-2 text-muted">{card.subtitle ?? "审核通过后展示完整店铺摘要。"}</p>
          <div className="mt-5 rounded-lg bg-[#f7efe8] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-brand">
              <ShieldCheck size={16} />
              AI 总结，仅供参考
            </div>
            <p className="mt-2 leading-7">{card.recommend_reason ?? "暂无推荐摘要。"}</p>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Info title="位置" value={data.shop.address ?? [data.shop.city, data.shop.district].filter(Boolean).join(" · ")} />
            <Info title="人均" value={card.avg_price_hint ?? "待确认"} />
            <Info title="推荐标签" value={(card.tags ?? []).join(" / ") || "待生成"} />
            <Info title="证据链" value={`${data.evidence?.length ?? 0} 条证据`} />
          </div>
        </article>
        <aside className="rounded-lg border border-line bg-white p-5">
          <h2 className="font-semibold">来源视频</h2>
          <div className="mt-3 space-y-3">
            {(data.mentions ?? []).length ? (
              data.mentions?.map((mention) => (
                <a key={mention.source_url} href={mention.source_url} target="_blank" rel="noreferrer" className="block rounded-lg border border-line p-3 text-sm hover:border-brand">
                  <span className="font-medium">{mention.title}</span>
                  <span className="mt-1 flex items-center gap-1 text-muted">
                    {[mention.creator_name, mention.bvid].filter(Boolean).join(" · ")}
                    <ExternalLink size={13} />
                  </span>
                </a>
              ))
            ) : (
              <p className="text-sm text-muted">发布后会显示 B站来源视频。</p>
            )}
          </div>
          <h2 className="mt-6 font-semibold">证据片段</h2>
          <div className="mt-3 space-y-2 text-sm text-muted">
            {(data.evidence ?? []).length ? (
              data.evidence?.map((ev, index) => (
                <p key={`${ev.source}-${index}`} className="rounded-lg border border-line p-3">
                  [{ev.source}] {ev.text_excerpt}
                </p>
              ))
            ) : (
              <p>暂无可展示证据，后台审核后补齐。</p>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}

function Info({ title, value }: { title: string; value?: string | null }) {
  return (
    <div className="rounded-lg border border-line p-4">
      <div className="text-sm text-muted">{title}</div>
      <div className="mt-1 font-medium">{value || "待确认"}</div>
    </div>
  );
}
