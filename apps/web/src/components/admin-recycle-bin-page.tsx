"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoaderCircle, RotateCcw, Search, Trash2 } from "lucide-react";
import { AdminShell } from "./admin-shell";
import { adminFetch } from "@/lib/admin-api";
import { ListState } from "./admin-list-state";
import { SafeImage } from "./safe-image";
import { useAdminRealtimeRefresh, useAdminTaskMutation } from "./admin-realtime-provider";
import {
  CREATOR_STATUS_LABELS,
  SHOP_STATUS_LABELS,
  VIDEO_WORKFLOW_STATUS_LABELS,
  lookupLabel,
} from "@/lib/labels";

type Kind = "creators" | "videos" | "shops";

type CreatorRow = {
  id: string;
  bilibili_uid: string;
  name: string;
  avatar_url?: string | null;
  profile_url: string;
  status: string;
  deleted_at?: string | null;
};

type VideoRow = {
  id: string;
  bvid: string;
  title: string;
  cover_url?: string | null;
  source_url: string;
  workflow_status: string;
  creator_name: string;
  deleted_at?: string | null;
};

type ShopRow = {
  id: string;
  display_name: string;
  city: string | null;
  district: string | null;
  business_area: string | null;
  status: string;
  deleted_at?: string | null;
};

export function AdminRecycleBinPage() {
  const { runTask } = useAdminTaskMutation();
  const [kind, setKind] = useState<Kind>("creators");
  const [q, setQ] = useState("");
  const [creators, setCreators] = useState<CreatorRow[]>([]);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "100", deleted: "only" });
      const [creatorPayload, videoPayload, shopPayload] = await Promise.all([
        adminFetch<{ creators: CreatorRow[] }>(`/api/admin/creators?${params.toString()}`),
        adminFetch<{ videos: VideoRow[] }>(`/api/admin/videos?${params.toString()}`),
        adminFetch<{ shops: ShopRow[] }>(`/api/admin/shops?${params.toString()}`),
      ]);
      setCreators(creatorPayload.creators);
      setVideos(videoPayload.videos);
      setShops(shopPayload.shops);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);
  useAdminRealtimeRefresh(load);

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

  const filteredCreators = filterRows(creators, q);
  const filteredVideos = filterRows(videos, q);
  const filteredShops = filterRows(shops, q);
  const visibleCount =
    kind === "creators"
      ? filteredCreators.length
      : kind === "videos"
        ? filteredVideos.length
        : filteredShops.length;
  const showInitialLoading = loading && creators.length + videos.length + shops.length === 0;

  return (
    <AdminShell
      title="回收站"
      description="集中查看已软删除的博主、视频和店铺，并按需恢复。恢复不会自动重新发布内容。"
    >
      {busy ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-[#f0c674] bg-[#fff5e1] px-3 py-2 text-sm text-[#7a4f00]">
          <LoaderCircle size={14} className="animate-spin" />
          正在执行：{busy}（其它操作按钮已禁用）
        </div>
      ) : null}
      <section className="rounded-lg border border-line bg-white p-4">
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-lg border border-line p-1">
            <Tab active={kind === "creators"} onClick={() => setKind("creators")}>
              博主 {creators.length}
            </Tab>
            <Tab active={kind === "videos"} onClick={() => setKind("videos")}>
              视频 {videos.length}
            </Tab>
            <Tab active={kind === "shops"} onClick={() => setKind("shops")}>
              店铺 {shops.length}
            </Tab>
          </div>
          <label className="relative min-w-64 flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm focus:border-brand focus:outline-none"
              placeholder="搜索回收站内容"
            />
          </label>
        </div>

        <div className="mt-4">
          {error ? (
            <ListState
              loading={false}
              error={error}
              isEmpty={false}
              isFiltered={false}
              onRetry={() => void load()}
            />
          ) : showInitialLoading ? (
            <ListState
              loading
              error={null}
              isEmpty={false}
              isFiltered={false}
              onRetry={() => undefined}
            />
          ) : visibleCount === 0 ? (
            <ListState
              loading={false}
              error={null}
              isEmpty
              isFiltered={q.trim() !== ""}
              onRetry={() => void load()}
              emptyHint={{
                initial: "当前分类下没有已删除内容。",
                filtered: "没有匹配该关键词的已删除内容。",
              }}
            />
          ) : (
            <div className={loading ? "card-scroll-md divide-y divide-line opacity-60" : "card-scroll-md divide-y divide-line"}>
              {kind === "creators"
                ? filteredCreators.map((creator) => (
                    <CreatorRecycleRow
                      key={creator.id}
                      creator={creator}
                      busy={busy}
                      onRestore={() =>
                        run("恢复博主", () =>
                          adminFetch(`/api/admin/creators/${creator.id}/restore`, { method: "POST" }),
                        )
                      }
                    />
                  ))
                : kind === "videos"
                  ? filteredVideos.map((video) => (
                      <VideoRecycleRow
                        key={video.id}
                        video={video}
                        busy={busy}
                        onRestore={() =>
                          run("恢复视频", () =>
                            adminFetch(`/api/admin/videos/${video.id}/restore`, { method: "POST" }),
                          )
                        }
                      />
                    ))
                  : filteredShops.map((shop) => (
                      <ShopRecycleRow
                        key={shop.id}
                        shop={shop}
                        busy={busy}
                        onRestore={() =>
                          run("恢复店铺", () =>
                            adminFetch(`/api/admin/shops/${shop.id}/restore`, { method: "POST" }),
                          )
                        }
                      />
                    ))}
            </div>
          )}
        </div>
      </section>
    </AdminShell>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? "rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-white"
          : "rounded-md px-3 py-1.5 text-sm font-medium text-muted hover:text-ink"
      }
    >
      {children}
    </button>
  );
}

