import crypto from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Kysely } from "kysely";
import type { DB, Json } from "@gowith/db";
import { env } from "../env";

type JsonRecord = Record<string, unknown>;

export interface TranscriptSegment {
  start_sec: number;
  end_sec: number;
  text: string;
}

export interface FetchedComment {
  id: string;
  content: string;
  like_count: number | null;
  reply_count: number | null;
  published_at: string | null;
  sample_type: "hot" | "latest" | "keyword";
  user_hash: string | null;
  raw_payload_id: string | null;
}

export interface FetchedVideo {
  bvid: string;
  aid: string | null;
  cid: string | null;
  title: string;
  description: string;
  cover_url: string | null;
  source_url: string;
  duration_sec: number | null;
  published_at: string;
  tags: string[];
  category: string | null;
  stats: JsonRecord;
  raw_payload_id: string | null;
  transcript: TranscriptSegment[];
  transcript_language: string | null;
  transcript_raw_payload_id: string | null;
  needs_asr: boolean;
  comments: FetchedComment[];
}

export interface CreatorPayload {
  name: string;
  avatar_url: string | null;
  bio: string | null;
  follower_count: number | null;
  raw_payload_id: string | null;
  videos: FetchedVideo[];
}

export interface CreatorProfilePayload {
  name: string;
  avatar_url: string | null;
  bio: string | null;
  follower_count: number | null;
  raw_payload_id: string | null;
}

export interface AudioDownload {
  filePath: string;
  fileName: string;
  mimeType: string;
  rawPayloadId: string | null;
  cleanup: () => Promise<void>;
}

export interface BilibiliCookiePoolCheckResult {
  checked: number;
  active: number;
  expired: number;
  risk: number;
  deleted_expired: number;
}

export class BilibiliError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BilibiliError";
  }
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const BILIBILI_API_BASE = "https://api.bilibili.com";
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29,
  28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22,
  25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
] as const;

const MOCK_CREATORS: Record<string, string> = {
  "3546888255048212": "食野地图",
  "99157282": "城市饭点",
  "1781681364": "咖啡因漫游",
  "544336675": "小巷开饭",
  "8263502": "周末去哪吃",
};

function mockPayload(uid: string): CreatorPayload {
  const name = MOCK_CREATORS[uid] ?? `B站博主 ${uid}`;
  const now = new Date().toISOString();
  return {
    name,
    avatar_url: "https://i0.hdslb.com/bfs/face/mock.jpg",
    bio: "Mock creator profile for local development.",
    follower_count: 120000,
    raw_payload_id: null,
    videos: [
      {
        bvid: `BV${uid.slice(-8)}A1`,
        aid: null,
        cid: null,
        title: `${name}在上海找到一家牛肉面小店`,
        description: "本期探店上海南京东路附近的面馆，主打牛肉面和卤味。",
        cover_url: "https://i0.hdslb.com/bfs/archive/mock-cover.jpg",
        source_url: `https://www.bilibili.com/video/BV${uid.slice(-8)}A1`,
        duration_sec: 420,
        published_at: now,
        tags: ["探店", "上海", "牛肉面"],
        category: "美食",
        stats: { view: 230000, like: 12000, reply: 360 },
        raw_payload_id: null,
        transcript: [
          { start_sec: 12, end_sec: 25, text: "今天来南京东路附近吃一家牛肉面。" },
          { start_sec: 80, end_sec: 96, text: "牛肉给得很足，汤底是浓郁型。" },
          { start_sec: 120, end_sec: 135, text: "高峰期排队比较久，人均大概三十。" },
        ],
        transcript_language: "zh-CN",
        transcript_raw_payload_id: null,
        needs_asr: false,
        comments: [
          {
            id: `${uid}-c1`,
            content: "这家是不是南京东路那家？上周去还在排队。",
            like_count: 88,
            reply_count: 2,
            published_at: now,
            sample_type: "hot",
            user_hash: null,
            raw_payload_id: null,
          },
          {
            id: `${uid}-c2`,
            content: "牛肉面确实分量足，但是饭点要等。",
            like_count: 35,
            reply_count: 0,
            published_at: now,
            sample_type: "latest",
            user_hash: null,
            raw_payload_id: null,
          },
        ],
      },
      {
        bvid: `BV${uid.slice(-8)}B2`,
        aid: null,
        cid: null,
        title: `${name}的周末城市散步`,
        description: "城市散步和聊天，非线下店铺探店。",
        cover_url: "https://i0.hdslb.com/bfs/archive/mock-cover-2.jpg",
        source_url: `https://www.bilibili.com/video/BV${uid.slice(-8)}B2`,
        duration_sec: 300,
        published_at: now,
        tags: ["vlog", "散步"],
        category: "生活",
        stats: { view: 51000, like: 3200, reply: 84 },
        raw_payload_id: null,
        transcript: [{ start_sec: 10, end_sec: 40, text: "今天主要是城市散步，没有具体探店。" }],
        transcript_language: "zh-CN",
        transcript_raw_payload_id: null,
        needs_asr: false,
        comments: [],
      },
    ],
  };
}

