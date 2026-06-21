import { describe, expect, it } from "vitest";
import {
  taskAcceptedResponseSchema,
  videoClassificationResultSchema,
  videoStructuredAnalysisSchema,
} from "./schemas";
import {
  evaluateClassificationReviewNeed,
  findStructuredAnalysisIssues,
} from "./validation";
import type { VideoStructuredAnalysis } from "./schemas";

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

describe("admin task response schema", () => {
  it("accepts a subscribable pipeline run response", () => {
    const result = taskAcceptedResponseSchema.parse({
      run_id: "2a176d61-e18b-420c-8b03-f5a92c51e0e5",
      job_id: null,
      run_type: "video_ai_retry",
      entity_type: "video",
      entity_id: "2a176d61-e18b-420c-8b03-f5a92c51e0e5",
      status: "queued",
    });
    expect(result.run_type).toBe("video_ai_retry");
  });
});

describe("structured analysis strict schema", () => {
  it("rejects legacy fields", () => {
    const result = videoStructuredAnalysisSchema.safeParse({
      schema_version: "video_structured_analysis.v1",
      video: {
        video_id: "vid_1",
        bvid: "BV1",
        creator_id: "creator_1",
        title: "探店",
        content_type: "single_shop_visit",
        is_shop_visit: true,
        overall_summary: "探店总结",
        primary_categories: [],
        analysis_confidence: 0.9,
        risk_flags: [],
        evidence_ids: [],
      },
      shop_candidates: [],
      shop_name: "旧字段",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an AI recommendation score without evidence", () => {
    const result = {
      video: { evidence_ids: ["ev_1"] },
      shop_candidates: [
        {
          candidate_id: "candidate_1",
          candidate_name: "测试店",
          risk_flags: [],
          card_payload: {
            recommend_reason: "博主明确推荐。",
            recommendation_score: 0.9,
            recommendation_score_evidence_ids: [],
            recommended_dishes: [],
          },
        },
      ],
    } as unknown as VideoStructuredAnalysis;

    expect(findStructuredAnalysisIssues(result)).toContain(
      "candidate_1:recommendation_score_missing_evidence",
    );
  });
});
