import { describe, expect, it } from "vitest";
import {
  convertStavechoPage,
  createStavechoUploadBody,
  normalizeStavechoBaseUrl,
  parseStavechoCursor,
  parseStavechoUploadResponse,
  stavechoApiBaseUrl,
  stavechoOAuthBaseUrl,
  stavechoSourcesForScope
} from "../src/api/stavecho";

describe("Stavecho client API adapter", () => {
  it("normalizes the public service and OAuth base URLs", () => {
    expect(stavechoApiBaseUrl("https://api.stavecho.com"))
      .toBe("https://api.stavecho.com/service");
    expect(stavechoApiBaseUrl("https://api.stavecho.com/service/"))
      .toBe("https://api.stavecho.com/service");
    expect(stavechoOAuthBaseUrl("https://api.stavecho.com/service"))
      .toBe("https://api.stavecho.com");
    expect(normalizeStavechoBaseUrl(""))
      .toBe("https://api.stavecho.com");
    expect(normalizeStavechoBaseUrl(" https://example.com/custom/service/ "))
      .toBe("https://example.com/custom");
  });

  it("walks dailylog, note and recording pages in order", () => {
    const first = convertStavechoPage("dailylog", 1, {
      page: 1,
      page_size: 100,
      total_count: 1,
      has_more: false,
      data: [{
        dailylog_id: "daily-1",
        content: "今天完成了接口联调。",
        create_time: "2026-09-22T23:00:00+08:00",
        update_time: "2026-09-23T08:30:00+08:00"
      }]
    });
    expect(first.nextCursor).toBe("stavecho:note:1");
    expect(first.jobs[0]).toMatchObject({
      actraId: "dailylog_daily-1",
      type: "daily_summary",
      revision: Date.parse("2026-09-23T08:30:00+08:00"),
      content: {
        title: "2026-09-23 每日总结",
        date: "2026-09-23",
        body: "今天完成了接口联调。"
      }
    });

    const note = convertStavechoPage("note", 1, {
      page: 1,
      page_size: 100,
      total_count: 1,
      has_more: true,
      data: [{
        notes_id: "note/1",
        notes_name: "接口灵感",
        notes_content: "把三类数据统一为同步任务。",
        create_time: "2026-09-23T09:00:00+08:00"
      }]
    });
    expect(note.nextCursor).toBe("stavecho:note:2");
    expect(note.jobs[0]).toMatchObject({
      actraId: "note_note_u2f_1",
      type: "idea",
      content: { title: "接口灵感" }
    });
    expect(parseStavechoCursor(note.nextCursor)).toEqual({ source: "note", page: 2 });
  });

  it("requests only data types granted by OAuth", () => {
    const sources = stavechoSourcesForScope("dailylog recording");
    expect(sources).toEqual(["dailylog", "recording"]);
    const first = convertStavechoPage("dailylog", 1, {
      page: 1,
      page_size: 100,
      total_count: 0,
      has_more: false,
      data: []
    }, sources);
    expect(first.nextCursor).toBe("stavecho:recording:1");
  });

  it("maps recording summary, content, transcript and HTTPS audio", () => {
    const result = convertStavechoPage("recording", 1, {
      page: 1,
      page_size: 100,
      total_count: 1,
      has_more: false,
      data: [{
        recording_id: "recording-1",
        file_path: "https://cdn.stavecho.com/audio/1.m4a",
        file_name: "会议录音.m4a",
        title: "产品会议",
        summary: "确认了接口字段。",
        minimalist_summary: "接口确认",
        content: "结构化会议内容",
        original_content: "原始录音转写",
        update_time: "2026-09-23T10:00:00+08:00"
      }]
    });
    expect(result.nextCursor).toBeUndefined();
    expect(result.jobs[0]).toMatchObject({
      type: "recording",
      content: {
        title: "产品会议",
        summary: "确认了接口字段。\n\n> 极简总结：接口确认",
        body: "结构化会议内容",
        transcript: "原始录音转写",
        audioUrl: "https://cdn.stavecho.com/audio/1.m4a"
      }
    });
  });

  it("rejects malformed API pages and cursors", () => {
    expect(() => convertStavechoPage("dailylog", 1, { data: [] }))
      .toThrow("分页响应格式无效");
    expect(() => parseStavechoCursor("note:2"))
      .toThrow("分页游标无效");
  });

  it("builds the documented multipart upload and validates its response", () => {
    const multipart = createStavechoUploadBody({
      documentId: "doc-1",
      path: "项目/周报.md",
      title: "周报",
      contentHash: "hash",
      createdAt: 1,
      modifiedAt: 2,
      tags: [],
      properties: {},
      headings: [],
      links: [],
      content: "# 周报\n\n本周完成接口接入。"
    });
    const body = new TextDecoder().decode(multipart.body);
    expect(multipart.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(multipart.filename).toBe("项目_周报.md");
    expect(body).toContain('name="channel"');
    expect(body).toContain("obsidian");
    expect(body).toContain('name="file"; filename="项目_周报.md"');
    expect(body).toContain("# 周报\n\n本周完成接口接入。");

    expect(parseStavechoUploadResponse({
      data_id: "data-1",
      file_path: "obsidian/data-1.md",
      file_url: "https://example.com/data-1.md",
      channel: "obsidian",
      use_status: 0,
      create_time: "2026-09-23T10:00:00+08:00"
    })).toMatchObject({ dataId: "data-1", channel: "obsidian" });
    expect(() => parseStavechoUploadResponse({ data_id: "data-1" }))
      .toThrow("上传响应格式无效");
  });
});
