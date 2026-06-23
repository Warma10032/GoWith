# GoWith MVP AI 工作流与后台审核规格

版本：v0.1  
日期：2026-06-16  
关联文档：[MVP-bilibili-shop-map.md](./MVP-bilibili-shop-map.md)  
落库设计：[MVP-database-schema.md](./MVP-database-schema.md)  
目标：把“视频理解 -> 店铺候选 -> POI 匹配 -> 后台审核 -> 前台展示”定义成可开发、可测试、可迭代的契约。

## 1. 设计原则

### 1.1 AI 输出原则

- 以视频为分析单位，先生成 `VideoAnalysis`，再聚合到 `Shop`。
- AI 只输出结构化 JSON，不输出 Markdown、解释性文本或自由格式段落。
- 信息没有证据时必须输出 `unknown`、`null` 或空数组，不能补全、猜测、编造。
- 每个重要结论必须绑定 `evidence_ids`。
- 视频字幕/ASR 是主证据，评论区是辅助证据。
- 评论区可补充店名、地址、搬迁、排队、争议信息，但不能单独覆盖视频结论。
- 低置信度结果进入后台，不进入前台推荐。

### 1.2 后台审核原则

- 后台优先解决“自动化无法确定”的问题，不做复杂运营系统。
- 一个审核任务必须能看到：原视频、字幕/ASR 证据、评论线索、AI 结构化结果、高德 POI 候选、历史同店铺。
- 人工编辑结果优先级高于 AI 和自动 POI 匹配。
- 每次人工操作必须留痕，便于回滚和模型评估。

## 2. 工作流产物

AI 与数据管线中建议保留这些中间产物：

| 产物                        | 说明                                 | 是否持久化 |
| --------------------------- | ------------------------------------ | ---------- |
| `VideoMetadata`             | B站视频元信息                        | 是         |
| `TranscriptAsset`           | 字幕或 ASR 文本，含时间戳            | 是         |
| `CommentSample`             | 评论样本与评论线索                   | 是         |
| `VideoClassificationResult` | 是否探店视频                         | 是         |
| `ShopCandidateExtraction`   | 视频级候选店铺抽取                   | 是         |
| `CommentSignalExtraction`   | 评论区店铺线索增强                   | 是         |
| `VideoStructuredAnalysis`   | 可支撑前台卡片的完整视频级结构化结果 | 是         |
| `PoiMatchResult`            | 高德 POI 候选和匹配分                | 是         |
| `ReviewDecision`            | 后台人工审核结果                     | 是         |
| `PublishedShopSnapshot`     | 前台展示用店铺快照                   | 是         |

## 3. 通用枚举

### 3.1 `content_type`

```text
single_shop_visit
multi_shop_visit
city_food_collection
travel_vlog_with_shops
food_review_not_shop
not_physical_shop
non_shop_visit
unknown
```

### 3.2 `sentiment`

```text
positive
neutral
negative
mixed
controversial
unknown
```

### 3.3 `evidence_source`

```text
title
description
tag
subtitle
asr
comment
danmaku
manual_review
poi_provider
system_inference
```

`system_inference` 只能用于系统推导字段，例如“多个候选 POI 距离相近，因此触发人工审核”，不能用于店铺评价结论。

### 3.4 `risk_flag`

```text
non_shop_visit_possible
shop_name_missing
shop_name_ambiguous
generic_name_risk
multiple_shops_in_video
address_missing
city_missing
poi_no_candidate
poi_low_confidence
poi_many_same_name_candidates
chain_store_branch_uncertain
closed_or_moved_mentioned
comment_conflict
asr_low_quality
subtitle_missing
insufficient_evidence
ai_output_incomplete
needs_manual_review
```

### 3.5 `missing_field`

```text
shop_name
city
district
business_area
exact_address
poi
opening_hours
phone
recommended_dishes
avoid_points
service
environment
queue
parking
reservation
```

## 4. 证据模型

所有可展示结论都应能回到证据。

```json
{
  "id": "ev_01H...",
  "source": "asr",
  "source_id": "asset_01H...",
  "text": "这家在南京东路附近的牛肉面，牛肉给得挺多。",
  "start_sec": 123.5,
  "end_sec": 131.2,
  "comment_id": null,
  "confidence": 0.86,
  "created_at": "2026-06-16T00:00:00Z"
}
```

字段说明：

| 字段         | 类型        | 说明                          |
| ------------ | ----------- | ----------------------------- |
| `id`         | string      | 内部证据 ID                   |
| `source`     | enum        | 证据来源                      |
| `source_id`  | string      | 字幕资产、评论、视频等来源 ID |
| `text`       | string      | 证据片段，避免过长            |
| `start_sec`  | number/null | 视频内开始秒数                |
| `end_sec`    | number/null | 视频内结束秒数                |
| `comment_id` | string/null | 评论证据 ID                   |
| `confidence` | number      | 证据与结论的相关性            |

约束：

