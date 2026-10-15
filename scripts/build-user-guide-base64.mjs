import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePath = join(root, "docs", "ACTRA-USER-GUIDE.md");
const outputPath = join(root, "docs", "ACTRA-USER-GUIDE-BASE64.md");
let guide = await readFile(sourcePath, "utf8");

for (const image of ["actra-guide-connect.svg", "actra-guide-sync.svg"]) {
  const reference = `](images/${image})`;
  if (!guide.includes(reference)) throw new Error(`Guide is missing ${image}`);
  const svg = await readFile(join(root, "docs", "images", image));
  guide = guide.replaceAll(
    reference,
    `](data:image/svg+xml;base64,${svg.toString("base64")})`,
  );
}

guide = guide.replaceAll(
  "](../PRIVACY.md)",
  "](https://github.com/stavecho/actra-obsidian/blob/main/PRIVACY.md)",
);
await writeFile(outputPath, guide);
console.log(`Created ${outputPath}`);
