import { describe, expect, it } from "vitest";
import { normalizeAmapTextResponse } from "./poi";

const candidate = {
  id: "candidate-1",
  candidate_name: "阿强牛肉面",
  normalized_name: "阿强牛肉面",
  category_primary: "餐饮",
  category_secondary: "面馆",
  city: "上海市",
  district: "黄浦区",
  business_area: "南京东路",
  address_hint: "南京东路步行街",
  risk_flags: [],
};

describe("poi adapter helpers", () => {
  it("normalizes AMap v5 response and scores candidates", () => {
    const result = normalizeAmapTextResponse(
      candidate,
      {
        status: "1",
        info: "OK",
        infocode: "10000",
        count: "1",
        pois: [
          {
            id: "B001",
            name: "阿强牛肉面",
            address: "上海市黄浦区南京东路步行街",
            location: "121.4826,31.2382",
            type: "餐饮服务;中餐厅;中餐厅",
            typecode: "050100",
            pname: "上海市",
            cityname: "上海市",
            adname: "黄浦区",
            business: {
              business_area: "南京东路",
              tel: "021-12345678",
              opentime_week: "周一至周日 10:00-22:00",
              rating: "4.7",
              cost: "42",
              tag: "牛肉面|一人食",
            },
            photos: [{ title: "门头", url: "https://example.com/shop.jpg" }],
          },
        ],
      },
      {
        keywords: "阿强牛肉面",
        region: "黄浦区",
        types: undefined,
        city_limit: true,
        forced_review: false,
        source: {
          candidate_name: candidate.candidate_name,
          city: candidate.city,
          district: candidate.district,
          business_area: candidate.business_area,
          address_hint: candidate.address_hint,
          category_primary: candidate.category_primary,
          category_secondary: candidate.category_secondary,
        },
      },
      "raw-1",
    );

    expect(result.candidates[0]).toMatchObject({
      provider_poi_id: "B001",
      name: "阿强牛肉面",
      location: { lng: 121.4826, lat: 31.2382, coord_type: "gcj02" },
      category_code: "050100",
      phone: "021-12345678",
      business_hours: "周一至周日 10:00-22:00",
      rating: 4.7,
      avg_cost: 42,
      tags: ["牛肉面", "一人食"],
      photos: [{ title: "门头", url: "https://example.com/shop.jpg" }],
    });
    expect(result.match_score).toBeGreaterThanOrEqual(0.9);
    expect(result.match_status).toBe("auto_matched");
  });

  it("forces manual review when shop name is missing", () => {
    const result = normalizeAmapTextResponse(
      { ...candidate, candidate_name: null, risk_flags: ["shop_name_missing"] },
      {
        status: "1",
        info: "OK",
        infocode: "10000",
        count: "1",
        pois: [
          {
            id: "B002",
            name: "阿强牛肉面",
            address: "上海市黄浦区南京东路步行街",
            location: "121.4826,31.2382",
            cityname: "上海市",
            adname: "黄浦区",
          },
        ],
      },
      {
        keywords: "南京东路步行街",
        region: "黄浦区",
        types: undefined,
        city_limit: true,
        forced_review: true,
        source: {
          candidate_name: null,
          city: candidate.city,
          district: candidate.district,
          business_area: candidate.business_area,
          address_hint: candidate.address_hint,
          category_primary: candidate.category_primary,
          category_secondary: candidate.category_secondary,
        },
      },
      null,
    );

    expect(result.match_status).toBe("need_review");
    expect(result.match_score).toBeLessThan(0.9);
    expect(result.risk_flags).toContain("shop_name_missing");
    expect(result.risk_flags).toContain("needs_manual_review");
  });
});
