import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const sourceRoot = join(projectRoot, "src");
const manifest = JSON.parse(readFileSync(join(projectRoot, "manifest.json"), "utf8"));

if (manifest.isDesktopOnly !== false) {
  throw new Error("manifest.json must set isDesktopOnly to false for iOS and Android support.");
}

function collectTypeScriptFiles(directory) {
  return readdirSync(directory)
    .flatMap((name) => {
      const filePath = join(directory, name);
      return statSync(filePath).isDirectory() ? collectTypeScriptFiles(filePath) : [filePath];
    })
    .filter((filePath) => extname(filePath) === ".ts");
}

const forbiddenRuntimePatterns = [
  { label: "Node.js module", pattern: /(?:from\s+|import\s*\(|require\s*\()\s*["'](?:node:|fs(?:\/|["'])|path(?:\/|["'])|os(?:\/|["'])|crypto(?:\/|["'])|child_process(?:\/|["']))/u },
  { label: "Electron module", pattern: /(?:from\s+|import\s*\(|require\s*\()\s*["']electron(?:\/|["'])/u },
  { label: "Node.js process global", pattern: /\bprocess\.(?:env|platform|versions|cwd)\b/u },
  { label: "Node.js Buffer global", pattern: /\bBuffer(?:\.|\s*\()/u },
  { label: "Node.js path global", pattern: /\b__(?:dirname|filename)\b/u }
];

const violations = [];
for (const filePath of collectTypeScriptFiles(sourceRoot)) {
  const source = readFileSync(filePath, "utf8");
  for (const { label, pattern } of forbiddenRuntimePatterns) {
    if (pattern.test(source)) violations.push(`${relative(projectRoot, filePath)}: ${label}`);
  }
}

if (violations.length > 0) {
  throw new Error(`Mobile-incompatible runtime API detected:\n${violations.join("\n")}`);
}

console.log("Mobile review passed: manifest supports mobile and src/ has no Node.js or Electron runtime APIs.");
