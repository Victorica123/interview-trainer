import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

let writeSequence = 0;

export async function writeFileAtomic(filePath, data, { tempPath } = {}) {
  await mkdir(dirname(filePath), { recursive: true });
  const pendingPath = tempPath || `${filePath}.${process.pid}-${Date.now()}-${++writeSequence}.tmp`;
  let handle = null;
  try {
    handle = await open(pendingPath, "w");
    await handle.writeFile(data, typeof data === "string" ? "utf8" : undefined);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(pendingPath, filePath);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(pendingPath, { force: true }).catch(() => {});
  }
}

export async function writeTextAtomic(filePath, text, options) {
  await writeFileAtomic(filePath, text, options);
}

export async function writeJsonAtomic(filePath, value, options) {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}
