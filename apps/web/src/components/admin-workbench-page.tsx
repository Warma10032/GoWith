"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  CircleAlert,
  Database,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  MapPin,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Store,
  Workflow,
} from "lucide-react";
import { AdminShell, adminFetch } from "./admin-shell";

type User = { id: string; email?: string | null; role: "user" | "admin" };
type BilibiliAuthAccount = {
  id: string;
  label: string;
  status: string;
  last_health_check_at?: string | null;
  last_success_at?: string | null;
  last_error_code?: string | null;
};
type Creator = { id: string; bilibili_uid: string; name: string; status: string; last_synced_at?: string | null };
type VideoRow = {
  id: string;
  bvid: string;
  title: string;
  source_url: string;
  workflow_status: string;
  content_type?: string | null;
  creator_name: string;
};
type CandidateRow = {
  id: string;
  candidate_name?: string | null;
  city?: string | null;
  district?: string | null;
  address_hint?: string | null;
  status: string;
  risk_flags: string[];
  video_title: string;
  video_source_url: string;
  video_bvid: string;
  creator_name: string;
};
type ShopRow = {
  id: string;
  display_name: string;
  city?: string | null;
  district?: string | null;
  status: string;
};
type PipelineRun = {
  id: string;
  run_type: string;
  entity_type: string;
  entity_id: string;
  status: string;
  created_at: string;
};

