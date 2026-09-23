import type { IndexDocumentPayload, PendingJobsPage, SyncJob, SyncJobContent } from "../types";
import { ActraError } from "../utils/errors";

export const STAVECHO_API_ORIGIN = "https://api.stavecho.com";

export type StavechoSource = "dailylog" | "note" | "recording";

interface StavechoDailylog {
  dailylog_id: string;
  content?: string | null;
  create_time?: string | null;
  update_time?: string | null;
}

interface StavechoNote {
  notes_id: string;
  notes_name?: string | null;
  notes_content?: string | null;
  create_time?: string | null;
  update_time?: string | null;
}

interface StavechoRecording {
  recording_id: string;
  file_path?: string | null;
  file_name?: string | null;
  title?: string | null;
  summary?: string | null;
  minimalist_summary?: string | null;
  content?: string | null;
  original_content?: string | null;
  create_time?: string | null;
  update_time?: string | null;
}

export const STAVECHO_SOURCES: StavechoSource[] = ["dailylog", "note", "recording"];

export interface StavechoPageCursor {
  source: StavechoSource;
  page: number;
}

export interface StavechoUploadResponse {
  dataId: string;
  filePath: string;
  fileUrl: string;
  channel: string;
  useStatus: number;
  createTime: string;
}

export interface StavechoMultipartBody {
  body: ArrayBuffer;
  contentType: string;
  filename: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ActraError(`ACTRA 数据字段 ${field} 无效。`, "INVALID_RESPONSE");
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function concatBytes(parts: Uint8Array[]): ArrayBuffer {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.byteLength;
  }
  return combined.buffer;
}

function timestampOf(item: { create_time?: string | null; update_time?: string | null }): string {
  return optionalString(item.update_time) ?? optionalString(item.create_time) ?? "1970-01-01T00:00:00.000Z";
}

