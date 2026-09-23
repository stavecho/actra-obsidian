import type { ActraNoteType, SyncJob, SyncJobContent } from "../types";

const START_PREFIX = "<!-- actra:managed:start ";
const END_PREFIX = "<!-- actra:managed:end ";
export const ACTRA_SYNC_TAG = "actra-synced";

function yamlScalar(value: string | number | boolean): string {
  if (typeof value !== "string") return String(value);
  return JSON.stringify(value);
}

function safeInline(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function safeManagedContent(value: string): string {
  return value.replace(/<!--\s*actra:managed:/gi, "&lt;!-- actra:managed:").trim();
}

function safeAudioUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatTask(task: NonNullable<SyncJobContent["tasks"]>[number]): string {
  const checked = task.completed ? "x" : " ";
  const due = task.dueDate ? ` 📅 ${safeInline(task.dueDate)}` : "";
  return `- [${checked}] ${safeInline(task.text)}${due}\n  <!-- actra_task_id: ${safeInline(task.id)} -->`;
}

function renderExerciseRows(rows: NonNullable<SyncJobContent["exerciseRows"]>): string {
  if (rows.length === 0) return "暂无运动数据。";
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const escape = (value: unknown) => String(value ?? "").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
  return [
    `| ${columns.map(escape).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map((column) => escape(row[column])).join(" | ")} |`)
  ].join("\n");
}

export function managedMarkers(actraId: string): { start: string; end: string } {
  return {
    start: `${START_PREFIX}${actraId} -->`,
    end: `${END_PREFIX}${actraId} -->`
  };
}

export function renderManagedBody(job: SyncJob): string {
  const sections: string[] = [];
  const { content } = job;

  if (content.summary) sections.push(`## AI 总结\n\n${safeManagedContent(content.summary)}`);
  if (content.body) sections.push(safeManagedContent(content.body));
  if (content.transcript) sections.push(`## 录音转写\n\n${safeManagedContent(content.transcript)}`);
  if (content.audioUrl) {
    const url = safeAudioUrl(content.audioUrl);
    sections.push(url ? `## 录音\n\n[在 ACTRA 中播放录音](${url})` : "## 录音\n\n录音链接无效，未写入可点击链接。");
  }
  if (content.tasks?.length) sections.push(`## 待办\n\n${content.tasks.map(formatTask).join("\n")}`);
  if (content.exerciseRows) sections.push(`## 运动数据\n\n${renderExerciseRows(content.exerciseRows)}`);

  return sections.join("\n\n") || "ACTRA 暂未提供正文。";
}

export function renderManagedBlock(job: SyncJob): string {
  const markers = managedMarkers(job.actraId);
  return `${markers.start}\n${renderManagedBody(job)}\n${markers.end}`;
}

export function renderFrontmatter(job: SyncJob, contentHash: string): string {
  const tags = Array.from(new Set(["actra", ACTRA_SYNC_TAG, ...(job.content.tags ?? [])]));
  const fields = [
    "---",
    `actra_id: ${yamlScalar(job.actraId)}`,
    `actra_type: ${yamlScalar(job.type)}`,
    "actra_managed: true",
    `actra_revision: ${job.revision}`,
    `actra_updated_at: ${yamlScalar(job.updatedAt)}`,
    `actra_content_hash: ${yamlScalar(contentHash)}`,
    `date: ${yamlScalar(job.content.date)}`
  ];
  if (job.content.project) fields.push(`project: ${yamlScalar(job.content.project)}`);
  fields.push("tags:", ...tags.map((tag) => `  - ${yamlScalar(tag)}`), "---");
  return fields.join("\n");
}

export function renderNewNote(job: SyncJob, contentHash: string): string {
  return `${renderFrontmatter(job, contentHash)}\n\n# ${safeInline(job.content.title)}\n\n${renderManagedBlock(job)}\n\n## 我的补充\n\n你可以在这里自由编辑，ACTRA 不会覆盖此区域。\n`;
}

export function extractManagedBlock(source: string, actraId: string): string | null {
  const { start, end } = managedMarkers(actraId);
  const startIndex = source.indexOf(start);
  if (startIndex < 0) return null;
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (endIndex < 0) return null;
  return source.slice(startIndex, endIndex + end.length);
}

export function replaceManagedBlock(source: string, actraId: string, replacement: string): string | null {
  const current = extractManagedBlock(source, actraId);
  if (!current) return null;
  return source.replace(current, replacement);
}

const TYPE_DIRECTORIES: Record<ActraNoteType, string> = {
  daily_summary: "每日总结",
  recording: "录音",
  conversation: "对话与灵感",
  idea: "对话与灵感",
  task_collection: "待办",
  exercise: "运动"
};

function safeFileName(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  return (cleaned || "未命名").slice(0, 100);
}

export function defaultRelativePath(job: SyncJob): string {
  if (job.type === "task_collection") return `${TYPE_DIRECTORIES[job.type]}/待办.md`;
  const date = safeFileName(job.content.date);
  const title = safeFileName(job.content.title);
  const name = job.type === "daily_summary" || job.type === "exercise" ? date : `${date}-${title}`;
  return `${TYPE_DIRECTORIES[job.type]}/${name}.md`;
}
