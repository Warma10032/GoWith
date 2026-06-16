import { Worker } from "bullmq";
import { createDb } from "@gowith/db";
import { connection, pipelineQueue } from "./queue";
import { handlePipelineJob } from "./jobs/pipeline";

const db = createDb();

const worker = new Worker(
  "gowith-pipeline",
  async (job) => {
    console.log(`[worker] start ${job.name} ${job.id}`);
    const result = await handlePipelineJob(db, job);
    console.log(`[worker] done ${job.name} ${job.id}`);
    return result;
  },
  { connection, concurrency: 2 },
);

worker.on("failed", (job, error) => {
  console.error(`[worker] failed ${job?.name} ${job?.id}`, error);
});

process.on("SIGINT", async () => {
  await worker.close();
  await pipelineQueue.close();
  await db.destroy();
  process.exit(0);
});

console.log("[worker] GoWith pipeline worker is running");
