"use client";

import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  CircleAlert,
  Database,
  KeyRound,
  LoaderCircle,
  Play,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
  Send,
  Store,
} from "lucide-react";
import { apiBaseUrl } from "@/lib/api";

type User = { id: string; email?: string | null; role: "user" | "admin" };
type Counts = {
  creators: number;
  videos: number;
  shop_candidates: number;
  open_reviews: number;
  published_shops: number;
  active_bilibili_cookies: number;
  expired_bilibili_cookies: number;
  risk_bilibili_cookies: number;
};
type BilibiliAuthAccount = {
  id: string;
  label: string;
  status: "active" | "expired" | "paused" | "risk" | string;
  last_health_check_at?: string | null;
  last_success_at?: string | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
  updated_at?: string | null;
};
type Creator = { id: string; bilibili_uid: string; name: string; status: string; last_synced_at?: string | null };
type VideoRow = {
  id: string;
  bvid: string;
  title: string;
  source_url: string;
  workflow_status: string;
  is_shop_visit?: boolean | null;
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
  updated_at?: string;
};

export function AdminConsole() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("admin@gowith.local");
  const [password, setPassword] = useState("admin123456");
  const [cookieLabel, setCookieLabel] = useState("main");
  const [cookieValue, setCookieValue] = useState("");
  const [creatorUid, setCreatorUid] = useState("");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [bilibiliAccounts, setBilibiliAccounts] = useState<BilibiliAuthAccount[]>([]);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = user?.role === "admin";
  const openWork = useMemo(() => (counts?.open_reviews ?? 0) + candidates.filter((item) => item.status !== "rejected").length, [counts, candidates]);

  useEffect(() => {
    void bootstrap();
  }, []);

  async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
      throw new Error(payload?.error?.message ?? payload?.error?.code ?? `Request failed: ${response.status}`);
    }
    return (await response.json()) as T;
  }

  async function bootstrap() {
    setLoading(true);
    setError(null);
    try {
      const me = await requestJson<{ user: User | null }>("/api/auth/me");
      setUser(me.user);
      if (me.user?.role === "admin") await loadAdminData();
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadAdminData() {
    const [dashboard, creatorData, videoData, candidateData, shopData] = await Promise.all([
      requestJson<{ counts: Counts }>("/api/admin/dashboard"),
      requestJson<{ creators: Creator[] }>("/api/admin/creators?limit=20"),
      requestJson<{ videos: VideoRow[] }>("/api/admin/videos?limit=20"),
      requestJson<{ candidates: CandidateRow[] }>("/api/admin/shop-candidates?limit=20"),
      requestJson<{ shops: ShopRow[] }>("/api/admin/shops?limit=20"),
    ]);
    const authData = await requestJson<{ accounts: BilibiliAuthAccount[] }>("/api/admin/bilibili-auth");
    setCounts(dashboard.counts);
    setBilibiliAccounts(authData.accounts);
    setCreators(creatorData.creators);
    setVideos(videoData.videos);
    setCandidates(candidateData.candidates);
    setShops(shopData.shops);
  }

  async function runAction(label: string, action: () => Promise<void>) {
    setBusyAction(label);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(`${label} 已提交`);
      await loadAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction("登录", async () => {
      const result = await requestJson<{ user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setUser(result.user);
      if (result.user.role !== "admin") throw new Error("当前账号不是管理员");
    });
  }

  async function handleCookieSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction("保存 B站 Cookie", async () => {
      await requestJson("/api/admin/bilibili-auth", {
        method: "POST",
        body: JSON.stringify({ label: cookieLabel, cookie: cookieValue }),
      });
      setCookieValue("");
    });
  }

  async function handleCreatorCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction("新增博主", async () => {
      await requestJson("/api/admin/creators", {
        method: "POST",
        body: JSON.stringify({ bilibili_uid: creatorUid }),
      });
    });
  }

  if (loading) {
    return (
      <section className="mx-auto grid min-h-[520px] max-w-7xl place-items-center px-4 py-10">
        <LoaderCircle className="animate-spin text-brand" />
      </section>
    );
  }

  if (!isAdmin) {
    return (
      <section className="mx-auto grid min-h-[620px] max-w-7xl place-items-center px-4 py-10">
        <form onSubmit={handleLogin} className="w-full max-w-md rounded-lg border border-line bg-white p-6 shadow-card">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg bg-ink text-white">
              <KeyRound size={18} />
            </span>
            <div>
              <h1 className="text-xl font-semibold">GoWith Admin</h1>
              <p className="text-sm text-muted">管理员登录</p>
            </div>
          </div>
          <label className="mt-6 block text-sm">
            <span className="mb-1 block font-medium">邮箱</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-lg border border-line px-3 py-2" />
          </label>
          <label className="mt-4 block text-sm">
            <span className="mb-1 block font-medium">密码</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              className="w-full rounded-lg border border-line px-3 py-2"
            />
          </label>
          {error ? <Notice tone="error" text={error} /> : null}
          <button className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white" disabled={!!busyAction}>
            {busyAction === "登录" ? <LoaderCircle size={16} className="animate-spin" /> : <Send size={16} />}
            登录
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">数据后台</h1>
          <p className="mt-1 text-sm text-muted">{user?.email} · {openWork} 个待处理项</p>
        </div>
        <button
          onClick={() => void runAction("刷新", loadAdminData)}
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium"
          disabled={!!busyAction}
        >
          <RefreshCw size={16} className={busyAction === "刷新" ? "animate-spin" : ""} />
          刷新
        </button>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-5">
        <Metric label="博主" value={counts?.creators ?? 0} />
        <Metric label="视频" value={counts?.videos ?? 0} />
        <Metric label="候选店铺" value={counts?.shop_candidates ?? 0} />
        <Metric label="审核任务" value={counts?.open_reviews ?? 0} />
        <Metric label="已发布店铺" value={counts?.published_shops ?? 0} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <Panel title="B站登录态" icon={<KeyRound size={17} />}>
            <div className="mb-3 grid grid-cols-3 gap-2 text-xs">
              <StatusPill label="可用" value={counts?.active_bilibili_cookies ?? 0} tone="success" />
              <StatusPill label="失效" value={counts?.expired_bilibili_cookies ?? 0} tone="error" />
              <StatusPill label="风控" value={counts?.risk_bilibili_cookies ?? 0} tone="warning" />
            </div>
            {(counts?.active_bilibili_cookies ?? 0) === 0 ? (
              <Notice tone="error" text="当前没有可用 B站 Cookie，真实视频同步会失败。" />
            ) : (counts?.expired_bilibili_cookies ?? 0) + (counts?.risk_bilibili_cookies ?? 0) > 0 ? (
              <Notice tone="error" text="Cookie 池中存在失效或风控账号，系统会自动跳过并定时清理。" />
            ) : null}
            <form onSubmit={handleCookieSave} className="space-y-3">
              <input value={cookieLabel} onChange={(event) => setCookieLabel(event.target.value)} className="w-full rounded-lg border border-line px-3 py-2 text-sm" placeholder="账号标签" />
              <textarea
                value={cookieValue}
                onChange={(event) => setCookieValue(event.target.value)}
                className="min-h-24 w-full resize-y rounded-lg border border-line px-3 py-2 text-sm"
                placeholder="SESSDATA=...; bili_jct=..."
              />
              <button className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-white" disabled={!cookieValue || !!busyAction}>
                <Database size={16} />
                加密保存
              </button>
            </form>
            <button
              onClick={() => void runAction("检查 Cookie 池", async () => {
                await requestJson("/api/admin/bilibili-auth/check", { method: "POST" });
              })}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium"
              disabled={!!busyAction}
            >
              <RefreshCw size={16} className={busyAction === "检查 Cookie 池" ? "animate-spin" : ""} />
              检查 Cookie 池
            </button>
            <div className="mt-4 space-y-2">
              {bilibiliAccounts.length ? (
                bilibiliAccounts.map((account) => (
                  <div key={account.id} className="rounded-lg border border-line p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{account.label}</span>
                      <span className={`rounded-md px-2 py-1 ${account.status === "active" ? "bg-[#eef7ed] text-[#2d6330]" : account.status === "risk" ? "bg-[#fff6df] text-[#8a5b00]" : "bg-[#fff1ee] text-[#9a341f]"}`}>
                        {account.status}
                      </span>
                    </div>
                    <div className="mt-2 text-muted">
                      最近成功：{formatTime(account.last_success_at)} · 检查：{formatTime(account.last_health_check_at)}
                    </div>
                    {account.last_error_code ? <div className="mt-1 text-[#9a341f]">{account.last_error_code}</div> : null}
                  </div>
                ))
              ) : (
                <p className="rounded-lg border border-dashed border-line p-3 text-xs text-muted">暂无 Cookie，保存后会进入池。</p>
              )}
            </div>
          </Panel>

          <Panel title="博主管理" icon={<Plus size={17} />}>
            <form onSubmit={handleCreatorCreate} className="space-y-3">
              <input
                value={creatorUid}
                onChange={(event) => setCreatorUid(event.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                pattern="[0-9]*"
                className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                placeholder="输入 B站 UID"
              />
              <p className="rounded-lg bg-[#f7efe8] px-3 py-2 text-xs leading-5 text-muted">
                昵称、头像和简介会在同步时从 B站资料自动更新。
              </p>
              <button className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white" disabled={!creatorUid || !!busyAction}>
                <Plus size={16} />
                新增或更新
              </button>
            </form>
            <div className="mt-4 space-y-2">
              {creators.map((creator) => (
                <div key={creator.id} className="flex items-center justify-between gap-2 rounded-lg border border-line p-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{creator.name}</div>
                    <div className="text-xs text-muted">UID {creator.bilibili_uid}</div>
                  </div>
                  <button
                    onClick={() => void runAction("同步博主", async () => {
                      await requestJson(`/api/admin/creators/${creator.id}/sync`, { method: "POST" });
                    })}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium"
                    disabled={!!busyAction}
                  >
                    <Play size={13} />
                    同步
                  </button>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          {message ? <Notice tone="success" text={message} /> : null}
          {error ? <Notice tone="error" text={error} /> : null}
          <Panel title="视频任务" icon={<Play size={17} />}>
            <DataTable
              columns={["标题", "博主", "状态", "分类"]}
              rows={videos.map((video) => [
                <div key="title" className="min-w-0">
                  <span className="line-clamp-1">{video.title}</span>
                  <a
                    href={video.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex max-w-full items-center gap-1 text-xs font-medium text-brand"
                  >
                    <ExternalLink size={12} />
                    <span className="truncate">{video.bvid}</span>
                  </a>
                </div>,
                video.creator_name,
                video.workflow_status,
                video.content_type ?? (video.is_shop_visit ? "shop_visit" : "待分类"),
              ])}
              empty="暂无视频任务"
            />
          </Panel>

          <Panel title="候选店铺审核" icon={<Search size={17} />}>
            <DataTable
              columns={["候选", "来源", "位置", "动作"]}
              rows={candidates.map((candidate) => [
                <div key="candidate" className="min-w-0">
                  <div className="font-medium">{candidate.candidate_name ?? "店名待确认"}</div>
                  <div className="mt-1 text-xs text-muted">{candidate.status} · {candidate.risk_flags.join(", ") || "no_risk"}</div>
                </div>,
                <div key="source" className="min-w-0">
                  <span className="line-clamp-1">{candidate.creator_name} / {candidate.video_title}</span>
                  <a
                    href={candidate.video_source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex max-w-full items-center gap-1 text-xs font-medium text-brand"
                  >
                    <ExternalLink size={12} />
                    <span className="truncate">{candidate.video_bvid}</span>
                  </a>
                </div>,
                [candidate.city, candidate.district, candidate.address_hint].filter(Boolean).join(" · ") || "待补全",
                <div key="actions" className="flex flex-wrap gap-2">
                  <button
                    onClick={() => void runAction("搜索 POI", async () => {
                      await requestJson(`/api/admin/shop-candidates/${candidate.id}/search-poi`, { method: "POST" });
                    })}
                    className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium"
                    disabled={!!busyAction}
                  >
                    <Search size={13} />
                    POI
                  </button>
                  <button
                    onClick={() => void runAction("驳回候选", async () => {
                      await requestJson(`/api/admin/shop-candidates/${candidate.id}/reject`, { method: "POST" });
                    })}
                    className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium"
                    disabled={!!busyAction}
                  >
                    <CircleAlert size={13} />
                    驳回
                  </button>
                </div>,
              ])}
              empty="暂无候选店铺"
            />
          </Panel>

          <Panel title="已入库店铺" icon={<Store size={17} />}>
            <DataTable
              columns={["店铺", "位置", "状态", "动作"]}
              rows={shops.map((shop) => [
                shop.display_name,
                [shop.city, shop.district].filter(Boolean).join(" · ") || "待确认",
                shop.status,
                <button
                  key="publish"
                  onClick={() => void runAction("发布店铺", async () => {
                    await requestJson(`/api/admin/shops/${shop.id}/publish`, { method: "POST" });
                  })}
                  className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium"
                  disabled={!!busyAction || shop.status === "published"}
                >
                  <Send size={13} />
                  发布
                </button>,
              ])}
              empty="暂无正式店铺"
            />
          </Panel>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-sm text-muted">{label}</div>
    </div>
  );
}

function StatusPill({ label, value, tone }: { label: string; value: number; tone: "success" | "warning" | "error" }) {
  const toneClass =
    tone === "success"
      ? "border-[#c9dfc8] bg-[#eef7ed] text-[#2d6330]"
      : tone === "warning"
        ? "border-[#f0d89a] bg-[#fff6df] text-[#8a5b00]"
        : "border-[#f2c7bd] bg-[#fff1ee] text-[#9a341f]";
  return (
    <div className={`rounded-lg border px-2 py-2 ${toneClass}`}>
      <div className="text-lg font-semibold">{value}</div>
      <div>{label}</div>
    </div>
  );
}

function formatTime(value?: string | null) {
  if (!value) return "未记录";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-white p-4 shadow-card">
      <div className="mb-4 flex items-center gap-2 font-semibold">
        <span className="text-brand">{icon}</span>
        {title}
      </div>
      {children}
    </section>
  );
}

function Notice({ tone, text }: { tone: "success" | "error"; text: string }) {
  return (
    <div className={`mt-4 rounded-lg border px-3 py-2 text-sm ${tone === "success" ? "border-[#c9dfc8] bg-[#eef7ed] text-[#2d6330]" : "border-[#f2c7bd] bg-[#fff1ee] text-[#9a341f]"}`}>
      {text}
    </div>
  );
}

function DataTable({ columns, rows, empty }: { columns: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <div className="rounded-lg border border-dashed border-line p-5 text-sm text-muted">{empty}</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            {columns.map((column) => (
              <th key={column} className="px-3 py-2 font-medium">{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-line/70 last:border-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="max-w-[280px] px-3 py-3 align-top">
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
