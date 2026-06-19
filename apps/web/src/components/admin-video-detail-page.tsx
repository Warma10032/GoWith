"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Bot,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  MapPin,
  Play,
  RefreshCw,
  ShieldOff,
} from "lucide-react";
import { AdminShell, adminFetch } from "./admin-shell";
import { SafeImage } from "./safe-image";
import {
  POI_MATCH_STATUS_LABELS,
  RISK_FLAG_LABELS,
  RUN_STATUS_LABELS,
  SHOP_CANDIDATE_STATUS_LABELS,
  VIDEO_CONTENT_TYPE_LABELS,
  VIDEO_WORKFLOW_STATUS_LABELS,
  lookupLabel,
  lookupLabels,
} from "@/lib/labels";

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
type VideoCandidateRow = {
  id: string;
  candidate_name?: string | null;
  status: string;
  city?: string | null;
  district?: string | null;
  risk_flags: string[];
};
type CandidatePoi = {
  id: string;
  // Kysely + pg returns `numeric` columns as strings to avoid precision
  // loss; the column is numeric(4,3) in SQL.
  match_score: string;
  match_status: "candidate" | "selected" | "rejected";
  match_features: Record<string, unknown> | null;
  poi_id: string;
  provider: string;
  provider_poi_id: string;
  name: string;
  address: string | null;
  city: string | null;
  district: string | null;
  business_area: string | null;
  category: string | null;
};
type CandidateDetail = {
  candidate: {
    id: string;
    candidate_name: string | null;
    normalized_name: string | null;
    address_hint: string | null;
    city: string | null;
    district: string | null;
    business_area: string | null;
    selected_poi_id: string | null;
    status: string;
    risk_flags: string[];
    name_confidence: number | null;
    location_confidence: number | null;
    summary_confidence: number | null;
  };
  evidence: Array<{ id: string; source: string; text_excerpt: string; start_sec?: number | null; end_sec?: number | null }>;
  poi_candidates: CandidatePoi[];
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
  candidates: VideoCandidateRow[];
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
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);
  const [candidateDetail, setCandidateDetail] = useState<CandidateDetail | null>(null);
  const [candidateError, setCandidateError] = useState<string | null>(null);

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
    if (!activeRun || !["queued", "running"].includes(activeRun.status as string)) return undefined;
    const timer = setInterval(() => {
      void loadEvents(activeRun.id).catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [activeRun?.id, activeRun?.status]);

  async function loadCandidateDetail(candidateId: string) {
    setCandidateError(null);
    try {
      const payload = await adminFetch<CandidateDetail>(`/api/admin/shop-candidates/${candidateId}`);
      setCandidateDetail(payload);
    } catch (err) {
      setCandidateError(err instanceof Error ? err.message : "加载候选详情失败");
    }
  }

  async function toggleCandidate(candidateId: string) {
    if (expandedCandidateId === candidateId) {
      setExpandedCandidateId(null);
      setCandidateDetail(null);
      return;
    }
    setExpandedCandidateId(candidateId);
    await loadCandidateDetail(candidateId);
  }

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

  async function candidateAction(candidateId: string, label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await action();
      await load();
      if (expandedCandidateId === candidateId) await loadCandidateDetail(candidateId);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} 失败`);
    } finally {
      setBusy(null);
    }
  }

  function editCandidateInline(candidateId: string, currentName: string | null, currentAddress: string | null) {
    const candidateName = window.prompt("候选店名", currentName ?? "");
    if (candidateName === null) return;
    const addressHint = window.prompt("地址线索", currentAddress ?? "");
    if (addressHint === null) return;
    void candidateAction(candidateId, "更新候选", async () => {
      await adminFetch(`/api/admin/shop-candidates/${candidateId}`, {
        method: "PATCH",
        body: JSON.stringify({
          candidate_name: candidateName.trim() || null,
          address_hint: addressHint.trim() || null,
        }),
      });
    });
  }

  const progress = useMemo(() => {
    const last = [...events].reverse().find((event) => event.progress_percent !== null && event.progress_percent !== undefined);
    return Math.max(0, Math.min(100, Number(last?.progress_percent ?? 0)));
  }, [events]);

  return (
    <AdminShell title="视频处理控制台" description="手动启动处理，查看 ASR/AI/POI 阶段的持久化事件流。">
      {busy ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-[#f0c674] bg-[#fff5e1] px-3 py-2 text-sm text-[#7a4f00]">
          <LoaderCircle size={14} className="animate-spin" />
          正在执行：{busy}（其它操作按钮已禁用）
        </div>
      ) : null}
      {!detail ? (
        <div className="grid min-h-80 place-items-center rounded-lg border border-line bg-white">
          <LoaderCircle className="animate-spin text-brand" />
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            <section className="rounded-lg border border-line bg-white p-4">
              <div className="flex flex-wrap gap-4">
                {detail.video.cover_url ? (
                  <SafeImage
                    src={detail.video.cover_url}
                    alt=""
                    className="h-32 w-56 rounded-lg object-cover"
                  />
                ) : (
                  <div className="h-32 w-56 rounded-lg bg-[#f7efe8]" />
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-semibold">{detail.video.title}</h2>
                  <p className="mt-2 text-sm text-muted">{detail.video.bvid} · {detail.video.category ?? "未知分区"} · {formatTime(detail.video.published_at)}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge>{lookupLabel(VIDEO_WORKFLOW_STATUS_LABELS, detail.video.workflow_status)}</Badge>
                    {detail.video.content_type ? <Badge>{lookupLabel(VIDEO_CONTENT_TYPE_LABELS, detail.video.content_type)}</Badge> : null}
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
                      {busy === "重跑 ASR" ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                      重跑 ASR
                    </button>
                    <button onClick={() => void run("重跑 AI", () => adminFetch<{ run_id: string }>(`/api/admin/videos/${videoId}/retry-ai`, { method: "POST" }))} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium" disabled={!!busy}>
                      {busy === "重跑 AI" ? <LoaderCircle size={16} className="animate-spin" /> : <Bot size={16} />}
                      重跑 AI
                    </button>
                    <button onClick={() => void run("标记非探店", () => adminFetch(`/api/admin/videos/${videoId}/mark-non-shop`, { method: "POST" }))} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium" disabled={!!busy}>
                      {busy === "标记非探店" ? <LoaderCircle size={16} className="animate-spin" /> : <ShieldOff size={16} />}
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
                {activeRun ? <span className="rounded-md bg-[#f7efe8] px-2 py-1 text-xs text-muted">{activeRun.run_type} · {lookupLabel(RUN_STATUS_LABELS, activeRun.status)}</span> : null}
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

            <Panel title="候选店铺（POI / 晋升 / 驳回）">
              {detail.candidates.map((candidate) => (
                <div key={candidate.id} className="rounded-lg border border-line p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{candidate.candidate_name ?? "店名待确认"}</div>
                      <div className="mt-1 text-xs text-muted">
                        {lookupLabel(SHOP_CANDIDATE_STATUS_LABELS, candidate.status)} · {[candidate.city, candidate.district].filter(Boolean).join(" ") || "位置待补充"}
                        {candidate.risk_flags.length ? ` · 风险: ${lookupLabels(RISK_FLAG_LABELS, candidate.risk_flags)}` : ""}
                      </div>
                    </div>
                    <button
                      onClick={() => void toggleCandidate(candidate.id)}
                      className="rounded-md border border-line px-2 py-1 text-xs font-medium"
                    >
                      {expandedCandidateId === candidate.id ? "收起" : "展开"}
                    </button>
                  </div>
                  {expandedCandidateId === candidate.id ? (
                    <CandidatePanel
                      candidateId={candidate.id}
                      detail={candidateDetail}
                      error={candidateError}
                      onEdit={() => editCandidateInline(candidate.id, candidateDetail?.candidate.candidate_name ?? candidate.candidate_name ?? null, candidateDetail?.candidate.address_hint ?? null)}
                      onSearchPoi={() =>
                        void candidateAction(candidate.id, "搜索 POI", async () => {
                          await adminFetch(`/api/admin/shop-candidates/${candidate.id}/search-poi`, { method: "POST" });
                        })
                      }
                      onSelectPoi={(poiId) =>
                        void candidateAction(candidate.id, "选 POI", async () => {
                          await adminFetch(`/api/admin/shop-candidates/${candidate.id}/select-poi`, {
                            method: "POST",
                            body: JSON.stringify({ poi_id: poiId }),
                          });
                        })
                      }
                      onPromote={() =>
                        void candidateAction(candidate.id, "晋升", async () => {
                          await adminFetch(`/api/admin/shop-candidates/${candidate.id}/promote`, { method: "POST" });
                        })
                      }
                      onReject={() =>
                        void candidateAction(candidate.id, "驳回", async () => {
                          await adminFetch(`/api/admin/shop-candidates/${candidate.id}/reject`, { method: "POST" });
                        })
                      }
                      busyLabel={busy}
                    />
                  ) : null}
                </div>
              ))}
              {!detail.candidates.length ? <Empty text="暂无候选店铺。点击上方「开始处理」抽取。" /> : null}
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

function CandidatePanel({
  candidateId,
  detail,
  error,
  onEdit,
  onSearchPoi,
  onSelectPoi,
  onPromote,
  onReject,
  busyLabel,
}: {
  candidateId: string;
  detail: CandidateDetail | null;
  error: string | null;
  onEdit: () => void;
  onSearchPoi: () => void;
  onSelectPoi: (poiId: string) => void;
  onPromote: () => void;
  onReject: () => void;
  busyLabel: string | null;
}) {
  if (error) {
    return <p className="mt-2 text-xs text-[#9a341f]">{error}</p>;
  }
  if (!detail || detail.candidate.id !== candidateId) {
    return <p className="mt-2 text-xs text-muted">正在加载候选详情…</p>;
  }
  const c = detail.candidate;
  const canPromote = c.status === "poi_matched" && Boolean(c.selected_poi_id);
  const isBusy = busyLabel !== null;
  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Field label="店名" value={c.candidate_name ?? "—"} />
        <Field label="标准化" value={c.normalized_name ?? "—"} />
        <Field label="地址线索" value={c.address_hint ?? "—"} />
        <Field label="城市" value={[c.city, c.district, c.business_area].filter(Boolean).join(" · ") || "—"} />
        <Field label="选中 POI" value={c.selected_poi_id ?? "未选"} />
        <Field label="置信度" value={`name ${fmtPct(c.name_confidence)} · loc ${fmtPct(c.location_confidence)} · sum ${fmtPct(c.summary_confidence)}`} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={onEdit} className="rounded-md border border-line px-2 py-1 text-xs font-medium" disabled={isBusy}>
          {busyLabel === "更新候选" ? <LoaderCircle size={12} className="mr-1 inline animate-spin" /> : null}
          编辑
        </button>
        <button onClick={onSearchPoi} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium" disabled={isBusy}>
          {busyLabel === "搜索 POI" ? <LoaderCircle size={12} className="animate-spin" /> : <MapPin size={12} />}
          搜索 POI
        </button>
        <button
          onClick={onPromote}
          className="inline-flex items-center gap-1 rounded-md bg-ink px-2 py-1 text-xs font-semibold text-white"
          disabled={isBusy || !canPromote}
          title={canPromote ? "晋升为店铺（需先在 /admin/shops 通过审核 + 发布）" : "需先选 POI 并匹配成功"}
        >
          {busyLabel === "晋升" ? <LoaderCircle size={12} className="animate-spin" /> : <ArrowUpRight size={12} />}
          晋升
        </button>
        <button onClick={onReject} className="inline-flex items-center gap-1 rounded-md border border-[#f2c7bd] px-2 py-1 text-xs font-semibold text-[#9a341f]" disabled={isBusy}>
          {busyLabel === "驳回" ? <LoaderCircle size={12} className="animate-spin" /> : <CircleAlert size={12} />}
          驳回
        </button>
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">POI 候选</div>
        {detail.poi_candidates.length === 0 ? (
          <p className="mt-1 text-xs text-muted">尚未搜索。点击「搜索 POI」调用 worker 跑 POI 匹配。</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {detail.poi_candidates.map((poi) => (
              <li key={poi.id} className="rounded-md border border-line p-2 text-xs">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <div className="font-medium">{poi.name}</div>
                    <div className="text-muted">{poi.address ?? "—"} · {poi.city ?? "?"} / {poi.district ?? "?"}</div>
                    <div className="text-muted">provider={poi.provider} · category={poi.category ?? "—"}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        poi.match_status === "selected"
                          ? "bg-[#dff5e7] text-[#1a7a3d]"
                          : poi.match_status === "rejected"
                            ? "bg-[#f1f3f6] text-[#5a6776]"
                            : "bg-[#e6efff] text-[#1a4f9a]"
                      }`}
                    >
                      {lookupLabel(POI_MATCH_STATUS_LABELS, poi.match_status)} · {Number(poi.match_score).toFixed(2)}
                    </span>
                    <button
                      onClick={() => onSelectPoi(poi.poi_id)}
                      className="rounded-md border border-line px-2 py-0.5 text-xs font-medium"
                      disabled={isBusy || poi.match_status === "selected"}
                    >
                      {busyLabel === "选 POI" ? <LoaderCircle size={12} className="mr-1 inline animate-spin" /> : null}
                      选用
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {detail.evidence.length > 0 ? (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">证据片段</div>
          <ul className="mt-1 space-y-1 text-xs text-muted">
            {detail.evidence.slice(0, 3).map((e) => (
              <li key={e.id} className="line-clamp-2">
                <span className="font-medium">[{e.source}]</span> {e.text_excerpt}
              </li>
            ))}
            {detail.evidence.length > 3 ? <li className="text-muted">…共 {detail.evidence.length} 条</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">{label}</div>
      <div className="text-xs text-ink">{value}</div>
    </div>
  );
}

function fmtPct(value: number | null): string {
  if (typeof value !== "number") return "—";
  return `${(value * 100).toFixed(0)}%`;
}
