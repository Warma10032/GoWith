import type { VideoClassificationResult, VideoStructuredAnalysis } from "./schemas";

export function evaluateClassificationReviewNeed(result: VideoClassificationResult): boolean {
  return result.need_manual_review || result.confidence < 0.65 || result.risk_flags.length > 0;
}

export function findStructuredAnalysisIssues(result: VideoStructuredAnalysis): string[] {
  const issues: string[] = [];

  if (!result.video.evidence_ids.length) {
    issues.push("video_missing_evidence");
  }

  for (const candidate of result.shop_candidates) {
    if (!candidate.candidate_name && !candidate.risk_flags.includes("shop_name_missing")) {
      issues.push(`${candidate.candidate_id}:missing_shop_name_flag`);
    }

    if (candidate.card_payload.recommend_reason.length > 80) {
      issues.push(`${candidate.candidate_id}:recommend_reason_too_long`);
    }

    if (
      candidate.card_payload.recommendation_score !== null &&
      !candidate.card_payload.recommendation_score_evidence_ids.length
    ) {
      issues.push(`${candidate.candidate_id}:recommendation_score_missing_evidence`);
    }

    for (const dish of candidate.card_payload.recommended_dishes) {
      if (!dish.evidence_ids.length) {
        issues.push(`${candidate.candidate_id}:dish_missing_evidence`);
      }
    }
  }

  return issues;
}

