"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Bot, ExternalLink, LoaderCircle, Play, RefreshCw, ShieldOff } from "lucide-react";
import { AdminShell, adminFetch } from "./admin-shell";

type PipelineRun = { id: string; run_type: string; status: string; created_at: string; started_at?: string | null; finished_at?: string | null };
type PipelineEvent = {
  id: string;
  stage: string;
  event_type: string;
  level: "info" | "success" | "warning" | "error";
  title: string;
  message?: string | null;
  progress_percent?: number | string | null;
  detail_json?: Record<string, unknown>;
  ai_run_id?: string | null;
  created_at: string;
};
type VideoDetail = {
  video: {
    id: string;
    creator_id: string;
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
    classification_confidence?: number | string | null;
    risk_flags: string[];
  };
  assets: Array<{ id: string; source: string; language?: string | null; status: string; model_provider?: string | null; model_name?: string | null; created_at: string }>;
  segments: Array<{ id: string; text: string; start_sec?: number | null; end_sec?: number | null; confidence?: number | string | null }>;
  comments: Array<{ id: string; content: string; like_count?: number | null; sample_type: string }>;
  candidates: Array<{ id: string; candidate_name?: string | null; status: string; city?: string | null; district?: string | null; risk_flags: string[] }>;
  reviews: Array<{ id: string; title: string; status: string; reason?: string | null }>;
  ai_runs: Array<{ id: string; stage: string; provider: string; model: string; prompt_version: string; status: string; usage?: Record<string, unknown>; created_at: string; raw_output_text?: string | null }>;
  latest_run?: PipelineRun | null;
};

