import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { basename, dirname, join, relative } from "node:path";

export const PUBLIC_RELEASE_ALLOWLIST = [
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

export const FORBIDDEN_RELEASE_ENTRY = /(^|\/)(?:\.local|node_modules|dist|backups?|backup|browser-profiles?|chrome-profile|profiles?|cache|drafts?|cookies?)(?:\/|$)|(?:^|\/)(?:ai-config|site-cookies|analysis-cache|pending-update|browser-state|content-mutation|update-history|source-candidates)\.json$/i;
export const FORBIDDEN_SECRET_NAME = /(?:api[-_]?key|secret|token|cookie|credential)/i;

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  CRC_TABLE[index] = value >>> 0;
}

function assertSafeEntry(entry) {
  const normalized = String(entry || "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes("..") || FORBIDDEN_RELEASE_ENTRY.test(normalized) || FORBIDDEN_SECRET_NAME.test(basename(normalized))) {
    throw new Error(`发布包拒绝敏感或非法条目：${entry}`);
  }
  return normalized;
}

async function collectPath(root, path, files) {
  const info = await stat(path);
  if (info.isDirectory()) {
    const names = await readdir(path);
    for (const name of names.sort((a, b) => a.localeCompare(b))) await collectPath(root, join(path, name), files);
    return;
  }
  if (!info.isFile()) throw new Error(`发布白名单包含不支持的条目：${path}`);
  const entry = assertSafeEntry(relative(root, path));
  files.push({ entry, path, mtime: info.mtime });
}

export async function collectPublicReleaseFiles(root, allowlist = PUBLIC_RELEASE_ALLOWLIST) {
  const files = [];
  for (const entry of allowlist) await collectPath(root, join(root, entry), files);
  files.sort((a, b) => a.entry.localeCompare(b.entry));
  return files;
}

export function createBufferEntry(entry, data, mtime = new Date()) {
  return { entry: assertSafeEntry(entry), data: Buffer.isBuffer(data) ? data : Buffer.from(data), mtime };
}

export function assertSafeReleaseFiles(files) {
  const names = new Set();
  for (const file of files) {
    file.entry = assertSafeEntry(file.entry);
    if (names.has(file.entry)) throw new Error(`发布包包含重复条目：${file.entry}`);
    names.add(file.entry);
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const value = date instanceof Date && !Number.isNaN(date.valueOf()) ? date : new Date();
  const year = Math.max(1980, value.getFullYear());
  const time = (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate();
  return { time, day };
}

function localHeader(name, packed, unpackedSize, crc, date, method) {
  const header = Buffer.alloc(30);
  const { time, day } = dosDateTime(date);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(method, 8);
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(day, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(packed.length, 18);
  header.writeUInt32LE(unpackedSize, 22);
  header.writeUInt16LE(name.length, 26);
  return header;
}

function centralHeader(name, packed, unpackedSize, crc, date, offset, method) {
  const header = Buffer.alloc(46);
  const { time, day } = dosDateTime(date);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(method, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(day, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(packed.length, 20);
  header.writeUInt32LE(unpackedSize, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE(offset, 42);
  return header;
}

export async function writeZipArchive(outputPath, inputFiles) {
  const files = [...inputFiles].sort((a, b) => a.entry.localeCompare(b.entry));
  assertSafeReleaseFiles(files);
  if (files.length > 0xffff) throw new Error("发布包条目数量超过 ZIP32 限制");

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const file of files) {
    const name = Buffer.from(file.entry, "utf8");
    const data = file.data ?? await readFile(file.path);
    const deflated = deflateRawSync(data, { level: 9 });
    const packed = deflated.length < data.length ? deflated : data;
    const method = packed === deflated ? 8 : 0;
    const crc = crc32(data);
    const local = localHeader(name, packed, data.length, crc, file.mtime, method);
    localParts.push(local, name, packed);
    centralParts.push(centralHeader(name, packed, data.length, crc, file.mtime, localOffset, method), name);
    localOffset += local.length + name.length + packed.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(localOffset, 16);

  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, Buffer.concat([...localParts, central, end]));
  await rename(temporaryPath, outputPath);
  return files.map((file) => file.entry);
}
