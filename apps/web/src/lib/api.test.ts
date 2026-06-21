import { describe, expect, it } from "vitest";
import { formatRecommendationScore } from "./api";

describe("formatRecommendationScore", () => {
  it("formats fractional scores as whole-number percentages", () => {
    expect(formatRecommendationScore(0.86)).toBe("86");
    expect(formatRecommendationScore(1)).toBe("100");
    expect(formatRecommendationScore(0)).toBe("0");
  });

  it("accepts numeric strings", () => {
    expect(formatRecommendationScore("0.86")).toBe("86");
    expect(formatRecommendationScore("1")).toBe("100");
    expect(formatRecommendationScore("  0.5  ")).toBe("50");
  });

  it("returns an empty-state label for missing or invalid values", () => {
    expect(formatRecommendationScore(undefined)).toBe("暂无");
    expect(formatRecommendationScore(null)).toBe("暂无");
    expect(formatRecommendationScore("")).toBe("暂无");
    expect(formatRecommendationScore("   ")).toBe("暂无");
    expect(formatRecommendationScore("not-a-number")).toBe("暂无");
  });

  it("rejects non-finite numeric values", () => {
    expect(formatRecommendationScore(Number.NaN)).toBe("暂无");
    expect(formatRecommendationScore(Number.POSITIVE_INFINITY)).toBe("暂无");
    expect(formatRecommendationScore(Number.NEGATIVE_INFINITY)).toBe("暂无");
  });
});
