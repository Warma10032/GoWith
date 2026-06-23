import { describe, expect, it } from "vitest";
import { collectCandidateEvidenceIds } from "./evidence";

describe("candidate evidence collection", () => {
  it("collects and de-duplicates evidence from public conclusions", () => {
    expect(
      collectCandidateEvidenceIds({
        card_payload: {
          recommendation_score_evidence_ids: ["score-1"],
          recommended_dishes: [{ evidence_ids: ["dish-1", "score-1"] }],
          avoid_points: [{ evidence_ids: ["avoid-1"] }],
        },
        review_dimensions: {
          taste: { evidence_ids: ["comment-1"] },
        },
        comment_summary: { evidence_ids: ["comment-1", "comment-2"] },
      }),
    ).toEqual(["score-1", "dish-1", "avoid-1", "comment-1", "comment-2"]);
  });
});
