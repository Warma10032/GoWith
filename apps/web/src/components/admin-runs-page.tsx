"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminShell, adminFetch } from "./admin-shell";

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

export function AdminRunsPage({ mode }: { mode: "pipeline" | "ai" }) {
  const [rows, setRows] = useState<Array<PipelineRun | AiRun>>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isAi = mode === "ai";

  async function load(nextStatus = status) {
    const params = new URLSearchParams({ limit: "100" });
    if (nextStatus) params.set("status", nextStatus);
    if (isAi) {
      const payload = await adminFetch<{ ai_runs: AiRun[] }>(`/api/admin/ai-runs?${params.toString()}`);
      setRows(payload.ai_runs);
    } else {
      const payload = await adminFetch<{ runs: PipelineRun[] }>(`/api/admin/pipeline-runs?${params.toString()}`);
      setRows(payload.runs);
    }
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "加载失败"));
  }, [mode]);

  const title = isAi ? "AI 运行" : "处理任务";
  return (
    <AdminShell title={title} description={isAi ? "查看 AI 阶段、模型、prompt version 与状态。" : "查看可视化处理 run，可按状态排障。"}>
      <section className="rounded-lg border border-line bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              void load(event.target.value).catch((err) => setError(err instanceof Error ? err.message : "筛选失败"));
            }}
            className="rounded-lg border border-line px-3 py-2 text-sm"
          >
            <option value="">全部状态</option>
            {["queued", "running", "success", "failed", "cancelled", "invalid_json", "schema_error"].map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
        {error ? <div className="mb-3 rounded-lg border border-[#f2c7bd] bg-[#fff1ee] px-3 py-2 text-sm text-[#9a341f]">{error}</div> : null}
        <div className="overflow-x-auto">
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
                  <td className="px-3 py-3">{isAi ? (row as AiRun).stage : (row as PipelineRun).run_type}</td>
                  <td className="px-3 py-3">{row.entity_type}:{row.entity_id.slice(0, 8)}</td>
                  <td className="px-3 py-3">{row.status}</td>
                  <td className="px-3 py-3">{new Date(row.created_at).toLocaleString("zh-CN")}</td>
                  <td className="px-3 py-3">
                    {row.entity_type === "video" ? <Link href={`/admin/videos/${row.entity_id}`} className="text-brand">打开视频</Link> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? <div className="rounded-lg border border-dashed border-line p-5 text-sm text-muted">暂无记录。</div> : null}
        </div>
      </section>
    </AdminShell>
  );
}
