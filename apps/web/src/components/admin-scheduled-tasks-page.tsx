"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Clock3, LoaderCircle, Play } from "lucide-react";
import { AdminShell } from "./admin-shell";
import { adminFetch } from "@/lib/admin-api";
import { ListState } from "./admin-list-state";
import {
  PIPELINE_RUN_TYPE_LABELS,
  RUN_STATUS_LABELS,
  lookupLabel,
} from "@/lib/labels";
import {
  useAdminRealtimeRefresh,
  useAdminTaskMutation,
} from "./admin-realtime-provider";

type ScheduledTask = {
  id: string;
  name: string;
  description: string;
  job_name: string;
  run_type: string;
  interval_ms: number;
  interval_label: string;
  retention_days: number | null;
  enabled: boolean;
  next_run_at: string | null;
  last_run: {
    id: string;
    status: string;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
    summary_json: Record<string, unknown>;
  } | null;
};

export function AdminScheduledTasksPage() {
  const { runTask } = useAdminTaskMutation();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const payload = await adminFetch<{ tasks: ScheduledTask[] }>(
        "/api/admin/scheduled-tasks",
      );
      setTasks(payload.tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);
  useAdminRealtimeRefresh(load, { progress: true });

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

  const showInitialLoading = loading && tasks.length === 0;

  return (
    <AdminShell
      title="定时任务"
      description="查看代码内置定时任务，支持手动触发一次；周期和启停由代码固定。"
    >
      {busy ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-[#f0c674] bg-[#fff5e1] px-3 py-2 text-sm text-[#7a4f00]">
          <LoaderCircle size={14} className="animate-spin" />
          正在执行：{busy}（其它操作按钮已禁用）
        </div>
      ) : null}
      <section className="rounded-lg border border-line bg-white p-4">
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
        ) : tasks.length === 0 ? (
          <ListState
            loading={false}
            error={null}
            isEmpty
            isFiltered={false}
            onRetry={() => void load()}
            emptyHint={{ initial: "暂无定时任务定义。", filtered: "" }}
          />
        ) : (
          <div
            className={
              loading
                ? "card-scroll-md overflow-x-auto opacity-60"
                : "card-scroll-md overflow-x-auto"
            }
          >
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">任务</th>
                  <th className="px-3 py-2">周期</th>
                  <th className="px-3 py-2">状态</th>
                  <th className="px-3 py-2">上次运行</th>
                  <th className="px-3 py-2">下次预计</th>
                  <th className="px-3 py-2">最近结果</th>
                  <th className="px-3 py-2">动作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const busyLabel = `运行 ${task.name}`;
                  return (
                    <tr key={task.id} className="border-b border-line/70">
                      <td className="px-3 py-3">
                        <div className="font-semibold text-ink">{task.name}</div>
                        <div className="mt-1 text-xs text-muted">{task.id}</div>
                        <div className="mt-1 max-w-md text-xs text-muted">
                          {task.description}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="inline-flex items-center gap-1 text-sm">
                          <Clock3 size={14} />
                          {task.interval_label}
                        </div>
                        {task.retention_days ? (
                          <div className="mt-1 text-xs text-muted">
                            保留 {task.retention_days} 天
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={
                            task.enabled
                              ? "rounded bg-[#dff5e7] px-2 py-1 text-xs font-semibold text-[#1a7a3d]"
                              : "rounded bg-[#f1f3f6] px-2 py-1 text-xs font-semibold text-muted"
                          }
                        >
                          {task.enabled ? "已启用" : "已停用"}
                        </span>
                        <div className="mt-1 text-xs text-muted">
                          {lookupLabel(PIPELINE_RUN_TYPE_LABELS, task.run_type)}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {task.last_run ? (
                          <Link
                            href={`/admin/runs/${task.last_run.id}`}
                            className="text-brand hover:underline"
                          >
                            {formatTime(task.last_run.created_at)}
                          </Link>
                        ) : (
                          <span className="text-muted">未运行</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {task.next_run_at ? formatTime(task.next_run_at) : "—"}
                      </td>
                      <td className="px-3 py-3">
                        {task.last_run ? (
                          <div>
                            <div>
                              {lookupLabel(RUN_STATUS_LABELS, task.last_run.status)}
                            </div>
                            <div className="mt-1 max-w-[220px] truncate text-xs text-muted">
                              {formatSummary(task.last_run.summary_json)}
                            </div>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <button
                          onClick={() =>
                            void run(busyLabel, () =>
                              adminFetch(`/api/admin/scheduled-tasks/${task.id}/run`, {
                                method: "POST",
                              }),
                            )
                          }
                          className="inline-flex items-center gap-2 rounded-md bg-ink px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                          disabled={!!busy || !task.enabled}
                        >
                          {busy === busyLabel ? (
                            <LoaderCircle size={14} className="animate-spin" />
                          ) : (
                            <Play size={14} />
                          )}
                          立即运行
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSummary(summary: Record<string, unknown>) {
  const keys = [
    "deleted_count",
    "protected_count",
    "jobs_deleted",
    "pipeline_runs_deleted",
    "pipeline_events_deleted",
  ];
  const parts = keys.flatMap((key) =>
    typeof summary[key] === "number" ? [`${key}=${summary[key]}`] : [],
  );
  return parts.length ? parts.join(" · ") : "等待结果";
}
