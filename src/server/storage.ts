import fs from "node:fs/promises";
import path from "node:path";

export function getStorageDir() {
  return path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR ?? "./storage");
}

export async function saveStoredFile(relativePath: string, data: Buffer) {
  const full = path.join(/*turbopackIgnore: true*/ getStorageDir(), relativePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
  return relativePath;
}

export function resolveStoredPath(relativePath: string) {
  const root = getStorageDir();
  const full = path.resolve(root, relativePath);
  if (!full.startsWith(root)) {
    throw new Error("Invalid storage path");
  }
  return full;
}