- `subtitle` / `asr` 证据优先带时间戳。
- 评论证据不默认前台展示原文，可只用于后台和摘要生成。
- 前台展示时可显示“来源：字幕/评论区/人工审核”，不一定显示完整原文。

## 5. 视频分类 Schema

### 5.1 输出示例

```json
{
  "schema_version": "video_classification.v1",
  "video_id": "vid_01H...",
  "bvid": "BV...",
  "is_shop_visit": true,
  "content_type": "multi_shop_visit",
  "confidence": 0.87,
  "primary_city_hints": ["上海"],
  "primary_category_hints": ["restaurant", "coffee"],
  "reason_codes": [
    "mentions_physical_shop",
    "mentions_address_or_area",
    "mentions_food_or_menu",
    "comments_ask_for_location"
  ],
  "risk_flags": ["multiple_shops_in_video"],
  "need_manual_review": false,
  "evidence_ids": ["ev_001", "ev_002"]
}
```

### 5.2 校验规则

- `confidence < 0.65` 时，必须 `need_manual_review = true`。
- `content_type = non_shop_visit` 时，不进入店铺抽取阶段。
- `content_type = food_review_not_shop` 时，不进入 POI 匹配。
- `multi_shop_visit` 必须允许后续输出多个 `shop_candidates`。

## 6. 评论区线索 Schema

评论区不是“完整评价来源”，而是补充线索。

```json
{
  "schema_version": "comment_signal.v1",
  "video_id": "vid_01H...",
  "sample_strategy": {
    "hot_comments_count": 80,
    "latest_comments_count": 120,
    "keyword_comments_count": 50
  },
  "location_questions": [
    {
      "text_summary": "多位用户询问店铺位置",
      "count": 12,
      "evidence_ids": ["ev_101", "ev_102"]
    }
  ],
  "shop_name_mentions": [
    {
      "candidate_name": "某某牛肉面",
      "confidence": 0.72,
      "evidence_ids": ["ev_103"]
    }
  ],
  "address_mentions": [
    {
      "text": "南京东路附近",
      "confidence": 0.68,
      "evidence_ids": ["ev_104"]
    }
  ],
  "status_mentions": [
    {
      "status": "possible_moved",
      "summary": "有评论提到店铺可能搬迁",
      "confidence": 0.61,
      "evidence_ids": ["ev_105"]
    }
  ],
  "aspect_sentiments": {
    "taste": {
      "sentiment": "positive",
      "summary": "评论区对味道整体偏正向。",
      "confidence": 0.71,
      "evidence_ids": ["ev_106"]
    },
    "queue": {
      "sentiment": "negative",
      "summary": "多条评论提到排队较久。",
      "confidence": 0.77,
      "evidence_ids": ["ev_107"]
    }
  },
  "risk_flags": ["closed_or_moved_mentioned"]
}
```

### 6.1 评论抽样建议

MVP 建议混合抽样：

- 热评：判断高赞共识。
- 最新评论：判断近期状态，如闭店、搬迁、涨价。
- 关键词评论：包含“店名”“地址”“在哪”“人均”“排队”“踩雷”“搬了”“闭店”等。

## 7. 视频级结构化分析 Schema

这是 AI 工作流最重要的输出。它不直接等于前台店铺，而是“视频对若干候选店铺的结构化理解”。

### 7.1 顶层结构

```json
{
  "schema_version": "video_structured_analysis.v2",
  "video": {
    "video_id": "vid_01H...",
    "bvid": "BV...",
    "creator_id": "creator_01H...",
    "title": "视频标题",
    "content_type": "multi_shop_visit",
    "is_shop_visit": true,
    "overall_summary": "该视频主要介绍了上海几家适合日常吃饭的小店。",
    "primary_city": "上海",
    "primary_categories": ["restaurant"],
    "analysis_confidence": 0.84,
    "risk_flags": ["multiple_shops_in_video"],
    "evidence_ids": ["ev_001", "ev_002"]
  },
  "shop_candidates": []
}
```

### 7.2 `shop_candidate` 完整结构

