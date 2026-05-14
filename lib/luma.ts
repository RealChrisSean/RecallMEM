import "server-only";

import { randomUUID } from "node:crypto";
import { getSetting } from "@/lib/settings";
import { getUserId, queryOne } from "@/lib/db";
import { getChat, transcriptToMessages, updateChat } from "@/lib/chats";
import type { GeneratedImage, Message } from "@/lib/types";

const LUMA_BASE_URL = "https://agents.lumalabs.ai/v1";
const LUMA_MODEL = "uni-1";

export const LUMA_ASPECT_RATIOS = [
  "3:1",
  "2:1",
  "16:9",
  "3:2",
  "1:1",
  "2:3",
  "9:16",
  "1:2",
  "1:3",
] as const;

export const LUMA_STYLES = ["auto", "manga"] as const;
export const LUMA_OUTPUT_FORMATS = ["png", "jpeg"] as const;

export type LumaAspectRatio = (typeof LUMA_ASPECT_RATIOS)[number];
export type LumaStyle = (typeof LUMA_STYLES)[number];
export type LumaOutputFormat = (typeof LUMA_OUTPUT_FORMATS)[number];
export type LumaGenerationType = "image" | "image_edit";
export type LumaGenerationState = "queued" | "processing" | "completed" | "failed";

export interface LumaInlineImage {
  url?: string;
  data?: string;
  media_type?: string;
}

export interface LumaCreateInput {
  prompt: string;
  type: LumaGenerationType;
  aspectRatio?: LumaAspectRatio | null;
  style?: LumaStyle;
  outputFormat?: LumaOutputFormat | null;
  webSearch?: boolean;
  source?: LumaInlineImage | null;
  imageRef?: LumaInlineImage[];
}

interface LumaOutput {
  type: "image";
  url: string;
}

interface LumaGenerationResponse {
  id: string;
  type: "image" | "image_edit";
  state: LumaGenerationState;
  model: string;
  created_at: string;
  output: LumaOutput[];
  failure_reason: string | null;
  failure_code: string | null;
}

interface LumaResponseMeta {
  requestId: string | null;
  apiVersion: string | null;
  rateLimitLimit: number | null;
  rateLimitRemaining: number | null;
  rateLimitReset: number | null;
}

export interface LumaGenerationRow {
  id: string;
  user_id: string;
  chat_id: string | null;
  luma_generation_id: string;
  generation_type: LumaGenerationType;
  prompt: string;
  aspect_ratio: string | null;
  style: string;
  output_format: string | null;
  web_search: boolean;
  state: LumaGenerationState;
  failure_reason: string | null;
  failure_code: string | null;
  request_id: string | null;
  api_version: string | null;
  rate_limit_limit: number | null;
  rate_limit_remaining: number | null;
  rate_limit_reset: number | null;
  output_url: string | null;
  local_image: Buffer | null;
  local_mime_type: string | null;
  local_size: number | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

export class LumaApiError extends Error {
  status: number;
  detail: string;
  requestId: string | null;
  apiVersion: string | null;
  retryAfter: string | null;

