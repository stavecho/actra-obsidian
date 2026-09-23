import { App, TFile } from "obsidian";
import type { ActraClient } from "../../api/client";
import type { ActraSettings, IndexDocumentPayload, IndexedDocument } from "../../types";
import { safeUserError } from "../../utils/errors";
import { sha256 } from "../../utils/hash";
import { createId } from "../../utils/id";
import { isAuthorizedReadPath } from "../../utils/path";
import { ACTRA_SYNC_TAG } from "../markdown";

type SaveSettings = () => Promise<void>;
export const AUTOMATIC_UPLOAD_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UploadSummary {
  indexed: number;
  failed: number;
  unchanged: number;
  filtered: number;
}

export function automaticUploadDelay(lastUploadAt: string, now = Date.now()): number {
  if (!lastUploadAt) return 0;
  const last = new Date(lastUploadAt).getTime();
  if (!Number.isFinite(last)) return 0;
  return Math.max(0, last + AUTOMATIC_UPLOAD_INTERVAL_MS - now);
}

export class OutboundIndexer {
  private running = false;

  constructor(
    private readonly app: App,
    private readonly settings: ActraSettings,
    private readonly client: ActraClient,
    private readonly saveSettings: SaveSettings
  ) {}

  canRead(path: string): boolean {
    return this.settings.connectionStatus === "CONNECTED"
      && !this.settings.paused
      && this.settings.permissions.readAuthorizedNotes
      && isAuthorizedReadPath(path, this.settings.readRoots);
  }

  canUpload(path: string): boolean {
    return this.canRead(path)
      && !Object.values(this.settings.mappings).some(({ filePath }) => filePath === path);
  }

  isRunning(): boolean {
    return this.running;
  }

  async reconcile(): Promise<UploadSummary> {
    if (this.running) return { indexed: 0, failed: 0, unchanged: 0, filtered: 0 };
    if (!this.settings.permissions.readAuthorizedNotes) {
      return { indexed: 0, failed: 0, unchanged: 0, filtered: 0 };
    }
    this.running = true;
    let indexed = 0;
    let failed = 0;
    let unchanged = 0;
    try {
      // Filter file objects by authorization before reading any content.
      const authorizedFiles = this.app.vault.getMarkdownFiles()
        .filter((file) => this.canRead(file.path));
      const files = authorizedFiles
        .filter((file) => this.canUpload(file.path) && !this.isActraManaged(file));
      let filtered = authorizedFiles.length - files.length;
      const visiblePaths = new Set(files.map((file) => file.path));

      for (let start = 0; start < files.length; start += 20) {
        const batchFiles = files.slice(start, start + 20);
        const documents: IndexDocumentPayload[] = [];
        for (const file of batchFiles) {
          try {
            const document = await this.prepareDocument(file);
            if (!document) {
              filtered += 1;
              continue;
            }
            const previous = this.settings.indexedDocuments[file.path];
            if (previous?.contentHash !== document.contentHash || previous.modifiedAt !== file.stat.mtime) {
              documents.push(document);
            } else {
              unchanged += 1;
            }
          } catch {
            failed += 1;
          }
        }
        if (documents.length > 0) {
          for (const document of documents) {
            try {
              const [uploaded] = await this.client.batchUpsertDocuments([document]);
              this.settings.indexedDocuments[document.path] = {
                documentId: uploaded?.documentId ?? document.documentId,
                path: document.path,
                contentHash: document.contentHash,
                modifiedAt: document.modifiedAt
              };
              indexed += 1;
            } catch (error) {
              failed += 1;
              this.settings.lastError = safeUserError(error);
            }
          }
          await this.saveSettings();
        }
      }

      for (const [path, mapping] of Object.entries(this.settings.indexedDocuments)) {
        if (this.canRead(path) && !visiblePaths.has(path)) await this.removeRemoteMapping(path, mapping);
      }
      await this.client.reconcileIndex(
        Object.values(this.settings.indexedDocuments).map(({ documentId, path, contentHash }) => ({
          documentId,
          path,
          contentHash
        }))
      );
      this.settings.lastIndexSyncAt = new Date().toISOString();
      await this.flushPendingRootCleanup();
      await this.saveSettings();
      return { indexed, failed, unchanged, filtered };
    } finally {
      this.running = false;
    }
  }

