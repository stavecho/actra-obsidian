import { describe, expect, it } from "vitest";
import {
  chooseAvailableTestTarget,
  createTestJob,
  defaultTestJobDraft,
  parseTestTasks
} from "../src/api/test-generator";

describe("ACTRA test data generator", () => {
  it("creates a custom pending sync job", () => {
    const draft = defaultTestJobDraft(new Date("2026-08-06T10:00:00+08:00"));
    draft.type = "recording";
    draft.actraId = "recording_custom_1";
    draft.revision = "2";
    draft.title = "自定义产品会议";
    draft.tags = "meeting, ACTRA, meeting";
    draft.transcript = "这是自定义转写。";
    draft.tasks = "[ ] 完成验收 | 2026-08-10\n[x] 确认配对";

    const job = createTestJob(draft, new Date("2026-08-06T02:30:00.000Z"));

    expect(job.actraId).toBe("recording_custom_1");
    expect(job.revision).toBe(2);
    expect(job.type).toBe("recording");
    expect(job.content.tags).toEqual(["meeting", "ACTRA"]);
    expect(job.content.transcript).toBe("这是自定义转写。");
    expect(job.content.tasks?.[0]).toMatchObject({ text: "完成验收", dueDate: "2026-08-10" });
    expect(job.content.tasks?.[1]).toMatchObject({ text: "确认配对", completed: true });
  });

  it("rejects unsafe IDs, invalid revisions and invalid dates", () => {
    const draft = defaultTestJobDraft();
    draft.actraId = "bad --> marker";
    expect(() => createTestJob(draft)).toThrow("对象 ID");

    draft.actraId = "safe_id";
    draft.revision = "0";
    expect(() => createTestJob(draft)).toThrow("版本号");

    draft.revision = "1";
    draft.date = "2026-02-30";
    expect(() => createTestJob(draft)).toThrow("日期");

    draft.date = "2026-08-06";
    draft.audioUrl = "http://example.com/audio";
    expect(() => createTestJob(draft)).toThrow("HTTPS");
  });

  it("parses plain and checkbox task lines", () => {
    const tasks = parseTestTasks("普通任务\n- [x] 已完成 | 2026-08-11");
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.text).toBe("普通任务");
    expect(tasks[1]).toMatchObject({ text: "已完成", completed: true, dueDate: "2026-08-11" });
  });

  it("chooses a unique readable path when a generated target is occupied", () => {
    const occupied = new Set([
      "ACTRA/每日总结/2026-08-06.md",
      "ACTRA/每日总结/2026-08-06-产品复盘.md"
    ]);
    expect(chooseAvailableTestTarget(
      "ACTRA/每日总结/2026-08-06.md",
      "产品复盘",
      true,
      (path) => occupied.has(path)
    )).toBe("ACTRA/每日总结/2026-08-06-产品复盘-3.md");

    expect(chooseAvailableTestTarget(
      "ACTRA/录音/2026-08-06-产品会议.md",
      "产品会议",
      false,
      (path) => path === "ACTRA/录音/2026-08-06-产品会议.md"
    )).toBe("ACTRA/录音/2026-08-06-产品会议-2.md");
  });
});
