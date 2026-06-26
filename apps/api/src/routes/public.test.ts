import { describe, expect, it } from "vitest";
import { recommendedQuerySchema } from "./public";

describe("recommended shop location query", () => {
  it("accepts exact paired WGS-84 coordinates", () => {
    expect(
      recommendedQuerySchema.parse({
        lng: "116.397428",
        lat: "39.90923",
        coord_type: "wgs84",
      }),
    ).toMatchObject({
      lng: 116.397428,
      lat: 39.90923,
      coord_type: "wgs84",
    });
  });

  it("rejects an incomplete location", () => {
    expect(() => recommendedQuerySchema.parse({ lng: "116.397428" })).toThrow();
  });

  it("keeps recency fallback valid without coordinates", () => {
    expect(recommendedQuerySchema.parse({})).toEqual({
      coord_type: "wgs84",
      limit: 30,
      sort: "recommended",
    });
  });

  it("accepts sorting and filter controls", () => {
    expect(
      recommendedQuerySchema.parse({
        sort: "distance",
        city: " 上海 ",
        category: "咖啡烘焙",
        creator_id: "00000000-0000-0000-0000-000000000001",
        min_avg_cost: "20",
        max_avg_cost: "80",
        has_dianping: "true",
        limit: "50",
        lng: "121.4737",
        lat: "31.2304",
      }),
    ).toMatchObject({
      sort: "distance",
      city: "上海",
      category: "咖啡烘焙",
      creator_id: "00000000-0000-0000-0000-000000000001",
      min_avg_cost: 20,
      max_avg_cost: 80,
      has_dianping: true,
      limit: 50,
    });
  });

  it("rejects invalid sort, creator id, and price ranges", () => {
    expect(() => recommendedQuerySchema.parse({ sort: "hot" })).toThrow();
    expect(() =>
      recommendedQuerySchema.parse({ creator_id: "not-a-uuid" }),
    ).toThrow();
    expect(() =>
      recommendedQuerySchema.parse({ min_avg_cost: "100", max_avg_cost: "20" }),
    ).toThrow();
    expect(() => recommendedQuerySchema.parse({ category: "面馆" })).toThrow();
  });
});
