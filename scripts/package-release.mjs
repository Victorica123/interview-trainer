import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const releaseName = `interview-trainer-v${manifest.version}.zip`;
const outputPath = join(root, "dist", releaseName);
const temporaryPath = `${outputPath}.tmp`;

// Public release inputs are deliberately explicit. Never replace this with a workspace-wide glob.
const ALLOWLIST = [
  ".gitignore",
  "LICENSE",
  "README.md",
  "package.json",
  "start.bat",
  "start.sh",
  "server.mjs",
  "content",
  "data",
  "docs",
  "public",
  "research",
  "scripts"
];

const FORBIDDEN_ENTRY = /(^|\/)(?:\.local|node_modules|dist|backups?|backup|browser-profiles?|chrome-profile|profiles?|cache|drafts?|cookies?)(?:\/|$)|(?:^|\/)(?:ai-config|site-cookies|analysis-cache|pending-update|browser-state|content-mutation|update-history|source-candidates)\.json$/i;
const FORBIDDEN_SECRET_NAME = /(?:api[-_]?key|secret|token|cookie|credential)/i;

async function collect(path, files) {
  const info = await stat(path);
  if (info.isDirectory()) {
    const names = await readdir(path);
    for (const name of names.sort((a, b) => a.localeCompare(b))) await collect(join(path, name), files);
    return;
  }
  if (!info.isFile()) throw new Error(`发布白名单包含不支持的条目：${path}`);
  const entry = relative(root, path).replaceAll("\\", "/");
  if (FORBIDDEN_ENTRY.test(entry) || FORBIDDEN_SECRET_NAME.test(basename(entry))) {
    throw new Error(`发布包拒绝敏感条目：${entry}`);
  }
  files.push({ entry, path, mtime: info.mtime });
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function localHeader(name, data, crc, date) {
  const header = Buffer.alloc(30);
  const { time, day } = dosDateTime(date);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(day, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  return header;
}

function centralHeader(name, data, crc, date, offset) {
  const header = Buffer.alloc(46);
  const { time, day } = dosDateTime(date);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(day, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE(offset, 42);
  return header;
}

const files = [];
for (const entry of ALLOWLIST) await collect(join(root, entry), files);
files.sort((a, b) => a.entry.localeCompare(b.entry));

const localParts = [];
const centralParts = [];
let localOffset = 0;
for (const file of files) {
  const name = Buffer.from(file.entry, "utf8");
  const data = await readFile(file.path);
  const crc = crc32(data);
  const local = localHeader(name, data, crc, file.mtime);
  localParts.push(local, name, data);
  centralParts.push(centralHeader(name, data, crc, file.mtime, localOffset), name);
  localOffset += local.length + name.length + data.length;
}

const central = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(central.length, 12);
end.writeUInt32LE(localOffset, 16);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(temporaryPath, Buffer.concat([...localParts, central, end]));
await rename(temporaryPath, outputPath);

const entries = files.map((file) => file.entry);
if (entries.some((entry) => FORBIDDEN_ENTRY.test(entry) || FORBIDDEN_SECRET_NAME.test(basename(entry)))) {
  throw new Error("生成后的发布条目检查失败");
}

console.log(`Release archive: ${outputPath}`);
console.log(`Entries: ${entries.length}`);
console.log(entries.join("\n"));
