import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const sourceRoot = join(projectRoot, "src");
const bundlePath = join(projectRoot, "main.js");
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
  { label: "Node.js path global", pattern: /\b__(?:dirname|filename)\b/u },
  { label: "desktop file adapter", pattern: /\bFileSystemAdapter\b/u },
  { label: "direct vault adapter access", pattern: /\b(?:vault\.)?adapter\b/u },
  { label: "platform-specific process access", pattern: /\bprocess\.platform\b/u },
  { label: "regular-expression lookbehind", pattern: /\(\?<(?=[=!])/u }
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

const bundle = readFileSync(bundlePath, "utf8");
const forbiddenBundleImport = /require\s*\(\s*["'](?:node:|electron(?:\/|["'])|fs(?:\/|["'])|path(?:\/|["'])|os(?:\/|["'])|crypto(?:\/|["'])|child_process(?:\/|["']))/u;
if (forbiddenBundleImport.test(bundle)) {
  throw new Error("main.js contains a mobile-incompatible Node.js or Electron runtime import.");
}

console.log("Mobile review passed: manifest, source, and production bundle support iOS and Android.");
