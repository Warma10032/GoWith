import Link from "next/link";
import { CreatorPageClient } from "@/components/creator-page-client";
import { TopNav } from "@/components/top-nav";
import { apiFetch, type ShopCardData } from "@/lib/api";

type LatestVideo = {
  id: string;
  title: string;
  bvid: string;
  source_url: string;
  published_at: string;
};

type CreatorListItem = {
  id: string;
  bilibili_uid: string;
  name: string;
  avatar_url?: string | null;
  profile_url: string;
  bio?: string | null;
  follower_count?: number | null;
  status: string;
};

type CreatorDetailPayload = {
  creator: {
    id: string;
    bilibili_uid: string;
    name: string;
    avatar_url?: string | null;
    profile_url: string;
    bio?: string | null;
    follower_count?: number | null;
    status: string;
  };
  shops: Array<ShopCardData & { latest_video: LatestVideo }>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CreatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Cheap client-side shape check before hitting the API. The API also
  // validates (returns 400) but doing it here means we never get an
  // unfriendly 'API 500' toast for a clearly invalid URL.
  if (!UUID_RE.test(id)) {
    return (
      <main>
        <TopNav />
        <NotFound message="该 URL 的博主 ID 不是合法的 UUID" />
      </main>
    );
  }

  let detail: CreatorDetailPayload;
  let selector: { creators: CreatorListItem[] };
  try {
    [detail, selector] = await Promise.all([
      apiFetch<CreatorDetailPayload>(`/api/creators/${id}`),
      apiFetch<{ creators: CreatorListItem[] }>(`/api/creators`),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "加载失败";
    // apiFetch throws "API <status>"; surface the status. Treat 404 as
    // 'not found' specifically, other statuses as 'load failed'.
    if (message.startsWith("API 404")) {
      return (
        <main>
          <TopNav />
          <NotFound message="该博主不存在或已被删除" />
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

  return (
    <main>
      <TopNav />
      <CreatorPageClient
        initialId={id}
        initialDetail={detail}
        initialSelector={selector.creators}
      />
    </main>
  );
}

function NotFound({ message }: { message: string }) {
  return (
    <section className="mx-auto max-w-3xl px-4 py-12 text-center">
      <p className="text-2xl font-semibold text-ink">找不到这位博主</p>
      <p className="mt-2 text-sm text-muted">{message}</p>
      <Link
        href="/creators"
        className="mt-6 inline-flex items-center gap-1 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium hover:text-brand"
      >
        返回博主列表
      </Link>
    </section>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <div className="rounded-lg border border-[#f2c7bd] bg-[#fff1ee] px-4 py-3 text-sm text-[#9a341f]">
        加载失败：{message}
      </div>
    </section>
  );
}
