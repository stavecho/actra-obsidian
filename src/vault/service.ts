import { MetadataCache, TFile, TFolder, Vault } from "obsidian";
import type { SyncJob } from "../types";
import { ActraError } from "../utils/errors";
import { assertWritePath, joinVaultPath, secureVaultPath } from "../utils/path";
import { defaultRelativePath, extractManagedBlock, isActraConflictNote } from "../sync/markdown";

export class ActraVaultService {
  constructor(
    private readonly vault: Vault,
    private readonly metadataCache: MetadataCache
  ) {}

  targetFor(job: SyncJob, writeRoot: string): string {
    const root = secureVaultPath(writeRoot, "folder");
    const candidate = job.targetPath
      ? secureVaultPath(job.targetPath, "file")
      : joinVaultPath(root, defaultRelativePath(job));
    return assertWritePath(candidate, root);
  }

  getFile(path: string): TFile | null {
    const abstract = this.vault.getAbstractFileByPath(path);
    return abstract instanceof TFile ? abstract : null;
  }

  pathExists(path: string): boolean {
    return this.vault.getAbstractFileByPath(path) !== null;
  }

  async ensureParentFolders(filePath: string, writeRoot: string): Promise<void> {
    const safeFile = assertWritePath(filePath, writeRoot);
    const parts = safeFile.split("/").slice(0, -1);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.vault.getAbstractFileByPath(current);
      if (existing && !(existing instanceof TFolder)) {
        throw new ActraError(`${current} 已存在且不是目录。`, "INVALID_TARGET");
      }
      if (!existing) await this.vault.createFolder(current);
    }
  }

  async findManagedFile(actraId: string, writeRoot: string): Promise<TFile | null> {
    const root = secureVaultPath(writeRoot, "folder");
    const files = this.vault.getMarkdownFiles().filter(
      (file) => file.path.startsWith(`${root}/`) || file.path === root
    );
    for (const file of files) {
      const frontmatter = this.metadataCache.getFileCache(file)?.frontmatter;
      if (frontmatter?.actra_id === actraId && frontmatter.actra_managed === true && !frontmatter.actra_conflict) {
        return file;
      }
    }

    // Obsidian's metadata cache can still be empty immediately after startup or
    // OAuth reauthorization. The managed markers in the file are authoritative,
    // so fall back to reading the Markdown before treating the target as new.
    for (const file of files) {
      try {
        const source = await this.vault.cachedRead(file);
        if (!isActraConflictNote(source) && extractManagedBlock(source, actraId)) return file;
      } catch {
        // A transient read failure for one file must not prevent checking others.
      }
    }
    return null;
  }

  conflictPath(targetPath: string, writeRoot: string, now = new Date()): string {
    const safeTarget = assertWritePath(targetPath, writeRoot);
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      "-",
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0")
    ].join("");
    const base = safeTarget.replace(/\.md$/i, "");
    let candidate = `${base}.conflict-${stamp}.md`;
    let suffix = 2;
    while (this.pathExists(candidate)) {
      candidate = `${base}.conflict-${stamp}-${suffix}.md`;
      suffix += 1;
    }
    return assertWritePath(candidate, writeRoot);
  }
}