function mockProfilePayload(uid: string): CreatorProfilePayload {
  const payload = mockPayload(uid);
  return {
    name: payload.name,
    avatar_url: payload.avatar_url,
    bio: payload.bio,
    follower_count: payload.follower_count,
    raw_payload_id: payload.raw_payload_id,
  };
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function md5(value: string): string {
  return crypto.createHash("md5").update(value).digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const parsed = asString(value);
    if (parsed && parsed.trim()) return parsed;
  }
  return null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function publishedAtFromSeconds(value: unknown): string {
  const seconds = asNumber(value);
  return seconds ? new Date(seconds * 1000).toISOString() : new Date().toISOString();
}

function parseDurationSeconds(value: unknown): number | null {
  const numeric = asNumber(value);
  if (numeric !== null) return numeric;
  const text = asString(value);
  if (!text) return null;
  const parts = text.split(":").map((part) => Number(part));
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith("//")) return `https:${value}`;
  return value;
}

function normalizeAudioMimeType(value: string | null): string {
  const mimeType = value?.split(";")[0]?.trim().toLowerCase();
  if (!mimeType || mimeType === "audio/m4s" || mimeType === "application/octet-stream") {
    return "audio/m4a";
  }
  return mimeType;
}

function accountStatusFromNavPayload(value: unknown): { status: "active" | "expired" | "risk"; code: string | null; message: string | null } {
  const record = asRecord(value);
  const code = asNumber(record.code);
  const message = firstString(record.message) ?? null;
  const data = asRecord(record.data);
  if (firstString(data.v_voucher) || /风控|risk|验证码|v_voucher/i.test(message ?? "")) {
    return { status: "risk", code: "risk_control", message: message ?? "Bilibili returned risk control" };
  }
  if (code === -101 || code === -102 || data.isLogin === false) {
    return { status: "expired", code: "login_expired", message: message ?? "Bilibili cookie is not logged in" };
  }
  if (code !== null && code !== 0) {
    const classified = classifyBilibiliCode(code, message ?? "");
    return {
      status: classified === "risk_control" ? "risk" : classified === "login_expired" ? "expired" : "active",
      code: classified,
      message: message ?? `Bilibili API error ${code}`,
    };
  }
  return { status: "active", code: null, message: null };
}

function removeWbiUnsafeChars(value: string): string {
  return value.replace(/[!'()*]/g, "");
}

export function encodeWbiComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function mixinKey(rawKey: string): string {
  return MIXIN_KEY_ENC_TAB.map((index) => rawKey[index] ?? "").join("").slice(0, 32);
}

export function signWbiParams(
  params: Record<string, string | number | boolean | null | undefined>,
  imgKey: string,
  subKey: string,
  timestampSeconds = Math.floor(Date.now() / 1000),
): Record<string, string> {
  const unsigned: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    unsigned[key] = removeWbiUnsafeChars(String(value));
  }
  unsigned.wts = String(timestampSeconds);
  const sortedQuery = Object.keys(unsigned)
    .sort()
    .map((key) => `${encodeWbiComponent(key)}=${encodeWbiComponent(unsigned[key] ?? "")}`)
    .join("&");
  return { ...unsigned, w_rid: md5(`${sortedQuery}${mixinKey(`${imgKey}${subKey}`)}`) };
}

function buildQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `${encodeWbiComponent(key)}=${encodeWbiComponent(String(value))}`)
    .join("&");
}

function keyFromWbiUrl(value: unknown): string | null {
  const url = asString(value);
  if (!url) return null;
  const filename = url.split("/").pop();
  return filename?.replace(/\.[^.]+$/, "") ?? null;
}

function classifyBilibiliCode(code: number, message: string): string {
  if (code === -101 || code === -102) return "login_expired";
  if (code === -403) return "wbi_signature_failed";
  if (code === -404 || code === 62002 || code === 62004 || code === 62012) return "video_unavailable";
  if (code === -412 || /风控|risk|验证码|v_voucher/i.test(message)) return "risk_control";
  if (code === -509 || /限流|频繁|rate/i.test(message)) return "rate_limited";
  if (code === -400 || code === -401) return "permission_denied";
  return "network_error";
}