```json
{
  "candidate_id": "cand_01H...",
  "candidate_name": "某某牛肉面",
  "normalized_name": "某某牛肉面",
  "name_confidence": 0.78,
  "alias_names": ["某某面馆"],
  "candidate_type": "physical_shop",
  "category": {
    "primary": "粉面粥",
    "secondary": "西北菜",
    "confidence": 0.81
  },
  "location_hints": {
    "country": "中国",
    "province": "上海市",
    "city": "上海市",
    "district": "黄浦区",
    "business_area": "南京东路",
    "address_text": "南京东路附近",
    "landmarks": ["南京东路"],
    "confidence": 0.65
  },
  "time_range": {
    "start_sec": 120.0,
    "end_sec": 420.0
  },
  "card_payload": {
    "display_title": "某某牛肉面",
    "subtitle": "适合一人食的日常面馆",
    "recommend_reason": "博主推荐牛肉面，认为牛肉分量足、汤底浓郁，适合一人食。",
    "recommendation_score": 0.86,
    "recommendation_score_evidence_ids": ["ev_201"],
    "cover_source": "video_cover",
    "tags": [],
    "recommended_dishes": [
      {
        "name": "牛肉面",
        "reason": "博主重点推荐，评论区也有提及。",
        "confidence": 0.82,
        "evidence_ids": ["ev_201"]
      }
    ],
    "avoid_points": [
      {
        "text": "高峰期可能需要排队。",
        "confidence": 0.74,
        "evidence_ids": ["ev_202"]
      }
    ],
    "suitable_scenes": ["一人食", "工作日午餐", "顺路打卡"]
  },
  "review_dimensions": {
    "taste": {
      "sentiment": "positive",
      "summary": "汤底浓，牛肉分量足。",
      "confidence": 0.82,
      "evidence_ids": ["ev_203"]
    },
    "price": {
      "sentiment": "positive",
      "summary": "人均约30元，偏日常消费。",
      "confidence": 0.68,
      "evidence_ids": ["ev_204"]
    },
    "queue": {
      "sentiment": "negative",
      "summary": "评论区提到高峰期排队较久。",
      "confidence": 0.74,
      "evidence_ids": ["ev_205"]
    },
    "service": {
      "sentiment": "unknown",
      "summary": "视频和评论样本未提供足够服务信息。",
      "confidence": 0.0,
      "evidence_ids": []
    },
    "environment": {
      "sentiment": "unknown",
      "summary": "环境信息不足。",
      "confidence": 0.0,
      "evidence_ids": []
    }
  },
  "comment_summary": {
    "positive_points": ["分量足", "性价比不错"],
    "negative_points": ["排队久"],
    "controversial_points": [],
    "recent_status_points": [],
    "confidence": 0.7,
    "evidence_ids": ["ev_206", "ev_207"]
  },
  "missing_fields": ["exact_address", "opening_hours", "phone"],
  "risk_flags": ["address_missing"],
  "manual_review_reasons": ["候选地址不完整，需要 POI 人工确认"]
}
```

`category.primary` 只允许：`中餐`、`地方特色菜`、`火锅`、`烧烤`、`海鲜`、`自助餐`、`小吃快餐`、`粉面粥`、`甜品饮品`、`咖啡烘焙`、`西餐`、`日本料理`、`韩国料理`、`东南亚菜`、`素食`、`其他餐饮`。`category.secondary` 只允许项目约定的菜系词表（如鲁菜、粤菜、潮汕菜、川菜、湘菜）；无证据时为 `null`。MVP 暂不生成或展示 `tags`。

`recommend_reason` 必须来自字幕中的博主结论，至少表达“是否推荐、推荐或不推荐什么菜、具体原因”中的可确认部分。评论只能进入 `comment_summary` / `aggregated_review`，不得替代博主推荐结论。

`recommendation_score` 是 0-1 的 AI 综合推荐度，不是店铺信息置信度。评分以博主字幕态度为主，评论只能在不反转博主观点的前提下辅助校准：0.80-1.00 为强烈推荐，0.60-0.79 为正向但有条件，0.40-0.59 为中性或褒贬不一，0.20-0.39 为负面，0.00-0.19 为明确不推荐。没有足够的博主态度证据时为 `null`；非空评分必须提供 `recommendation_score_evidence_ids`。`shop_confidence` 仅用于信息质量与发布门槛，不在前台作为推荐评分展示。

`structure_video.v3` 先用小 Schema 从字幕提炼店名、城市、博主态度与推荐菜，再进入完整结构化调用。若完整调用对已确认的探店视频返回空 `shop_candidates`，仅在小 Schema 有店名字幕证据时生成一个候选，避免出现“分析成功但没有 POI 候选”的断链。

`comment_analysis.v5` 使用两段式评论分析：`comment_relevance_filter.v1` 从最多 80 条样本中只返回与当前店铺直接相关的 `comment_id`，随后 M3 仅接收并分析这些筛选结果。维度仍使用 `sentiment / summary / confidence / evidence_ids`，`summary` 禁止出现评论编号，编号只保存在 `evidence_ids`。结构化综合不得用字幕证据覆盖评论维度；后台点击整个评价维度后，通过 `evidence.source_ref_id -> video_comments.id` 展示关联原评论。

AI Worker 采用双层模型：视频分类、评论相关性筛选、JSON 修复等预处理任务使用 `MINIMAX_SIMPLE_MODEL`（默认 `MiniMax-M2.7`）；字幕洞察、评论维度结论、视频结构化总结等分析任务使用 `MINIMAX_COMPLEX_MODEL`（默认 `MiniMax-M3`）。两段式调用的子模型写入 `usage.model`，顶层 `ai_runs.model` 记录产出最终阶段结果的模型。

