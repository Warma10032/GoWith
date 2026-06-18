import Link from "next/link";
import { TopNav } from "@/components/top-nav";
import { apiFetch } from "@/lib/api";

type Creator = {
  id: string;
  bilibili_uid: string;
  name: string;
  avatar_url?: string | null;
  profile_url: string;
  bio?: string | null;
  follower_count?: number | null;
  status: string;
};

type CreatorListPayload = { creators: Creator[] };

export default async function CreatorsListPage() {
  // Server-side fetch. /api/creators filters by status='active' and
  // returns the seed set; falls back to an empty list if the API
  // is unreachable so the page never 500s.
  let creators: Creator[] = [];
  try {
    const data = await apiFetch<CreatorListPayload>("/api/creators");
    creators = data.creators;
  } catch {
    creators = [];
  }

  return (
    <main>
      <TopNav />
      <section className="mx-auto max-w-7xl px-4 py-6">
        <header className="rounded-lg border border-line bg-white p-6">
          <h1 className="text-2xl font-semibold">探店博主</h1>
          <p className="mt-2 text-sm text-muted">
            所有已激活的 B 站探店博主。点击进入查看博主的探店地图与店铺卡片。
          </p>
        </header>

        {creators.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">
            暂无可展示的博主。管理后台可以新增博主并触发同步。
          </div>
        ) : (
          <ul className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {creators.map((creator) => (
              <li key={creator.id}>
                <Link
                  href={`/creators/${creator.id}`}
                  className="flex gap-3 rounded-lg border border-line bg-white p-4 transition hover:border-brand hover:shadow-card"
                >
                  {creator.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={creator.avatar_url}
                      alt=""
                      className="size-16 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="grid size-16 shrink-0 place-items-center rounded-lg bg-[#f7efe8] text-xl font-semibold text-muted">
                      {creator.name.slice(0, 1)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <h2 className="line-clamp-1 font-semibold">{creator.name}</h2>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          creator.status === "active"
                            ? "bg-[#dff5e7] text-[#1a7a3d]"
                            : "bg-[#f1f3f6] text-[#5a6776]"
                        }`}
                      >
                        {creator.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">UID {creator.bilibili_uid}</p>
                    <p className="mt-1 text-xs text-muted">
                      粉丝 {creator.follower_count?.toLocaleString() ?? "—"}
                    </p>
                    {creator.bio ? (
                      <p className="mt-2 line-clamp-2 text-xs text-ink/80">{creator.bio}</p>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
