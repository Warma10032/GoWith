"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import {
  Activity,
  Bot,
  Database,
  ExternalLink,
  Film,
  KeyRound,
  LoaderCircle,
  Store,
  UserRound,
  Workflow,
} from "lucide-react";
import { adminFetch } from "@/lib/admin-api";
import { RUN_STATUS_LABELS, lookupLabel } from "@/lib/labels";
import { useAdminRealtime, useAdminRealtimeRefresh } from "./admin-realtime-provider";

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

type RecentRun = {
  id: string;
  run_type: string;
  entity_type: string;
  entity_id: string;
  status: string;
  created_at: string;
};

const navItems = [
  { href: "/admin", label: "数据总览", icon: Database },
  { href: "/admin/creators", label: "博主", icon: UserRound },
  { href: "/admin/videos", label: "视频", icon: Film },
  { href: "/admin/shops", label: "店铺", icon: Store },
  { href: "/admin/runs", label: "处理任务", icon: Workflow },
  { href: "/admin/ai-runs", label: "AI 运行", icon: Bot },
];

interface AdminShellProps {
  title: string;
  description?: string;
  children: ReactNode;
  /**
   * 在 metrics 卡片下方追加「最近活动 run」列表，仅 dashboard 页用得到。
   */
  showActivity?: boolean;
}

