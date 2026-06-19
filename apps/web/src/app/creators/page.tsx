import { TopNav } from "@/components/top-nav";
import { CreatorListClient } from "@/components/creator-list-client";
import { apiFetch } from "@/lib/api";

interface CreatorListItem {
  id: string;
  bilibili_uid: string;
  name: string;
  avatar_url?: string | null;
  profile_url: string;
  bio?: string | null;
  follower_count?: number | null;
  status: string;
  shop_count: number;
}

export default async function CreatorsListPage() {
  const data = await apiFetch<{ creators: CreatorListItem[] }>("/api/creators");

  // 后端默认 created_at desc；前端再按粉丝数倒序排序，覆盖至 0 的 null 值。
  const creators = [...data.creators].sort((a, b) => {
    const aFollowers = a.follower_count ?? 0;
    const bFollowers = b.follower_count ?? 0;
    if (bFollowers !== aFollowers) return bFollowers - aFollowers;
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });

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

        <CreatorListClient creators={creators} />
      </section>
    </main>
  );
}