  constructor(message: string, opts: {
    status: number;
    detail: string;
    requestId: string | null;
    apiVersion: string | null;
    retryAfter: string | null;
  }) {
    super(message);
    this.name = "LumaApiError";
    this.status = opts.status;
    this.detail = opts.detail;
    this.requestId = opts.requestId;
    this.apiVersion = opts.apiVersion;
    this.retryAfter = opts.retryAfter;
  }
}

export function normalizeLumaCreateInput(input: {
  prompt?: unknown;
  aspectRatio?: unknown;
  aspect_ratio?: unknown;
  style?: unknown;
  outputFormat?: unknown;
  output_format?: unknown;
  webSearch?: unknown;
  web_search?: unknown;
  source?: unknown;
  imageRef?: unknown;
  image_ref?: unknown;
}): LumaCreateInput {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (prompt.length < 1 || prompt.length > 6000) {
    throw new Error("Prompt must be between 1 and 6000 characters");
  }

  const rawAspectRatio = input.aspectRatio ?? input.aspect_ratio ?? null;
  const aspectRatio =
    rawAspectRatio === "" || rawAspectRatio === null || rawAspectRatio === undefined
      ? null
      : rawAspectRatio;
  if (
    aspectRatio !== null &&
    (typeof aspectRatio !== "string" ||
      !LUMA_ASPECT_RATIOS.includes(aspectRatio as LumaAspectRatio))
  ) {
    throw new Error(`Invalid aspect ratio. Use one of: ${LUMA_ASPECT_RATIOS.join(", ")}`);
  }

  const style = input.style === undefined || input.style === "" ? "auto" : input.style;
  if (typeof style !== "string" || !LUMA_STYLES.includes(style as LumaStyle)) {
    throw new Error("Invalid style. Use auto or manga");
  }

  const rawOutputFormat = input.outputFormat ?? input.output_format ?? null;
  const outputFormat =
    rawOutputFormat === "" || rawOutputFormat === null || rawOutputFormat === undefined
      ? null
      : rawOutputFormat;
  if (
    outputFormat !== null &&
    (typeof outputFormat !== "string" ||
      !LUMA_OUTPUT_FORMATS.includes(outputFormat as LumaOutputFormat))
  ) {
    throw new Error("Invalid output format. Use png or jpeg");
  }

  const source = normalizeInlineImage(input.source, "source");
  const rawImageRef = input.imageRef ?? input.image_ref ?? [];
  const imageRef = normalizeImageRef(rawImageRef);
  const type: LumaGenerationType = source ? "image_edit" : "image";

  if (type === "image_edit" && imageRef.length > 8) {
    throw new Error("Image edits support up to 8 reference images");
  }
  if (type === "image" && imageRef.length > 9) {
    throw new Error("Image generation supports up to 9 reference images");
  }

  return {
    prompt,
    type,
    aspectRatio: aspectRatio as LumaAspectRatio | null,
    style: style as LumaStyle,
    outputFormat: outputFormat as LumaOutputFormat | null,
    webSearch: Boolean(input.webSearch ?? input.web_search),
    source,
    imageRef,
  };
}

function normalizeImageRef(value: unknown): LumaInlineImage[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("image_ref must be an array");
  return value.map((item, index) => {
    const image = normalizeInlineImage(item, `image_ref[${index}]`);
    if (!image) throw new Error(`image_ref[${index}]: url or data required`);
    return image;
  });
}

function normalizeInlineImage(value: unknown, label: string): LumaInlineImage | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object") throw new Error(`${label} must be an object`);

  const input = value as { url?: unknown; data?: unknown; media_type?: unknown };
  const url = typeof input.url === "string" ? input.url.trim() : "";
  const data = typeof input.data === "string" ? input.data.trim() : "";
  const mediaType = typeof input.media_type === "string" ? input.media_type.trim() : "";

  if (url && data) throw new Error(`${label}: provide either url or data, not both`);
  if (!url && !data) throw new Error(`${label}: url or data required`);
  if (data && !mediaType) throw new Error(`${label}: media_type is required with data`);

  return url ? { url } : { data, media_type: mediaType };
}

export async function getLumaApiKey(): Promise<string | null> {
  return (await getSetting("luma_api_key")) || process.env.LUMA_AGENTS_API_KEY || null;
}

export async function createLumaGeneration(
  apiKey: string,
  input: LumaCreateInput
): Promise<{ generation: LumaGenerationResponse; meta: LumaResponseMeta }> {
  const body: Record<string, unknown> = {
    type: input.type,
    model: LUMA_MODEL,
    prompt: input.prompt,
    style: input.style || "auto",
    web_search: !!input.webSearch,
  };
  if (input.aspectRatio) body.aspect_ratio = input.aspectRatio;
  if (input.outputFormat) body.output_format = input.outputFormat;
  if (input.source) body.source = input.source;
  if (input.imageRef?.length) body.image_ref = input.imageRef;
  return lumaJson<LumaGenerationResponse>(apiKey, "/generations", {
    method: "POST",
    body,
  });
}

