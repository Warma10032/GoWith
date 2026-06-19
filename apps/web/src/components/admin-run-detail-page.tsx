"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
} from "lucide-react";
import { AdminShell, adminFetch } from "./admin-shell";

interface PipelineRunDetail {
  id: string;
  run_type: string;
  entity_type: string;
  entity_id: string;
  status: string;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  triggered_by?: string | null;
  summary_json?: Record<string, unknown> | null;
}

interface AiRunDetail {
  id: string;
  stage: string;
  entity_type: string;
  entity_id: string;
  status: string;
  provider: string;
  model: string;
  prompt_version: string;
  input_hash?: string | null;
  output_payload?: unknown;
  created_at: string;
  finished_at?: string | null;
}

interface RunEvent {
  id: string;
  stage?: string | null;
  event_type?: string | null;
  title?: string | null;
  message?: string | null;
  level?: string | null;
  detail_json?: Record<string, unknown> | null;
  created_at: string;
}

type RunDetail =
  | { type: "pipeline"; run: PipelineRunDetail; events: RunEvent[] }
  | { type: "ai"; run: AiRunDetail; events: RunEvent[] };

interface AdminRunDetailPageProps {
  runId: string;
}

export function AdminRunDetailPage({ runId }: AdminRunDetailPageProps) {
  const [data, setData] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminFetch<RunDetail>(`/api/admin/runs/${runId}`)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (error) {
    return (
      <AdminShell
        title="Run 详情"
        description="单个 pipeline / AI run 的运行状态与事件流。"
      >
        <div className="rounded-lg border border-[#f2c7bd] bg-[#fff7f4] px-4 py-3 text-sm text-[#9a341f]">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} />
            <p className="font-semibold">加载失败</p>
          </div>
          <p className="mt-1 leading-6">{error}</p>
          <Link
            href="/admin/runs"
            className="mt-3 inline-flex items-center gap-1 rounded-md border border-[#f2c7bd] bg-white px-2 py-1 text-xs font-semibold"
          >
            <ArrowLeft size={12} />
            返回列表
          </Link>
        </div>
      </AdminShell>
    );
  }

  if (!data) {
    return (
      <AdminShell
        title="Run 详情"
        description="单个 pipeline / AI run 的运行状态与事件流。"
      >
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-line bg-white px-4 py-6 text-sm text-muted">
          <LoaderCircle size={16} className="animate-spin text-brand" />
          正在加载 run…
        </div>
      </AdminShell>
    );
  }

  const entityLink = entityHref(data.run.entity_type, data.run.entity_id);
  const runType = data.type === "pipeline" ? data.run.run_type : data.run.stage;
  const createdAt = data.run.created_at;
  const finishedAt =
    "finished_at" in data.run ? (data.run.finished_at ?? null) : null;

  return (
    <AdminShell
      title={`${data.type === "pipeline" ? "Pipeline" : "AI"} · ${runType}`}
      description={`${data.run.entity_type} ${data.run.entity_id}`}
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-line bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Link
                href="/admin/runs"
                className="inline-flex items-center gap-1 text-xs text-muted hover:text-brand"
              >
                <ArrowLeft size={12} />
                返回列表
              </Link>
              <div className="mt-1 text-lg font-semibold text-[#16202b]">
                {runType}
              </div>
              <div className="mt-1 text-xs text-muted">
                {data.run.entity_type}:{data.run.entity_id.slice(0, 8)}
                {entityLink ? (
                  <Link
                    href={entityLink.href}
                    className="ml-2 inline-flex items-center gap-1 text-brand hover:underline"
                  >
                    {entityLink.label}
                    <ExternalLink size={11} />
                  </Link>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <RunStatusBadge status={data.run.status} />
              <span className="text-xs text-muted">
                {formatTime(createdAt)}
                {finishedAt ? ` → ${formatTime(finishedAt)}` : ""}
              </span>
            </div>
          </div>

          {data.type === "ai" ? (
            <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
              <Meta label="provider" value={data.run.provider} />
              <Meta label="model" value={data.run.model} />
              <Meta label="prompt_version" value={data.run.prompt_version} />
              {"input_hash" in data.run && data.run.input_hash ? (
                <Meta
                  label="input_hash"
                  value={data.run.input_hash.slice(0, 16)}
                />
              ) : null}
            </dl>
          ) : null}

          {data.type === "pipeline" &&
          data.run.summary_json &&
          Object.keys(data.run.summary_json).length ? (
            <details className="mt-4 rounded-md border border-line bg-[#f8fafc] p-3">
              <summary className="cursor-pointer text-xs font-semibold text-[#5f6b79]">
                summary_json
              </summary>
              <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-white p-2 text-[11px] text-[#16202b]">
                {JSON.stringify(data.run.summary_json, null, 2)}
              </pre>
            </details>
          ) : null}

          {data.type === "ai" && data.run.output_payload ? (
            <details className="mt-4 rounded-md border border-line bg-[#f8fafc] p-3">
              <summary className="cursor-pointer text-xs font-semibold text-[#5f6b79]">
                output_payload
              </summary>
              <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-white p-2 text-[11px] text-[#16202b]">
                {JSON.stringify(data.run.output_payload, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>

        <section className="rounded-lg border border-line bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              事件流（{data.events.length} 条）
            </h2>
            <span className="text-[11px] text-muted">按 created_at asc</span>
          </div>
          {data.events.length ? (
            <ol className="space-y-3">
              {data.events.map((event) => (
                <li
                  key={event.id}
                  className={`rounded-md border p-3 text-sm ${
                    event.level === "error"
                      ? "border-[#f2c7bd] bg-[#fff1ee]"
                      : event.level === "success"
                        ? "border-[#c9dfc8] bg-[#eef7ed]"
                        : "border-line bg-[#f8fafc]"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <ChevronRight size={12} className="text-muted" />
                    <span className="font-semibold">
                      {event.title ?? event.event_type ?? "事件"}
                    </span>
                    {event.stage ? (
                      <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-[#5f6b79]">
                        {event.stage}
                      </span>
                    ) : null}
                    {event.event_type ? (
                      <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-[#5f6b79]">
                        {event.event_type}
                      </span>
                    ) : null}
                    <time className="ml-auto text-[11px] text-muted">
                      {formatTime(event.created_at)}
                    </time>
                  </div>
                  {event.message ? (
                    <p className="mt-1 leading-6 text-muted">{event.message}</p>
                  ) : null}
                  {event.detail_json &&
                  Object.keys(event.detail_json).length ? (
                    <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-white p-2 text-[11px] text-muted">
                      {JSON.stringify(event.detail_json, null, 2)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <div className="rounded-md border border-dashed border-line bg-[#f8fafc] px-4 py-6 text-center text-xs text-muted">
              这个 run 还没有任何事件。
            </div>
          )}
        </section>
      </div>
    </AdminShell>
  );
}

function entityHref(
  entityType: string,
  entityId: string,
): { href: string; label: string } | null {
  if (entityType === "video") {
    return { href: `/admin/videos/${entityId}`, label: "打开视频" };
  }
  if (entityType === "creator") {
    return { href: `/admin/creators/${entityId}`, label: "打开博主" };
  }
  if (entityType === "shop" || entityType === "shop_candidate") {
    return { href: `/admin/shops/${entityId}`, label: "打开店铺" };
  }
  return null;
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-[#f8fafc] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[#7a8794]">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-xs text-[#16202b]">{value}</div>
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
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>
      {status}
    </span>
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
