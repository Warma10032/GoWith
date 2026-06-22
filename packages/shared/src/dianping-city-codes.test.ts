import { describe, expect, it } from "vitest";
import { lookupDianpingCityId } from "./dianping-city-codes";

describe("lookupDianpingCityId", () => {
  it("returns canonical IDs for first-tier cities", () => {
    expect(lookupDianpingCityId("北京市")).toBe(2);
    expect(lookupDianpingCityId("上海市")).toBe(1);
    expect(lookupDianpingCityId("广州市")).toBe(4);
    expect(lookupDianpingCityId("深圳市")).toBe(7);
    expect(lookupDianpingCityId("成都市")).toBe(8);
    expect(lookupDianpingCityId("杭州市")).toBe(3);
  });

  it("returns IDs for province capitals", () => {
    expect(lookupDianpingCityId("南京市")).toBe(5);
    expect(lookupDianpingCityId("武汉市")).toBe(16);
    expect(lookupDianpingCityId("西安市")).toBe(17);
    expect(lookupDianpingCityId("长沙市")).toBe(344);
    expect(lookupDianpingCityId("哈尔滨市")).toBe(79);
    expect(lookupDianpingCityId("济南市")).toBe(22);
  });

  it("strips 市 suffix and matches the base name", () => {
    expect(lookupDianpingCityId("北京")).toBe(2);
    expect(lookupDianpingCityId("上海")).toBe(1);
    expect(lookupDianpingCityId("广州")).toBe(4);
  });

  it("strips 地区 suffix and matches the base name", () => {
    expect(lookupDianpingCityId("阿克苏")).toBe(2107);
    expect(lookupDianpingCityId("吐鲁番")).toBe(327);
  });

  it("strips 自治州 / 盟 / 林区 suffix and matches the base name", () => {
    expect(lookupDianpingCityId("凉山")).toBe(257);
    expect(lookupDianpingCityId("锡林郭勒")).toBe(54);
  });

  it("honours manual alias overrides", () => {
    // 张家界市 真实 id 是 2098，原始数据里和别名表对不上
    expect(lookupDianpingCityId("张家界")).toBe(2098);
    // 大兴安岭（无 "市" 后缀）alias
    expect(lookupDianpingCityId("大兴安岭")).toBe(91);
    // 哈尔滨 vs 齐齐哈尔 消歧
    expect(lookupDianpingCityId("齐齐哈尔")).toBe(80);
  });

  it("returns null for unknown cities without false positives", () => {
    expect(lookupDianpingCityId("亚特兰蒂斯市")).toBeNull();
    expect(lookupDianpingCityId("新东京市")).toBeNull();
  });

  it("returns null for empty or nullish input", () => {
    expect(lookupDianpingCityId("")).toBeNull();
    expect(lookupDianpingCityId("   ")).toBeNull();
    expect(lookupDianpingCityId(null)).toBeNull();
    expect(lookupDianpingCityId(undefined)).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(lookupDianpingCityId("  北京市  ")).toBe(2);
    expect(lookupDianpingCityId("\t上海市\n")).toBe(1);
  });

  it("does not strip suffix when stripping would leave empty string", () => {
    // "市" 单独出现时不应该被剥离为 "" 然后命中空串
    expect(lookupDianpingCityId("市")).toBeNull();
  });
});
