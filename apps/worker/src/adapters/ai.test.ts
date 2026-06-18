import { describe, expect, it } from "vitest";
import { buildVideoAnalysisRequest } from "./ai";

describe("buildVideoAnalysisRequest", () => {
  it("includes metadata, transcript segments, and comment samples", () => {
    const request = buildVideoAnalysisRequest({
      video: {
        id: "video-1",
        bvid: "BV1",
        creator_id: "creator-1",
        title: "上海牛肉面探店",
        description: "一家面馆",
        tags: ["探店", "面馆"],
        category: "美食",
      },
      transcriptSegments: [
        {
          segment_id: "ev-seg-1",
          start_sec: 0,
          end_sec: 3,
          text: "这家牛肉面分量足。",
          confidence: 1,
        },
      ],
      commentSamples: [
        {
          comment_id: "ev-comment-1",
          content: "求地址",
          like_count: 8,
          reply_count: 1,
          sample_type: "hot",
          contains_location_signal: true,
          contains_shop_signal: false,
        },
      ],
      previousStageOutputs: { classification: { is_shop_visit: true } },
    });

    expect(request.video_metadata.title).toBe("上海牛肉面探店");
    expect(request.transcript_segments[0]?.segment_id).toBe("ev-seg-1");
    expect(request.comment_samples[0]?.comment_id).toBe("ev-comment-1");
    expect(request.previous_stage_outputs?.classification).toEqual({ is_shop_visit: true });
  });
});
