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

export default async function CreatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Server-side fetch: get the initial creator detail + the full selector
  // list (active creators). Both are SSR-rendered so the page has real
  // data on first paint and no loading flash for the selector.
  const [detail, selector] = await Promise.all([
    apiFetch<CreatorDetailPayload>(`/api/creators/${id}`),
    apiFetch<{ creators: CreatorListItem[] }>(`/api/creators`),
  ]);

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
