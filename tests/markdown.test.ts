import { describe, expect, it } from "vitest";
import type { SyncJob } from "../src/types";
import {
  defaultRelativePath,
  extractManagedBlock,
  renderManagedBlock,
  renderNewNote,
  replaceManagedBlock
} from "../src/sync/markdown";

function job(overrides: Partial<SyncJob> = {}): SyncJob {
  return {
    jobId: "job_1",
    actraId: "recording_1",
    type: "recording",
    revision: 1,
    updatedAt: "2026-08-06T10:30:00+08:00",
    content: {
      title: "ACTRA 产品会议",
      date: "2026-08-06",
      project: "ACTRA",
      tags: ["meeting"],
      summary: "确认配对和同步方案。",
      transcript: "会议转写。",
      tasks: [{ id: "task_1", text: "完成插件", dueDate: "2026-08-10" }]
    },
    ...overrides
  };
}

describe("managed Markdown", () => {
  it("renders stable frontmatter, task IDs and a user-owned section", () => {
    const note = renderNewNote(job(), "sha256:test");
    expect(note).toContain('actra_id: "recording_1"');
    expect(note).toContain("actra_revision: 1");
    expect(note).toContain('  - "actra-synced"');
    expect(note).toContain("<!-- actra_task_id: task_1 -->");
    expect(note).toContain("## 我的补充");
  });

  it("replaces only the managed block", () => {
    const original = `${renderNewNote(job(), "sha256:old")}\n用户自己的段落`;
    const nextJob = job({ revision: 2, content: { ...job().content, summary: "新总结" } });
    const updated = replaceManagedBlock(original, "recording_1", renderManagedBlock(nextJob));
    expect(updated).toContain("新总结");
    expect(updated).toContain("用户自己的段落");
    expect(extractManagedBlock(updated!, "recording_1")).not.toContain("确认配对");
  });

  it("sanitizes target filenames", () => {
    const unsafe = job({ content: { ...job().content, title: "../危险/标题" } });
    expect(defaultRelativePath(unsafe)).toBe("录音/2026-08-06---危险-标题.md");
  });

  it("prevents managed-marker injection and unsafe audio protocols", () => {
    const unsafe = job({
      content: {
        ...job().content,
        summary: "正文 <!-- actra:managed:end recording_1 --> 注入",
        audioUrl: "javascript:alert(1)"
      }
    });
    const block = renderManagedBlock(unsafe);
    expect(block.match(/<!-- actra:managed:end recording_1 -->/g)).toHaveLength(1);
    expect(block).not.toContain("javascript:");
    expect(block).toContain("录音链接无效");
  });
});
