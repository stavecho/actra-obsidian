import { TFile, TFolder } from "obsidian";
import { describe, expect, it } from "vitest";
import { MockActraClient } from "../src/api/client";
import { DEFAULT_SETTINGS } from "../src/settings/defaults";
import { InboundSyncEngine } from "../src/sync/inbound/engine";
import { OutboundIndexer } from "../src/sync/outbound/indexer";
import type { ActraSettings, SyncJob } from "../src/types";
import { ActraVaultService } from "../src/vault/service";

class FakeVault {
  readonly files = new Map<string, { file: TFile; content: string }>();
  readonly folders = new Map<string, TFolder>();

  getAbstractFileByPath(path: string): TFile | TFolder | null {
    return this.files.get(path)?.file ?? this.folders.get(path) ?? null;
  }

  getMarkdownFiles(): TFile[] {
    return [...this.files.values()].map(({ file }) => file);
  }

  async createFolder(path: string): Promise<TFolder> {
    const folder = new (TFolder as unknown as new (value: string) => TFolder)(path);
    this.folders.set(path, folder);
    return folder;
  }

  async create(path: string, content: string): Promise<TFile> {
    if (this.getAbstractFileByPath(path)) throw new Error("exists");
    const file = new (TFile as unknown as new (value: string) => TFile)(path);
    this.files.set(path, { file, content });
    return file;
  }

  cachedRead(file: TFile): Promise<string> {
    return Promise.resolve(this.files.get(file.path)?.content ?? "");
  }

  async process(file: TFile, callback: (content: string) => string): Promise<string> {
    const entry = this.files.get(file.path)!;
    entry.content = callback(entry.content);
    return entry.content;
  }

  change(path: string, callback: (content: string) => string): void {
    const entry = this.files.get(path)!;
    entry.content = callback(entry.content);
  }

  simulateRemoval(path: string): void {
    this.files.delete(path);
  }
}

function makeSettings(): ActraSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    connectionStatus: "CONNECTED",
    vaultConnectionId: "vault_test"
  };
}

function makeJob(revision = 1): SyncJob {
  return {
    jobId: `job_${revision}`,
    actraId: "recording_1",
    type: "recording",
    revision,
    updatedAt: `2026-08-06T10:3${revision}:00+08:00`,
    content: {
      title: "产品会议",
      date: "2026-08-06",
      summary: revision === 1 ? "初版总结" : "更新总结"
    }
  };
}

function makeEngine(vault: FakeVault, settings: ActraSettings, client: MockActraClient): InboundSyncEngine {
  const metadata = { getFileCache: () => null };
  const fileManager = { processFrontMatter: async (_file: TFile, callback: (value: Record<string, unknown>) => void) => callback({}) };
  return new InboundSyncEngine(
    vault as never,
    fileManager as never,
    new ActraVaultService(vault as never, metadata as never),
    settings,
    client,
    async () => undefined
  );
}

