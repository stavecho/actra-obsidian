export class TFile {
  path: string;
  extension: string;
  basename: string;
  stat = { ctime: Date.now(), mtime: Date.now(), size: 0 };

  constructor(path: string) {
    this.path = path;
    this.extension = path.split(".").pop() ?? "";
    this.basename = path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path;
  }
}

export class TFolder {
  path: string;
  children: unknown[] = [];
  constructor(path: string) { this.path = path; }
}

export class Notice {}

export function normalizePath(path: string): string {
  return path.replace(/\/{2,}/g, "/").replace(/^\.\//, "");
}
