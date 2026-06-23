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
    expect(recommendedQuerySchema.parse({})).toEqual({ coord_type: "wgs84" });
  });
});