function revisionOf(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function dateOf(timestamp: string): string {
  const match = timestamp.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? "未知日期";
}

function stableActraId(source: StavechoSource, id: string): string {
  const encoded = Array.from(id, (char) => /[A-Za-z0-9._-]/.test(char)
    ? char
    : `_u${char.codePointAt(0)!.toString(16)}_`).join("");
  return `${source}_${encoded}`;
}

function httpsUrl(value: unknown): string | undefined {
  const text = optionalString(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function makeJob(
  source: StavechoSource,
  sourceId: string,
  timestamp: string,
  content: SyncJobContent
): SyncJob {
  const revision = revisionOf(timestamp);
  const actraId = stableActraId(source, sourceId);
  return {
    jobId: `${actraId}_${revision}`,
    actraId,
    type: source === "dailylog" ? "daily_summary" : source === "note" ? "idea" : "recording",
    revision,
    updatedAt: timestamp,
    content
  };
}

function dailylogJob(value: unknown): SyncJob {
  if (!isRecord(value)) throw new ActraError("ACTRA Dailylog 响应格式无效。", "INVALID_RESPONSE");
  const item = value as unknown as StavechoDailylog;
  const id = requiredString(item.dailylog_id, "dailylog_id");
  const timestamp = timestampOf(item);
  const date = dateOf(timestamp);
  const body = optionalString(item.content);
  return makeJob("dailylog", id, timestamp, {
    title: `${date} 每日总结`,
    date,
    ...(body ? { body } : {}),
    tags: ["dailylog"]
  });
}

function noteJob(value: unknown): SyncJob {
  if (!isRecord(value)) throw new ActraError("ACTRA Note 响应格式无效。", "INVALID_RESPONSE");
  const item = value as unknown as StavechoNote;
  const id = requiredString(item.notes_id, "notes_id");
  const timestamp = timestampOf(item);
  const date = dateOf(timestamp);
  const body = optionalString(item.notes_content);
  return makeJob("note", id, timestamp, {
    title: optionalString(item.notes_name) ?? `${date} ACTRA 笔记`,
    date,
    ...(body ? { body } : {}),
    tags: ["note"]
  });
}

function recordingJob(value: unknown): SyncJob {
  if (!isRecord(value)) throw new ActraError("ACTRA Recording 响应格式无效。", "INVALID_RESPONSE");
  const item = value as unknown as StavechoRecording;
  const id = requiredString(item.recording_id, "recording_id");
  const timestamp = timestampOf(item);
  const date = dateOf(timestamp);
  const fileName = optionalString(item.file_name)?.replace(/\.[^.]+$/, "");
  const fullSummary = optionalString(item.summary);
  const minimalistSummary = optionalString(item.minimalist_summary);
  const summary = fullSummary && minimalistSummary && fullSummary !== minimalistSummary
    ? `${fullSummary}\n\n> 极简总结：${minimalistSummary}`
    : fullSummary ?? minimalistSummary;
  const body = optionalString(item.content);
  const transcript = optionalString(item.original_content);
  const audioUrl = httpsUrl(item.file_path);
  return makeJob("recording", id, timestamp, {
    title: optionalString(item.title) ?? fileName ?? `${date} ACTRA 录音`,
    date,
    ...(summary ? { summary } : {}),
    ...(body ? { body } : {}),
    ...(transcript ? { transcript } : {}),
    ...(audioUrl ? { audioUrl } : {}),
    tags: ["recording"]
  });
}

export function stavechoApiBaseUrl(configuredBaseUrl: string): string {
  const trimmed = configuredBaseUrl.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ActraError("ACTRA 服务地址无效。", "INVALID_CONFIGURATION");
  }
  const localDevelopment = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(localDevelopment && parsed.protocol === "http:")) {
    throw new ActraError("ACTRA 服务必须使用 HTTPS。", "INVALID_CONFIGURATION");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ActraError("ACTRA 服务地址不能包含凭据、查询参数或片段。", "INVALID_CONFIGURATION");
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = pathname.endsWith("/service") ? pathname : `${pathname}/service`;
  return parsed.toString().replace(/\/$/, "");
}

export function stavechoOAuthBaseUrl(configuredBaseUrl: string): string {
  const apiBase = new URL(stavechoApiBaseUrl(configuredBaseUrl));
  apiBase.pathname = apiBase.pathname.replace(/\/service$/, "") || "/";
  return apiBase.toString().replace(/\/$/, "");
}

export function normalizeStavechoBaseUrl(configuredBaseUrl: string): string {
  return stavechoOAuthBaseUrl(configuredBaseUrl.trim() || STAVECHO_API_ORIGIN);
}

export function stavechoSourcesForScope(scope: string): StavechoSource[] {
  const granted = new Set(scope.trim().split(/[\s,]+/).filter(Boolean));
  return STAVECHO_SOURCES.filter((source) => granted.has(source));
}

export function hasStavechoScope(scope: string, required: string): boolean {
  return new Set(scope.trim().split(/[\s,]+/).filter(Boolean)).has(required);
}

export function createStavechoUploadBody(
  document: IndexDocumentPayload,
  channel = "obsidian"
): StavechoMultipartBody {
  const boundary = `----actra-obsidian-${crypto.randomUUID().replace(/-/g, "")}`;
  const safeChannel = channel.replace(/[\r\n"]/g, "").trim() || "obsidian";
  const filename = document.path
    .replace(/[\\/\r\n"]/g, "_")
    .replace(/[^\p{L}\p{N}._ -]/gu, "-")
    .slice(-180) || "obsidian-note.md";
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\n`
    + `Content-Disposition: form-data; name="channel"\r\n\r\n`
    + `${safeChannel}\r\n`
    + `--${boundary}\r\n`
    + `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`
    + `Content-Type: text/markdown; charset=utf-8\r\n\r\n`
  );
  const content = encoder.encode(document.content);
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  return {
    body: concatBytes([head, content, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
    filename
  };
}

export function parseStavechoUploadResponse(value: unknown): StavechoUploadResponse {
  if (!isRecord(value)
    || typeof value.data_id !== "string" || !value.data_id
    || typeof value.file_path !== "string"
    || typeof value.file_url !== "string"
    || typeof value.channel !== "string"
    || !Number.isInteger(value.use_status)
    || typeof value.create_time !== "string") {
    throw new ActraError("ACTRA 上传响应格式无效。", "INVALID_RESPONSE");
  }
  return {
    dataId: value.data_id,
    filePath: value.file_path,
    fileUrl: value.file_url,
    channel: value.channel,
    useStatus: value.use_status as number,
    createTime: value.create_time
  };
}

export function parseStavechoCursor(
  cursor?: string,
  sources: readonly StavechoSource[] = STAVECHO_SOURCES
): StavechoPageCursor {
  if (!cursor) {
    const source = sources[0];
    if (!source) throw new ActraError("ACTRA 未授予任何可同步的数据权限。", "REQUEST_REJECTED");
    return { source, page: 1 };
  }
  const match = cursor.match(/^stavecho:(dailylog|note|recording):(\d+)$/);
  if (!match) throw new ActraError("ACTRA 分页游标无效。", "INVALID_RESPONSE");
  const page = Number(match[2]);
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new ActraError("ACTRA 分页页码无效。", "INVALID_RESPONSE");
  }
  return { source: match[1] as StavechoSource, page };
}

export function convertStavechoPage(
  source: StavechoSource,
  page: number,
  value: unknown,
  sources: readonly StavechoSource[] = STAVECHO_SOURCES
): PendingJobsPage {
  if (!isRecord(value)
    || !Number.isInteger(value.page)
    || value.page !== page
    || !Number.isInteger(value.page_size)
    || !Number.isInteger(value.total_count)
    || typeof value.has_more !== "boolean"
    || (value.data !== undefined && !Array.isArray(value.data))) {
    throw new ActraError("ACTRA 分页响应格式无效。", "INVALID_RESPONSE");
  }
  const data = value.data ?? [];
  const jobs = source === "dailylog"
    ? data.map(dailylogJob)
    : source === "note" ? data.map(noteJob) : data.map(recordingJob);
  const sourceIndex = sources.indexOf(source);
  if (sourceIndex < 0) throw new ActraError("ACTRA 分页来源不在授权范围内。", "INVALID_RESPONSE");
  const nextCursor = value.has_more
    ? `stavecho:${source}:${page + 1}`
    : sourceIndex < sources.length - 1 ? `stavecho:${sources[sourceIndex + 1]!}:1` : undefined;
  return { jobs, ...(nextCursor ? { nextCursor } : {}) };
}
