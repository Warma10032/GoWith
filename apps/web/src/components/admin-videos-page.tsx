"use client";

import Link from "next/link";
import { useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { AdminShell, adminFetch } from "./admin-shell";
import { ListState } from "./admin-list-state";
import { useDebouncedEffect } from "@/lib/use-debounced-effect";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (q.trim()) params.set("q", q.trim());
      if (status) params.set("status", status);
      const payload = await adminFetch<{ videos: VideoRow[] }>(
        `/api/admin/videos?${params.toString()}`,
      );
      setVideos(payload.videos);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useDebouncedEffect(load, [q, status], 350);

  const isFiltered = q.trim() !== "" || status !== "";
  const showInitialLoading = loading && videos.length === 0;
  const showInlineLoading = loading && videos.length > 0;

  return (
    <AdminShell
      title="视频数据"
      description="跨博主检索视频，进入单个视频处理控制台。"
    >
      <section className="rounded-lg border border-line bg-white p-4">
        <div className="flex flex-wrap gap-2">
          <label className="relative min-w-64 flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm focus:border-brand focus:outline-none"
              placeholder="搜索标题或 BV 号"
            />
          </label>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded-lg border border-line px-3 py-2 text-sm"
          >
            <option value="">全部状态</option>
            {[
              "metadata_synced",
              "subtitle_ready",
              "asr_ready",
              "classified",
              "non_shop_visit",
              "ai_structured",
              "failed",
            ].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4">
          {showInitialLoading ? (
            <ListState
              loading
              error={null}
              isEmpty={false}
              isFiltered={false}
              onRetry={() => undefined}
            />
          ) : error ? (
            <ListState
              loading={false}
              error={error}
              isEmpty={false}
              isFiltered={false}
              onRetry={load}
            />
          ) : videos.length === 0 ? (
            <ListState
              loading={false}
              error={null}
              isEmpty
              isFiltered={isFiltered}
              onRetry={load}
              emptyHint={{
                initial:
                  "还没有任何视频，先在博主管理页添加种子博主并触发同步。",
                filtered: "没有匹配该关键字或状态的视频。",
              }}
            />
          ) : (
            <div
              className={
                showInlineLoading
                  ? "divide-y divide-line opacity-60"
                  : "divide-y divide-line"
              }
            >
              {videos.map((video) => (
                <div key={video.id} className="flex gap-3 py-3">
                  {video.cover_url ? (
                    <img
                      src={video.cover_url}
                      alt=""
                      className="h-20 w-32 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="h-20 w-32 rounded-lg bg-[#f7efe8]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/admin/videos/${video.id}`}
                      className="line-clamp-1 font-semibold hover:text-brand"
                    >
                      {video.title}
                    </Link>
                    <div className="mt-1 text-xs text-muted">
                      {video.creator_name} · {video.bvid} ·{" "}
                      {video.workflow_status} · {video.content_type ?? "待分类"}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Link
                        href={`/admin/videos/${video.id}`}
                        className="rounded-md bg-ink px-2 py-1 text-xs font-semibold text-white"
                      >
                        处理
                      </Link>
                      <a
                        href={video.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium"
                      >
                        <ExternalLink size={13} />
                        B站
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </AdminShell>
  );
}
