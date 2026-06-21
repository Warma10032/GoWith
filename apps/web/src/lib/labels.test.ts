import { describe, expect, test } from "vitest";
import {
  CREATOR_STATUS_LABELS,
  POI_MATCH_STATUS_LABELS,
  RISK_FLAG_LABELS,
  RUN_STATUS_LABELS,
  SHOP_STATUS_LABELS,
  VIDEO_CONTENT_TYPE_LABELS,
  VIDEO_WORKFLOW_STATUS_LABELS,
  formatPromptVersion,
  lookupLabel,
  lookupLabels,
} from "./labels";

describe("lookupLabel", () => {
  test("returns Chinese label for known enum value", () => {
    expect(lookupLabel(SHOP_STATUS_LABELS, "published")).toBe("已发布");
    expect(lookupLabel(SHOP_STATUS_LABELS, "draft")).toBe("草稿");
    expect(lookupLabel(RUN_STATUS_LABELS, "queued")).toBe("排队中");
  });

  test("returns raw value when key not in table (development visibility)", () => {
    expect(lookupLabel(SHOP_STATUS_LABELS, "new_status_we_dont_know")).toBe(
      "new_status_we_dont_know",
    );
  });

  test("returns em dash for empty / null / undefined", () => {
    expect(lookupLabel(SHOP_STATUS_LABELS, null)).toBe("—");
    expect(lookupLabel(SHOP_STATUS_LABELS, undefined)).toBe("—");
    expect(lookupLabel(SHOP_STATUS_LABELS, "")).toBe("—");
  });
});

describe("lookupLabels (arrays)", () => {
  test("joins Chinese labels with full-width comma", () => {
    expect(lookupLabels(RISK_FLAG_LABELS, ["low_confidence", "generic_name"]))
      .toBe("置信度低，店名过于通用");
  });

  test("falls back to '无' when array is empty", () => {
    expect(lookupLabels(RISK_FLAG_LABELS, [])).toBe("无");
    expect(lookupLabels(RISK_FLAG_LABELS, null)).toBe("无");
    expect(lookupLabels(RISK_FLAG_LABELS, undefined)).toBe("无");
  });

  test("preserves unknown values", () => {
    expect(
      lookupLabels(RISK_FLAG_LABELS, ["low_confidence", "future_flag"]),
    ).toBe("置信度低，future_flag");
  });
});

describe("table coverage sanity", () => {
  test("creator status covers active / paused", () => {
    expect(CREATOR_STATUS_LABELS.active).toBe("活跃");
    expect(CREATOR_STATUS_LABELS.paused).toBe("已暂停");
  });

  test("video workflow covers the full lifecycle", () => {
    expect(VIDEO_WORKFLOW_STATUS_LABELS.metadata_synced).toBe("基础信息已同步");
    expect(VIDEO_WORKFLOW_STATUS_LABELS.ai_structured).toBe("AI 结构化完成");
    expect(VIDEO_WORKFLOW_STATUS_LABELS.failed).toBe("处理失败");
  });

  test("video content type covers shop_visit branch", () => {
    expect(VIDEO_CONTENT_TYPE_LABELS.shop_visit).toBe("探店");
    expect(VIDEO_CONTENT_TYPE_LABELS.non_shop_visit).toBe("非探店");
  });

  test("POI match status covers selected / rejected", () => {
    expect(POI_MATCH_STATUS_LABELS.selected).toBe("已选用");
    expect(POI_MATCH_STATUS_LABELS.rejected).toBe("已驳回");
  });
});

describe("formatPromptVersion", () => {
  test("translates known prompt keys and keeps version suffix", () => {
    expect(formatPromptVersion("comment_analysis.v5")).toBe("评论分析 v5");
    expect(formatPromptVersion("comment_relevance_filter.v1")).toBe(
      "评论相关性筛选 v1",
    );
    expect(formatPromptVersion("transcript_fact_extraction.v1")).toBe(
      "转写事实抽取 v1",
    );
    expect(formatPromptVersion("structure_synthesis.v5")).toBe("结构化综合 v5");
  });

  test("falls back to raw key for unknown prompt names", () => {
    expect(formatPromptVersion("future_module.v9")).toBe("future_module v9");
  });

  test("returns em dash for empty / null / undefined", () => {
    expect(formatPromptVersion(null)).toBe("—");
    expect(formatPromptVersion(undefined)).toBe("—");
    expect(formatPromptVersion("")).toBe("—");
  });
});
