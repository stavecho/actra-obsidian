import { TFile } from "obsidian";
import { describe, expect, it } from "vitest";
import { MockActraClient } from "../src/api/client";
import type { IndexDocumentPayload, UploadedDocument } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/settings/defaults";
import {
  AUTOMATIC_UPLOAD_INTERVAL_MS,
  OutboundIndexer,
  automaticUploadDelay
} from "../src/sync/outbound/indexer";

describe("outbound authorization gate", () => {
  it("stops reading while paused or disconnected", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.connectionStatus = "CONNECTED";
    settings.readRoots = ["项目/ACTRA"];
    settings.permissions.readAuthorizedNotes = true;
    const indexer = new OutboundIndexer({} as never, settings, new MockActraClient(), async () => undefined);

    expect(indexer.canRead("项目/ACTRA/周报.md")).toBe(true);
    settings.paused = true;
    expect(indexer.canRead("项目/ACTRA/周报.md")).toBe(false);
    settings.paused = false;
    settings.connectionStatus = "REVOKED";
    expect(indexer.canRead("项目/ACTRA/周报.md")).toBe(false);
  });

  it("uploads only authorized Markdown and skips unchanged content", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.connectionStatus = "CONNECTED";
    settings.readRoots = ["项目/ACTRA"];
    settings.permissions.readAuthorizedNotes = true;
    settings.automaticUploadEnabled = false;
    const TestFile = TFile as unknown as new (path: string) => TFile;
    const file = new TestFile("项目/ACTRA/周报.md");
    const app = {
      vault: {
        getMarkdownFiles: () => [file, new TestFile("其他/私密.md")],
        cachedRead: async (target: TFile) => target.path === file.path ? "# 周报\n\n已完成接口接入。" : "私密内容"
      },
      metadataCache: { getFileCache: () => null }
    };
    const client = new MockActraClient();
    const indexer = new OutboundIndexer(app as never, settings, client, async () => undefined);

    await expect(indexer.reconcile()).resolves.toEqual({ indexed: 1, failed: 0, unchanged: 0, filtered: 0 });
    expect(client.uploadedDocuments.size).toBe(1);
    expect(Object.keys(settings.indexedDocuments)).toEqual([file.path]);
    await expect(indexer.reconcile()).resolves.toEqual({ indexed: 0, failed: 0, unchanged: 1, filtered: 0 });
  });

  it("filters ACTRA-managed metadata and tags before reading file content", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.connectionStatus = "CONNECTED";
    settings.readRoots = ["知识库"];
    settings.permissions.readAuthorizedNotes = true;
    const TestFile = TFile as unknown as new (path: string) => TFile;
    const managed = new TestFile("知识库/来自 ACTRA.md");
    const tagged = new TestFile("知识库/旧版 ACTRA.md");
    const uncached = new TestFile("知识库/缓存未更新.md");
    const local = new TestFile("知识库/本地笔记.md");
    const reads: string[] = [];
    const app = {
      vault: {
        getMarkdownFiles: () => [managed, tagged, uncached, local],
        cachedRead: async (file: TFile) => {
          reads.push(file.path);
          return file === uncached
            ? "---\nactra_managed: true\nactra_id: note_uncached\ntags: [actra-synced]\n---\n\n# ACTRA 内容"
            : `# ${file.basename}`;
        }
      },
      metadataCache: {
        getFileCache: (file: TFile) => file === managed
          ? { frontmatter: { actra_managed: true, actra_id: "note_1" } }
          : file === tagged ? { frontmatter: { tags: ["actra-synced"] } } : null
      }
    };
    const client = new MockActraClient();
    const indexer = new OutboundIndexer(app as never, settings, client, async () => undefined);

    await expect(indexer.reconcile()).resolves.toEqual({ indexed: 1, failed: 0, unchanged: 0, filtered: 3 });
    expect(reads).toEqual([uncached.path, local.path]);
    expect([...client.uploadedDocuments.values()].map(({ path }) => path)).toEqual([local.path]);
  });

  it("schedules automatic uploads every 24 hours", () => {
    const now = Date.parse("2026-09-23T08:00:00Z");
    expect(automaticUploadDelay("", now)).toBe(0);
    expect(automaticUploadDelay("invalid", now)).toBe(0);
    expect(automaticUploadDelay("2026-09-23T07:00:00Z", now))
      .toBe(AUTOMATIC_UPLOAD_INTERVAL_MS - 60 * 60 * 1000);
    expect(automaticUploadDelay("2026-09-22T07:59:59Z", now)).toBe(0);
  });

  it("keeps each successful upload mapping when a later file fails", async () => {
    class PartiallyFailingClient extends MockActraClient {
      override batchUpsertDocuments(documents: IndexDocumentPayload[]): Promise<UploadedDocument[]> {
        if (documents[0]?.path.endsWith("失败.md")) return Promise.reject(new Error("upload failed"));
        return super.batchUpsertDocuments(documents);
      }
    }

    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.connectionStatus = "CONNECTED";
    settings.readRoots = ["项目"];
    settings.permissions.readAuthorizedNotes = true;
    const TestFile = TFile as unknown as new (path: string) => TFile;
    const successful = new TestFile("项目/成功.md");
    const failed = new TestFile("项目/失败.md");
    const app = {
      vault: {
        getMarkdownFiles: () => [successful, failed],
        cachedRead: async (file: TFile) => `# ${file.basename}`
      },
      metadataCache: { getFileCache: () => null }
    };
    const client = new PartiallyFailingClient();
    const indexer = new OutboundIndexer(app as never, settings, client, async () => undefined);

    await expect(indexer.reconcile()).resolves.toEqual({ indexed: 1, failed: 1, unchanged: 0, filtered: 0 });
    expect(Object.keys(settings.indexedDocuments)).toEqual([successful.path]);
    expect(client.uploadedDocuments.size).toBe(1);
  });
});
