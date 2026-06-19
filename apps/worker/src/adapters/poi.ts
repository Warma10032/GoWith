import crypto from "node:crypto";
import type { Kysely } from "kysely";
import type { DB, Json } from "@gowith/db";
import type { PoiMatchResult } from "@gowith/shared";
import { env } from "../env";

type PoiSearchOverrides = {
  keywords?: string;
  region?: string;
  types?: string;
};

type PoiSearchResult = PoiMatchResult & {
  query_payload: Record<string, unknown>;
  raw_payload_id: string | null;
};

type AmapPoi = {
  id?: string;
  name?: string;
  address?: string | unknown[];
  location?: string;
  type?: string;
  typecode?: string;
  pname?: string;
  cityname?: string;
  adname?: string;
  business?: {
    business_area?: string;
    tel?: string;
    opentime_week?: string;
    opentime_today?: string;
    cost?: string;
    rating?: string;
  };
};

type AmapTextResponse = {
  status?: string;
  info?: string;
  infocode?: string;
  count?: string;
  pois?: AmapPoi[] | { poi?: AmapPoi[] };
};

type CandidateContext = {
  id: string;
  candidate_name: string | null;
  normalized_name: string | null;
  category_primary: string | null;
  category_secondary: string | null;
  city: string | null;
  district: string | null;
  business_area: string | null;
  address_hint: string | null;
  risk_flags: string[];
};

type PoiMatchFeatures = {
  name_similarity: number;
  city_match: number;
  district_match: number;
  business_area_match: number;
  address_text_match: number;
  category_match: number;
};

