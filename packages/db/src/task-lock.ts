import { sql, type Kysely, type Transaction } from "kysely";
import type { DB } from "./schema";

export const ACTIVE_TASK_STATUSES = ["queued", "running"] as const;
export const SYSTEM_TASK_ENTITY_ID = "00000000-0000-0000-0000-000000000000";

export type ActiveTaskStatus = (typeof ACTIVE_TASK_STATUSES)[number];

export interface TaskLockKey {
  jobType: string;
  entityType: string;
  entityId: string;
}

export interface ActiveTask {
  id: string;
  job_type: string;
  entity_type: string;
  entity_id: string;
  status: ActiveTaskStatus;
  run_id: string | null;
  started_at: Date | null;
  created_at: Date;
}

export interface ActivePipelineRun {
  id: string;
  run_type: string;
  entity_type: string;
  entity_id: string;
  status: ActiveTaskStatus;
  started_at: Date | null;
  created_at: Date;
}

type PipelineRunType = DB["pipeline_runs"]["run_type"];
type TaskDb = Kysely<DB> | Transaction<DB>;

export function formatTaskLockKey(key: TaskLockKey) {
  return `${key.jobType}:${key.entityType}:${key.entityId}`;
}

export async function acquireTaskStartLock(db: TaskDb, key: TaskLockKey) {
  await sql`select pg_advisory_xact_lock(hashtext(${formatTaskLockKey(key)}))`.execute(
    db,
  );
}

export async function tryAcquireTaskStartLock(db: TaskDb, key: TaskLockKey) {
  const result = await sql<{
    acquired: boolean;
  }>`select pg_try_advisory_xact_lock(hashtext(${formatTaskLockKey(key)})) as acquired`.execute(
    db,
  );
  return result.rows[0]?.acquired === true;
}

export async function findActiveTask(db: TaskDb, key: TaskLockKey) {
  return db
    .selectFrom("jobs")
    .select([
      "id",
      "job_type",
      "entity_type",
      "entity_id",
      "status",
      "run_id",
      "started_at",
      "created_at",
    ])
    .where("job_type", "=", key.jobType)
    .where("entity_type", "=", key.entityType)
    .where("entity_id", "=", key.entityId)
    .where("status", "in", [...ACTIVE_TASK_STATUSES])
    .orderBy("created_at", "desc")
    .executeTakeFirst() as Promise<ActiveTask | undefined>;
}

export async function findActiveTaskWithLock(db: TaskDb, key: TaskLockKey) {
  await acquireTaskStartLock(db, key);
  return findActiveTask(db, key);
}

export async function findActivePipelineRun(
  db: TaskDb,
  input: {
    runType: PipelineRunType;
    entityType: string;
    entityId: string;
  },
) {
  return db
    .selectFrom("pipeline_runs")
    .select([
      "id",
      "run_type",
      "entity_type",
      "entity_id",
      "status",
      "started_at",
      "created_at",
    ])
    .where("run_type", "=", input.runType)
    .where("entity_type", "=", input.entityType)
    .where("entity_id", "=", input.entityId)
    .where("status", "in", [...ACTIVE_TASK_STATUSES])
    .orderBy("created_at", "desc")
    .executeTakeFirst() as Promise<ActivePipelineRun | undefined>;
}
