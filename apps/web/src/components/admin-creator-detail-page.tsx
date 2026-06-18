"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink, LoaderCircle, Play, Search } from "lucide-react";
import { AdminShell, adminFetch } from "./admin-shell";

type CreatorDetail = {
  creator: {
    id: string;
    bilibili_uid: string;
    name: string;
    avatar_url?: string | null;
    profile_url: string;
    bio?: string | null;
    follower_count?: number | null;
    status: string;
    last_synced_at?: string | null;
  };
  stats: { videos: number; classified: number };
  latest_run?: { id: string; status: string; run_type: string; created_at: string } | null;
};

type Video = {
  id: string;
  bvid: string;
  title: string;
  description?: string | null;
  cover_url?: string | null;
  source_url: string;
  duration_sec?: number | null;
  published_at?: string | null;
  tags: string[];
  category?: string | null;
  workflow_status: string;
  content_type?: string | null;
};

export function AdminCreatorDetailPage({ creatorId }: { creatorId: string }) {
  const [detail, setDetail] = useState<CreatorDetail | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(query = q) {
    const params = new URLSearchParams({ limit: "100" });
    if (query.trim()) params.set("q", query.trim());
    const [detailPayload, videosPayload] = await Promise.all([
      adminFetch<CreatorDetail>(`/api/admin/creators/${creatorId}`),
      adminFetch<{ videos: Video[] }>(`/api/admin/creators/${creatorId}/videos?${params.toString()}`),
    ]);
    setDetail(detailPayload);
    setVideos(videosPayload.videos);
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "加载失败"));
  }, [creatorId]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  const title = detail?.creator.name ?? "博主详情";
  return (
    <AdminShell title={title} description="查看该博主的全部已同步视频，并进入单个视频的数据处理控制台。">
      {!detail ? (
        <div className="grid min-h-80 place-items-center rounded-lg border border-line bg-white">
          <LoaderCircle className="animate-spin text-brand" />
        </div>
      ) : (
        <div className="space-y-4">
          <section className="rounded-lg border border-line bg-white p-4">
            <div className="flex flex-wrap items-start gap-4">
              {detail.creator.avatar_url ? <img src={detail.creator.avatar_url} alt="" className="size-16 rounded-lg object-cover" /> : <div className="size-16 rounded-lg bg-[#f7efe8]" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold">{detail.creator.name}</h2>
                  <span className="rounded-md bg-[#eef7ed] px-2 py-1 text-xs text-[#2d6330]">{detail.creator.status}</span>
                </div>
                <p className="mt-1 text-sm text-muted">UID {detail.creator.bilibili_uid} · 粉丝 {detail.creator.follower_count ?? "未知"} · 最近同步 {formatTime(detail.creator.last_synced_at)}</p>
                {detail.creator.bio ? <p className="mt-2 line-clamp-2 text-sm text-ink/80">{detail.creator.bio}</p> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => void run("同步博主", async () => {
                      await adminFetch(`/api/admin/creators/${creatorId}/sync`, { method: "POST" });
                    })}
                    className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white"
                    disabled={!!busy}
                  >
                    {busy === "同步博主" ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} />}
                    同步基础视频
                  </button>
                  <a href={detail.creator.profile_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium">
                    <ExternalLink size={16} />
                    B站主页
                  </a>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Stat label="视频" value={detail.stats.videos} />
                <Stat label="已分类" value={detail.stats.classified} />
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-4">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run("搜索视频", () => load(q));
              }}
              className="mb-4 flex gap-2"
            >
              <input value={q} onChange={(event) => setQ(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-sm" placeholder="搜索标题或 BV 号" />
              <button className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium" disabled={!!busy}>
                <Search size={16} />
                搜索
              </button>
            </form>
            {error ? <div className="mb-3 rounded-lg border border-[#f2c7bd] bg-[#fff1ee] px-3 py-2 text-sm text-[#9a341f]">{error}</div> : null}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {videos.map((video) => (
                <article key={video.id} className="overflow-hidden rounded-lg border border-line bg-white">
                  {video.cover_url ? <img src={video.cover_url} alt="" className="aspect-video w-full object-cover" /> : <div className="aspect-video bg-[#f7efe8]" />}
                  <div className="p-3">
                    <Link href={`/admin/videos/${video.id}`} className="line-clamp-2 min-h-10 font-semibold hover:text-brand">
                      {video.title}
                    </Link>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge>{video.workflow_status}</Badge>
                      {video.content_type ? <Badge>{video.content_type}</Badge> : null}
                      {video.category ? <Badge>{video.category}</Badge> : null}
                    </div>
                    <div className="mt-2 text-xs text-muted">
                      {video.bvid} · {formatDuration(video.duration_sec)} · {formatTime(video.published_at)}
                    </div>
                    {video.tags?.length ? <div className="mt-2 line-clamp-1 text-xs text-muted">{video.tags.slice(0, 6).join(" / ")}</div> : null}
                    <div className="mt-3 flex gap-2">
                      <Link href={`/admin/videos/${video.id}`} className="rounded-md bg-ink px-2 py-1 text-xs font-semibold text-white">
                        处理
                      </Link>
                      <a href={video.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium">
                        <ExternalLink size={13} />
                        B站
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </AdminShell>
  );
}

function Badge({ children }: { children: string }) {
  return <span className="rounded-md bg-[#f7efe8] px-2 py-1 text-xs text-muted">{children}</span>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line px-4 py-3 text-center">
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function formatTime(value?: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "未记录";
}

function formatDuration(value?: number | null) {
  if (!value) return "未知时长";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
