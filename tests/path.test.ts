import { describe, expect, it } from "vitest";
import {
  assertWritePath,
  isAuthorizedReadPath,
  isWithinRoot,
  secureVaultPath
} from "../src/utils/path";

describe("Vault path authorization", () => {
  it.each([
    "/Users/test/secret.md",
    "C:/Users/test/secret.md",
    "ACTRA/../secret.md",
    "ACTRA/.obsidian/config.md",
    "ACTRA//note.md",
    "ACTRA\\note.md"
  ])("rejects unsafe path %s", (path) => {
    expect(() => secureVaultPath(path, "file")).toThrow();
  });

  it("allows only Markdown inside the write root", () => {
    expect(assertWritePath("ACTRA/录音/会议.md", "ACTRA")).toBe("ACTRA/录音/会议.md");
    expect(() => assertWritePath("项目/会议.md", "ACTRA")).toThrow("不在写入目录");
    expect(() => assertWritePath("ACTRA/录音/会议.pdf", "ACTRA")).toThrow("Markdown");
  });

  it("uses segment-aware root matching", () => {
    expect(isWithinRoot("项目/ACTRA/周报.md", "项目/ACTRA")).toBe(true);
    expect(isWithinRoot("项目/ACTRA2/周报.md", "项目/ACTRA")).toBe(false);
  });

  it("does not grant read access from the write root", () => {
    expect(isAuthorizedReadPath("ACTRA/每日总结/今天.md", [])).toBe(false);
    expect(isAuthorizedReadPath("ACTRA/每日总结/今天.md", ["项目"])).toBe(false);
    expect(isAuthorizedReadPath("项目/ACTRA/周报.md", ["项目/ACTRA"])).toBe(true);
  });
});
