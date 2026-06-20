import { describe, expect, it } from "vitest";
import { handlePipelineJob } from "./pipeline";

describe("pipeline job routing", () => {
  it("rejects unsupported legacy jobs", async () => {
    await expect(
      handlePipelineJob({} as never, { name: "fetch_video_metadata" } as never),
    ).rejects.toThrow("Unsupported pipeline job: fetch_video_metadata");
  });
});