export function AdminWorkbenchPage() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("admin@gowith.local");
  const [password, setPassword] = useState("admin123456");
  const [creatorUid, setCreatorUid] = useState("");
  const [cookieLabel, setCookieLabel] = useState("main");
  const [cookieValue, setCookieValue] = useState("");
  const [creatorQuery, setCreatorQuery] = useState("");
  const [videoQuery, setVideoQuery] = useState("");
  const [candidateQuery, setCandidateQuery] = useState("");
  const [creators, setCreators] = useState<Creator[]>([]);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [accounts, setAccounts] = useState<BilibiliAuthAccount[]>([]);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const pendingRuns = useMemo(() => runs.filter((run) => ["queued", "running"].includes(run.status)).length, [runs]);

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap() {
    setLoading(true);
    try {
      const me = await adminFetch<{ user: User | null }>("/api/auth/me");
      setUser(me.user);
      if (me.user?.role === "admin") await loadData();
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadData() {
    const [creatorPayload, videoPayload, candidatePayload, shopPayload, authPayload, runPayload] = await Promise.all([
      adminFetch<{ creators: Creator[] }>(`/api/admin/creators?limit=12${creatorQuery.trim() ? `&q=${encodeURIComponent(creatorQuery.trim())}` : ""}`),
      adminFetch<{ videos: VideoRow[] }>(`/api/admin/videos?limit=12${videoQuery.trim() ? `&q=${encodeURIComponent(videoQuery.trim())}` : ""}`),
      adminFetch<{ candidates: CandidateRow[] }>("/api/admin/shop-candidates?limit=12"),
      adminFetch<{ shops: ShopRow[] }>("/api/admin/shops?limit=12"),
      adminFetch<{ accounts: BilibiliAuthAccount[] }>("/api/admin/bilibili-auth"),
      adminFetch<{ runs: PipelineRun[] }>("/api/admin/pipeline-runs?limit=8"),
    ]);
    setCreators(creatorPayload.creators);
    setVideos(videoPayload.videos);
    setCandidates(
      candidateQuery.trim()
        ? candidatePayload.candidates.filter((item) => `${item.candidate_name ?? ""}${item.city ?? ""}${item.district ?? ""}${item.video_title}`.includes(candidateQuery.trim()))
        : candidatePayload.candidates,
    );
    setShops(shopPayload.shops);
    setAccounts(authPayload.accounts);
    setRuns(runPayload.runs);
  }

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(`${label} 已提交`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run("登录", async () => {
      const payload = await adminFetch<{ user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setUser(payload.user);
    });
  }

  async function handleCreatorCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run("新增博主", async () => {
      await adminFetch("/api/admin/creators", { method: "POST", body: JSON.stringify({ bilibili_uid: creatorUid }) });
      setCreatorUid("");
    });
  }

  async function handleCookieSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run("保存 Cookie", async () => {
      await adminFetch("/api/admin/bilibili-auth", {
        method: "POST",
        body: JSON.stringify({ label: cookieLabel, cookie: cookieValue }),
      });
      setCookieValue("");
    });
  }

  async function editCandidate(candidate: CandidateRow) {
    const candidateName = window.prompt("候选店名", candidate.candidate_name ?? "");
    if (candidateName === null) return;
    const addressHint = window.prompt("地址线索", candidate.address_hint ?? "");
    if (addressHint === null) return;
    await run("更新候选", async () => {
      await adminFetch(`/api/admin/shop-candidates/${candidate.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          candidate_name: candidateName.trim() || null,
          address_hint: addressHint.trim() || null,
        }),
      });
    });
  }

  async function editShop(shop: ShopRow) {
    const displayName = window.prompt("店铺展示名", shop.display_name);
    if (displayName === null || !displayName.trim()) return;
    await run("更新店铺", async () => {
      await adminFetch(`/api/admin/shops/${shop.id}`, {
        method: "PATCH",
        body: JSON.stringify({ display_name: displayName.trim() }),
      });
    });
  }

  if (loading) {
    return (
      <section className="grid min-h-[620px] place-items-center bg-[#eef1f4]">
        <LoaderCircle className="animate-spin text-brand" />
      </section>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <section className="grid min-h-[calc(100vh-64px)] place-items-center bg-[#eef1f4] px-4">
        <form onSubmit={handleLogin} className="w-full max-w-sm rounded-lg border border-[#d7dde5] bg-white p-5 shadow-card">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6b7785]">Admin Access</div>
          <h1 className="mt-1 text-2xl font-semibold text-[#16202b]">GoWith 数据中台</h1>
          <label className="mt-5 block text-sm">
            <span className="mb-1 block font-medium">邮箱</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-md border border-[#d7dde5] px-3 py-2" />
          </label>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block font-medium">密码</span>
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" className="w-full rounded-md border border-[#d7dde5] px-3 py-2" />
          </label>
          {error ? <Notice tone="error" text={error} /> : null}
          <button className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white" disabled={!!busy}>
            {busy === "登录" ? <LoaderCircle size={16} className="animate-spin" /> : <KeyRound size={16} />}
            登录
          </button>
        </form>
      </section>
    );
  }

  return (
    <AdminShell title="数据中台" description="从这里完成数据新增、检索、审核、发布与下一步流程触发。">
      {message ? <Notice tone="success" text={message} /> : null}
      {error ? <Notice tone="error" text={error} /> : null}

      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <WorkbenchPanel title="快速新增" icon={<Plus size={17} />}>
            <form onSubmit={handleCreatorCreate} className="space-y-2">
              <input value={creatorUid} onChange={(event) => setCreatorUid(event.target.value.replace(/\D/g, ""))} inputMode="numeric" className="w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm" placeholder="B站 UID" />
              <button className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white" disabled={!creatorUid || !!busy}>
                <Plus size={15} />
                新增博主并获取资料
              </button>
            </form>
            <form onSubmit={handleCookieSave} className="mt-4 space-y-2 border-t border-[#e3e8ef] pt-4">
              <input value={cookieLabel} onChange={(event) => setCookieLabel(event.target.value)} className="w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm" placeholder="Cookie 标签" />
              <textarea value={cookieValue} onChange={(event) => setCookieValue(event.target.value)} className="min-h-24 w-full rounded-md border border-[#d7dde5] px-3 py-2 text-sm" placeholder="粘贴 B站 Cookie" />
              <button className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#17202b] px-3 py-2 text-sm font-semibold text-white" disabled={!cookieValue || !!busy}>
                <Database size={15} />
                加密保存 Cookie
              </button>
            </form>
          </WorkbenchPanel>

          <WorkbenchPanel title="任务运行" icon={<Workflow size={17} />}>
            <div className="mb-3 rounded-md border border-[#d7dde5] bg-[#f8fafc] px-3 py-2 text-sm">
              <span className="font-semibold">{pendingRuns}</span> 个运行中 / 入队任务
            </div>
            <CompactRows
              rows={runs.map((runItem) => ({
                id: runItem.id,
                title: runItem.run_type,
                meta: `${runItem.entity_type}:${runItem.entity_id.slice(0, 8)} · ${runItem.status}`,
                href: runItem.entity_type === "video" ? `/admin/videos/${runItem.entity_id}` : undefined,
              }))}
              empty="暂无处理任务"
            />
            <Link href="/admin/runs" className="mt-3 inline-flex rounded-md border border-[#d7dde5] px-2 py-1 text-xs font-medium">查看全部任务</Link>
          </WorkbenchPanel>

          <WorkbenchPanel title="Cookie 池" icon={<KeyRound size={17} />}>
            <CompactRows
              rows={accounts.slice(0, 6).map((account) => ({
                id: account.id,
                title: account.label,
                meta: `${account.status} · 最近成功 ${formatTime(account.last_success_at)}`,
              }))}
              empty="暂无 Cookie"
            />
            <button
              onClick={() => void run("检查 Cookie 池", async () => {
                await adminFetch("/api/admin/bilibili-auth/check", { method: "POST" });
              })}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-[#d7dde5] px-2 py-2 text-xs font-medium"
              disabled={!!busy}
            >
              <RefreshCw size={14} />
              检查 Cookie 池
            </button>
          </WorkbenchPanel>
        </div>

        <div className="space-y-4">
          <DataSection
            title="博主数据"
            searchValue={creatorQuery}
            onSearchChange={setCreatorQuery}
            onSearch={() => void run("搜索博主", loadData)}
            action={<Link href="/admin/creators" className="rounded-md bg-[#17202b] px-3 py-2 text-xs font-semibold text-white">进入博主管理</Link>}
          >
            <OpsTable
              columns={["名称", "UID", "状态", "动作"]}
              rows={creators.map((creator) => [
                <Link key="name" href={`/admin/creators/${creator.id}`} className="font-semibold text-[#16202b] hover:text-brand">{creator.name}</Link>,
                creator.bilibili_uid,
                creator.status,
                <div key="actions" className="flex flex-wrap gap-2">
                  <button onClick={() => void run("同步基础视频", async () => adminFetch(`/api/admin/creators/${creator.id}/sync`, { method: "POST" }))} className="op-btn" disabled={!!busy}>
                    <Play size={13} />
                    同步
                  </button>
                  <Link href={`/admin/creators/${creator.id}`} className="op-btn">查看</Link>
                </div>,
              ])}
              empty="暂无博主"
            />
          </DataSection>

          <DataSection
            title="视频处理"
            searchValue={videoQuery}
            onSearchChange={setVideoQuery}
            onSearch={() => void run("搜索视频", loadData)}
            action={<Link href="/admin/videos" className="rounded-md bg-[#17202b] px-3 py-2 text-xs font-semibold text-white">进入视频库</Link>}
          >
            <OpsTable
              columns={["标题", "博主", "状态", "动作"]}
              rows={videos.map((video) => [
                <div key="title" className="min-w-0">
                  <Link href={`/admin/videos/${video.id}`} className="line-clamp-1 font-semibold text-[#16202b] hover:text-brand">{video.title}</Link>
                  <a href={video.source_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-brand">
                    <ExternalLink size={12} />
                    {video.bvid}
                  </a>
                </div>,
                video.creator_name,
                video.workflow_status,
                <div key="actions" className="flex flex-wrap gap-2">
                  <button onClick={() => void run("开始处理", async () => adminFetch(`/api/admin/videos/${video.id}/process`, { method: "POST" }))} className="op-btn" disabled={!!busy}>
                    <Play size={13} />
                    处理
                  </button>
                  <Link href={`/admin/videos/${video.id}`} className="op-btn">控制台</Link>
                </div>,
              ])}
              empty="暂无视频"
            />
          </DataSection>

          <DataSection
            title="候选店铺审核"
            searchValue={candidateQuery}
            onSearchChange={setCandidateQuery}
            onSearch={() => void run("搜索候选", loadData)}
            action={<Link href="/admin#shops" className="rounded-md border border-[#d7dde5] px-3 py-2 text-xs font-semibold">店铺发布区</Link>}
          >
            <OpsTable
              columns={["候选", "来源", "位置", "动作"]}
              rows={candidates.map((candidate) => [
                <div key="candidate">
                  <div className="font-semibold">{candidate.candidate_name ?? "店名待确认"}</div>
                  <div className="text-xs text-[#6b7785]">{candidate.status} · {candidate.risk_flags.join(", ") || "no_risk"}</div>
                </div>,
                <a key="source" href={candidate.video_source_url} target="_blank" rel="noreferrer" className="line-clamp-1 text-brand">{candidate.creator_name} / {candidate.video_bvid}</a>,
                [candidate.city, candidate.district, candidate.address_hint].filter(Boolean).join(" · ") || "待补全",
                <div key="actions" className="flex flex-wrap gap-2">
                  <button onClick={() => void editCandidate(candidate)} className="op-btn" disabled={!!busy}>
                    编辑
                  </button>
                  <button onClick={() => void run("搜索 POI", async () => adminFetch(`/api/admin/shop-candidates/${candidate.id}/search-poi`, { method: "POST" }))} className="op-btn" disabled={!!busy}>
                    <MapPin size={13} />
                    POI
                  </button>
                  <button onClick={() => void run("驳回候选", async () => adminFetch(`/api/admin/shop-candidates/${candidate.id}/reject`, { method: "POST" }))} className="op-btn danger" disabled={!!busy}>
                    <CircleAlert size={13} />
                    驳回
                  </button>
                </div>,
              ])}
              empty="暂无候选"
            />
          </DataSection>

          <DataSection title="店铺发布" action={<Link href="/admin#shops" className="rounded-md border border-[#d7dde5] px-3 py-2 text-xs font-semibold">刷新查看</Link>}>
            <OpsTable
              columns={["店铺", "位置", "状态", "动作"]}
              rows={shops.map((shop) => [
                <span key="name" className="font-semibold">{shop.display_name}</span>,
                [shop.city, shop.district].filter(Boolean).join(" · ") || "待确认",
                shop.status,
                <div key="actions" className="flex flex-wrap gap-2">
                  <button
                    onClick={() => void run("发布店铺", async () => adminFetch(`/api/admin/shops/${shop.id}/publish`, { method: "POST" }))}
                    className="op-btn"
                    disabled={!!busy || shop.status === "published"}
                  >
                    <Send size={13} />
                    发布
                  </button>
                  <button onClick={() => void editShop(shop)} className="op-btn" disabled={!!busy}>
                    改名
                  </button>
                  <button onClick={() => void run("隐藏店铺", async () => adminFetch(`/api/admin/shops/${shop.id}`, { method: "PATCH", body: JSON.stringify({ status: "hidden" }) }))} className="op-btn danger" disabled={!!busy || shop.status === "hidden"}>
                    隐藏
                  </button>
                </div>,
              ])}
              empty="暂无正式店铺"
            />
          </DataSection>
        </div>
      </div>
    </AdminShell>
  );
}

function WorkbenchPanel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[#d7dde5] bg-white p-4 shadow-[0_12px_32px_rgba(26,34,43,0.05)]">
      <div className="mb-3 flex items-center gap-2 font-semibold text-[#16202b]">
        <span className="text-brand">{icon}</span>
        {title}
      </div>
      {children}
    </section>
  );
}

function DataSection({
  title,
  children,
  action,
  searchValue,
  onSearchChange,
  onSearch,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onSearch?: () => void;
}) {
  return (
    <section className="rounded-lg border border-[#d7dde5] bg-white shadow-[0_12px_32px_rgba(26,34,43,0.05)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e3e8ef] px-4 py-3">
        <h2 className="font-semibold text-[#16202b]">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {onSearchChange ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onSearch?.();
              }}
              className="flex gap-2"
            >
              <input value={searchValue ?? ""} onChange={(event) => onSearchChange(event.target.value)} className="w-56 rounded-md border border-[#d7dde5] px-3 py-2 text-sm" placeholder="搜索当前数据" />
              <button className="inline-flex items-center gap-1 rounded-md border border-[#d7dde5] px-3 py-2 text-xs font-semibold">
                <Search size={13} />
                查询
              </button>
            </form>
          ) : null}
          {action}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function OpsTable({ columns, rows, empty }: { columns: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <div className="rounded-md border border-dashed border-[#d7dde5] p-5 text-sm text-[#6b7785]">{empty}</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b border-[#e3e8ef] text-xs uppercase tracking-wide text-[#6b7785]">
            {columns.map((column) => (
              <th key={column} className="px-3 py-2 font-semibold">{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-[#eef2f6] last:border-0 hover:bg-[#f8fafc]">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="max-w-[320px] px-3 py-3 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompactRows({ rows, empty }: { rows: Array<{ id: string; title: string; meta: string; href?: string }>; empty: string }) {
  if (!rows.length) return <div className="rounded-md border border-dashed border-[#d7dde5] p-3 text-sm text-[#6b7785]">{empty}</div>;
  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const body = (
          <div className="rounded-md border border-[#e3e8ef] bg-[#f8fafc] px-3 py-2">
            <div className="line-clamp-1 text-sm font-semibold text-[#16202b]">{row.title}</div>
            <div className="mt-1 text-xs text-[#6b7785]">{row.meta}</div>
          </div>
        );
        return row.href ? <Link key={row.id} href={row.href}>{body}</Link> : <div key={row.id}>{body}</div>;
      })}
    </div>
  );
}

function Notice({ tone, text }: { tone: "success" | "error"; text: string }) {
  return (
    <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${tone === "success" ? "border-[#b8d6b4] bg-[#eef7ed] text-[#2d6330]" : "border-[#f2c7bd] bg-[#fff1ee] text-[#9a341f]"}`}>
      {text}
    </div>
  );
}

function formatTime(value?: string | null) {
  if (!value) return "未记录";
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
