import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectPublicReleaseFiles, writeZipArchive } from "./release-archive.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const outputPath = join(root, "dist", `interview-trainer-v${manifest.version}.zip`);
const files = await collectPublicReleaseFiles(root);
const entries = await writeZipArchive(outputPath, files);

console.log(`Release archive: ${outputPath}`);
console.log(`Entries: ${entries.length}`);
console.log(entries.join("\n"));
