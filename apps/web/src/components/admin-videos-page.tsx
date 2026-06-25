"use client";

import Link from "next/link";
import { useState } from "react";
import { ExternalLink, LoaderCircle, RotateCcw, Search, Trash2 } from "lucide-react";
import { AdminShell } from "./admin-shell";
import { adminFetch } from "@/lib/admin-api";
import { SafeImage } from "./safe-image";
import { ListState } from "./admin-list-state";
import { useDebouncedEffect } from "@/lib/use-debounced-effect";
import { useAdminRealtimeRefresh, useAdminTaskMutation } from "./admin-realtime-provider";
import { AdminDeleteDialog, type DeleteDialogTarget } from "./admin-delete-dialog";
import {
  VIDEO_CONTENT_TYPE_LABELS,
  VIDEO_WORKFLOW_STATUS_LABELS,
  lookupLabel,
} from "@/lib/labels";

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
  updated_at: string;
  deleted_at?: string | null;
  deletion_reason?: string | null;
};

export function AdminVideosPage() {
  const { runTask } = useAdminTaskMutation();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [deleted, setDeleted] = useState<"exclude" | "only">("exclude");
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<(DeleteDialogTarget & { updated_at: string }) | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (q.trim()) params.set("q", q.trim());
      if (status) params.set("status", status);
      params.set("deleted", deleted);
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

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await runTask(action);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(reason: string) {
    if (!deleteTarget) return;
    await run("删除", async () => {
      await adminFetch(`/api/admin/videos/${deleteTarget.id}`, {
        method: "DELETE",
        body: JSON.stringify({
          reason,
          expected_updated_at: deleteTarget.updated_at,
        }),
      });
      setDeleteTarget(null);
    });
  }

  async function handleRestore(video: VideoRow) {
    await run("恢复视频", () =>
      adminFetch(`/api/admin/videos/${video.id}/restore`, { method: "POST" }),
    );
  }

  useDebouncedEffect(load, [q, status, deleted], 350);
  useAdminRealtimeRefresh(load);

  const isFiltered = q.trim() !== "" || status !== "" || deleted !== "exclude";
  const showInitialLoading = loading && videos.length === 0;
  const showInlineLoading = loading && videos.length > 0;

  return (
    <AdminShell
      title="视频数据"
      description="跨博主检索视频，进入单个视频处理控制台。"
    >
      {busy ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-[#f0c674] bg-[#fff5e1] px-3 py-2 text-sm text-[#7a4f00]">
          <LoaderCircle size={14} className="animate-spin" />
          正在执行：{busy}（其它操作按钮已禁用）
        </div>
      ) : null}
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
            disabled={!!busy}
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
                {lookupLabel(VIDEO_WORKFLOW_STATUS_LABELS, item)}
              </option>
            ))}
          </select>
          <select
            value={deleted}
            onChange={(event) => setDeleted(event.target.value as "exclude" | "only")}
            className="rounded-lg border border-line px-3 py-2 text-sm"
            disabled={!!busy}
          >
            <option value="exclude">正常</option>
            <option value="only">回收站</option>
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
                  ? "card-scroll-md divide-y divide-line opacity-60"
                  : "card-scroll-md divide-y divide-line"
              }
            >
              {videos.map((video) => (
                <div key={video.id} className="flex gap-3 py-3">
                  {video.cover_url ? (
                    <SafeImage
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
                      {lookupLabel(VIDEO_WORKFLOW_STATUS_LABELS, video.workflow_status)} ·{" "}
                      {lookupLabel(VIDEO_CONTENT_TYPE_LABELS, video.content_type ?? null)}
                    </div>
                    {video.deleted_at ? (
                      <div className="mt-1 text-xs text-[#9a341f]">
                        已删除 · {video.deletion_reason ?? "未记录原因"}
                      </div>
                    ) : null}
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
                      {video.deleted_at ? (
                        <button
                          onClick={() => void handleRestore(video)}
                          className="inline-flex items-center gap-1 rounded-md border border-[#c9dfc8] px-2 py-1 text-xs font-semibold text-[#2d6330]"
                          disabled={!!busy}
                        >
                          {busy === "恢复视频" ? <LoaderCircle size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                          恢复
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            setDeleteTarget({
                              id: video.id,
                              title: `删除视频「${video.title}」？`,
                              description: "删除视频会重新统计关联店铺来源；证据不足的店铺会自动下架并进入复核。",
                              updated_at: video.updated_at,
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-[#f2c7bd] px-2 py-1 text-xs font-semibold text-[#9a341f]"
                          disabled={!!busy}
                        >
                          <Trash2 size={13} />
                          删除
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      <AdminDeleteDialog
        target={deleteTarget}
        busy={busy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </AdminShell>
  );
}
