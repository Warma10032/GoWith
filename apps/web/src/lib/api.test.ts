import { describe, expect, it } from "vitest";
import { formatConfidence } from "./api";

describe("formatConfidence", () => {
  it("把 number 格式化为两位小数", () => {
    expect(formatConfidence(0.86)).toBe("0.86");
    expect(formatConfidence(1)).toBe("1.00");
    expect(formatConfidence(0)).toBe("0.00");
  });

  it("兼容 numeric-as-string（Kysely + pg numeric 字段）", () => {
    expect(formatConfidence("0.86")).toBe("0.86");
    expect(formatConfidence("1")).toBe("1.00");
    expect(formatConfidence("  0.5  ")).toBe("0.50");
  });

  it("缺失或非法值返回「待评估」", () => {
    expect(formatConfidence(undefined)).toBe("待评估");
    expect(formatConfidence(null)).toBe("待评估");
    expect(formatConfidence("")).toBe("待评估");
    expect(formatConfidence("   ")).toBe("待评估");
    expect(formatConfidence("not-a-number")).toBe("待评估");
  });

  it("拒绝 Infinity / NaN", () => {
    expect(formatConfidence(Number.NaN)).toBe("待评估");
    expect(formatConfidence(Number.POSITIVE_INFINITY)).toBe("待评估");
    expect(formatConfidence(Number.NEGATIVE_INFINITY)).toBe("待评估");
  });

  it("支持自定义小数位数", () => {
    expect(formatConfidence(0.8642, 3)).toBe("0.864");
    expect(formatConfidence("0.5", 0)).toBe("1");
  });

  it("string 中带前导零与负数也能正确解析", () => {
    expect(formatConfidence("0.001")).toBe("0.00");
    expect(formatConfidence("-0.5")).toBe("-0.50");
  });
});
