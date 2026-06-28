export type ScheduledTaskId =
  | "bilibili_cookie_health_check"
  | "daily_creator_video_sync"
  | "cleanup_ai_runs"
  | "cleanup_task_logs";

export type ScheduledTaskRunType =
  | "creator_video_sync"
  | "bilibili_auth_check"
  | "scheduled_ai_runs_cleanup"
  | "scheduled_task_logs_cleanup";

export type ScheduledTaskJobName =
  | "check_bilibili_auth_pool"
  | "sync_all_creator_videos"
  | "cleanup_ai_runs"
  | "cleanup_task_logs";

export type ScheduledTaskDefinition = {
  id: ScheduledTaskId;
  name: string;
  description: string;
  jobName: ScheduledTaskJobName;
  runType: ScheduledTaskRunType;
  intervalMs: number;
  retentionDays?: number;
  enabled: boolean;
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const scheduledTaskDefinitions = [
  {
    id: "bilibili_cookie_health_check",
    name: "B站 Cookie 健康检查",
    description: "检查 Cookie 池登录态，标记过期、风控和可用账号。",
    jobName: "check_bilibili_auth_pool",
    runType: "bilibili_auth_check",
    intervalMs: 30 * 60 * 1000,
    retentionDays: undefined,
    enabled: true,
  },
  {
    id: "daily_creator_video_sync",
    name: "每日同步博主视频",
    description:
      "每天扫描所有 active 博主的视频列表，只补充新视频并重试 metadata_failed 视频。",
    jobName: "sync_all_creator_videos",
    runType: "creator_video_sync",
    intervalMs: DAY,
    retentionDays: undefined,
    enabled: true,
  },
  {
    id: "cleanup_ai_runs",
    name: "AI 运行记录清理",
    description: "物理清理超过 30 天且未被业务结果引用的 AI 运行记录。",
    jobName: "cleanup_ai_runs",
    runType: "scheduled_ai_runs_cleanup",
    intervalMs: DAY,
    retentionDays: 30,
    enabled: true,
  },
  {
    id: "cleanup_task_logs",
    name: "DB 任务日志清理",
    description: "物理清理超过 7 天且已终态的任务日志、事件和 job 审计记录。",
    jobName: "cleanup_task_logs",
    runType: "scheduled_task_logs_cleanup",
    intervalMs: DAY,
    retentionDays: 7,
    enabled: true,
  },
] as const satisfies readonly ScheduledTaskDefinition[];

export function findScheduledTaskDefinition(id: string) {
  return scheduledTaskDefinitions.find((task) => task.id === id);
}

export function formatIntervalMs(intervalMs: number) {
  if (intervalMs % DAY === 0) return `${intervalMs / DAY} 天`;
  if (intervalMs % HOUR === 0) return `${intervalMs / HOUR} 小时`;
  const minutes = Math.round(intervalMs / 60_000);
  return `${minutes} 分钟`;
}
