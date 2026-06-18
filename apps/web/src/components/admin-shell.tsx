"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { Activity, Bot, Database, Film, KeyRound, LoaderCircle, Store, UserRound, Workflow } from "lucide-react";
import { apiBaseUrl } from "@/lib/api";

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

const navItems = [
  { href: "/admin", label: "数据总览", icon: Database },
  { href: "/admin/creators", label: "博主", icon: UserRound },
  { href: "/admin/videos", label: "视频", icon: Film },
  { href: "/admin/shops", label: "店铺", icon: Store },
  { href: "/admin/runs", label: "处理任务", icon: Workflow },
  { href: "/admin/ai-runs", label: "AI 运行", icon: Bot },
  { href: "/admin#cookies", label: "Cookie 池", icon: KeyRound },
];

export async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
    throw new Error(payload?.error?.message ?? payload?.error?.code ?? `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function AdminShell({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const pathname = usePathname();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminFetch<{ counts: Counts }>("/api/admin/dashboard")
      .then((payload) => setCounts(payload.counts))
      .catch((err) => setError(err instanceof Error ? err.message : "后台未登录或接口不可用"));
  }, []);

  const openWork = (counts?.open_reviews ?? 0) + (counts?.risk_bilibili_cookies ?? 0) + (counts?.expired_bilibili_cookies ?? 0);

  return (
    <section className="min-h-[calc(100vh-64px)] bg-[#eef1f4]">
      <div className="mx-auto grid max-w-[1520px] gap-4 px-4 py-4 lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-4 h-[calc(100vh-96px)] overflow-hidden rounded-lg border border-[#202834] bg-[#111820] text-white shadow-card">
        <Link href="/admin" className="block border-b border-white/10 px-4 py-4">
          <div className="text-sm font-semibold tracking-wide">GoWith Ops</div>
          <div className="mt-1 text-xs text-white/55">B站探店数据中台</div>
        </Link>
        <nav className="space-y-1 p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const hrefPath = item.href.split("#")[0] ?? item.href;
            const active = hrefPath === "/admin" ? pathname === "/admin" : pathname.startsWith(hrefPath);
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
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6b7785]">Control Plane</div>
              <h1 className="mt-1 text-2xl font-semibold text-[#16202b]">{title}</h1>
              {description ? <p className="mt-1 text-sm text-[#66717f]">{description}</p> : null}
            </div>
            {!counts && !error ? <LoaderCircle className="animate-spin text-brand" size={18} /> : null}
          </div>
          {counts ? (
            <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
              <Metric label="博主" value={counts.creators} hint="creators" />
              <Metric label="视频" value={counts.videos} hint="videos" />
              <Metric label="候选" value={counts.shop_candidates} hint="candidates" />
              <Metric label="审核" value={counts.open_reviews} hint="open tasks" tone={counts.open_reviews ? "warn" : "normal"} />
              <Metric label="店铺" value={counts.published_shops} hint="published" />
              <Metric label="Cookie" value={counts.active_bilibili_cookies} hint={`${counts.expired_bilibili_cookies + counts.risk_bilibili_cookies} 异常`} tone={counts.expired_bilibili_cookies + counts.risk_bilibili_cookies ? "warn" : "normal"} />
            </div>
          ) : error ? (
            <div className="mt-4 rounded-lg border border-[#f2c7bd] bg-[#fff1ee] px-3 py-2 text-sm text-[#9a341f]">{error}</div>
          ) : null}
        </div>
        <div className="mt-4">{children}</div>
      </div>
      </div>
    </section>
  );
}

function Metric({ label, value, hint, tone = "normal" }: { label: string; value: number; hint: string; tone?: "normal" | "warn" }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${tone === "warn" ? "border-[#f0d28a] bg-[#fff8df]" : "border-[#dfe5ec] bg-[#f8fafc]"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-lg font-semibold tabular-nums text-[#16202b]">{value}</div>
        <div className="text-[10px] uppercase tracking-wide text-[#7a8794]">{hint}</div>
      </div>
      <div className="text-xs font-medium text-[#5f6b79]">{label}</div>
    </div>
  );
}
