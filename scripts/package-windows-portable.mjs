import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectPublicReleaseFiles, createBufferEntry, writeZipArchive } from "./release-archive.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const runtimeOptionIndex = process.argv.indexOf("--runtime-dir");
const runtimeInput = runtimeOptionIndex >= 0 ? process.argv[runtimeOptionIndex + 1] : process.env.INTERVIEW_TRAINER_NODE_RUNTIME;
if (!runtimeInput) throw new Error("请通过 --runtime-dir 或 INTERVIEW_TRAINER_NODE_RUNTIME 提供官方 Windows Node.js 运行时目录");

const runtimeDir = resolve(runtimeInput);
const nodePath = join(runtimeDir, "node.exe");
await stat(nodePath).catch(() => { throw new Error(`缺少 Windows Node.js 运行时：${nodePath}`); });

const licenseCandidates = ["LICENSE", "LICENSE.txt"];
let licensePath = null;
for (const candidate of licenseCandidates) {
  const path = join(runtimeDir, candidate);
  if (await stat(path).then((info) => info.isFile()).catch(() => false)) {
    licensePath = path;
    break;
  }
}
if (!licensePath) throw new Error(`官方 Node.js 运行时目录缺少许可证文件：${runtimeDir}`);

const files = await collectPublicReleaseFiles(root);
const sourceLauncher = files.find((file) => file.entry === "start.bat");
const launcherMtime = sourceLauncher?.mtime || new Date();
const portableLauncher = Buffer.from([
  "@echo off",
  "setlocal",
  "cd /d \"%~dp0\"",
  "if not exist \"%~dp0runtime\\node.exe\" (",
  "  echo [Interview Trainer] Bundled Node.js runtime is missing.",
  "  pause",
  "  exit /b 1",
  ")",
  "\"%~dp0runtime\\node.exe\" server.mjs --open",
  "pause",
  ""
].join("\r\n"), "utf8");

const launcherIndex = files.findIndex((file) => file.entry === "start.bat");
if (launcherIndex < 0) throw new Error("发布白名单中缺少 start.bat");
files.splice(launcherIndex, 1, createBufferEntry("start.bat", portableLauncher, launcherMtime));
files.push(
  { entry: "runtime/node.exe", path: nodePath, mtime: (await stat(nodePath)).mtime },
  { entry: "runtime/NODE-LICENSE", path: licensePath, mtime: (await stat(licensePath)).mtime },
  createBufferEntry("WINDOWS-PORTABLE.txt", [
    "面试训练场 Windows x64 免安装版",
    "",
    "1. 解压整个 ZIP，不能只在压缩包预览中运行。",
    "2. 双击 start.bat。",
    "3. 程序会启动本机服务并自动打开默认浏览器。",
    "4. 请保留 runtime 目录；此版本无需另行安装 Node.js。",
    "",
    `应用版本：${manifest.version}`,
    `内置 Node.js：${basename(runtimeDir)}`,
    ""
  ].join("\r\n"), launcherMtime)
);

const outputPath = join(root, "dist", `interview-trainer-windows-x64-v${manifest.version}.zip`);
const entries = await writeZipArchive(outputPath, files);
console.log(`Windows portable archive: ${outputPath}`);
console.log(`Entries: ${entries.length}`);
console.log(entries.join("\n"));
