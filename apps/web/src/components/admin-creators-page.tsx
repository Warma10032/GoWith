"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ExternalLink, LoaderCircle, Play, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { AdminShell } from "./admin-shell";
import { adminFetch } from "@/lib/admin-api";
import { SafeImage } from "./safe-image";
import { CREATOR_STATUS_LABELS, lookupLabel } from "@/lib/labels";
import { useAdminRealtimeRefresh, useAdminTaskMutation } from "./admin-realtime-provider";
import { AdminDeleteDialog, type DeleteDialogTarget } from "./admin-delete-dialog";

type Creator = {
  id: string;
  bilibili_uid: string;
  name: string;
  avatar_url?: string | null;
  profile_url: string;
  follower_count?: number | null;
  status: string;
  last_synced_at?: string | null;
  updated_at: string;
  deleted_at?: string | null;
};

export function AdminCreatorsPage() {
  const { runTask } = useAdminTaskMutation();
  const [q, setQ] = useState("");
  const [uid, setUid] = useState("");
  const [deleted, setDeleted] = useState<"exclude" | "only">("exclude");
  const [creators, setCreators] = useState<Creator[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<(DeleteDialogTarget & { updated_at: string }) | null>(null);

  async function load() {
    setError(null);
    const params = new URLSearchParams({ limit: "100" });
    if (q.trim()) params.set("q", q.trim());
    params.set("deleted", deleted);
    const payload = await adminFetch<{ creators: Creator[] }>(`/api/admin/creators?${params.toString()}`);
    setCreators(payload.creators);
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "加载失败"));
  }, [deleted]);
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

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    await run("搜索", load);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await run("删除", async () => {
      await adminFetch(`/api/admin/creators/${deleteTarget.id}`, {
        method: "DELETE",
        body: JSON.stringify({
          expected_updated_at: deleteTarget.updated_at,
        }),
      });
      setDeleteTarget(null);
    });
  }

  async function handleRestore(creator: Creator) {
    await run("恢复博主", () =>
      adminFetch(`/api/admin/creators/${creator.id}/restore`, { method: "POST" }),
    );
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    await run("新增博主", async () => {
      const result = await adminFetch("/api/admin/creators", { method: "POST", body: JSON.stringify({ bilibili_uid: uid }) });
      setUid("");
      return result;
    });
  }

  return (
    <AdminShell title="博主管理" description="同步 B站博主资料与视频基础信息，进入博主页查看全部视频卡片。">
      {busy ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-[#f0c674] bg-[#fff5e1] px-3 py-2 text-sm text-[#7a4f00]">
          <LoaderCircle size={14} className="animate-spin" />
          正在执行：{busy}（其它操作按钮已禁用）
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <section className="rounded-lg border border-line bg-white p-4">
          <h2 className="font-semibold">新增博主</h2>
          <form onSubmit={handleCreate} className="mt-3 space-y-3">
            <input
              value={uid}
              onChange={(event) => setUid(event.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm"
              placeholder="输入 B站 UID"
            />
            <button className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white" disabled={!uid || !!busy}>
              {busy === "新增博主" ? <LoaderCircle size={16} className="animate-spin" /> : <Plus size={16} />}
              新增或更新
            </button>
          </form>
        </section>

        <section className="rounded-lg border border-line bg-white p-4">
          <form onSubmit={handleSearch} className="flex flex-wrap gap-2">
            <input value={q} onChange={(event) => setQ(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-sm" placeholder="搜索昵称或 UID" />
            <select
              value={deleted}
              onChange={(event) => setDeleted(event.target.value as "exclude" | "only")}
              className="rounded-lg border border-line px-3 py-2 text-sm"
              disabled={!!busy}
            >
              <option value="exclude">正常</option>
              <option value="only">回收站</option>
            </select>
            <button className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium" disabled={!!busy}>
              <Search size={16} />
              搜索
            </button>
          </form>
          {error ? <div className="mt-3 rounded-lg border border-[#f2c7bd] bg-[#fff1ee] px-3 py-2 text-sm text-[#9a341f]">{error}</div> : null}
          <div className="card-scroll-md mt-4 grid gap-3 md:grid-cols-2">
            {creators.map((creator) => (
              <article key={creator.id} className="rounded-lg border border-line p-3">
                <div className="flex gap-3">
                  {creator.avatar_url ? (
                    <SafeImage
                      src={creator.avatar_url}
                      alt=""
                      className="size-12 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="size-12 rounded-lg bg-[#f7efe8]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/creators/${creator.id}`} className="line-clamp-1 font-semibold hover:text-brand">
                      {creator.name}
                    </Link>
                    <div className="mt-1 text-xs text-muted">UID {creator.bilibili_uid} · {lookupLabel(CREATOR_STATUS_LABELS, creator.status)}</div>
                    <div className="mt-1 text-xs text-muted">粉丝 {creator.follower_count ?? "未知"} · 同步 {formatTime(creator.last_synced_at)}</div>
                    {creator.deleted_at ? <div className="mt-1 text-xs text-[#9a341f]">已删除</div> : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={`/admin/creators/${creator.id}`} className="rounded-md bg-ink px-2 py-1 text-xs font-semibold text-white">
                    查看视频
                  </Link>
                  <button
                    onClick={() => void run("同步博主", () =>
                      adminFetch(`/api/admin/creators/${creator.id}/sync`, { method: "POST" }))}
                    className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium"
                    disabled={!!busy || Boolean(creator.deleted_at)}
                  >
                    <Play size={13} />
                    同步基础视频
                  </button>
                  <a href={creator.profile_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium">
                    <ExternalLink size={13} />
                    B站
                  </a>
                  {creator.deleted_at ? (
                    <button
                      onClick={() => void handleRestore(creator)}
                      className="inline-flex items-center gap-1 rounded-md border border-[#c9dfc8] px-2 py-1 text-xs font-semibold text-[#2d6330]"
                      disabled={!!busy}
                    >
                      {busy === "恢复博主" ? <LoaderCircle size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                      恢复
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        setDeleteTarget({
                          id: creator.id,
                          title: `删除博主「${creator.name}」？`,
                          description: "删除博主会同步隐藏其未删除视频，并重新校验关联店铺来源。该操作会进入回收站，可恢复。",
                          updated_at: creator.updated_at,
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
              </article>
            ))}
          </div>
        </section>
      </div>
      <AdminDeleteDialog
        target={deleteTarget}
        busy={busy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </AdminShell>
  );
}

function formatTime(value?: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "未记录";
}
