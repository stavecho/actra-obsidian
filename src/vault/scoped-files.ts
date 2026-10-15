import { TFile, TFolder, type Vault } from "obsidian";
import { secureVaultPath } from "../utils/path";

/** Visit Markdown files only below folders the user authorized or ACTRA owns. */
export function markdownFilesInRoots(vault: Vault, roots: readonly string[]): TFile[] {
  const files: TFile[] = [];
  const seen = new Set<string>();
  const visitedFolders = new Set<string>();

  const visit = (folder: TFolder): void => {
    if (visitedFolders.has(folder.path)) return;
    visitedFolders.add(folder.path);
    for (const child of folder.children) {
      if (child.path.split("/").some((segment) => segment.startsWith("."))) continue;
      if (child instanceof TFolder) visit(child);
      else if (child instanceof TFile && child.extension.toLowerCase() === "md" && !seen.has(child.path)) {
        seen.add(child.path);
        files.push(child);
      }
    }
  };

  for (const root of roots) {
    let path: string;
    try {
      path = secureVaultPath(root, "folder");
    } catch {
      // Ignore invalid saved roots instead of expanding the read scope.
      continue;
    }
    const folder = vault.getAbstractFileByPath(path);
    if (folder instanceof TFolder) visit(folder);
  }
  return files;
}