全部 Prompt 集中在 `apps/ai-worker/app/prompts.py`，由注册表保存 key、版本、模型层级、任务目标、证据优先级、决策规则和 Pydantic JSON Schema 输出契约。结构化阶段依次执行 `transcript_fact_extraction.v1`、`transcript_opinion_analysis.v2`、`structure_synthesis.v6`；若单店探店缺少候选、视频缺少证据、推荐评分缺少字幕证据或推荐菜缺少字幕证据，则执行一次 `structure_semantic_retry.v3`。`json_repair.v2` 只能修复 JSON 语法和字段形状，禁止改变业务语义。

AI Worker envelope 的 `subcalls` 按调用顺序返回每次模型调用的 stage、model、prompt_version、input_hash、输入摘要、原始输出、解析输出、usage、status 与错误。Worker 将顶层阶段写为父 `ai_runs`，子调用通过 `parent_ai_run_id` 与 `call_index` 关联；失败 HTTP 响应也携带已发生的 subcalls 并落库。

后台异步命令统一返回 HTTP 202 与 `run_id`。`pipeline_runs` 状态变化和 `pipeline_events` 新增后由 PostgreSQL `NOTIFY gowith_admin_tasks` 通知 API，`GET /api/admin/task-stream` 通过 SSE 推送到后台全局 Provider；断线时通过 `GET /api/admin/pipeline-runs/changes?since=...` 每 10 秒增量补偿。任务按钮在 queued/running 阶段保持页面级 busy，终态后自动刷新后台数据。

### 7.3 字段要求

| 字段                                | 要求                                            |
| ----------------------------------- | ----------------------------------------------- |
| `candidate_name`                    | 不能确定时为 `null`，并添加 `shop_name_missing` |
| `normalized_name`                   | 清洗后的名称，不能凭空补充分店名                |
| `location_hints.city`               | 能判断城市就必须输出；不能判断则为 `null`       |
| `time_range`                        | 多店铺视频必须尽量输出                          |
| `card_payload.recommend_reason`     | 必须适合首页卡片，控制在 60 字以内              |
| `card_payload.recommendation_score` | 推荐程度，非空时必须引用字幕证据                |
| `review_dimensions`                 | 信息不足时使用 `unknown`                        |
| `evidence_ids`                      | 重要结论必须非空                                |
| `missing_fields`                    | 缺什么写什么，不能沉默                          |
| `risk_flags`                        | 触发审核的重要依据                              |

## 8. POI 匹配 Schema

### 8.1 查询请求

```json
{
  "candidate_id": "cand_01H...",
  "query_strategy": "city_name_keyword",
  "provider": "amap",
  "query": {
    "keywords": "某某牛肉面",
    "city": "上海",
    "citylimit": true,
    "types": ["餐饮服务"],
    "address_hint": "南京东路附近"
  }
}
```

### 8.2 匹配结果

```json
{
  "schema_version": "poi_match.v1",
  "candidate_id": "cand_01H...",
  "provider": "amap",
  "selected_poi": {
    "provider_poi_id": "B0...",
    "name": "某某牛肉面",
    "address": "上海市黄浦区...",
    "province": "上海市",
    "city": "上海市",
    "district": "黄浦区",
    "business_area": "南京东路",
    "location": {
      "lng": 121.48,
      "lat": 31.23,
      "coord_type": "gcj02"
    },
    "category": "餐饮服务;中餐厅;中餐厅",
    "raw_provider_payload_id": "raw_poi_01H..."
  },
  "candidates": [
    {
      "provider_poi_id": "B0...",
      "name": "某某牛肉面",
      "address": "上海市黄浦区...",
      "match_features": {
        "name_similarity": 0.92,
        "city_match": 1.0,
        "district_match": 0.8,
        "business_area_match": 0.7,
        "category_match": 0.9,
        "address_text_match": 0.62,
        "chain_branch_risk": 0.1
      },
      "match_score": 0.86
    }
  ],
  "match_score": 0.86,
  "match_status": "need_review",
  "risk_flags": ["address_missing"],
  "manual_review_reasons": ["地址线索不足，需确认是否为该分店"]
}
```

### 8.3 匹配状态

```text
not_started
no_candidate
low_confidence
need_review
auto_matched
manual_matched
manual_rejected
```

**重写语义（overwrite-on-search）**：每次 `matchPoiJob` 启动时先 `DELETE FROM poi_match_candidates WHERE shop_candidate_id = ?`，然后插入新 attempt 的候选。同一 POI 不会再因为重复搜索出现 N 次。`poi_match_attempts` 表保留作为查询审计日志（每行是一次 attempt 的查询策略、payload、状态），不被清空。`shop_candidates.selected_poi_id` 也会在 job 末尾被 UPDATE 覆盖为新 attempt 的结果。

阈值建议：

| 条件                           | 状态               |
| ------------------------------ | ------------------ |
| `match_score >= 0.9` 且无风险  | `auto_matched`     |
| `0.65 <= match_score < 0.9`    | `need_review`      |
| `match_score < 0.65`           | `low_confidence`   |
| 无候选                         | `no_candidate`     |
| 店名缺失、同名分店多、搬迁风险 | 强制 `need_review` |

