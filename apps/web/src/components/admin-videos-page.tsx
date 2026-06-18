"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { AdminShell, adminFetch } from "./admin-shell";

type VideoRow = {
  id: string;
  bvid: string;
  title: string;
  cover_url?: string | null;
  source_url: string;
  workflow_status: string;
  content_type?: string | null;
  published_at?: string | null;
  creator_name: string;
};

export function AdminVideosPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const params = new URLSearchParams({ limit: "100" });
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    const payload = await adminFetch<{ videos: VideoRow[] }>(`/api/admin/videos?${params.toString()}`);
    setVideos(payload.videos);
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "加载失败"));
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void load().catch((err) => setError(err instanceof Error ? err.message : "搜索失败"));
  }

  return (
    <AdminShell title="视频数据" description="跨博主检索视频，进入单个视频处理控制台。">
      <section className="rounded-lg border border-line bg-white p-4">
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-2">
          <input value={q} onChange={(event) => setQ(event.target.value)} className="min-w-64 flex-1 rounded-lg border border-line px-3 py-2 text-sm" placeholder="搜索标题或 BV 号" />
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-line px-3 py-2 text-sm">
            <option value="">全部状态</option>
            {["metadata_synced", "subtitle_ready", "asr_ready", "classified", "non_shop_visit", "ai_structured", "failed"].map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <button className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium">
            <Search size={16} />
            搜索
          </button>
        </form>
        {error ? <div className="mt-3 rounded-lg border border-[#f2c7bd] bg-[#fff1ee] px-3 py-2 text-sm text-[#9a341f]">{error}</div> : null}
        <div className="mt-4 divide-y divide-line">
          {videos.map((video) => (
            <div key={video.id} className="flex gap-3 py-3">
              {video.cover_url ? <img src={video.cover_url} alt="" className="h-20 w-32 rounded-lg object-cover" /> : <div className="h-20 w-32 rounded-lg bg-[#f7efe8]" />}
              <div className="min-w-0 flex-1">
                <Link href={`/admin/videos/${video.id}`} className="line-clamp-1 font-semibold hover:text-brand">{video.title}</Link>
                <div className="mt-1 text-xs text-muted">{video.creator_name} · {video.bvid} · {video.workflow_status} · {video.content_type ?? "待分类"}</div>
                <div className="mt-2 flex gap-2">
                  <Link href={`/admin/videos/${video.id}`} className="rounded-md bg-ink px-2 py-1 text-xs font-semibold text-white">处理</Link>
                  <a href={video.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium">
                    <ExternalLink size={13} />
                    B站
                  </a>
                </div>
              </div>
            </div>
          ))}
          {!videos.length ? <div className="rounded-lg border border-dashed border-line p-5 text-sm text-muted">暂无视频。</div> : null}
        </div>
      </section>
    </AdminShell>
  );
}
