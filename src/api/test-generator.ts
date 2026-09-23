import type { ActraNoteType, ActraTask, SyncJob, SyncJobContent } from "../types";
import { createId } from "../utils/id";

export interface TestJobDraft {
  type: ActraNoteType;
  actraId: string;
  revision: string;
  title: string;
  date: string;
  project: string;
  tags: string;
  summary: string;
  body: string;
  transcript: string;
  audioUrl: string;
  tasks: string;
}

export const TEST_JOB_TYPE_LABELS: Record<ActraNoteType, string> = {
  daily_summary: "每日总结",
  recording: "录音与会议",
  conversation: "对话",
  idea: "灵感",
  task_collection: "待办集合",
  exercise: "运动记录"
};

function localDateString(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function defaultTestJobDraft(now = new Date()): TestJobDraft {
  return {
    type: "daily_summary",
    actraId: "",
    revision: "1",
    title: "ACTRA 测试内容",
    date: localDateString(now),
    project: "ACTRA",
    tags: "test",
    summary: "这是一条由 ACTRA 测试数据生成器创建的待同步内容。",
    body: "",
    transcript: "",
    audioUrl: "",
    tasks: ""
  };
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseTags(value: string): string[] {
  return Array.from(new Set(value
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean)));
}

export function parseTestTasks(value: string): ActraTask[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean)
    .map((line) => {
      const state = line.match(/^\[([ xX])\]\s*(.*)$/);
      const completed = state?.[1]?.toLowerCase() === "x";
      const details = (state?.[2] ?? line).split(/\s*\|\s*/, 2);
      const text = details[0]?.trim() ?? "";
      const dueDate = details[1]?.trim() ?? "";
      if (!text) throw new Error("待办内容不能为空。");
      if (dueDate && !isCalendarDate(dueDate)) {
        throw new Error(`待办日期“${dueDate}”必须使用 YYYY-MM-DD 格式。`);
      }
      const task: ActraTask = { id: createId("test_task"), text };
      if (completed) task.completed = true;
      if (dueDate) task.dueDate = dueDate;
      return task;
    });
}

function safeTestFileName(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  return (cleaned || "测试内容").slice(0, 100);
}

export function chooseAvailableTestTarget(
  preferredPath: string,
  title: string,
  appendTitle: boolean,
  pathExists: (path: string) => boolean
): string {
  if (!pathExists(preferredPath)) return preferredPath;
  const base = preferredPath.replace(/\.md$/i, "");
  const label = safeTestFileName(title);
  let suffix = 2;
  let candidate = appendTitle ? `${base}-${label}.md` : `${base}-${suffix}.md`;
  while (pathExists(candidate)) {
    suffix += 1;
    candidate = appendTitle ? `${base}-${label}-${suffix}.md` : `${base}-${suffix}.md`;
  }
  return candidate;
}

export function createTestJob(draft: TestJobDraft, now = new Date()): SyncJob {
  const title = draft.title.trim();
  const date = draft.date.trim();
  const revision = Number(draft.revision);
  const requestedId = draft.actraId.trim();

  if (!(draft.type in TEST_JOB_TYPE_LABELS)) throw new Error("内容类型无效。");
  if (!title) throw new Error("标题不能为空。");
  if (!isCalendarDate(date)) throw new Error("日期必须使用有效的 YYYY-MM-DD 格式。");
  if (!Number.isInteger(revision) || revision < 1) throw new Error("版本号必须是大于等于 1 的整数。");
  if (requestedId && !/^[A-Za-z0-9_-]{1,100}$/.test(requestedId)) {
    throw new Error("ACTRA 对象 ID 只能包含字母、数字、下划线和连字符，最多 100 个字符。");
  }

  const tags = parseTags(draft.tags);
  const tasks = parseTestTasks(draft.tasks);
  const content: SyncJobContent = { title, date };
  const project = draft.project.trim();
  const summary = draft.summary.trim();
  const body = draft.body.trim();
  const transcript = draft.transcript.trim();
  const audioUrl = draft.audioUrl.trim();

  if (audioUrl) {
    let parsed: URL;
    try {
      parsed = new URL(audioUrl);
    } catch {
      throw new Error("录音链接必须是有效的 HTTPS 地址。");
    }
    if (parsed.protocol !== "https:") throw new Error("录音链接必须使用 HTTPS。");
  }

  if (project) content.project = project;
  if (tags.length > 0) content.tags = tags;
  if (summary) content.summary = summary;
  if (body) content.body = body;
  if (transcript) content.transcript = transcript;
  if (audioUrl) content.audioUrl = audioUrl;
  if (tasks.length > 0) content.tasks = tasks;

  const suffix = `${now.getTime().toString(36)}_${createId("local").slice(-8)}`;
  return {
    jobId: `test_job_${suffix}`,
    actraId: requestedId || `test_${draft.type}_${suffix}`,
    type: draft.type,
    revision,
    updatedAt: now.toISOString(),
    content
  };
}