## 9. 发布店铺聚合 Schema

视频分析和 POI 审核完成后，生成前台展示用快照。

```json
{
  "shop_id": "shop_01H...",
  "canonical_name": "某某牛肉面",
  "display_name": "某某牛肉面",
  "poi": {
    "provider": "amap",
    "provider_poi_id": "B0...",
    "address": "上海市黄浦区...",
    "location": {
      "lng": 121.48,
      "lat": 31.23,
      "coord_type": "gcj02"
    }
  },
  "category": {
    "primary": "粉面粥",
    "secondary": "西北菜"
  },
  "card": {
    "title": "某某牛肉面",
    "subtitle": "适合一人食的日常面馆",
    "recommend_reason": "多条视频和评论提到牛肉分量足，适合顺路吃一顿。",
    "tags": [],
    "cover_url": "https://...",
    "source_creator_avatars": ["https://..."]
  },
  "aggregated_review": {
    "taste": {
      "sentiment": "positive",
      "summary": "整体对味道评价偏正向。",
      "confidence": 0.82
    },
    "queue": {
      "sentiment": "negative",
      "summary": "高峰期可能排队。",
      "confidence": 0.74
    }
  },
  "source_stats": {
    "creator_count": 1,
    "video_count": 2,
    "comment_signal_count": 18,
    "latest_video_published_at": "2026-05-01T00:00:00Z"
  },
  "quality": {
    "shop_confidence": 0.86,
    "poi_confidence": 0.86,
    "summary_confidence": 0.78,
    "review_status": "approved",
    "last_reviewed_at": "2026-06-16T00:00:00Z"
  }
}
```

## 10. 校验与拦截规则

### 10.1 AI 输出校验

必须自动校验：

- JSON 是否可解析。
- `schema_version` 是否匹配。
- 必填字段是否存在。
- 枚举值是否合法。
- `confidence` 是否在 `0-1`。
- 重要结论是否有 `evidence_ids`。
- `unknown` 字段是否误填成空洞文案。
- 店铺候选数量是否异常。

失败处理：

- JSON 解析失败：重试一次，仍失败进入 `ai_output_incomplete`。
- 必填字段缺失：进入后台任务。
- 证据缺失：不允许发布。
- `risk_flags` 非空：按规则决定是否强制审核。

### 10.2 幻觉拦截

以下情况必须进入人工审核：

- AI 输出了视频文本中完全没有出现的店名，且评论区也没有证据。
- AI 输出了具体地址，但证据只有城市或商圈。
- AI 输出了具体价格，但证据只有“便宜”“贵”。
- AI 输出了推荐菜，但字幕/评论没有对应菜品。
- AI 输出“闭店”“搬迁”等高影响结论，但证据不足。

### 10.3 前台发布门槛

店铺前台发布需要同时满足：

- `is_shop_visit = true`。
- 至少一个 `shop_candidate` 通过审核或自动高置信匹配。
- 有有效 POI。
- 有可展示卡片标题和推荐理由。
- `shop_confidence >= 0.7`。
- 无未处理的高风险标记。

## 11. 后台信息架构

### 11.1 一级菜单

- 工作台
- 博主管理
- 视频任务
- AI 分析
- 店铺候选
- POI 审核
- 店铺合并
- 已发布店铺
- 用户反馈
- 系统设置

MVP 可以先实现：工作台、博主管理、视频任务、店铺候选、POI 审核、已发布店铺。

### 11.2 工作台队列

| 队列          | 说明                            | 优先级 |
| ------------- | ------------------------------- | ------ |
| 采集失败      | B站接口、登录态、字幕、评论失败 | 高     |
| ASR 失败      | 无字幕且 ASR 失败               | 中     |
| 非探店待确认  | 分类置信度低                    | 中     |
| 店名缺失      | 有探店迹象但无明确店名          | 高     |
| 多店铺拆分    | 一个视频多个店铺                | 高     |
| POI 待确认    | 候选 POI 不够确定               | 高     |
| 店铺待合并    | 疑似同店铺                      | 中     |
| AI 摘要待修正 | 卡片文案或结构化信息不足        | 中     |
| 待发布        | 已审核但未发布                  | 中     |

## 12. 后台页面字段

### 12.1 博主管理

列表字段：

| 字段         | 说明                    |
| ------------ | ----------------------- |
| UID          | B站 UID                 |
| 昵称         | 博主名称                |
| 头像         | 头像                    |
| 状态         | active / paused / error |
| 视频总数     | 已同步视频数            |
| 探店视频数   | AI 或人工确认探店视频   |
| 候选店铺数   | 抽取出的候选店铺        |
| 已发布店铺数 | 前台可见店铺            |
| 最近同步     | 最近一次同步时间        |
| 错误         | 最近错误摘要            |

操作：

- 新增 UID。
- 暂停同步。
- 立即同步。
- 查看视频。
- 查看博主页预览。

### 12.2 视频任务列表

列表字段：