function safeText(value: string | unknown[] | null | undefined): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function normalizeKeyword(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

function compactText(parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ");
}

function diceSimilarity(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const a = (left ?? "").replace(/\s+/g, "").toLowerCase();
  const b = (right ?? "").replace(/\s+/g, "").toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.86;
  const grams = (value: string) => {
    const result = new Map<string, number>();
    for (let index = 0; index < value.length - 1; index += 1) {
      const gram = value.slice(index, index + 2);
      result.set(gram, (result.get(gram) ?? 0) + 1);
    }
    return result;
  };
  const leftGrams = grams(a);
  const rightGrams = grams(b);
  let overlap = 0;
  for (const [gram, count] of leftGrams)
    overlap += Math.min(count, rightGrams.get(gram) ?? 0);
  const total = Math.max(
    1,
    [...leftGrams.values()].reduce((sum, count) => sum + count, 0) +
      [...rightGrams.values()].reduce((sum, count) => sum + count, 0),
  );
  return (2 * overlap) / total;
}

function parseLocation(
  value: string | undefined,
): { lng: number; lat: number } | null {
  if (!value) return null;
  const [lngText, latText] = value.split(",");
  const lng = Number(lngText);
  const lat = Number(latText);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

function buildQuery(
  candidate: CandidateContext,
  overrides: PoiSearchOverrides,
) {
  const inferredKeyword =
    candidate.candidate_name ??
    candidate.normalized_name ??
    compactText([
      candidate.business_area,
      candidate.address_hint,
      candidate.category_primary,
    ]);
  const keywords = normalizeKeyword(overrides.keywords ?? inferredKeyword);
  const region = normalizeKeyword(
    overrides.region ?? candidate.district ?? candidate.city ?? "",
  );
  const types = overrides.types?.trim() || undefined;
  const forcedReview =
    !candidate.candidate_name ||
    candidate.risk_flags.includes("shop_name_missing") ||
    candidate.risk_flags.includes("generic_name_risk");
  return {
    keywords,
    region,
    types,
    city_limit: Boolean(region),
    forced_review: forcedReview,
    source: {
      candidate_name: candidate.candidate_name,
      city: candidate.city,
      district: candidate.district,
      business_area: candidate.business_area,
      address_hint: candidate.address_hint,
      category_primary: candidate.category_primary,
      category_secondary: candidate.category_secondary,
    },
  };
}

function matchFeatures(
  candidate: CandidateContext,
  poi: AmapPoi,
): PoiMatchFeatures {
  const address = safeText(poi.address);
  const businessArea = poi.business?.business_area ?? null;
  const categoryText = poi.type ?? "";
  const nameSimilarity = diceSimilarity(
    candidate.candidate_name ?? candidate.normalized_name,
    poi.name,
  );
  const cityMatch =
    candidate.city && poi.cityname?.includes(candidate.city.replace(/市$/, ""))
      ? 1
      : 0;
  const districtMatch =
    candidate.district &&
    poi.adname?.includes(candidate.district.replace(/区|县|市$/, ""))
      ? 1
      : 0;
  const businessAreaMatch =
    candidate.business_area && businessArea?.includes(candidate.business_area)
      ? 1
      : 0;
  const addressTextMatch =
    candidate.address_hint && address
      ? diceSimilarity(candidate.address_hint, address)
      : 0;
  const categoryMatch =
    candidate.category_primary &&
    categoryText.includes(candidate.category_primary)
      ? 0.8
      : categoryText.includes("餐饮")
        ? 0.6
        : 0;
  return {
    name_similarity: Number(nameSimilarity.toFixed(4)),
    city_match: cityMatch,
    district_match: districtMatch,
    business_area_match: businessAreaMatch,
    address_text_match: Number(addressTextMatch.toFixed(4)),
    category_match: categoryMatch,
  };
}

function scoreFeatures(
  features: PoiMatchFeatures,
  forcedReview: boolean,
): number {
  const score =
    features.name_similarity * 0.46 +
    features.city_match * 0.16 +
    features.district_match * 0.1 +
    features.business_area_match * 0.08 +
    features.address_text_match * 0.12 +
    features.category_match * 0.08;
  return Number(
    Math.min(forcedReview ? 0.88 : 1, Math.max(0, score)).toFixed(4),
  );
}

function riskFlagsFor(
  candidate: CandidateContext,
  candidates: Array<{ name: string; match_score: number }>,
  forcedReview: boolean,
): PoiMatchResult["risk_flags"] {
  const flags = new Set<PoiMatchResult["risk_flags"][number]>();
  if (!candidate.candidate_name) flags.add("shop_name_missing");
  if (forcedReview) flags.add("needs_manual_review");
  if (candidate.risk_flags.includes("closed_or_moved_mentioned"))
    flags.add("closed_or_moved_mentioned");
  const bestName = candidates[0]?.name;
  const sameNameCount = bestName
    ? candidates.filter(
        (item) => item.name === bestName && item.match_score >= 0.65,
      ).length
    : 0;
  if (sameNameCount > 1) flags.add("poi_many_same_name_candidates");
  if (!candidates.length) flags.add("poi_no_candidate");
  else if ((candidates[0]?.match_score ?? 0) < 0.65)
    flags.add("poi_low_confidence");
  return [...flags];
}

export function normalizeAmapTextResponse(
  candidate: CandidateContext,
  response: AmapTextResponse,
  query: ReturnType<typeof buildQuery>,
  rawPayloadId: string | null,
): PoiSearchResult {
  const pois = Array.isArray(response.pois)
    ? response.pois
    : (response.pois?.poi ?? []);
  const candidates = pois
    .map((poi) => {
      const location = parseLocation(poi.location);
      if (!poi.id || !poi.name || !location) return null;
      const features = matchFeatures(candidate, poi);
      return {
        provider_poi_id: poi.id,
        name: poi.name,
        address: safeText(poi.address),
        province: poi.pname ?? null,
        city: poi.cityname ?? null,
        district: poi.adname ?? null,
        business_area: poi.business?.business_area ?? null,
        location: { ...location, coord_type: "gcj02" as const },
        category: poi.type ?? null,
        category_code: poi.typecode ?? null,
        match_features: features,
        match_score: scoreFeatures(features, query.forced_review),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.match_score - left.match_score)
    .slice(0, 10);

  const risk_flags = riskFlagsFor(candidate, candidates, query.forced_review);
  const selected = candidates[0];
  const matchScore = selected?.match_score ?? 0;
  const matchStatus: PoiMatchResult["match_status"] = !selected
    ? "no_candidate"
    : matchScore >= 0.9 && risk_flags.length === 0
      ? "auto_matched"
      : matchScore >= 0.65
        ? "need_review"
        : "low_confidence";

  return {
    schema_version: "poi_match.v1",
    candidate_id: candidate.id,
    provider: "amap",
    selected_poi: selected
      ? {
          provider_poi_id: selected.provider_poi_id,
          name: selected.name,
          address: selected.address,
          province: selected.province,
          city: selected.city,
          district: selected.district,
          business_area: selected.business_area,
          location: selected.location,
          category: selected.category,
          raw_provider_payload_id: rawPayloadId,
        }
      : null,
    candidates,
    match_score: matchScore,
    match_status: matchStatus,
    risk_flags,
    manual_review_reasons: risk_flags.length
      ? ["高德 POI 匹配存在不确定性，需要人工确认。"]
      : [],
    query_payload: query,
    raw_payload_id: rawPayloadId,
  };
}

async function saveRawAmapPayload(
  db: Kysely<DB>,
  candidateId: string,
  requestPayload: Record<string, unknown>,
  payload: AmapTextResponse,
) {
  const sanitized = { request: requestPayload, response: payload };
  const serialized = JSON.stringify(sanitized);
  const requestHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(requestPayload))
    .digest("hex");
  const payloadHash = crypto
    .createHash("sha256")
    .update(serialized)
    .digest("hex");
  const [row] = await db
    .insertInto("raw_ingest_payloads")
    .values({
      id: crypto.randomUUID(),
      provider: "amap",
      resource_type: "poi_search",
      resource_key: candidateId,
      request_hash: requestHash,
      payload: sanitized as unknown as Json,
      object_key: null,
      payload_sha256: payloadHash,
      fetched_at: new Date(),
      expires_at: null,
      created_at: new Date(),
    })
    .onConflict((oc) =>
      oc.columns(["provider", "request_hash"]).doUpdateSet({
        payload: sanitized as unknown as Json,
        payload_sha256: payloadHash,
        fetched_at: new Date(),
      }),
    )
    .returning(["id"])
    .execute();
  return row?.id ?? null;
}

export async function searchAmapPoi(
  db: Kysely<DB>,
  candidateId: string,
  overrides: PoiSearchOverrides = {},
): Promise<PoiSearchResult> {
  const candidate = await db
    .selectFrom("shop_candidates")
    .selectAll()
    .where("id", "=", candidateId)
    .executeTakeFirstOrThrow();
  const context: CandidateContext = {
    id: candidate.id,
    candidate_name: candidate.candidate_name,
    normalized_name: candidate.normalized_name,
    category_primary: candidate.category_primary,
    category_secondary: candidate.category_secondary,
    city: candidate.city,
    district: candidate.district,
    business_area: candidate.business_area,
    address_hint: candidate.address_hint,
    risk_flags: candidate.risk_flags,
  };
  const query = buildQuery(context, overrides);
  if (!query.keywords) {
    return normalizeAmapTextResponse(
      context,
      { status: "1", info: "OK", infocode: "10000", count: "0", pois: [] },
      query,
      null,
    );
  }
  if (!env.amapWebServiceKey)
    throw new Error("AMAP_WEB_SERVICE_KEY is required for live POI search");

  const requestPayload = {
    endpoint: "v5/place/text",
    keywords: query.keywords,
    region: query.region || undefined,
    city_limit: query.city_limit,
    types: query.types,
    page_size: 10,
    page_num: 1,
    show_fields: "business,photos",
  };
  const params = new URLSearchParams();
  params.set("key", env.amapWebServiceKey);
  params.set("keywords", query.keywords);
  if (query.region) params.set("region", query.region);
  params.set("city_limit", String(query.city_limit));
  if (query.types) params.set("types", query.types);
  params.set("page_size", "10");
  params.set("page_num", "1");
  params.set("show_fields", "business,photos");
  params.set("output", "json");

  const response = await fetch(
    `https://restapi.amap.com/v5/place/text?${params.toString()}`,
    {
      headers: { accept: "application/json" },
    },
  );
  if (!response.ok) throw new Error(`amap_http_${response.status}`);
  const payload = (await response.json()) as AmapTextResponse;
  const rawPayloadId = await saveRawAmapPayload(
    db,
    candidateId,
    requestPayload,
    payload,
  );
  if (payload.status !== "1")
    throw new Error(
      `amap_${payload.infocode ?? "unknown"}_${payload.info ?? "failed"}`,
    );
  return normalizeAmapTextResponse(context, payload, query, rawPayloadId);
}
