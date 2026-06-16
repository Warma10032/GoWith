import { describe, expect, it } from "vitest";
import { videoClassificationResultSchema } from "./schemas";
import { evaluateClassificationReviewNeed } from "./validation";

describe("video classification schema", () => {
  it("requires review for low confidence classification", () => {
    const result = videoClassificationResultSchema.parse({
      schema_version: "video_classification.v1",
      video_id: "vid_1",
      bvid: "BV1",
      is_shop_visit: true,
      content_type: "single_shop_visit",
      confidence: 0.5,
      primary_city_hints: [],
      primary_category_hints: [],
      reason_codes: [],
      risk_flags: [],
      need_manual_review: false,
      evidence_ids: ["ev_1"],
    });

    expect(evaluateClassificationReviewNeed(result)).toBe(true);
  });
});

