import type {
  CommentSignalExtraction,
  VideoClassificationResult,
  VideoStructuredAnalysis,
} from "@gowith/shared";

interface VideoInput {
  id: string;
  bvid: string;
  creator_id: string;
  title: string;
}

export async function classifyVideo(video: VideoInput): Promise<VideoClassificationResult> {
  const isShop = /探店|牛肉面|小店|餐厅|咖啡|火锅/.test(video.title);
  return {
    schema_version: "video_classification.v1",
    video_id: video.id,
    bvid: video.bvid,
    is_shop_visit: isShop,
    content_type: isShop ? "single_shop_visit" : "non_shop_visit",
    confidence: isShop ? 0.88 : 0.91,
    primary_city_hints: isShop ? ["上海"] : [],
    primary_category_hints: isShop ? ["restaurant"] : [],
    reason_codes: isShop ? ["mentions_physical_shop", "mentions_food_or_menu"] : ["explicit_non_shop_context"],
    risk_flags: [],
    need_manual_review: false,
    evidence_ids: [],
  };
}

export async function extractCommentSignals(videoId: string): Promise<CommentSignalExtraction> {
  return {
    schema_version: "comment_signal.v1",
    video_id: videoId,
    sample_strategy: {
      hot_comments_count: 1,
      latest_comments_count: 1,
      keyword_comments_count: 1,
    },
    location_questions: [],
    shop_name_mentions: [
      {
        candidate_name: "某某牛肉面",
        confidence: 0.72,
        evidence_ids: [],
      },
    ],
    address_mentions: [
      {
        text: "南京东路附近",
        confidence: 0.68,
        evidence_ids: [],
      },
    ],
    status_mentions: [],
    aspect_sentiments: {
      queue: {
        sentiment: "negative",
        summary: "评论区提到排队较久。",
        confidence: 0.77,
        evidence_ids: [],
      },
    },
    risk_flags: [],
  };
}

export async function structureVideo(video: VideoInput): Promise<VideoStructuredAnalysis> {
  return {
    schema_version: "video_structured_analysis.v1",
    video: {
      video_id: video.id,
      bvid: video.bvid,
      creator_id: video.creator_id,
      title: video.title,
      content_type: "single_shop_visit",
      is_shop_visit: true,
      overall_summary: "视频主要介绍上海南京东路附近一家日常面馆，优点是牛肉分量足，缺点是高峰期排队。",
      primary_city: "上海市",
      primary_categories: ["restaurant"],
      analysis_confidence: 0.84,
      risk_flags: ["address_missing"],
      evidence_ids: [],
    },
    shop_candidates: [
      {
        candidate_id: "mock_candidate",
        candidate_name: "某某牛肉面",
        normalized_name: "某某牛肉面",
        name_confidence: 0.78,
        alias_names: ["某某面馆"],
        candidate_type: "physical_shop",
        category: {
          primary: "restaurant",
          secondary: "noodle_shop",
          confidence: 0.81,
        },
        location_hints: {
          country: "中国",
          province: "上海市",
          city: "上海市",
          district: "黄浦区",
          business_area: "南京东路",
          address_text: "南京东路附近",
          landmarks: ["南京东路"],
          confidence: 0.65,
        },
        time_range: {
          start_sec: 18,
          end_sec: 338,
        },
        card_payload: {
          display_title: "某某牛肉面",
          subtitle: "适合一人食的日常面馆",
          recommend_reason: "牛肉分量足，汤底浓，适合顺路吃一顿。",
          avg_price_hint: "约30元",
          cover_source: "video_cover",
          tags: ["一人食", "分量足", "排队"],
          recommended_dishes: [
            {
              name: "牛肉面",
              reason: "博主重点推荐。",
              confidence: 0.82,
              evidence_ids: [],
            },
          ],
          avoid_points: [
            {
              text: "高峰期可能排队。",
              confidence: 0.74,
              evidence_ids: [],
            },
          ],
          suitable_scenes: ["一人食", "工作日午餐", "顺路打卡"],
        },
        review_dimensions: {
          taste: {
            sentiment: "positive",
            summary: "汤底浓，牛肉分量足。",
            confidence: 0.82,
            evidence_ids: [],
          },
          queue: {
            sentiment: "negative",
            summary: "高峰期排队较久。",
            confidence: 0.74,
            evidence_ids: [],
          },
        },
        comment_summary: {
          positive_points: ["分量足"],
          negative_points: ["排队久"],
          controversial_points: [],
          recent_status_points: ["最近仍在营业"],
          confidence: 0.7,
          evidence_ids: [],
        },
        missing_fields: ["exact_address", "opening_hours", "phone"],
        risk_flags: ["address_missing"],
        manual_review_reasons: ["地址线索不完整，需要 POI 人工确认。"],
      },
    ],
  };
}