function sanitizeBilibiliPayload(resourceType: string, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeBilibiliPayload(resourceType, item));
  if (!value || typeof value !== "object") return value;

  const result: JsonRecord = {};
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    if (resourceType === "playurl" && ["baseUrl", "base_url", "backupUrl", "backup_url", "url"].includes(key)) {
      result[key] = "[redacted_play_url]";
      continue;
    }
    if (key === "member") {
      const member = asRecord(child);
      const mid = asString(member.mid);
      result[key] = mid ? { mid_hash: sha256(mid) } : {};
      continue;
    }
    if (["cookie", "SESSDATA", "bili_jct"].includes(key)) {
      result[key] = "[redacted]";
      continue;
    }
    result[key] = sanitizeBilibiliPayload(resourceType, child);
  }
  return result;
}

async function saveRawPayload(
  db: Kysely<DB>,
  resourceType: string,
  resourceKey: string,
  payload: unknown,
): Promise<string> {
  const sanitized = sanitizeBilibiliPayload(resourceType, payload);
  const serialized = JSON.stringify(sanitized);
  const payloadSha = sha256(serialized);
  const requestHash = sha256(`${resourceType}:${resourceKey}:${payloadSha}`);
  const now = new Date();
  const row = await db
    .insertInto("raw_ingest_payloads")
    .values({
      id: crypto.randomUUID(),
      provider: "bilibili",
      resource_type: resourceType,
      resource_key: resourceKey,
      request_hash: requestHash,
      payload: sanitized as Json,
      object_key: null,
      payload_sha256: payloadSha,
      fetched_at: now,
      expires_at: null,
      created_at: now,
    })
    .onConflict((oc) =>
      oc.columns(["provider", "request_hash"]).doUpdateSet({
        payload: sanitized as Json,
        payload_sha256: payloadSha,
        fetched_at: now,
      }),
    )
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

function decryptSecret(encoded: string): string {
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const key = crypto.createHash("sha256").update(env.cookieEncryptionKey).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function normalizeSubtitleBody(value: unknown): TranscriptSegment[] {
  const body = asArray(asRecord(value).body);
  return body
    .map((item) => {
      const record = asRecord(item);
      const text = firstString(record.content, record.text)?.trim();
      const start = asNumber(record.from ?? record.start_sec ?? record.start);
      const end = asNumber(record.to ?? record.end_sec ?? record.end);
      if (!text || start === null || end === null) return null;
      return { start_sec: start, end_sec: end, text };
    })
    .filter((segment): segment is TranscriptSegment => segment !== null);
}

export function mapViewDetailToVideoMetadata(bvid: string, detail: unknown, rawPayloadId: string | null): FetchedVideo {
  const data = asRecord(asRecord(detail).data);
  const view = asRecord(data.View ?? data.view ?? data);
  const stats = asRecord(view.stat);
  const firstPage = asRecord(asArray(view.pages)[0]);
  const aid = asString(view.aid);
  const cid = firstString(view.cid, firstPage.cid);
  const title = firstString(view.title) ?? bvid;
  const description = firstString(view.desc, view.description) ?? "";
  const tags = uniqueStrings(
    asArray(data.Tags)
      .map((tag) => firstString(asRecord(tag).tag_name, asRecord(tag).name))
      .filter((tag): tag is string => Boolean(tag)),
  );

  return {
    bvid,
    aid,
    cid,
    title,
    description,
    cover_url: normalizeUrl(firstString(view.pic, view.cover)),
    source_url: `https://www.bilibili.com/video/${bvid}`,
    duration_sec: parseDurationSeconds(view.duration ?? firstPage.duration),
    published_at: publishedAtFromSeconds(view.pubdate),
    tags,
    category: firstString(view.tname_v2, view.tname, view.type_name),
    stats,
    raw_payload_id: rawPayloadId,
    transcript: [],
    transcript_language: null,
    transcript_raw_payload_id: null,
    needs_asr: true,
    comments: [],
  };
}

class LiveBilibiliClient {
  private cookie: string | null = null;
  private accountId: string | null = null;
  private lastRequestAt = 0;
  private wbi: { imgKey: string; subKey: string; expiresAt: number } | null = null;

  constructor(private readonly db: Kysely<DB>) {}

  async fetchCreatorProfile(uid: string): Promise<CreatorProfilePayload> {
    try {
      try {
        await this.loadAccount();
      } catch (error) {
        if (!(error instanceof BilibiliError) || error.code !== "login_expired") throw error;
      }
      const creatorInfo = await this.fetchCreatorInfo(uid);
      await this.markAccountSuccess();
      return {
        name: creatorInfo.name ?? `B站 UID ${uid}`,
        avatar_url: creatorInfo.avatarUrl,
        bio: creatorInfo.bio,
        follower_count: creatorInfo.followerCount,
        raw_payload_id: creatorInfo.rawPayloadId,
      };
    } catch (error) {
      await this.markAccountFailure(error);
      throw error;
    }
  }

  async fetchCreatorVideos(uid: string): Promise<CreatorPayload> {
    try {
      await this.loadAccount();
      const creatorInfo = await this.fetchCreatorInfo(uid);
      const videos = await this.fetchVideoList(uid);
      const enrichedVideos: FetchedVideo[] = [];
      const maxVideos = env.bilibiliMaxVideosPerCreator;
      const selectedVideos = maxVideos > 0 ? videos.slice(0, maxVideos) : videos;

      for (const listVideo of selectedVideos) {
        const detailVideo = await this.fetchVideoDetail(listVideo.bvid);
        const video = { ...listVideo, ...detailVideo };
        const subtitle = video.cid ? await this.fetchSubtitle(video.bvid, video.cid) : null;
        const comments = video.aid ? await this.fetchComments(video.aid) : [];
        enrichedVideos.push({
          ...video,
          transcript: subtitle?.segments ?? [],
          transcript_language: subtitle?.language ?? null,
          transcript_raw_payload_id: subtitle?.rawPayloadId ?? null,
          needs_asr: !subtitle?.segments.length,
          comments,
        });
      }

      await this.markAccountSuccess();
      return {
        name: creatorInfo.name ?? `B站 UID ${uid}`,
        avatar_url: creatorInfo.avatarUrl,
        bio: creatorInfo.bio,
        follower_count: creatorInfo.followerCount,
        raw_payload_id: creatorInfo.rawPayloadId,
        videos: enrichedVideos,
      };
    } catch (error) {
      await this.markAccountFailure(error);
      throw error;
    }
  }

  async fetchAudio(video: { bvid: string; cid: string | null }): Promise<AudioDownload> {
    try {
      if (!video.cid) throw new BilibiliError("video_unavailable", "Video cid is required before ASR");
      await this.loadAccount();
      const { json, rawPayloadId } = await this.fetchPlayUrl(video.bvid, video.cid);
      const audio = this.pickAudioStream(json);
      const response = await this.fetchWithRateLimit(audio.url, {
        headers: this.headers(`https://www.bilibili.com/video/${video.bvid}`),
      });
      if (!response.ok) {
        throw new BilibiliError(response.status === 403 ? "permission_denied" : "network_error", `Audio download failed: ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const mimeType = normalizeAudioMimeType(response.headers.get("content-type") ?? audio.mimeType);
      const directory = await mkdtemp(path.join(tmpdir(), "gowith-bilibili-asr-"));
      const fileName = `${video.bvid}-${video.cid}.m4a`;
      const filePath = path.join(directory, fileName);
      await writeFile(filePath, buffer);
      await this.markAccountSuccess();
      return {
        filePath,
        fileName,
        mimeType,
        rawPayloadId,
        cleanup: async () => {
          await rm(directory, { recursive: true, force: true });
        },
      };
    } catch (error) {
      await this.markAccountFailure(error);
      throw error;
    }
  }

  private async fetchPlayUrl(bvid: string, cid: string): Promise<{ json: unknown; rawPayloadId: string | null }> {
    const params = { bvid, cid, fnval: 16 };
    try {
      return await this.requestJson("/x/player/wbi/playurl", params, {
        wbi: true,
        resourceType: "playurl",
        resourceKey: `${bvid}:${cid}`,
        referer: `https://www.bilibili.com/video/${bvid}`,
      });
    } catch (error) {
      if (!(error instanceof BilibiliError) || error.code !== "risk_control") throw error;
      return this.requestJson("/x/player/playurl", params, {
        wbi: false,
        resourceType: "playurl_public_fallback",
        resourceKey: `${bvid}:${cid}`,
        referer: `https://www.bilibili.com/video/${bvid}`,
      });
    }
  }

  private async fetchCreatorInfo(uid: string): Promise<{
    name: string | null;
    avatarUrl: string | null;
    bio: string | null;
    followerCount: number | null;
    rawPayloadId: string | null;
  }> {
    try {
      const { json, rawPayloadId } = await this.requestJson(
        "/x/space/wbi/acc/info",
        { mid: uid },
        {
          wbi: true,
          resourceType: "creator_info",
          resourceKey: uid,
          referer: `https://space.bilibili.com/${uid}`,
          requireLogin: false,
        },
      );
      const data = asRecord(asRecord(json).data);
      const followerCount = asNumber(data.follower);
      if (followerCount === null) {
        const cardInfo = await this.fetchCreatorCardInfo(uid);
        return {
          name: firstString(data.name) ?? cardInfo.name,
          avatarUrl: normalizeUrl(firstString(data.face)) ?? cardInfo.avatarUrl,
          bio: firstString(data.sign) ?? cardInfo.bio,
          followerCount: cardInfo.followerCount,
          rawPayloadId: cardInfo.rawPayloadId ?? rawPayloadId,
        };
      }
      return {
        name: firstString(data.name),
        avatarUrl: normalizeUrl(firstString(data.face)),
        bio: firstString(data.sign),
        followerCount,
        rawPayloadId,
      };
    } catch (error) {
      if (error instanceof BilibiliError && error.code === "video_unavailable") throw error;
      return this.fetchCreatorCardInfo(uid);
    }
  }

  private async fetchCreatorCardInfo(uid: string): Promise<{
    name: string | null;
    avatarUrl: string | null;
    bio: string | null;
    followerCount: number | null;
    rawPayloadId: string | null;
  }> {
    const { json, rawPayloadId } = await this.requestJson(
      "/x/web-interface/card",
      { mid: uid },
      {
        wbi: false,
        resourceType: "creator_card",
        resourceKey: uid,
        referer: `https://space.bilibili.com/${uid}`,
        requireLogin: false,
      },
    );
    const data = asRecord(asRecord(json).data);
    const card = asRecord(data.card);
    return {
      name: firstString(card.name),
      avatarUrl: normalizeUrl(firstString(card.face)),
      bio: firstString(card.sign, card.description),
      followerCount: asNumber(data.follower ?? card.fans),
      rawPayloadId,
    };
  }

  private async fetchVideoList(uid: string): Promise<FetchedVideo[]> {
    const videos: FetchedVideo[] = [];
    let page = 1;
    const pageSize = 30;
    while (true) {
      const { json, rawPayloadId } = await this.requestJson(
        "/x/space/wbi/arc/search",
        {
          mid: uid,
          pn: page,
          ps: pageSize,
          tid: 0,
          keyword: "",
          order: "pubdate",
          platform: "web",
          web_location: 1550101,
        },
        { wbi: true, resourceType: "creator_video_page", resourceKey: `${uid}:${page}`, referer: `https://space.bilibili.com/${uid}` },
      );
      const data = asRecord(asRecord(json).data);
      const list = asRecord(data.list);
      const vlist = asArray(list.vlist);
      if (!vlist.length) break;
      for (const item of vlist) {
        const record = asRecord(item);
        const bvid = firstString(record.bvid);
        if (!bvid) continue;
        videos.push({
          bvid,
          aid: asString(record.aid),
          cid: null,
          title: firstString(record.title) ?? bvid,
          description: firstString(record.description, record.desc) ?? "",
          cover_url: normalizeUrl(firstString(record.pic)),
          source_url: `https://www.bilibili.com/video/${bvid}`,
          duration_sec: parseDurationSeconds(record.length ?? record.duration),
          published_at: publishedAtFromSeconds(record.created ?? record.pubdate),
          tags: [],
          category: null,
          stats: {
            view: asNumber(record.play),
            reply: asNumber(record.comment),
            favorite: asNumber(record.favorites),
            author: firstString(record.author),
          },
          raw_payload_id: rawPayloadId,
          transcript: [],
          transcript_language: null,
          transcript_raw_payload_id: null,
          needs_asr: true,
          comments: [],
        });
      }
      const total = asNumber(asRecord(data.page).count);
      if (total !== null && videos.length >= total) break;
      if (env.bilibiliMaxVideosPerCreator > 0 && videos.length >= env.bilibiliMaxVideosPerCreator) break;
      page += 1;
    }
    return videos;
  }

  private async fetchVideoDetail(bvid: string): Promise<FetchedVideo> {
    const { json, rawPayloadId } = await this.requestJson(
      "/x/web-interface/wbi/view/detail",
      { bvid, need_elec: 0 },
      { wbi: true, resourceType: "video_detail", resourceKey: bvid, referer: `https://www.bilibili.com/video/${bvid}` },
    );
    return mapViewDetailToVideoMetadata(bvid, json, rawPayloadId);
  }

  private async fetchSubtitle(
    bvid: string,
    cid: string,
  ): Promise<{ segments: TranscriptSegment[]; language: string | null; rawPayloadId: string | null } | null> {
    const { json } = await this.requestJson(
      "/x/player/wbi/v2",
      { bvid, cid },
      { wbi: true, resourceType: "player_v2", resourceKey: `${bvid}:${cid}`, referer: `https://www.bilibili.com/video/${bvid}` },
    );
    const data = asRecord(asRecord(json).data);
    const subtitle = asRecord(data.subtitle);
    const candidates = [...asArray(subtitle.subtitles), ...asArray(subtitle.list)];
    const selected = this.selectSubtitle(candidates);
    if (!selected) return null;
    const subtitleUrl = normalizeUrl(firstString(selected.subtitle_url, selected.url));
    if (!subtitleUrl) return null;
    const response = await this.fetchWithRateLimit(subtitleUrl, {
      headers: this.headers(`https://www.bilibili.com/video/${bvid}`),
    });
    if (!response.ok) throw new BilibiliError("network_error", `Subtitle body fetch failed: ${response.status}`);
    const body = (await response.json()) as unknown;
    const rawPayloadId = await saveRawPayload(this.db, "subtitle_body", `${bvid}:${cid}:${firstString(selected.id) ?? "default"}`, body);
    const segments = normalizeSubtitleBody(body);
    return {
      segments,
      language: firstString(selected.lan, selected.lang, selected.lan_doc),
      rawPayloadId,
    };
  }

  private async fetchComments(aid: string): Promise<FetchedComment[]> {
    const totalLimit = Math.max(0, env.bilibiliCommentsLimitPerVideo);
    if (totalLimit === 0) return [];
    const perModeLimit = Math.max(1, Math.ceil(totalLimit / 2));
    const comments = new Map<string, FetchedComment>();
    await this.fetchCommentsByMode(aid, "hot", 3, perModeLimit, comments);
    if (comments.size < totalLimit) {
      await this.fetchCommentsByMode(aid, "latest", 2, totalLimit - comments.size, comments);
    }
    return [...comments.values()].slice(0, totalLimit);
  }

  private async fetchCommentsByMode(
    aid: string,
    sampleType: "hot" | "latest",
    mode: number,
    limit: number,
    comments: Map<string, FetchedComment>,
  ): Promise<void> {
    let offset = "";
    let page = 0;
    while (comments.size < env.bilibiliCommentsLimitPerVideo && limit > 0 && page < 6) {
      const params: Record<string, string | number> = {
        oid: aid,
        type: 1,
        mode,
        ps: Math.min(20, limit),
      };
      if (offset) params.pagination_str = JSON.stringify({ offset });
      const { json, rawPayloadId } = await this.requestJson(
        "/x/v2/reply/wbi/main",
        params,
        { wbi: true, resourceType: "comments_page", resourceKey: `${aid}:${sampleType}:${page}:${offset || "first"}` },
      );
      const data = asRecord(asRecord(json).data);
      const replies = [...asArray(data.top_replies), ...asArray(data.replies)];
      if (!replies.length) break;
      for (const reply of replies) {
        const mapped = this.mapReply(reply, sampleType, rawPayloadId);
        if (!mapped || comments.has(mapped.id)) continue;
        comments.set(mapped.id, mapped);
        limit -= 1;
        if (limit <= 0) break;
      }
      const nextOffset = firstString(asRecord(asRecord(data.cursor).pagination_reply).next_offset);
      if (!nextOffset || nextOffset === offset) break;
      offset = nextOffset;
      page += 1;
    }
  }

  private mapReply(value: unknown, sampleType: "hot" | "latest", rawPayloadId: string): FetchedComment | null {
    const reply = asRecord(value);
    const id = firstString(reply.rpid, reply.rpid_str);
    const content = firstString(asRecord(reply.content).message);
    if (!id || !content) return null;
    const mid = firstString(asRecord(reply.member).mid);
    const ctime = asNumber(reply.ctime);
    return {
      id,
      content,
      like_count: asNumber(reply.like),
      reply_count: asNumber(reply.rcount ?? reply.count),
      published_at: ctime ? new Date(ctime * 1000).toISOString() : null,
      sample_type: sampleType,
      user_hash: mid ? sha256(mid) : null,
      raw_payload_id: rawPayloadId,
    };
  }

  private selectSubtitle(candidates: unknown[]): JsonRecord | null {
    const records = candidates.map(asRecord).filter((record) => firstString(record.subtitle_url, record.url));
    return (
      records.find((record) => /zh|cn|中文|简体|繁体/i.test(`${firstString(record.lan, record.lang, record.lan_doc) ?? ""}`)) ??
      records[0] ??
      null
    );
  }

  private pickAudioStream(json: unknown): { url: string; mimeType: string } {
    const data = asRecord(asRecord(json).data);
    const dash = asRecord(data.dash);
    const audioStreams = asArray(dash.audio).map(asRecord);
    const sorted = audioStreams
      .map((audio) => ({
        url: normalizeUrl(firstString(audio.baseUrl, audio.base_url)),
        mimeType: firstString(audio.mimeType, audio.mime_type) ?? "audio/mp4",
        bandwidth: asNumber(audio.bandwidth) ?? Number.MAX_SAFE_INTEGER,
      }))
      .filter((audio): audio is { url: string; mimeType: string; bandwidth: number } => Boolean(audio.url))
      .sort((left, right) => left.bandwidth - right.bandwidth);
    const selected = sorted[0];
    if (!selected) throw new BilibiliError("video_unavailable", "No audio stream found for ASR");
    return selected;
  }

  private async requestJson(
    endpoint: string,
    params: Record<string, string | number | boolean | null | undefined>,
    options: { wbi: boolean; resourceType: string; resourceKey: string; referer?: string; requireLogin?: boolean },
    retried = false,
  ): Promise<{ json: unknown; rawPayloadId: string }> {
    const signed = options.wbi ? signWbiParams(params, ...(await this.ensureWbiKeys(options.requireLogin ?? true))) : params;
    const query = buildQuery(signed);
    const url = `${BILIBILI_API_BASE}${endpoint}${query ? `?${query}` : ""}`;
    const response = await this.fetchWithRateLimit(url, { headers: this.headers(options.referer) });
    if (response.status === 429) throw new BilibiliError("rate_limited", "Bilibili returned HTTP 429");
    if (response.status === 412) throw new BilibiliError("risk_control", "Bilibili returned HTTP 412 risk control");
    if (response.status === 403) throw new BilibiliError("permission_denied", "Bilibili returned HTTP 403");
    if (!response.ok) throw new BilibiliError("network_error", `Bilibili request failed: ${response.status}`);
    const json = (await response.json()) as unknown;
    const rawPayloadId = await saveRawPayload(this.db, options.resourceType, options.resourceKey, json);
    const record = asRecord(json);
    const code = asNumber(record.code);
    const message = firstString(record.message) ?? "";
    const data = asRecord(record.data);
    if (firstString(data.v_voucher)) {
      if (options.wbi && !retried) {
        this.wbi = null;
        return this.requestJson(endpoint, params, options, true);
      }
      throw new BilibiliError("wbi_signature_failed", "Bilibili returned v_voucher for signed request");
    }
    if (code !== null && code !== 0) {
      throw new BilibiliError(classifyBilibiliCode(code, message), `Bilibili API error ${code}: ${message}`);
    }
    return { json, rawPayloadId };
  }

  private async ensureWbiKeys(requireLogin = true): Promise<[string, string]> {
    if (this.wbi && this.wbi.expiresAt > Date.now()) return [this.wbi.imgKey, this.wbi.subKey];
    const response = await this.fetchWithRateLimit(`${BILIBILI_API_BASE}/x/web-interface/nav`, {
      headers: this.headers("https://www.bilibili.com"),
    });
    if (!response.ok) throw new BilibiliError("network_error", `Bilibili nav failed: ${response.status}`);
    const json = (await response.json()) as unknown;
    await saveRawPayload(this.db, "nav", "current", json);
    const data = asRecord(asRecord(json).data);
    if (requireLogin && data.isLogin === false) throw new BilibiliError("login_expired", "Bilibili cookie is not logged in");
    const wbiImg = asRecord(data.wbi_img);
    const imgKey = keyFromWbiUrl(wbiImg.img_url);
    const subKey = keyFromWbiUrl(wbiImg.sub_url);
    if (!imgKey || !subKey) throw new BilibiliError("wbi_signature_failed", "Unable to read Bilibili WBI keys");
    this.wbi = { imgKey, subKey, expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
    return [imgKey, subKey];
  }

  private headers(referer = "https://www.bilibili.com"): HeadersInit {
    return {
      "User-Agent": USER_AGENT,
      Referer: referer,
      Cookie: this.cookie ?? "",
      Accept: "application/json, text/plain, */*",
    };
  }

  private async fetchWithRateLimit(input: string, init: RequestInit): Promise<Response> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < env.bilibiliRequestIntervalMs) await sleep(env.bilibiliRequestIntervalMs - elapsed);
    this.lastRequestAt = Date.now();
    return fetch(input, init);
  }

  private async loadAccount(): Promise<void> {
    if (this.cookie && this.accountId) return;
    const account = await this.db
      .selectFrom("bilibili_auth_accounts")
      .selectAll()
      .where("status", "=", "active")
      .orderBy("last_success_at", "asc")
      .orderBy("created_at", "asc")
      .executeTakeFirst();
    if (!account) throw new BilibiliError("login_expired", "No active Bilibili cookie account configured");
    this.cookie = decryptSecret(account.encrypted_cookie);
    this.accountId = account.id;
  }

  private async markAccountSuccess(): Promise<void> {
    if (!this.accountId) return;
    await this.db
      .updateTable("bilibili_auth_accounts")
      .set({
        status: "active",
        last_health_check_at: new Date(),
        last_success_at: new Date(),
        last_error_code: null,
        last_error_message: null,
        updated_at: new Date(),
      })
      .where("id", "=", this.accountId)
      .execute();
  }

  private async markAccountFailure(error: unknown): Promise<void> {
    if (!this.accountId) return;
    const code = error instanceof BilibiliError ? error.code : "network_error";
    await this.db
      .updateTable("bilibili_auth_accounts")
      .set({
        status: code === "login_expired" ? "expired" : code === "risk_control" ? "risk" : "active",
        last_health_check_at: new Date(),
        last_error_code: code,
        last_error_message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
        updated_at: new Date(),
      })
      .where("id", "=", this.accountId)
      .execute();
  }
}

export async function fetchCreatorVideos(db: Kysely<DB>, uid: string): Promise<CreatorPayload> {
  if (!env.isExternalLive) return mockPayload(uid);
  return new LiveBilibiliClient(db).fetchCreatorVideos(uid);
}

export async function checkBilibiliCookiePool(db: Kysely<DB>): Promise<BilibiliCookiePoolCheckResult> {
  const now = new Date();
  const accounts = await db
    .selectFrom("bilibili_auth_accounts")
    .select(["id", "encrypted_cookie", "status"])
    .where("status", "in", ["active", "risk"])
    .orderBy("last_health_check_at", "asc")
    .execute();

  let active = 0;
  let expired = 0;
  let risk = 0;
  for (const account of accounts) {
    try {
      const cookie = decryptSecret(account.encrypted_cookie);
      const response = await fetch(`${BILIBILI_API_BASE}/x/web-interface/nav`, {
        headers: {
          "User-Agent": USER_AGENT,
          Referer: "https://www.bilibili.com",
          Cookie: cookie,
          Accept: "application/json, text/plain, */*",
        },
      });
      const json = response.ok ? ((await response.json()) as unknown) : { code: response.status, message: `HTTP ${response.status}` };
      const result = accountStatusFromNavPayload(json);
      if (result.status === "active") active += 1;
      if (result.status === "expired") expired += 1;
      if (result.status === "risk") risk += 1;
      await db
        .updateTable("bilibili_auth_accounts")
        .set({
          status: result.status,
          last_health_check_at: now,
          last_success_at: result.status === "active" ? now : undefined,
          last_error_code: result.code,
          last_error_message: result.message?.slice(0, 500) ?? null,
          updated_at: now,
        })
        .where("id", "=", account.id)
        .execute();
    } catch (error) {
      risk += 1;
      await db
        .updateTable("bilibili_auth_accounts")
        .set({
          status: "risk",
          last_health_check_at: now,
          last_error_code: "network_error",
          last_error_message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
          updated_at: now,
        })
        .where("id", "=", account.id)
        .execute();
    }
  }

  const retentionMs = Math.max(1, env.bilibiliCookieExpiredRetentionDays) * 24 * 60 * 60 * 1000;
  const deleteBefore = new Date(Date.now() - retentionMs);
  const deleted = await db
    .deleteFrom("bilibili_auth_accounts")
    .where("status", "=", "expired")
    .where("updated_at", "<", deleteBefore)
    .executeTakeFirst();

  return {
    checked: accounts.length,
    active,
    expired,
    risk,
    deleted_expired: Number(deleted.numDeletedRows ?? 0),
  };
}

export async function fetchCreatorProfile(db: Kysely<DB>, uid: string): Promise<CreatorProfilePayload> {
  if (!env.isExternalLive) return mockProfilePayload(uid);
  return new LiveBilibiliClient(db).fetchCreatorProfile(uid);
}

export async function fetchVideoAudioForAsr(
  db: Kysely<DB>,
  video: { bvid: string; cid: string | null },
): Promise<AudioDownload> {
  if (!env.isExternalLive) {
    const directory = await mkdtemp(path.join(tmpdir(), "gowith-mock-asr-"));
    const fileName = `${video.bvid}-mock.txt`;
    const filePath = path.join(directory, fileName);
    await writeFile(filePath, "mock audio");
    return {
      filePath,
      fileName,
      mimeType: "text/plain",
      rawPayloadId: null,
      cleanup: async () => {
        await rm(directory, { recursive: true, force: true });
      },
    };
  }
  return new LiveBilibiliClient(db).fetchAudio(video);
}

export async function readAudioDownload(download: AudioDownload): Promise<Buffer> {
  return readFile(download.filePath);
}
