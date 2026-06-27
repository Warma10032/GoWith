import { describe, expect, it } from "vitest";
import { planCreatorVideoSync } from "./creator-video-sync-plan";

describe("planCreatorVideoSync", () => {
  it("ingests every listed video on the first run", () => {
    const actions = planCreatorVideoSync(
      [{ bvid: "BV1" }, { bvid: "BV2" }],
      [],
    );

    expect(actions.map((action) => action.kind)).toEqual(["new", "new"]);
  });

  it("skips existing successful videos on later runs", () => {
    const actions = planCreatorVideoSync(
      [{ bvid: "BV1" }, { bvid: "BV2" }],
      [
        { id: "video_1", bvid: "BV1", workflow_status: "ai_structured" },
        { id: "video_2", bvid: "BV2", workflow_status: "subtitle_ready" },
      ],
    );

    expect(actions.map((action) => action.kind)).toEqual([
      "skip_existing",
      "skip_existing",
    ]);
  });

  it("retries only metadata failures plus new videos", () => {
    const actions = planCreatorVideoSync(
      [{ bvid: "BV1" }, { bvid: "BV2" }, { bvid: "BV3" }],
      [
        { id: "video_1", bvid: "BV1", workflow_status: "metadata_failed" },
        { id: "video_2", bvid: "BV2", workflow_status: "classified" },
      ],
    );

    expect(actions.map((action) => action.kind)).toEqual([
      "retry_failed",
      "skip_existing",
      "new",
    ]);
  });

  it("does not retry a soft-deleted metadata failure", () => {
    const actions = planCreatorVideoSync(
      [{ bvid: "BV1" }],
      [
        {
          id: "video_1",
          bvid: "BV1",
          workflow_status: "metadata_failed",
          deleted_at: new Date(),
        },
      ],
    );

    expect(actions.map((action) => action.kind)).toEqual(["skip_existing"]);
  });
});
