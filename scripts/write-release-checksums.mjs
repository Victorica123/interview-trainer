import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const names = [
  `interview-trainer-v${manifest.version}.zip`,
  `interview-trainer-windows-x64-v${manifest.version}.zip`
];

const lines = [];
for (const name of names) {
  const data = await readFile(join(dist, name));
  const hash = createHash("sha256").update(data).digest("hex").toUpperCase();
  lines.push(`${hash}  ${name}`);
}

const outputPath = join(dist, "SHA256SUMS.txt");
await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(`Release checksums: ${outputPath}`);
console.log(lines.join("\n"));
