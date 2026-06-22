import { describe, expect, it } from "vitest";
import {
  InvalidDianpingUrlError,
  parseDianpingUrl,
} from "./shop-external-links";

describe("parseDianpingUrl", () => {
  it("accepts canonical and share links without fetching them", () => {
    expect(
      parseDianpingUrl(
        "https://www.dianping.com/shop/G7RgscHLjDjXY9hg#reviews",
      ),
    ).toEqual({
      externalUrl: "https://www.dianping.com/shop/G7RgscHLjDjXY9hg",
      externalShopId: "G7RgscHLjDjXY9hg",
    });
    expect(
      parseDianpingUrl(
        "https://m.dianping.com/shopshare/example?source=wechat",
      ),
    ).toEqual({
      externalUrl: "https://m.dianping.com/shopshare/example?source=wechat",
      externalShopId: null,
    });
  });

  it.each([
    "http://www.dianping.com/shop/123",
    "https://dianping.com.evil.example/shop/123",
    "https://user:pass@www.dianping.com/shop/123",
    "https://www.dianping.com:8443/shop/123",
    "not-a-url",
  ])("rejects unsafe URL %s", (url) => {
    expect(() => parseDianpingUrl(url)).toThrow(InvalidDianpingUrlError);
  });
});
