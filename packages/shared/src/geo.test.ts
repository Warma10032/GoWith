import { describe, expect, it } from "vitest";
import { formatDistance, wgs84ToGcj02 } from "./geo";

describe("coordinate conversion", () => {
  it("converts WGS-84 coordinates in China to GCJ-02", () => {
    const result = wgs84ToGcj02({ lng: 116.397428, lat: 39.90923 });
    expect(result.lng).toBeCloseTo(116.40367, 4);
    expect(result.lat).toBeCloseTo(39.91063, 4);
  });

  it("leaves coordinates outside China unchanged", () => {
    expect(wgs84ToGcj02({ lng: -0.1276, lat: 51.5072 })).toEqual({
      lng: -0.1276,
      lat: 51.5072,
    });
  });
});

describe("distance formatting", () => {
  it("formats meters and kilometres", () => {
    expect(formatDistance(850)).toBe("850 m");
    expect(formatDistance(2300)).toBe("2.3 km");
    expect(formatDistance(null)).toBeNull();
  });
});
