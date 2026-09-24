import { FileManager, TFile, Vault } from "obsidian";
import type { ActraClient } from "../../api/client";
import type {
  ActraSettings,
  SyncFailureCode,
  SyncJob,
  SyncJobResult
} from "../../types";
import { ActraError, safeUserError } from "../../utils/errors";
import { sha256 } from "../../utils/hash";
import { withRetry } from "../../utils/retry";
import { assertWritePath } from "../../utils/path";
import { ActraVaultService } from "../../vault/service";
import {
  extractActraContentHash,
  extractActraRevision,
  extractManagedBlock,
  ACTRA_SYNC_TAG,
  renderManagedBlock,
  renderNewNote,
  replaceManagedBlock
} from "../markdown";

type SaveSettings = () => Promise<void>;

export class InboundSyncEngine {
  private running = false;

  constructor(
    private readonly vault: Vault,
    private readonly fileManager: FileManager,
    private readonly vaultService: ActraVaultService,
    private readonly settings: ActraSettings,
    private readonly client: ActraClient,
    private readonly saveSettings: SaveSettings
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  async pull(): Promise<SyncJobResult[]> {
    if (this.running) throw new ActraError("同步正在进行，请稍候。", "ALREADY_RUNNING");
    if (this.settings.paused) throw new ActraError("同步已暂停。", "PAUSED");
    if (this.settings.connectionStatus !== "CONNECTED") {
      throw new ActraError("请先连接 ACTRA。", "NOT_CONNECTED");
    }

    this.running = true;
    this.settings.lastError = "";
    const results: SyncJobResult[] = [];
    try {
      let cursor: string | undefined;
      const seenCursors = new Set<string>();
      let pageCount = 0;
      do {
        pageCount += 1;
        if (pageCount > 100 || (cursor !== undefined && seenCursors.has(cursor))) {
          throw new ActraError("同步分页游标重复或页数异常，已停止拉取。", "INVALID_RESPONSE");
        }
        if (cursor !== undefined) seenCursors.add(cursor);
        const page = await withRetry(() => this.client.getPendingJobs(cursor));
        this.settings.counters.pending = page.jobs.length;
        for (const job of page.jobs) results.push(await this.processAndReport(job));
        cursor = page.nextCursor;
      } while (cursor);

      if (results.some((result) => result.status === "SUCCEEDED" || result.status === "DUPLICATE")) {
        this.settings.lastSuccessfulSyncAt = new Date().toISOString();
      }
      this.settings.counters.pending = 0;
      await this.saveSettings();
      return results;
    } catch (error) {
      this.settings.lastError = safeUserError(error);
      await this.saveSettings();
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async processAndReport(job: SyncJob): Promise<SyncJobResult> {
    let result: SyncJobResult;
    try {
      result = await this.processJob(job);
    } catch (error) {
      const code = this.failureCode(error);
      const message = safeUserError(error);
      const path = error instanceof SyncConflictError ? error.conflictPath : undefined;
      this.settings.counters.failed += 1;
      if (code === "CONFLICT") this.settings.counters.conflicts += 1;
      try {
        await withRetry(() => this.client.failJob(job.jobId, code, message, path));
      } catch {
        // The server keeps an unacknowledged job pending; the local error remains visible.
      }
      await this.saveSettings();
      return { jobId: job.jobId, actraId: job.actraId, status: code, error: message, ...(path ? { path } : {}) };
    }

    if (!result.path) throw new ActraError("同步结果缺少目标路径。", "FAILED");
    const mapping = this.settings.mappings[job.actraId];
    const hash = mapping?.lastContentHash ?? "";
    // If the receipt fails, do not report a local write failure. The unacknowledged
    // server job remains pending and is safely acknowledged as a duplicate later.
    await withRetry(() => this.client.acknowledgeJob(job.jobId, result.path!, hash));
    this.settings.completedJobs[job.jobId] = result.path;
    this.trimCompletedJobs();
    if (result.status === "SUCCEEDED") this.settings.counters.succeeded += 1;
    await this.saveSettings();
    return result;
  }

  private async processJob(job: SyncJob): Promise<SyncJobResult> {
    this.validateJob(job);
    const completedPath = this.settings.completedJobs[job.jobId];
    if (completedPath) {
      return { jobId: job.jobId, actraId: job.actraId, status: "DUPLICATE", path: completedPath };
    }

    const expectedPath = this.vaultService.targetFor(job, this.settings.writeRoot);
    let mapping = this.settings.mappings[job.actraId];
    if (mapping && mapping.vaultConnectionId !== this.settings.vaultConnectionId) {
      // OAuth reauthorization creates a new connection id. The ACTRA object id
      // and its local mapping remain stable, so rebind instead of recreating it.
      mapping.vaultConnectionId = this.settings.vaultConnectionId;
    }
    if (mapping && this.settings.locallyRemoved.includes(job.actraId)) {
      throw new ActraError("用户已删除本地文件；需明确恢复后才能重新创建。", "LOCALLY_REMOVED");
    }

    if (mapping) assertWritePath(mapping.filePath, this.settings.writeRoot);
    let file: TFile | null = mapping ? this.vaultService.getFile(mapping.filePath) : null;
    if (mapping && !file) {
      if (!this.settings.locallyRemoved.includes(job.actraId)) this.settings.locallyRemoved.push(job.actraId);
      throw new ActraError("已映射的本地文件不存在，已标记为本地删除。", "LOCALLY_REMOVED");
    }

    if (!mapping) {
      file = await this.vaultService.findManagedFile(job.actraId, this.settings.writeRoot);
      if (file) {
        const source = await this.vault.cachedRead(file);
        const currentBlock = extractManagedBlock(source, job.actraId);
        if (!currentBlock) throw new ActraError("ACTRA 管理标记已丢失。", "CONFLICT");
        const currentHash = await sha256(currentBlock);
        mapping = {
          actraId: job.actraId,
          vaultConnectionId: this.settings.vaultConnectionId,
          filePath: file.path,
          lastRevision: extractActraRevision(source) ?? 0,
          lastContentHash: extractActraContentHash(source) ?? currentHash,
          lastSyncedAt: new Date().toISOString()
        };
        this.settings.mappings[job.actraId] = mapping;
      }
    }

    if (mapping && file) return this.updateManagedFile(job, file, mapping);
    return this.createManagedFile(job, expectedPath);
  }

  private async createManagedFile(job: SyncJob, targetPath: string): Promise<SyncJobResult> {
    if (this.vaultService.pathExists(targetPath)) {
      const conflict = await this.createConflictCopy(job, targetPath);
      throw new SyncConflictError("目标路径已被其他文件占用，已创建冲突副本。", conflict);
    }
    const block = renderManagedBlock(job);
    const hash = await sha256(block);
    await this.vaultService.ensureParentFolders(targetPath, this.settings.writeRoot);
    await this.vault.create(targetPath, renderNewNote(job, hash));
    this.settings.mappings[job.actraId] = {
      actraId: job.actraId,
      vaultConnectionId: this.settings.vaultConnectionId,
      filePath: targetPath,
      lastRevision: job.revision,
      lastContentHash: hash,
      lastSyncedAt: new Date().toISOString()
    };
    return { jobId: job.jobId, actraId: job.actraId, status: "SUCCEEDED", path: targetPath };
  }

  private async updateManagedFile(
    job: SyncJob,
    file: TFile,
    mapping: NonNullable<ActraSettings["mappings"][string]>
  ): Promise<SyncJobResult> {
    if (job.revision <= mapping.lastRevision) {
      return { jobId: job.jobId, actraId: job.actraId, status: "DUPLICATE", path: file.path };
    }
    const source = await this.vault.cachedRead(file);
    const currentBlock = extractManagedBlock(source, job.actraId);
    if (!currentBlock) {
      const conflict = await this.createConflictCopy(job, file.path);
      throw new SyncConflictError("ACTRA 管理区块已丢失，未覆盖原文件。", conflict);
    }
    const currentHash = await sha256(currentBlock);
    if (currentHash !== mapping.lastContentHash) {
      const conflict = await this.createConflictCopy(job, file.path);
      throw new SyncConflictError("检测到本地修改，未覆盖原文件，已创建冲突副本。", conflict);
    }

    const nextBlock = renderManagedBlock(job);
    const nextHash = await sha256(nextBlock);
    await this.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.actra_id = job.actraId;
      frontmatter.actra_type = job.type;
      frontmatter.actra_managed = true;
      frontmatter.actra_revision = job.revision;
      frontmatter.actra_updated_at = job.updatedAt;
      frontmatter.actra_content_hash = nextHash;
      frontmatter.date = job.content.date;
      if (job.content.project) frontmatter.project = job.content.project;
      frontmatter.tags = Array.from(new Set(["actra", ACTRA_SYNC_TAG, ...(job.content.tags ?? [])]));
    });
    await this.vault.process(file, (contents) => {
      const updated = replaceManagedBlock(contents, job.actraId, nextBlock);
      if (updated === null) throw new ActraError("更新期间管理区块发生变化。", "CONFLICT");
      return updated;
    });
    mapping.filePath = file.path;
    mapping.lastRevision = job.revision;
    mapping.lastContentHash = nextHash;
    mapping.lastSyncedAt = new Date().toISOString();
    return { jobId: job.jobId, actraId: job.actraId, status: "SUCCEEDED", path: file.path };
  }

  private async createConflictCopy(job: SyncJob, originalPath: string): Promise<string> {
    const conflictPath = this.vaultService.conflictPath(originalPath, this.settings.writeRoot);
    const block = renderManagedBlock(job);
    const hash = await sha256(block);
    const note = renderNewNote(job, hash).replace("actra_managed: true", "actra_managed: true\nactra_conflict: true");
    await this.vaultService.ensureParentFolders(conflictPath, this.settings.writeRoot);
    await this.vault.create(conflictPath, note);
    return conflictPath;
  }

  private validateJob(job: SyncJob): void {
    if (!job.jobId || !job.actraId || !Number.isInteger(job.revision) || job.revision < 1) {
      throw new ActraError("同步任务字段无效。", "FAILED");
    }
    if (!job.content?.title || !job.content.date || !job.updatedAt) {
      throw new ActraError("同步内容缺少标题、日期或更新时间。", "FAILED");
    }
  }

  private failureCode(error: unknown): SyncFailureCode {
    if (error instanceof SyncConflictError) return "CONFLICT";
    if (error instanceof ActraError) {
      if (["PERMISSION_DENIED", "INVALID_TARGET", "CONFLICT", "LOCALLY_REMOVED"].includes(error.code)) {
        return error.code as SyncFailureCode;
      }
    }
    return "FAILED";
  }

  private trimCompletedJobs(): void {
    const ids = Object.keys(this.settings.completedJobs);
    if (ids.length <= 500) return;
    for (const id of ids.slice(0, ids.length - 500)) delete this.settings.completedJobs[id];
  }
}

class SyncConflictError extends ActraError {
  constructor(message: string, readonly conflictPath: string) {
    super(message, "CONFLICT");
  }
}
