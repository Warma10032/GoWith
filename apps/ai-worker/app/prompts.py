from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal

from openai.types.chat import ChatCompletionMessageParam
from pydantic import BaseModel


ModelTier = Literal["simple", "complex"]


@dataclass(frozen=True)
class PromptSpec:
    key: str
    version: str
    model_tier: ModelTier
    objective: str
    source_priority: tuple[str, ...]
    decision_rules: tuple[str, ...]


COMMON_EVIDENCE_RULES = (
    "只能使用输入材料，不得补写未出现的店名、地址、价格、菜品或营业状态。",
    "结论必须引用输入中的 evidence_id、segment_id 或 comment_id。",
    "字幕和标题用于视频及博主结论；评论只能作为顾客反馈，不能覆盖博主结论。",
    "没有证据时使用 null、空字符串或空数组，不输出‘不清楚’‘信息不足’‘需要审核’。",
)

COMMON_OUTPUT_RULES = (
    "只输出一个符合目标 JSON Schema 的 JSON object。",
    "不要输出 Markdown、解释、前后缀或思维过程。",
    "不要在自然语言 summary 中写 evidence ID，ID 只放入 evidence_ids。",
)


PROMPTS: dict[str, PromptSpec] = {
    "classify_video": PromptSpec(
        key="classify_video",
        version="classify_video.v2",
        model_tier="simple",
        objective="判断视频是否属于线下探店，并给出内容类型、城市和餐饮品类提示。",
        source_priority=("字幕", "标题与简介", "标签", "评论不得决定分类"),
        decision_rules=(
            "出现具体线下店铺、到店过程或菜品体验时才判定为探店。",
            "置信度低不改变事实字段，只通过 confidence 和具体 risk_flags 表达。",
            "need_manual_review 固定为 false，系统审核由下游规则决定。",
        ),
    ),
    "comment_relevance_filter": PromptSpec(
        key="comment_relevance_filter",
        version="comment_relevance_filter.v1",
        model_tier="simple",
        objective="从评论样本中筛出只针对当前视频所探访店铺的评论。",
        source_priority=("视频店铺上下文", "评论正文", "评论互动数据仅作辅助"),
        decision_rules=(
            "保留明确评价当前店铺菜品、味道、价格、服务、环境、排队或到店体验的评论。",
            "排除其他店铺、泛城市讨论、博主玩梗、纯提问和无法确认对象的评论。",
            "评论未重复店名但语义明确承接视频中的菜品或体验时可以保留。",
        ),
    ),
    "comment_analysis": PromptSpec(
        key="comment_analysis",
        version="comment_analysis.v4",
        model_tier="complex",
        objective="仅基于已筛选评论，聚合当前店铺的顾客评价结论。",
        source_priority=("相关评论正文", "点赞和回复数仅用于权重", "不得使用无关评论"),
        decision_rules=(
            "优先分析 taste、dish_recommendation、value_for_money、service、environment、queue。",
            "同一维度同时存在正负评价时输出 mixed 或 controversial，并概括双方观点。",
            "未被明确提及的维度不要输出，禁止生成空 summary 的 unknown 维度。",
            "每个维度的 evidence_ids 只包含实际支撑该维度的 comment_id。",
        ),
    ),
    "transcript_fact_extraction": PromptSpec(
        key="transcript_fact_extraction",
        version="transcript_fact_extraction.v1",
        model_tier="simple",
        objective="从标题、简介、标签和字幕中提取店铺身份、位置与限定品类事实。",
        source_priority=("字幕中的明确陈述", "标题", "简介", "标签"),
        decision_rules=(
            "店名必须是输入中明确出现的完整名称，通用称呼不得扩写。",
            "位置按 country、province、city、district、address_text 分开提取。",
            "主品类和菜系只能从输入给定的允许值中选择。",
        ),
    ),
    "transcript_opinion_analysis": PromptSpec(
        key="transcript_opinion_analysis",
        version="transcript_opinion_analysis.v1",
        model_tier="complex",
        objective="沿字幕时间顺序分析博主态度、推荐菜、不推荐点和具体理由。",
        source_priority=("字幕原话", "已提取店铺事实用于指代消歧", "评论禁止参与"),
        decision_rules=(
            "先判断 recommend、conditional、not_recommend 或 unclear，再总结理由。",
            "理由必须包含菜品及味道、口感、价格或体验依据，不得复述标题。",
            "recommended_dishes 与 avoid_points 每项都必须引用字幕 segment_id。",
            "区分明确推荐、有限条件推荐、负面评价和仅建议猎奇尝试。",
        ),
    ),
    "structure_synthesis": PromptSpec(
        key="structure_synthesis",
        version="structure_synthesis.v4",
        model_tier="complex",
        objective="综合分类、店铺事实、博主观点和评论分析，生成唯一主店铺结构化卡片。",
        source_priority=("字幕事实与博主观点", "分类结果", "评论分析仅补充顾客反馈"),
        decision_rules=(
            "single_shop_visit 且存在明确店名证据时必须输出一个 shop_candidate。",
            "recommend_reason 只总结博主态度与字幕理由，不能使用评论结论替代。",
            "评论维度写入 review_dimensions 和 comment_summary，不混入推荐理由。",
            "最多输出一个主候选；tags 固定为空数组；文案不超过 100 个中文字符。",
        ),
    ),
    "json_repair": PromptSpec(
        key="json_repair",
        version="json_repair.v2",
        model_tier="simple",
        objective="只修复已有输出的 JSON 语法和字段形状，使其符合目标 Schema。",
        source_priority=("原始模型输出", "校验错误", "目标 JSON Schema"),
        decision_rules=(
            "保留原输出中的全部事实、结论和 evidence_ids。",
            "禁止新增、删除或改写业务结论；无法修复时保持原值并补齐结构默认值。",
            "本步骤不是重新分析任务，不得根据上下文生成新结论。",
        ),
    ),
    "structure_semantic_retry": PromptSpec(
        key="structure_semantic_retry",
        version="structure_semantic_retry.v1",
        model_tier="complex",
        objective="根据语义校验问题重新生成完整的视频与店铺结构化结果。",
        source_priority=("完整递进式分析上下文", "语义校验问题", "上一次结构化输出"),
        decision_rules=(
            "逐项修复 validation_errors，但不得牺牲已有有效事实和 evidence_ids。",
            "单店探店且已有店名事实时必须保留该候选。",
            "不得通过删除候选、推荐菜或证据来绕过校验。",
        ),
    ),
}


def prompt_spec(key: str) -> PromptSpec:
    return PROMPTS[key]


def build_messages(
    key: str,
    context: dict[str, Any],
    response_model: type[BaseModel],
) -> list[ChatCompletionMessageParam]:
    spec = prompt_spec(key)
    system_sections = [
        "# Role\n你是 GoWith 的探店内容结构化分析组件。",
        f"# Objective\n{spec.objective}",
        "# Source Priority\n" + "\n".join(f"{i + 1}. {rule}" for i, rule in enumerate(spec.source_priority)),
        "# Evidence Policy\n" + "\n".join(f"- {rule}" for rule in COMMON_EVIDENCE_RULES),
        "# Decision Rules\n" + "\n".join(f"- {rule}" for rule in spec.decision_rules),
        "# Output Contract\n" + "\n".join(f"- {rule}" for rule in COMMON_OUTPUT_RULES),
    ]
    return [
        {"role": "system", "content": "\n\n".join(system_sections)},
        {
            "role": "user",
            "content": json.dumps(
                {
                    "prompt_key": spec.key,
                    "prompt_version": spec.version,
                    "input": context,
                    "output_schema": response_model.model_json_schema(),
                },
                ensure_ascii=False,
            ),
        },
    ]
