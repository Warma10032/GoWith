function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function addIds(target: Set<string>, value: unknown) {
  if (!Array.isArray(value)) return;
  for (const id of value) {
    if (typeof id === "string" && id.trim()) target.add(id);
  }
}

function addConclusionIds(target: Set<string>, value: unknown) {
  if (!Array.isArray(value)) return;
  for (const item of value) addIds(target, asRecord(item).evidence_ids);
}

export function collectCandidateEvidenceIds(input: {
  card_payload: unknown;
  review_dimensions: unknown;
  comment_summary: unknown;
}) {
  const ids = new Set<string>();
  const card = asRecord(input.card_payload);
  addIds(ids, card.recommendation_score_evidence_ids);
  addConclusionIds(ids, card.recommended_dishes);
  addConclusionIds(ids, card.avoid_points);

  for (const dimension of Object.values(asRecord(input.review_dimensions))) {
    addIds(ids, asRecord(dimension).evidence_ids);
  }
  addIds(ids, asRecord(input.comment_summary).evidence_ids);
  return [...ids];
}