export function AdminShell({
  title,
  description,
  children,
  showActivity = false,
}: AdminShellProps) {
  const pathname = usePathname();
  const { activeRuns, connectionState, lastResult } = useAdminRealtime();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [recentRuns, setRecentRuns] = useState<RecentRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadDashboard() {
    adminFetch<{ counts: Counts; recent_runs?: RecentRun[] }>(
      "/api/admin/dashboard",
    )
      .then((payload) => {
        setCounts(payload.counts);
        setRecentRuns(payload.recent_runs ?? null);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "后台未登录或接口不可用"),
      );
  }

  useEffect(() => {
    void loadDashboard();
  }, []);
  useAdminRealtimeRefresh(loadDashboard);

  const openWork =
    (counts?.open_reviews ?? 0) +
    (counts?.risk_bilibili_cookies ?? 0) +
    (counts?.expired_bilibili_cookies ?? 0);

  return (
    <section className="min-h-[calc(100vh-64px)] bg-[#eef1f4]">
      <div className="mx-auto grid max-w-[1520px] gap-4 px-4 py-4 lg:grid-cols-[248px_1fr]">
        <aside className="sticky top-4 h-[calc(100vh-96px)] overflow-hidden rounded-lg border border-[#202834] bg-[#111820] text-white shadow-card">
          <Link
            href="/admin"
            className="block border-b border-white/10 px-4 py-4"
          >
            <div className="text-sm font-semibold tracking-wide">
              GoWith Ops
            </div>
            <div className="mt-1 text-xs text-white/55">B站探店数据中台</div>
          </Link>
          <nav className="space-y-1 p-3">
            {navItems.map((item) => {
              const Icon = item.icon;
              const hrefPath = item.href.split("#")[0] ?? item.href;
              const active =
                hrefPath === "/admin"
                  ? pathname === "/admin"
                  : pathname.startsWith(hrefPath);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${active ? "bg-brand text-white shadow-[inset_3px_0_0_rgba(255,255,255,.65)]" : "text-white/72 hover:bg-white/10 hover:text-white"}`}
                >
                  <Icon size={16} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="absolute bottom-0 left-0 right-0 border-t border-white/10 bg-[#0d131a] p-3">
            <div className="flex items-center gap-2 text-xs text-white/60">
              <Activity size={14} />
              {counts ? `${openWork} 个待处理信号` : "正在读取任务状态"}
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <div className="rounded-lg border border-[#d7dde5] bg-white p-4 shadow-[0_12px_32px_rgba(26,34,43,0.06)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6b7785]">
                  Control Plane
                </div>
                <h1 className="mt-1 text-2xl font-semibold text-[#16202b]">
                  {title}
                </h1>
                {description ? (
                  <p className="mt-1 text-sm text-[#66717f]">{description}</p>
                ) : null}
              </div>
              {!counts && !error ? (
                <LoaderCircle className="animate-spin text-brand" size={18} />
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className={`size-2 rounded-full ${connectionState === "connected" ? "bg-[#16855b]" : connectionState === "fallback" ? "bg-[#d7901e]" : "bg-[#7a8794]"}`} />
              <span className="text-[#66717f]">
                {connectionState === "connected" ? "实时更新已连接" : connectionState === "fallback" ? "实时连接中断，正在轮询同步" : "正在连接实时更新"}
              </span>
              {activeRuns.size ? <span className="font-medium text-brand">{activeRuns.size} 个任务运行中</span> : null}
              {lastResult?.status ? <span className={lastResult.status === "success" ? "text-[#16855b]" : "text-[#b4482b]"}>最近任务：{lookupLabel(RUN_STATUS_LABELS, lastResult.status)}</span> : null}
            </div>
            {counts ? (
              <>
                <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
                  <Metric
                    label="博主"
                    value={counts.creators}
                    hint="creators"
                  />
                  <Metric label="视频" value={counts.videos} hint="videos" />
                  <Metric
                    label="候选"
                    value={counts.shop_candidates}
                    hint="candidates"
                  />
                  <Metric
                    label="审核"
                    value={counts.open_reviews}
                    hint="open tasks"
                    tone={counts.open_reviews ? "warn" : "normal"}
                  />
                  <Metric
                    label="店铺"
                    value={counts.published_shops}
                    hint="published"
                  />
                  <Metric
                    label="Cookie"
                    value={counts.active_bilibili_cookies}
                    hint={`${counts.expired_bilibili_cookies + counts.risk_bilibili_cookies} 异常`}
                    tone={
                      counts.expired_bilibili_cookies +
                      counts.risk_bilibili_cookies
                        ? "warn"
                        : "normal"
                    }
                  />
                </div>
                {showActivity ? <RecentActivity runs={recentRuns} /> : null}
              </>
            ) : error ? (
              <div className="mt-4 rounded-lg border border-[#f2c7bd] bg-[#fff1ee] px-3 py-2 text-sm text-[#9a341f]">
                {error}
              </div>
            ) : null}
          </div>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
  tone = "normal",
}: {
  label: string;
  value: number;
  hint: string;
  tone?: "normal" | "warn";
}) {
  return (
    <div
      className={`rounded-md border px-3 py-2 ${
        tone === "warn"
          ? "border-[#f0d28a] bg-[#fff8df]"
          : "border-[#dfe5ec] bg-[#f8fafc]"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-lg font-semibold tabular-nums text-[#16202b]">
          {value}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-[#7a8794]">
          {hint}
        </div>
      </div>
      <div className="text-xs font-medium text-[#5f6b79]">{label}</div>
    </div>
  );
}

function RecentActivity({ runs }: { runs: RecentRun[] | null }) {
  if (runs === null) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-md border border-dashed border-[#dfe5ec] bg-[#f8fafc] px-3 py-2 text-xs text-[#7a8794]">
        <LoaderCircle size={12} className="animate-spin" />
        正在读取最近活动…
      </div>
    );
  }
  if (!runs.length) {
    return (
      <div className="mt-3 rounded-md border border-dashed border-[#dfe5ec] bg-[#f8fafc] px-3 py-2 text-xs text-[#7a8794]">
        还没有任何 run 活动。等博主/视频同步、AI 管线、POI
        匹配触发后，会出现在此。
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-md border border-[#dfe5ec] bg-[#f8fafc] p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#5f6b79]">
          <Activity size={12} />
          最近活动（最近 5 条 run）
        </div>
        <Link
          href="/admin/runs"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
        >
          全部
          <ExternalLink size={11} />
        </Link>
      </div>
      <ul className="divide-y divide-[#dfe5ec]">
        {runs.map((run) => (
          <li key={run.id}>
            <Link
              href={`/admin/runs/${run.id}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs text-[#16202b] hover:bg-white"
            >
              <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-[#5f6b79]">
                {run.run_type}
              </span>
              <span className="text-[#7a8794]">
                {run.entity_type}:{run.entity_id.slice(0, 8)}
              </span>
              <RunStatusBadge status={run.status} />
              <time className="ml-auto text-[11px] text-[#7a8794]">
                {new Date(run.created_at).toLocaleString("zh-CN", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  const tone =
    status === "success"
      ? "bg-[#dff5e7] text-[#1a7a3d]"
      : status === "failed" ||
          status === "invalid_json" ||
          status === "schema_error"
        ? "bg-[#fff1ee] text-[#9a341f]"
        : status === "running" || status === "queued"
          ? "bg-[#e6efff] text-[#1a4f9a]"
          : "bg-[#f1f3f6] text-[#5a6776]";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}>
      {lookupLabel(RUN_STATUS_LABELS, status)}
    </span>
  );
}
