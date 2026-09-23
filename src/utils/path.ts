import { normalizePath } from "obsidian";
import { ActraError } from "./errors";

const HIDDEN_SEGMENT = /^\./;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/;

export function secureVaultPath(input: string, kind: "file" | "folder" = "folder"): string {
  const raw = input.trim();
  if (!raw) throw new ActraError("路径不能为空。", "INVALID_TARGET");
  if (raw.startsWith("/") || raw.startsWith("\\") || WINDOWS_ABSOLUTE.test(raw)) {
    throw new ActraError("只允许 Vault 内的相对路径。", "INVALID_TARGET");
  }
  if (raw.includes("\\")) {
    throw new ActraError("路径必须使用 / 分隔。", "INVALID_TARGET");
  }

  const rawSegments = raw.split("/");
  if (rawSegments.some((segment) => segment === ".." || segment === "." || segment === "")) {
    throw new ActraError("路径包含不安全的层级。", "INVALID_TARGET");
  }
  if (rawSegments.some((segment) => HIDDEN_SEGMENT.test(segment))) {
    throw new ActraError("ACTRA 不访问隐藏目录或 .obsidian。", "INVALID_TARGET");
  }

  const path = normalizePath(raw).replace(/\/$/, "");
  if (kind === "file" && !path.toLocaleLowerCase().endsWith(".md")) {
    throw new ActraError("当前仅允许写入 Markdown 文件。", "INVALID_TARGET");
  }
  return path;
}

export function isWithinRoot(pathInput: string, rootInput: string): boolean {
  const path = secureVaultPath(pathInput, pathInput.toLocaleLowerCase().endsWith(".md") ? "file" : "folder");
  const root = secureVaultPath(rootInput, "folder");
  return path === root || path.startsWith(`${root}/`);
}

export function assertWritePath(pathInput: string, writeRootInput: string): string {
  const path = secureVaultPath(pathInput, "file");
  const root = secureVaultPath(writeRootInput, "folder");
  if (!isWithinRoot(path, root)) {
    throw new ActraError(`目标不在写入目录 ${root} 内。`, "PERMISSION_DENIED");
  }
  return path;
}

export function isAuthorizedReadPath(pathInput: string, roots: string[]): boolean {
  let path: string;
  try {
    path = secureVaultPath(pathInput, "file");
  } catch {
    return false;
  }
  return roots.some((root) => {
    try {
      return isWithinRoot(path, root);
    } catch {
      return false;
    }
  });
}

export function joinVaultPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/"));
}