| 字段       | 说明                   |
| ---------- | ---------------------- |
| 封面       | 视频封面               |
| 标题       | B站标题                |
| 博主       | 来源博主               |
| BV号       | 视频标识               |
| 发布时间   | 视频发布时间           |
| 任务状态   | 当前 workflow 状态     |
| 文本来源   | subtitle / asr / none  |
| 是否探店   | true / false / unknown |
| 候选店铺数 | AI 抽取数量            |
| 风险       | risk_flags 摘要        |
| 最近处理   | 最近任务更新时间       |

操作：

- 查看详情。
- 重新获取字幕。
- 重新 ASR。
- 重新 AI 分析。
- 标记非探店。
- 创建审核任务。

### 12.3 视频详情审核页

页面布局建议：

- 顶部：视频标题、封面、博主、BV号、原视频链接、发布时间、状态。
- 左栏：字幕/ASR 时间轴。
- 中栏：AI 输出结构化 JSON 的可读视图。
- 右栏：候选店铺、评论线索、风险标记、审核操作。

字段：

| 区域     | 字段                                         |
| -------- | -------------------------------------------- |
| 视频信息 | 标题、简介、标签、发布时间、播放数据         |
| 文本资产 | 字幕状态、ASR 状态、文本长度、ASR 模型、语言 |
| 分类结果 | 是否探店、内容类型、置信度、原因、证据       |
| 评论线索 | 店名提及、地址提及、排队/闭店/搬迁线索       |
| 店铺候选 | 候选名、城市、商圈、菜品、时间段、风险       |
| 操作     | 通过分类、标记非探店、拆分店铺、重跑 AI      |

### 12.4 店铺候选审核页

列表字段：

| 字段     | 说明                                 |
| -------- | ------------------------------------ |
| 候选店名 | AI 抽取名称                          |
| 博主     | 来源博主                             |
| 视频     | 来源视频                             |
| 城市线索 | AI/评论推断城市                      |
| 地址线索 | 商圈、地标、评论地址                 |
| 推荐菜   | AI 抽取                              |
| 置信度   | name/location/summary                |
| 风险标记 | 店名缺失、地址缺失等                 |
| POI 状态 | no_candidate / need_review / matched |

详情字段：

| 字段     | 可编辑 | 说明                |
| -------- | ------ | ------------------- |
| 候选店名 | 是     | 人工可修正          |
| 别名     | 是     | 方便后续合并        |
| 城市     | 是     | POI 搜索关键字段    |
| 区县     | 是     | POI 搜索关键字段    |
| 商圈     | 是     | 辅助匹配            |
| 地址线索 | 是     | 可从评论补充        |
| 品类     | 是     | 用于前台和 POI 类型 |
| 推荐菜   | 是     | 可删除无证据菜品    |
| 推荐理由 | 是     | 卡片展示核心文案    |
| 避雷点   | 是     | 高风险负面可删改    |
| 证据     | 否     | 可查看，不直接编辑  |
| 风险标记 | 是     | 可人工清除或新增    |

操作：

- 保存修改。
- 搜索 POI。
- 选择 POI。
- 标记店名未知。
- 标记非店铺。
- 合并到已有店铺。
- 驳回候选。

### 12.5 POI 审核页

核心目标：让人快速判断“这个候选店铺到底是哪一个地图点”。

展示字段：

| 区域     | 字段                                 |
| -------- | ------------------------------------ |
| 候选信息 | 候选店名、城市、商圈、地址线索、品类 |
| 视频证据 | 相关字幕/ASR 片段、时间戳、视频链接  |
| 评论证据 | 店名/地址/搬迁/排队线索              |
| 高德候选 | 名称、地址、区县、类型、距离/匹配分  |
| 地图预览 | 候选 POI pin、附近地标               |
| 历史店铺 | 系统内疑似同店                       |

高德候选列表字段：

| 字段       | 说明          |
| ---------- | ------------- |
| POI 名称   | 高德返回名    |
| 地址       | 高德地址      |
| 区县       | 高德行政区    |
| 类型       | 高德类型      |
| 坐标       | GCJ-02        |
| 名称相似度 | 本地计算      |
| 地址匹配度 | 本地计算      |
| 品类匹配度 | 本地计算      |
| 综合分     | `match_score` |

操作：

- 选中该 POI。
- 重新搜索。
- 修改关键词搜索。
- 创建无 POI 店铺。
- 标记暂不发布。
- 合并到已有店铺。

### 12.6 店铺合并页

触发场景：

- 多个候选匹配到同一高德 POI。
- 店名相似且坐标距离很近。
- 人工发现同一家店被重复创建。

展示字段：

| 字段        | 说明                        |
| ----------- | --------------------------- |
| 主店铺      | 合并后的保留店铺            |
| 待合并店铺  | 将被合并的候选              |
| POI 信息    | provider_poi_id、地址、坐标 |
| 来源视频    | 涉及视频列表                |
| 来源博主    | 涉及博主列表                |
| 卡片文案    | 哪个版本作为主展示          |
| 推荐菜      | 合并后保留列表              |
| 负面/争议点 | 合并后保留列表              |

