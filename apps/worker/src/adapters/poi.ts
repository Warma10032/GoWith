import type { PoiMatchResult } from "@gowith/shared";

export async function searchAmapPoi(candidateId: string): Promise<PoiMatchResult> {
  return {
    schema_version: "poi_match.v1",
    candidate_id: candidateId,
    provider: "amap",
    selected_poi: {
      provider_poi_id: `mock_amap_${candidateId.slice(0, 8)}`,
      name: "某某牛肉面",
      address: "上海市黄浦区南京东路步行街附近",
      province: "上海市",
      city: "上海市",
      district: "黄浦区",
      business_area: "南京东路",
      location: {
        lng: 121.4826,
        lat: 31.2382,
        coord_type: "gcj02",
      },
      category: "餐饮服务;中餐厅;中餐厅",
      raw_provider_payload_id: null,
    },
    candidates: [
      {
        provider_poi_id: `mock_amap_${candidateId.slice(0, 8)}`,
        name: "某某牛肉面",
        address: "上海市黄浦区南京东路步行街附近",
        match_features: {
          name_similarity: 0.92,
          city_match: 1,
          district_match: 0.8,
          business_area_match: 0.7,
          category_match: 0.9,
          address_text_match: 0.62,
        },
        match_score: 0.86,
      },
    ],
    match_score: 0.86,
    match_status: "need_review",
    risk_flags: ["address_missing"],
    manual_review_reasons: ["地址线索不足，需人工确认是否为该分店。"],
  };
}

