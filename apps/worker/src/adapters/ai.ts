import { readFile } from "node:fs/promises";
import type {
  CommentSignalExtraction,
  VideoClassificationResult,
  VideoStructuredAnalysis,
} from "@gowith/shared";
import { env } from "../env";

export interface AsrTranscriptSegment {
  segment_id?: string | null;
  start_sec: number;
  end_sec: number;
  text: string;
  confidence?: number | null;
}

export interface AsrResponse {
  source: "asr";
  language: string;
  model_provider: string;
  model_name: string;
  content_text: string;
  segments: AsrTranscriptSegment[];
}

export interface CommentSample {
  comment_id: string;
  content: string;
  like_count: number | null;
  reply_count: number | null;
  sample_type: string | null;
  contains_location_signal: boolean;
  contains_shop_signal: boolean;
}

export interface VideoAnalysisRequest {
  video_metadata: {
    video_id: string;
    bvid: string;
    creator_id: string;
    title: string;
    description: string | null;
    tags: string[];
    category: string | null;
  };
  transcript_segments: AsrTranscriptSegment[];
  comment_samples: CommentSample[];
  comment_signals?: Record<string, unknown>;
  previous_stage_outputs?: Record<string, unknown>;
}

export interface AiResponseEnvelope<T> {
  output: T;
  provider: string;
  model: string;
  prompt_version: string;
  usage: Record<string, unknown>;
  raw_output_text: string | null;
}

export async function transcribeAudioFile(input: {
  filePath: string;
  fileName: string;
  mimeType: string;
}): Promise<AsrResponse> {
  const bytes = await readFile(input.filePath);
  const formData = new FormData();
  formData.append("file", new Blob([bytes], { type: input.mimeType }), input.fileName);
  const response = await fetch(`${env.aiWorkerUrl}/asr/transcribe`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`ASR request failed: ${response.status} ${message}`.trim());
  }
  return (await response.json()) as AsrResponse;
}

export function buildVideoAnalysisRequest(input: {
  video: {
    id: string;
    bvid: string;
    creator_id: string;
    title: string;
    description: string | null;
    tags: string[];
    category: string | null;
  };
  transcriptSegments: AsrTranscriptSegment[];
  commentSamples: CommentSample[];
  commentSignals?: Record<string, unknown>;
  previousStageOutputs?: Record<string, unknown>;
}): VideoAnalysisRequest {
  return {
    video_metadata: {
      video_id: input.video.id,
      bvid: input.video.bvid,
      creator_id: input.video.creator_id,
      title: input.video.title,
      description: input.video.description,
      tags: input.video.tags,
      category: input.video.category,
    },
    transcript_segments: input.transcriptSegments,
    comment_samples: input.commentSamples,
    comment_signals: input.commentSignals ?? {},
    previous_stage_outputs: input.previousStageOutputs ?? {},
  };
}

export async function classifyVideo(
  request: VideoAnalysisRequest,
): Promise<AiResponseEnvelope<VideoClassificationResult>> {
  return postAi<VideoClassificationResult>("/ai/classify-video", request);
}

export async function extractCommentSignals(
  request: VideoAnalysisRequest,
): Promise<AiResponseEnvelope<CommentSignalExtraction>> {
  return postAi<CommentSignalExtraction>("/ai/comment-signals", request);
}

export async function structureVideo(
  request: VideoAnalysisRequest,
): Promise<AiResponseEnvelope<VideoStructuredAnalysis>> {
  return postAi<VideoStructuredAnalysis>("/ai/structure-video", request);
}

async function postAi<T>(path: string, request: VideoAnalysisRequest): Promise<AiResponseEnvelope<T>> {
  const response = await fetch(`${env.aiWorkerUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`AI request failed: ${path} ${response.status} ${message}`.trim());
  }
  return (await response.json()) as AiResponseEnvelope<T>;
}