操作：

- 确认合并。
- 取消合并。
- 拆分为不同分店。
- 选择主文案。
- 选择主图。

### 12.7 已发布店铺编辑页

字段：

| 字段     | 可编辑        | 前台展示 |
| -------- | ------------- | -------- |
| 展示店名 | 是            | 是       |
| 品类     | 是            | 是       |
| 地址     | 通过 POI 修改 | 是       |
| 坐标     | 通过 POI 修改 | 是       |
| 推荐理由 | 是            | 是       |
| 副标题   | 是            | 是       |
| 推荐菜   | 是            | 是       |
| 避雷点   | 是            | 是       |
| 适合场景 | 是            | 是       |
| 人均提示 | 是            | 是       |
| 博主来源 | 否            | 是       |
| 视频来源 | 否            | 是       |
| 证据链   | 否            | 可选展示 |
| 发布状态 | 是            | 是       |

状态：

```text
draft
published
hidden
needs_recheck
rejected
```

## 13. 审核动作与状态流转

### 13.1 视频级动作

| 动作       | 前置状态                         | 后置状态                          |
| ---------- | -------------------------------- | --------------------------------- |
| 标记探店   | `classified`                     | `shop_candidates_extracted`       |
| 标记非探店 | 任意未发布状态                   | `non_shop_visit`                  |
| 重跑 ASR   | `asr_ready` / `text_unavailable` | `asr_ready` 或 `text_unavailable` |
| 重跑 AI    | `ai_structured` / `need_review`  | `ai_structured`                   |
| 驳回视频   | 任意未发布状态                   | `rejected`                        |

### 13.2 店铺候选动作

| 动作                          | 后置状态                               |
| ----------------------------- | -------------------------------------- |
| 修改候选信息                  | `need_review`                          |
| 搜索 POI                      | `poi_candidates_found`                 |
| 选择 POI                      | `poi_matched`                          |
| 合并到已有店铺                | `merged`                               |
| 驳回候选                      | `rejected`                             |
| 晋升为店铺（创建 `shops` 行） | `merged`（candidate）/ `draft`（shop） |
| 审核通过                      | `approved`（shop）                     |
| 发布                          | `published`（shop）                    |

候选级动作（修改 / 搜索 POI / 选 POI / 晋升 / 驳回）现在挂在 `/admin/videos/[id]` 视频处理控制台内，而不是工作台。审核通过与发布动作挂在 `/admin/shops/[id]` 店铺详情页。状态机如下：

```
candidate:    extracted -> poi_matched -> merged (when promoted to draft shop)
shop:         draft -> approved -> published
              ↑
         (no direct promote-to-published; must pass through approved)
```

### 13.3 需要记录的审计字段

```json
{
  "review_id": "review_01H...",
  "entity_type": "shop_candidate",
  "entity_id": "cand_01H...",
  "action": "select_poi",
  "before": {},
  "after": {},
  "reviewer_id": "user_01H...",
  "reason": "高德候选地址与评论线索一致",
  "created_at": "2026-06-16T00:00:00Z"
}
```

## 14. Prompt 契约

### 14.1 通用系统约束

所有 AI 阶段都应包含这些约束：

```text
你是视频内容结构化分析器。你只能根据输入材料输出结论。
不要编造店名、地址、价格、菜品、营业状态。
如果信息不足，输出 unknown/null/[]，并在 missing_fields 或 risk_flags 中标记。
所有关键结论必须引用 evidence_ids。
只输出合法 JSON，不要输出 Markdown 或解释。
```

### 14.2 视频级总结 Prompt 输入结构

```json
{
  "video_metadata": {},
  "transcript_segments": [
    {
      "segment_id": "seg_001",
      "start_sec": 0,
      "end_sec": 8.4,
      "text": "..."
    }
  ],
  "comment_signals": {},
  "previous_stage_outputs": {},
  "output_schema": "video_structured_analysis.v2"
}
```

### 14.3 输出后处理

AI 输出不能直接写入最终业务表。建议顺序：

1. JSON parse。
2. Schema validate。
3. Enum validate。
4. Evidence validate。
5. Risk rule evaluate。
6. Generate review tasks。
7. Save immutable raw output。
8. Save normalized result。

## 15. API 草案

后台 MVP 可先做这些接口：

```text
POST /api/admin/creators
POST /api/admin/creators/:id/sync
GET  /api/admin/videos
GET  /api/admin/videos/:id
POST /api/admin/videos/:id/retry-asr
POST /api/admin/videos/:id/retry-ai
POST /api/admin/videos/:id/mark-non-shop

GET  /api/admin/shop-candidates
GET  /api/admin/shop-candidates/:id
PATCH /api/admin/shop-candidates/:id
POST /api/admin/shop-candidates/:id/search-poi
POST /api/admin/shop-candidates/:id/select-poi
POST /api/admin/shop-candidates/:id/reject

GET  /api/admin/shops
GET  /api/admin/shops/:id
PATCH /api/admin/shops/:id
POST /api/admin/shops/:id/publish
POST /api/admin/shops/merge
```