function CreatorRecycleRow({
  creator,
  busy,
  onRestore,
}: {
  creator: CreatorRow;
  busy: string | null;
  onRestore: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      {creator.avatar_url ? (
        <SafeImage src={creator.avatar_url} alt="" className="size-12 rounded-lg object-cover" />
      ) : (
        <div className="size-12 rounded-lg bg-[#f7efe8]" />
      )}
      <div className="min-w-0 flex-1">
        <Link href={`/admin/creators/${creator.id}`} className="line-clamp-1 font-semibold hover:text-brand">
          {creator.name}
        </Link>
        <div className="mt-1 text-xs text-muted">
          UID {creator.bilibili_uid} · {lookupLabel(CREATOR_STATUS_LABELS, creator.status)} · 删除于 {formatTime(creator.deleted_at)}
        </div>
      </div>
      <RestoreButton label="恢复博主" busy={busy} onClick={onRestore} />
    </div>
  );
}

function VideoRecycleRow({
  video,
  busy,
  onRestore,
}: {
  video: VideoRow;
  busy: string | null;
  onRestore: () => void;
}) {
  return (
    <div className="flex gap-3 py-3">
      {video.cover_url ? (
        <SafeImage src={video.cover_url} alt="" className="h-20 w-32 rounded-lg object-cover" />
      ) : (
        <div className="h-20 w-32 rounded-lg bg-[#f7efe8]" />
      )}
      <div className="min-w-0 flex-1">
        <Link href={`/admin/videos/${video.id}`} className="line-clamp-1 font-semibold hover:text-brand">
          {video.title}
        </Link>
        <div className="mt-1 text-xs text-muted">
          {video.creator_name} · {video.bvid} · {lookupLabel(VIDEO_WORKFLOW_STATUS_LABELS, video.workflow_status)}
        </div>
        <div className="mt-1 text-xs text-muted">删除于 {formatTime(video.deleted_at)}</div>
      </div>
      <RestoreButton label="恢复视频" busy={busy} onClick={onRestore} />
    </div>
  );
}

function ShopRecycleRow({
  shop,
  busy,
  onRestore,
}: {
  shop: ShopRow;
  busy: string | null;
  onRestore: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="grid size-12 shrink-0 place-items-center rounded-lg bg-[#fff1ee] text-[#9a341f]">
        <Trash2 size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <Link href={`/admin/shops/${shop.id}`} className="line-clamp-1 font-semibold hover:text-brand">
          {shop.display_name}
        </Link>
        <div className="mt-1 text-xs text-muted">
          {[shop.city, shop.district, shop.business_area].filter(Boolean).join(" · ") || "位置待确认"} · {lookupLabel(SHOP_STATUS_LABELS, shop.status)}
        </div>
        <div className="mt-1 text-xs text-muted">删除于 {formatTime(shop.deleted_at)}</div>
      </div>
      <RestoreButton label="恢复店铺" busy={busy} onClick={onRestore} />
    </div>
  );
}

function RestoreButton({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: string | null;
  onClick: () => void;
}) {
  return (
    <button
      onClick={() => void onClick()}
      className="inline-flex items-center gap-2 rounded-md border border-[#c9dfc8] px-3 py-2 text-sm font-semibold text-[#2d6330] disabled:opacity-60"
      disabled={!!busy}
    >
      {busy === label ? <LoaderCircle size={14} className="animate-spin" /> : <RotateCcw size={14} />}
      恢复
    </button>
  );
}

function filterRows<T extends { name?: string; title?: string; display_name?: string; bilibili_uid?: string; bvid?: string }>(
  rows: T[],
  query: string,
) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return rows;
  return rows.filter((row) =>
    [row.name, row.title, row.display_name, row.bilibili_uid, row.bvid]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword)),
  );
}

function formatTime(value?: string | null) {
  return value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "未知";
}