  async handleRename(file: TFile, oldPath: string): Promise<void> {
    const previous = this.settings.indexedDocuments[oldPath];
    if (previous) {
      delete this.settings.indexedDocuments[oldPath];
      if (!this.canUpload(file.path)) {
        await this.client.removeIndexDocument(previous.documentId);
        await this.saveSettings();
        return;
      }
      this.settings.indexedDocuments[file.path] = { ...previous, path: file.path, modifiedAt: 0 };
    }
  }

  async handleLocalDelete(path: string): Promise<void> {
    const mapping = this.settings.indexedDocuments[path];
    if (!mapping) return;
    // The official API has no deletion endpoint; this only clears local upload tracking.
    await this.removeRemoteMapping(path, mapping);
    await this.saveSettings();
  }

  async revokeRoot(root: string): Promise<void> {
    await this.saveSettings();
  }

  private async prepareDocument(file: TFile): Promise<IndexDocumentPayload | null> {
    if (!this.canUpload(file.path) || this.isActraManaged(file)) {
      throw new Error("File is outside authorized read roots or managed by ACTRA.");
    }
    const content = await this.app.vault.cachedRead(file);
    if (this.hasActraManagedFrontmatter(content)) return null;
    const cache = this.app.metadataCache.getFileCache(file);
    const previous = this.settings.indexedDocuments[file.path];
    const tags = Array.from(new Set([
      ...(cache?.tags ?? []).map((tag) => tag.tag.replace(/^#/, "")),
      ...this.frontmatterTags(cache?.frontmatter?.tags)
    ]));
    const properties = { ...(cache?.frontmatter ?? {}) } as Record<string, unknown>;
    delete properties.position;
    return {
      documentId: previous?.documentId ?? createId("doc"),
      path: file.path,
      title: file.basename,
      contentHash: await sha256(`${file.path}\0${content}`),
      createdAt: file.stat.ctime,
      modifiedAt: file.stat.mtime,
      tags,
      properties,
      headings: (cache?.headings ?? []).map((heading) => heading.heading),
      links: (cache?.links ?? []).map((link) => link.link),
      content
    };
  }

  private isActraManaged(file: TFile): boolean {
    if (Object.values(this.settings.mappings).some(({ filePath }) => filePath === file.path)) return true;
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (frontmatter?.actra_managed === true || typeof frontmatter?.actra_id === "string") return true;
    return this.frontmatterTags(frontmatter?.tags).includes(ACTRA_SYNC_TAG);
  }

  private hasActraManagedFrontmatter(content: string): boolean {
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    if (!frontmatter) return false;
    return /^actra_managed:\s*(?:true|"true"|'true')\s*$/im.test(frontmatter)
      || /^actra_id:\s*\S+/im.test(frontmatter)
      || new RegExp(`(?:^|[\\s,\\[])#?${ACTRA_SYNC_TAG}(?:$|[\\s,\\]])`, "im").test(frontmatter);
  }

  private frontmatterTags(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((tag): tag is string => typeof tag === "string");
    if (typeof value === "string") return value.split(/[ ,]+/).filter(Boolean);
    return [];
  }

  private async removeRemoteMapping(path: string, mapping: IndexedDocument): Promise<void> {
    // Stavecho currently has no remote deletion endpoint. The client call is a
    // no-op there, but remains part of the interface for compatible backends.
    await this.client.removeIndexDocument(mapping.documentId);
    delete this.settings.indexedDocuments[path];
  }

  private async flushPendingRootCleanup(): Promise<void> {
    for (const root of [...this.settings.pendingIndexCleanupRoots]) {
      try {
        await this.client.revokeReadRoot(root);
        this.settings.pendingIndexCleanupRoots = this.settings.pendingIndexCleanupRoots.filter((value) => value !== root);
        for (const [path] of Object.entries(this.settings.indexedDocuments)) {
          if (path === root || path.startsWith(`${root}/`)) delete this.settings.indexedDocuments[path];
        }
      } catch (error) {
        this.settings.lastError = safeUserError(error);
      }
    }
  }
}