前台 MVP：

```text
GET /api/shops/recommended
GET /api/shops/:id
GET /api/shops/map
GET /api/creators
GET /api/creators/:id
POST /api/users/events
POST /api/users/favorites
```

## 16. 下一步开发切分

建议按这 5 个任务包推进：

1. Schema 与数据库模型：定义 Pydantic/Zod Schema、数据库表、状态枚举。
2. AI Worker：视频分类、候选抽取、评论增强、结构化总结。
3. POI Worker：高德搜索、候选重排、匹配状态。
4. 后台审核：工作台、视频详情、候选审核、POI 审核。
5. 前台展示：卡片流、地图 pin、博主页、店铺详情。

## 17. 已落地实现（2026-06-17）

仓库当前处于 **M0 完成 / M1 起步**。本规范对应的代码位置：

| 规范章节                 | 实现位置                                                                                                                                   | 状态                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| §5 视频分类 Schema       | `apps/ai-worker/app/schemas.py:42-54`（Pydantic）+ `packages/shared/src/schemas.ts:25-38`（Zod）                                           | ✅ mock 返回                    |
| §6 评论线索 Schema       | `apps/ai-worker/app/main.py:75-95`（FastAPI 端点）+ `packages/shared/src/schemas.ts:40-87`                                                 | ✅ mock 返回                    |
| §7 视频结构化分析 Schema | `apps/ai-worker/app/main.py:98-167` + `packages/shared/src/schemas.ts:104-175`                                                             | ✅ mock 返回                    |
| §8 POI 匹配 Schema       | `apps/worker/src/adapters/poi.ts` + `packages/shared/src/schemas.ts:177-212`                                                               | ✅ mock 返回                    |
| §9 发布快照 Schema       | `apps/api/src/routes/admin.ts` `POST /api/admin/shops/:id/publish` 事务 + `published_shop_snapshots`                                       | ✅ 实现                         |
| §10 校验                 | `packages/shared/src/validation.ts` `findStructuredAnalysisIssues` + `evaluateClassificationReviewNeed`                                    | ✅ 实现                         |
| §11 后台信息架构         | `apps/web/src/app/admin/page.tsx`（`AdminConsole`）                                                                                        | ✅ 实现                         |
| §12 后台页面字段         | `AdminConsole` 内嵌 Form + DataTable，按 11.1 一级菜单简化                                                                                 | 🟡 MVP 简化                     |
| §13 状态流转             | `apps/worker/src/jobs/pipeline.ts` 推动 `videos.workflow_status` 与 `shop_candidates.status`                                               | ✅ 实现（POI / merge 流转除外） |
| §14 Prompt 契约          | `apps/worker/src/jobs/pipeline.ts` 每次写 `ai_runs` 带 `stage`、`provider='mock'`、`model='mock-*'`、`prompt_version='*.v1'`、`input_hash` | ✅ 实现                         |
| §15 API 草案             | `apps/api/src/routes/{public,admin,auth}.ts` + `docs/openapi.yaml`                                                                         | ✅ 实现（合并接口占位）         |

落地策略与规范的差异：

- **双 schema 校验**：Zod（TS）给 worker 用，Pydantic（Python）给 AI worker 用。两边都基于 §5-§9 的字段定义；M1 真实 LLM 时应让 Python 输出 Pydantic，TS 端 Zod 反向校验。
- **AI 输出落库顺序**：规范 §14.3 是 8 步流程；`apps/worker/src/jobs/pipeline.ts` 当前是"HTTP 取 JSON → Zod parse → 写 ai_runs → 写业务表"，简化了"独立 raw_output 持久化"（M0 不持久化模型原始输出文本，只存 `output_payload`）。
- **AI 工作流 status 推进**：M0 由 pipeline 自动推到 `ai_structured`；`need_review` / `approved` / `published` / `rejected` 由人工通过 `/api/admin/*` 流转；`POST /api/admin/shops/merge` 是占位符（M3）。
- **POI 状态**：spec 列了 7 态；当前 M0 实现只显式写 `poi_matched` / `poi_match_need_review` / `extracted`；`low_confidence` / `no_candidate` 留给 M1 真实高德实现。
- **后台 UI**：AdminConsole 把视频任务 / 候选店铺 / 已发布店铺合并在单页；视频详情三栏审核页（spec §12.3）M1+ 实现。
- **审计日志**：`packages/db/src/schema.ts` 中 `review_events` 字段为 `task_id`/`actor_id`/`note`，但 SQL 是 `review_task_id`/`reviewer_id`/`reason`。M0 暂未写 `review_events`（人工编辑路径未实现），drift 在 M1 修复前不会引爆。

后续按 M1-M5 推进，逐步覆盖本规范未落地的部分。
