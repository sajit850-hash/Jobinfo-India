import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { ResumeStorage } from "./contracts";

/** Private disk storage for local/single-node deployments. Keep its directory outside the web root. */
export class LocalFileStorage implements ResumeStorage {
  readonly name = "private local disk";
  private readonly root = path.resolve(process.env.UPLOAD_DIR || ".data/private-uploads");

  private resolve(key: string) {
    if (!/^users\/[A-Za-z0-9_-]+\/[a-f0-9-]{36}$/.test(key)) throw new Error("Invalid private file key");
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(`${this.root}${path.sep}`)) throw new Error("Invalid private file key");
    return resolved;
  }

  async check() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  async save(input: { ownerId: string; fileName: string; contentType: string; bytes: Buffer }) {
    const id = crypto.randomUUID();
    const key = `users/${input.ownerId}/${id}`;
    const filePath = this.resolve(key);
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFile(filePath, input.bytes, { mode: 0o600, flag: "wx" });
    await writeFile(`${filePath}.json`, JSON.stringify({ fileName: input.fileName, contentType: input.contentType }), { mode: 0o600, flag: "wx" });
    return { key, size: input.bytes.length };
  }

  async read(key: string) {
    const filePath = this.resolve(key);
    const [bytes, metadata] = await Promise.all([readFile(filePath), readFile(`${filePath}.json`, "utf8")]);
    const info = JSON.parse(metadata) as { fileName: string; contentType: string };
    return { bytes, ...info };
  }

  async remove(key: string) {
    const filePath = this.resolve(key);
    await Promise.all([rm(filePath, { force: true }), rm(`${filePath}.json`, { force: true })]);
  }
}
