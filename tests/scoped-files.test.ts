import { TFile, TFolder } from "obsidian";
import { describe, expect, it } from "vitest";
import { markdownFilesInRoots } from "../src/vault/scoped-files";

describe("authorized folder traversal", () => {
  it("visits only selected folders, skips hidden files, and deduplicates nested roots", () => {
    const Folder = TFolder as unknown as new (path: string) => TFolder;
    const File = TFile as unknown as new (path: string) => TFile;
    const project = new Folder("项目");
    const reports = new Folder("项目/报告");
    const hidden = new Folder("项目/.private");
    const selected = new File("项目/报告/周报.md");
    reports.children = [selected, new File("项目/报告/附件.pdf")];
    hidden.children = [new File("项目/.private/私密.md")];
    project.children = [reports, hidden];
    const lookedUp: string[] = [];
    const vault = {
      getAbstractFileByPath: (path: string) => {
        lookedUp.push(path);
        return path === "项目" ? project : path === "项目/报告" ? reports : null;
      },
      getMarkdownFiles: () => { throw new Error("Global file enumeration is forbidden"); }
    };

    expect(markdownFilesInRoots(vault as never, ["项目", "项目/报告", "../无效目录"]))
      .toEqual([selected]);
    expect(lookedUp).toEqual(["项目", "项目/报告"]);
  });
});
