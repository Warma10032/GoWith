"use client";

import Link from "next/link";
import { useState } from "react";
import { AdminShell, adminFetch } from "./admin-shell";
import { ListState } from "./admin-list-state";
import { useDebouncedEffect } from "@/lib/use-debounced-effect";

type PipelineRun = {
  id: string;
  run_type: string;
  entity_type: string;
  entity_id: string;
  status: string;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
};

type AiRun = {
  id: string;
  stage: string;
  entity_type: string;
  entity_id: string;
  provider: string;
  model: string;
  prompt_version: string;
  status: string;
  created_at: string;
};

const RUN_STATUS_OPTIONS = [
  "queued",
  "running",
  "success",
  "failed",
  "cancelled",
  "invalid_json",
  "schema_error",
];

export function AdminRunsPage({ mode }: { mode: "pipeline" | "ai" }) {
  const [rows, setRows] = useState<Array<PipelineRun | AiRun>>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isAi = mode === "ai";

  async function load(nextStatus = status) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (nextStatus) params.set("status", nextStatus);
      if (isAi) {
        const payload = await adminFetch<{ ai_runs: AiRun[] }>(
          `/api/admin/ai-runs?${params.toString()}`,
        );
        setRows(payload.ai_runs);
      } else {
        const payload = await adminFetch<{ runs: PipelineRun[] }>(
          `/api/admin/pipeline-runs?${params.toString()}`,
        );
        setRows(payload.runs);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useDebouncedEffect(load, [mode, status], 350);

  const title = isAi ? "AI 运行" : "处理任务";
  const isFiltered = status !== "";
  const showInitialLoading = loading && rows.length === 0;

  return (
    <AdminShell
      title={title}
      description={
        isAi
          ? "查看 AI 阶段、模型、prompt version 与状态。"
          : "查看可视化处理 run，可按状态排障。"
      }
    >
      <section className="rounded-lg border border-line bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded-lg border border-line px-3 py-2 text-sm"
          >
            <option value="">全部状态</option>
            {RUN_STATUS_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
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
        ) : rows.length === 0 ? (
          <ListState
            loading={false}
            error={null}
            isEmpty
            isFiltered={isFiltered}
            onRetry={() => void load()}
            emptyHint={{
              initial: isAi
                ? "还没有 AI 运行记录；触发一次视频处理或重跑 AI 后会出现在此。"
                : "还没有任何处理 run；从博主管理或视频处理页触发一次同步就会生成。",
              filtered: "当前筛选状态下没有记录。",
            }}
          />
        ) : (
          <div
            className={
              loading ? "overflow-x-auto opacity-60" : "overflow-x-auto"
            }
          >
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">类型</th>
                  <th className="px-3 py-2">实体</th>
                  <th className="px-3 py-2">状态</th>
                  <th className="px-3 py-2">创建时间</th>
                  <th className="px-3 py-2">动作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-line/70">
                    <td className="px-3 py-3">
                      {isAi
                        ? (row as AiRun).stage
                        : (row as PipelineRun).run_type}
                    </td>
                    <td className="px-3 py-3">
                      {row.entity_type}:{row.entity_id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-3">{row.status}</td>
                    <td className="px-3 py-3">
                      {new Date(row.created_at).toLocaleString("zh-CN")}
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={`/admin/runs/${row.id}`}
                        className="text-brand hover:underline"
                      >
                        详情
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
