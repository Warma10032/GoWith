import { describe, expect, it } from "vitest";
import { mapViewDetailToVideoMetadata, normalizeSubtitleBody, signWbiParams } from "./bilibili";

describe("bilibili adapter helpers", () => {
  it("signs WBI params deterministically", () => {
    const signed = signWbiParams(
      { foo: "114", bar: "514", zab: 1919810 },
      "7cd084941338484aae1ad9425b84077c",
      "4932caff0ff746eab6f01bf08b70ac45",
      1702204169,
    );

    expect(signed.w_rid).toBe("8f6f2b5b3d485fe1886cec6a0be8c5d4");
    expect(signed.wts).toBe("1702204169");
  });

  it("maps view detail metadata including title, description, category, and tags", () => {
    const video = mapViewDetailToVideoMetadata(
      "BV123",
      {
        data: {
          View: {
            aid: 123,
            cid: 456,
            title: "探店标题",
            desc: "探店简介",
            pic: "//i0.hdslb.com/bfs/archive/cover.jpg",
            duration: 98,
            pubdate: 1_700_000_000,
            tname: "美食侦探",
            stat: { view: 100, reply: 2 },
          },
          Tags: [{ tag_name: "探店" }, { tag_name: "上海" }, { tag_name: "探店" }],
        },
      },
      "raw_1",
    );

    expect(video.title).toBe("探店标题");
    expect(video.description).toBe("探店简介");
    expect(video.category).toBe("美食侦探");
    expect(video.tags).toEqual(["探店", "上海"]);
    expect(video.aid).toBe("123");
    expect(video.cid).toBe("456");
    expect(video.raw_payload_id).toBe("raw_1");
  });

  it("normalizes subtitle body segments", () => {
    const segments = normalizeSubtitleBody({
      body: [
        { from: 1.2, to: 3.4, content: "第一句" },
        { from: 3.4, to: 5, content: "  " },
        { start: 5, end: 8, text: "第二句" },
      ],
    });

    expect(segments).toEqual([
      { start_sec: 1.2, end_sec: 3.4, text: "第一句" },
      { start_sec: 5, end_sec: 8, text: "第二句" },
    ]);
  });
});