export function AdminVideoDetailPage({ videoId }: { videoId: string }) {
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [activeRun, setActiveRun] = useState<PipelineRun | null>(null);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const payload = await adminFetch<VideoDetail>(`/api/admin/videos/${videoId}`);
    setDetail(payload);
    setActiveRun(payload.latest_run ?? null);
    if (payload.latest_run) await loadEvents(payload.latest_run.id);
  }

  async function loadEvents(runId: string) {
    const payload = await adminFetch<{ run: PipelineRun; events: PipelineEvent[] }>(`/api/admin/pipeline-runs/${runId}/events`);
    setActiveRun(payload.run);
    setEvents(payload.events);
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "加载失败"));
  }, [videoId]);

  useEffect(() => {
    if (!activeRun || !["queued", "running"].includes(activeRun.status)) return undefined;
    const timer = setInterval(() => {
      void loadEvents(activeRun.id).catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [activeRun?.id, activeRun?.status]);

  async function run(label: string, action: () => Promise<{ run_id?: string } | void>) {
    setBusy(label);
    setError(null);
    try {
      const result = await action();
      await load();
      if (result?.run_id) await loadEvents(result.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  const progress = useMemo(() => {
    const last = [...events].reverse().find((event) => event.progress_percent !== null && event.progress_percent !== undefined);
    return Math.max(0, Math.min(100, Number(last?.progress_percent ?? 0)));
  }, [events]);

  return (
    <AdminShell title="视频处理控制台" description="手动启动处理，查看 ASR/AI/POI 阶段的持久化事件流。">
      {!detail ? (
        <div className="grid min-h-80 place-items-center rounded-lg border border-line bg-white">
          <LoaderCircle className="animate-spin text-brand" />
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            <section className="rounded-lg border border-line bg-white p-4">
              <div className="flex flex-wrap gap-4">
                {detail.video.cover_url ? <img src={detail.video.cover_url} alt="" className="w-56 rounded-lg object-cover" /> : <div className="h-32 w-56 rounded-lg bg-[#f7efe8]" />}
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-semibold">{detail.video.title}</h2>
                  <p className="mt-2 text-sm text-muted">{detail.video.bvid} · {detail.video.category ?? "未知分区"} · {formatTime(detail.video.published_at)}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge>{detail.video.workflow_status}</Badge>
                    {detail.video.content_type ? <Badge>{detail.video.content_type}</Badge> : null}
                    {detail.video.classification_confidence ? <Badge>置信度 {Number(detail.video.classification_confidence).toFixed(2)}</Badge> : null}
                  </div>
                  {detail.video.description ? <p className="mt-3 line-clamp-3 text-sm leading-6 text-ink/80">{detail.video.description}</p> : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => void run("开始处理", () => adminFetch<{ run_id: string }>("/api/admin/videos/" + videoId + "/process", { method: "POST" }))}
                      className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white"
                      disabled={!!busy}
                    >
                      {busy === "开始处理" ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} />}
                      开始处理
                    </button>
                    <button onClick={() => void run("重跑 ASR", () => adminFetch<{ run_id: string }>(`/api/admin/videos/${videoId}/retry-asr`, { method: "POST" }))} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium" disabled={!!busy}>
                      <RefreshCw size={16} />
                      重跑 ASR
                    </button>
                    <button onClick={() => void run("重跑 AI", () => adminFetch<{ run_id: string }>(`/api/admin/videos/${videoId}/retry-ai`, { method: "POST" }))} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium" disabled={!!busy}>
                      <Bot size={16} />
                      重跑 AI
                    </button>
                    <button onClick={() => void run("标记非探店", () => adminFetch(`/api/admin/videos/${videoId}/mark-non-shop`, { method: "POST" }))} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium" disabled={!!busy}>
                      <ShieldOff size={16} />
                      标记非探店
                    </button>
                    <a href={detail.video.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium">
                      <ExternalLink size={16} />
                      B站视频
                    </a>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-line bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">处理事件流</h2>
                {activeRun ? <span className="rounded-md bg-[#f7efe8] px-2 py-1 text-xs text-muted">{activeRun.run_type} · {activeRun.status}</span> : null}
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#f7efe8]">
                <div className="h-full bg-brand" style={{ width: `${progress}%` }} />
              </div>
              {error ? <div className="mt-3 rounded-lg border border-[#f2c7bd] bg-[#fff1ee] px-3 py-2 text-sm text-[#9a341f]">{error}</div> : null}
              <div className="mt-4 space-y-3">
                {events.length ? (
                  events.map((event) => (
                    <div key={event.id} className={`rounded-lg border p-3 text-sm ${event.level === "error" ? "border-[#f2c7bd] bg-[#fff1ee]" : event.level === "success" ? "border-[#c9dfc8] bg-[#eef7ed]" : "border-line bg-white"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold">{event.title}</div>
                        <div className="text-xs text-muted">{event.stage} · {event.event_type} · {formatTime(event.created_at)}</div>
                      </div>
                      {event.message ? <p className="mt-1 text-sm text-muted">{event.message}</p> : null}
                      {event.detail_json && Object.keys(event.detail_json).length ? (
                        <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-[#fbfaf8] p-2 text-xs text-muted">{JSON.stringify(event.detail_json, null, 2)}</pre>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-line p-5 text-sm text-muted">暂无处理事件。点击“开始处理”后这里会展示持久化进度。</div>
                )}
              </div>
            </section>
          </div>

          <aside className="space-y-4">
            <Panel title="文本资产">
              {detail.assets.map((asset) => (
                <div key={asset.id} className="rounded-lg border border-line p-3 text-sm">
                  <div className="font-medium">{asset.source} · {asset.status}</div>
                  <div className="mt-1 text-xs text-muted">{asset.language ?? "unknown"} · {asset.model_provider ?? "official"} {asset.model_name ?? ""}</div>
                </div>
              ))}
              {!detail.assets.length ? <Empty text="暂无字幕或 ASR 文本。" /> : null}
            </Panel>

            <Panel title="AI 运行">
              {detail.ai_runs.slice(0, 6).map((run) => (
                <div key={run.id} className="rounded-lg border border-line p-3 text-sm">
                  <div className="font-medium">{run.stage} · {run.status}</div>
                  <div className="mt-1 text-xs text-muted">{run.provider}/{run.model} · {run.prompt_version}</div>
                </div>
              ))}
              {!detail.ai_runs.length ? <Empty text="暂无 AI 运行记录。" /> : null}
            </Panel>

            <Panel title="候选店铺">
              {detail.candidates.map((candidate) => (
                <div key={candidate.id} className="rounded-lg border border-line p-3 text-sm">
                  <div className="font-medium">{candidate.candidate_name ?? "店名待确认"}</div>
                  <div className="mt-1 text-xs text-muted">{candidate.status} · {[candidate.city, candidate.district].filter(Boolean).join(" ") || "位置待补充"}</div>
                </div>
              ))}
              {!detail.candidates.length ? <Empty text="暂无候选店铺。" /> : null}
            </Panel>

            <Panel title="评论样本 / 字幕片段">
              <div className="text-sm text-muted">{detail.comments.length} 条评论样本 · {detail.segments.length} 条文本片段</div>
              <Link href={`/admin/creators/${detail.video.creator_id}`} className="mt-3 inline-block rounded-md border border-line px-2 py-1 text-xs font-medium">
                返回博主视频列表
              </Link>
            </Panel>
          </aside>
        </div>
      )}
    </AdminShell>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-md bg-[#f7efe8] px-2 py-1 text-xs text-muted">{children}</span>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-line p-3 text-sm text-muted">{text}</div>;
}

function formatTime(value?: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "未记录";
}
