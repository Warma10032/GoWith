import { describe, expect, it } from "vitest";
import {
  citiesForProvinceInput,
  provinceForRegionInput,
  regionNameVariants,
} from "./china-regions";

describe("china region helpers", () => {
  it("expands province input to province cities", () => {
    expect(provinceForRegionInput("广东")).toBe("广东省");
    expect(citiesForProvinceInput("广东省")).toEqual(
      expect.arrayContaining(["广州市", "深圳市"]),
    );
  });

  it("keeps compact region name variants for fuzzy DB matching", () => {
    expect(regionNameVariants("上海市")).toEqual(["上海市", "上海"]);
  });
});