export async function getRemoteLumaGeneration(
  apiKey: string,
  lumaGenerationId: string
): Promise<{ generation: LumaGenerationResponse; meta: LumaResponseMeta }> {
  return lumaJson<LumaGenerationResponse>(
    apiKey,
    `/generations/${encodeURIComponent(lumaGenerationId)}`,
    { method: "GET" }
  );
}

async function lumaJson<T>(
  apiKey: string,
  path: string,
  opts: { method: "GET" | "POST"; body?: Record<string, unknown> }
): Promise<{ generation: T; meta: LumaResponseMeta }> {
  const res = await fetch(`${LUMA_BASE_URL}${path}`, {
    method: opts.method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Request-Id": `recallmem-${randomUUID()}`,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  const meta = lumaMetaFromHeaders(res.headers);
  if (!res.ok) {
    const detail =
      parsed && typeof parsed === "object" && "detail" in parsed
        ? String((parsed as { detail: unknown }).detail)
        : text || `Luma request failed with HTTP ${res.status}`;
    throw new LumaApiError(detail, {
      status: res.status,
      detail,
      requestId: meta.requestId,
      apiVersion: meta.apiVersion,
      retryAfter: res.headers.get("retry-after"),
    });
  }

  return { generation: parsed as T, meta };
}

function lumaMetaFromHeaders(headers: Headers): LumaResponseMeta {
  const toInt = (value: string | null) => {
    if (!value) return null;
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  };
  return {
    requestId: headers.get("x-request-id"),
    apiVersion: headers.get("x-api-version"),
    rateLimitLimit: toInt(headers.get("x-ratelimit-limit")),
    rateLimitRemaining: toInt(headers.get("x-ratelimit-remaining")),
    rateLimitReset: toInt(headers.get("x-ratelimit-reset")),
  };
}

export async function insertLumaGeneration(input: {
  chatId: string;
  request: LumaCreateInput;
  generation: LumaGenerationResponse;
  meta: LumaResponseMeta;
}): Promise<LumaGenerationRow> {
  const userId = await getUserId();
  const row = await queryOne<LumaGenerationRow>(
    `INSERT INTO s2m_luma_generations (
       user_id, chat_id, luma_generation_id, generation_type, prompt, aspect_ratio, style,
       output_format, web_search, state, failure_reason, failure_code,
       request_id, api_version, rate_limit_limit, rate_limit_remaining,
       rate_limit_reset, output_url, completed_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
       CASE WHEN $10 IN ('completed', 'failed') THEN NOW() ELSE NULL END)
     RETURNING *`,
    [
      userId,
      input.chatId,
      input.generation.id,
      input.request.type,
      input.request.prompt,
      input.request.aspectRatio || null,
      input.request.style || "auto",
      input.request.outputFormat || null,
      !!input.request.webSearch,
      input.generation.state,
      input.generation.failure_reason,
      input.generation.failure_code,
      input.meta.requestId,
      input.meta.apiVersion,
      input.meta.rateLimitLimit,
      input.meta.rateLimitRemaining,
      input.meta.rateLimitReset,
      input.generation.output[0]?.url || null,
    ]
  );
  if (!row) throw new Error("Failed to save Luma generation");
  return row;
}

export async function getLumaGeneration(id: string): Promise<LumaGenerationRow | null> {
  return queryOne<LumaGenerationRow>(
    `SELECT * FROM s2m_luma_generations WHERE id = $1`,
    [id]
  );
}

export async function lumaSourceFromStoredGeneration(id: string): Promise<LumaInlineImage> {
  const row = await getLumaGeneration(id);
  if (!row) throw new Error("Source image not found");
  if (row.state !== "completed" || !row.local_image) {
    throw new Error("Source image is not ready yet");
  }
  return {
    data: Buffer.from(row.local_image).toString("base64"),
    media_type: row.local_mime_type || "image/png",
  };
}

export async function updateLumaGenerationFromRemote(input: {
  id: string;
  generation: LumaGenerationResponse;
  meta: LumaResponseMeta;
}): Promise<LumaGenerationRow> {
  const row = await queryOne<LumaGenerationRow>(
    `UPDATE s2m_luma_generations
     SET state = $2,
         failure_reason = $3,
         failure_code = $4,
         request_id = COALESCE($5, request_id),
         api_version = COALESCE($6, api_version),
         output_url = COALESCE($7, output_url),
         completed_at = CASE WHEN $2 IN ('completed', 'failed') THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      input.id,
      input.generation.state,
      input.generation.failure_reason,
      input.generation.failure_code,
      input.meta.requestId,
      input.meta.apiVersion,
      input.generation.output[0]?.url || null,
    ]
  );
  if (!row) throw new Error("Luma generation not found");
  return row;
}

export async function downloadAndStoreLumaImage(input: {
  row: LumaGenerationRow;
  outputUrl: string;
  outputFormat?: string | null;
}): Promise<LumaGenerationRow> {
  const res = await fetch(input.outputUrl, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to download Luma image: HTTP ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mimeType = normalizeImageMimeType(
    res.headers.get("content-type"),
    input.outputFormat || input.row.output_format
  );

  const row = await queryOne<LumaGenerationRow>(
    `UPDATE s2m_luma_generations
     SET local_image = $2,
         local_mime_type = $3,
         local_size = $4,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [input.row.id, buffer, mimeType, buffer.length]
  );
  if (!row) throw new Error("Luma generation not found");
  return row;
}

function normalizeImageMimeType(contentType: string | null, outputFormat?: string | null): string {
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
  if (mediaType === "image/png" || mediaType === "image/jpeg" || mediaType === "image/webp") {
    return mediaType;
  }
  if (outputFormat === "jpeg") return "image/jpeg";
  return "image/png";
}

export function lumaRowToGeneratedImage(row: LumaGenerationRow): GeneratedImage {
  return {
    id: row.id,
    prompt: row.prompt,
    status: row.state,
    generationType: row.generation_type,
    url: row.local_image ? `/api/luma/images/${row.id}` : undefined,
    aspectRatio: row.aspect_ratio,
    style: row.style,
    outputFormat: row.output_format,
    webSearch: row.web_search,
    failureReason: row.failure_reason,
    failureCode: row.failure_code,
  };
}

export function lumaAssistantContent(image: GeneratedImage): string {
  if (image.status === "failed") {
    return `Image generation failed: ${image.failureReason || "Unknown Luma error"}`;
  }
  if (image.status === "completed") {
    return `${image.generationType === "image_edit" ? "Edited image" : "Generated image"}: ${image.prompt}`;
  }
  return `${image.generationType === "image_edit" ? "Editing image" : "Generating image"}: ${image.prompt}`;
}

export function lumaErrorPayload(err: unknown): {
  error: string;
  status?: number;
  requestId?: string | null;
  retryAfter?: string | null;
} {
  if (err instanceof LumaApiError) {
    return {
      error: err.detail,
      status: err.status,
      requestId: err.requestId,
      retryAfter: err.retryAfter,
    };
  }
  if (err instanceof Error) {
    const isValidationError =
      err.message.startsWith("Prompt ") ||
      err.message.startsWith("Invalid ") ||
      err.message.startsWith("source") ||
      err.message.startsWith("Source ") ||
      err.message.startsWith("image_ref") ||
      err.message.startsWith("Image ");
    return { error: err.message, status: isValidationError ? 400 : undefined };
  }
  return { error: "Unknown error" };
}

export async function syncLumaMessageInChat(row: LumaGenerationRow): Promise<void> {
  if (!row.chat_id) return;
  const chat = await getChat(row.chat_id);
  if (!chat?.transcript) return;

  const image = lumaRowToGeneratedImage(row);
  const messages = transcriptToMessages(chat.transcript || "");
  let changed = false;
  const nextMessages: Message[] = messages.map((message) => {
    if (message.generatedImage?.id !== row.id) return message;
    changed = true;
    return {
      ...message,
      content: lumaAssistantContent(image),
      generatedImage: image,
    };
  });

  if (changed) {
    await updateChat(row.chat_id, nextMessages);
  }
}
