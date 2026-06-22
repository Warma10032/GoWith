import { describe, expect, it } from "vitest";
import { buildDianpingSearchUrl } from "./dianping-search";

describe("buildDianpingSearchUrl", () => {
  it("builds a URL with the 0_ shop-name prefix that Dianping expects", () => {
    expect(buildDianpingSearchUrl("上海市", "烤全羊")).toBe(
      "https://www.dianping.com/search/keyword/1/0_%E7%83%A4%E5%85%A8%E7%BE%8A",
    );
  });

  it("prepends 0_ before URL-encoding the shop name", () => {
    const url = buildDianpingSearchUrl("北京", "第六季自助餐（王府井店）");
    expect(url).not.toBeNull();
    expect(url!.split("/").pop()).toMatch(/^0_/);
    expect(url!.split("/").pop()).not.toContain("(");
    expect(url!.split("/").pop()).not.toContain("（");
  });

  it("uses the resolved cityId, not the input string", () => {
    expect(buildDianpingSearchUrl("上海市", "xx")).toContain("/1/0_");
    expect(buildDianpingSearchUrl("上海", "xx")).toContain("/1/0_");
    expect(buildDianpingSearchUrl("北京", "xx")).toContain("/2/0_");
  });

  it("returns null when shop name is empty or whitespace", () => {
    expect(buildDianpingSearchUrl("上海市", "")).toBeNull();
    expect(buildDianpingSearchUrl("上海市", "   ")).toBeNull();
    expect(buildDianpingSearchUrl("上海市", null)).toBeNull();
    expect(buildDianpingSearchUrl("上海市", undefined)).toBeNull();
  });

  it("returns null when cityId cannot be resolved", () => {
    expect(buildDianpingSearchUrl("亚特兰蒂斯市", "某店")).toBeNull();
    expect(buildDianpingSearchUrl("", "某店")).toBeNull();
    expect(buildDianpingSearchUrl(null, "某店")).toBeNull();
  });

  it("trims surrounding whitespace from the shop name", () => {
    const url = buildDianpingSearchUrl("上海市", "  烤全羊  ");
    expect(url).toBe(
      "https://www.dianping.com/search/keyword/1/0_%E7%83%A4%E5%85%A8%E7%BE%8A",
    );
  });
});