describe("inbound synchronization", () => {
  it("does not upload ACTRA-synchronized files back to ACTRA", async () => {
    const vault = new FakeVault();
    const settings = makeSettings();
    const client = new MockActraClient();
    const engine = makeEngine(vault, settings, client);
    const jobs: SyncJob[] = [
      {
        jobId: "job_dailylog",
        actraId: "dailylog_1",
        type: "daily_summary",
        revision: 1,
        updatedAt: "2026-09-23T08:00:00+08:00",
        content: { title: "2026-09-23 每日总结", date: "2026-09-23", body: "今日记录" }
      },
      {
        jobId: "job_note",
        actraId: "note_1",
        type: "idea",
        revision: 1,
        updatedAt: "2026-09-23T09:00:00+08:00",
        content: { title: "接口笔记", date: "2026-09-23", body: "笔记正文" }
      },
      {
        jobId: "job_recording",
        actraId: "recording_1",
        type: "recording",
        revision: 1,
        updatedAt: "2026-09-23T10:00:00+08:00",
        content: { title: "产品会议", date: "2026-09-23", summary: "会议摘要", transcript: "会议转写" }
      }
    ];

    client.enqueue(jobs);
    const pulled = await engine.pull();
    expect(pulled).toHaveLength(3);
    expect(pulled.every((result) => result.status === "SUCCEEDED")).toBe(true);
    expect([...vault.files.keys()]).toEqual(expect.arrayContaining([
      "ACTRA/每日总结/2026-09-23.md",
      "ACTRA/对话与灵感/2026-09-23-接口笔记.md",
      "ACTRA/录音/2026-09-23-产品会议.md"
    ]));

    settings.readRoots = ["ACTRA"];
    settings.permissions.readAuthorizedNotes = true;
    const app = {
      vault,
      metadataCache: { getFileCache: () => null }
    };
    const indexer = new OutboundIndexer(app as never, settings, client, async () => undefined);
    await expect(indexer.reconcile()).resolves.toEqual({ indexed: 0, failed: 0, unchanged: 0, filtered: 3 });
    expect(client.uploadedDocuments.size).toBe(0);
  });

  it("creates once, updates only the managed block, and preserves user content", async () => {
    const vault = new FakeVault();
    const settings = makeSettings();
    const client = new MockActraClient();
    const engine = makeEngine(vault, settings, client);

    client.enqueue([makeJob(1)]);
    await engine.pull();
    const path = "ACTRA/录音/2026-08-06-产品会议.md";
    expect(vault.files.get(path)?.content).toContain("初版总结");
    vault.change(path, (content) => `${content}\n用户补充内容`);

    client.enqueue([makeJob(2)]);
    await engine.pull();
    expect(vault.files.get(path)?.content).toContain("更新总结");
    expect(vault.files.get(path)?.content).toContain("用户补充内容");
    expect(vault.files.size).toBe(1);
  });

  it("creates a conflict copy instead of overwriting a modified managed block", async () => {
    const vault = new FakeVault();
    const settings = makeSettings();
    const client = new MockActraClient();
    const engine = makeEngine(vault, settings, client);
    const path = "ACTRA/录音/2026-08-06-产品会议.md";

    client.enqueue([makeJob(1)]);
    await engine.pull();
    vault.change(path, (content) => content.replace("初版总结", "用户修改了受控内容"));
    client.enqueue([makeJob(2)]);
    const [result] = await engine.pull();

    expect(result?.status).toBe("CONFLICT");
    expect(vault.files.get(path)?.content).toContain("用户修改了受控内容");
    expect([...vault.files.keys()].some((value) => value.includes(".conflict-"))).toBe(true);
  });

  it("does not recreate a locally removed mapped file", async () => {
    const vault = new FakeVault();
    const settings = makeSettings();
    const client = new MockActraClient();
    const engine = makeEngine(vault, settings, client);
    const path = "ACTRA/录音/2026-08-06-产品会议.md";

    client.enqueue([makeJob(1)]);
    await engine.pull();
    vault.simulateRemoval(path);
    client.enqueue([makeJob(2)]);
    const [result] = await engine.pull();

    expect(result?.status).toBe("LOCALLY_REMOVED");
    expect(vault.files.has(path)).toBe(false);
    expect(settings.locallyRemoved).toContain("recording_1");
  });

  it("keeps a locally written job pending when only the receipt fails", async () => {
    class FlakyReceiptClient extends MockActraClient {
      failReceipt = true;
      override acknowledgeJob(jobId: string): Promise<void> {
        if (this.failReceipt) return Promise.reject(new Error("receipt transport failed"));
        return super.acknowledgeJob(jobId);
      }
    }
    const vault = new FakeVault();
    const settings = makeSettings();
    const client = new FlakyReceiptClient();
    const engine = makeEngine(vault, settings, client);
    const path = "ACTRA/录音/2026-08-06-产品会议.md";

    client.enqueue([makeJob(1)]);
    await expect(engine.pull()).rejects.toThrow("receipt transport failed");
    expect(vault.files.has(path)).toBe(true);
    expect(settings.counters.failed).toBe(0);

    client.failReceipt = false;
    const [result] = await engine.pull();
    expect(result?.status).toBe("DUPLICATE");
    expect(vault.files.size).toBe(1);
  });
});
