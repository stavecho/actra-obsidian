import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const forbidden = [
  /\bVault\s*\.\s*(?:delete|trash)\s*\(/,
  /\bFileManager\s*\.\s*trashFile\s*\(/,
  /\bDataAdapter\s*\.\s*(?:remove|rmdir)\s*\(/,
  /\.vault\s*\.\s*(?:delete|trash)\s*\(/,
  /\.fileManager\s*\.\s*trashFile\s*\(/,
  /\.adapter\s*\.\s*(?:remove|rmdir)\s*\(/
];

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(path));
    else if (/\.(?:ts|js|mjs)$/.test(entry.name)) result.push(path);
  }
  return result;
}

const findings = [];
for (const path of await filesUnder("src")) {
  const source = await readFile(path, "utf8");
  source.split("\n").forEach((line, index) => {
    for (const pattern of forbidden) {
      if (pattern.test(line)) findings.push(`${path}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (findings.length > 0) {
  console.error("Forbidden local-file deletion capability found:\n" + findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Security review passed: no forbidden local-file deletion calls found.");
}
