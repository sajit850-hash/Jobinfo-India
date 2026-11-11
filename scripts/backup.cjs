const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { finished } = require("node:stream/promises");

const root = path.resolve(__dirname, "..");
const outDir = path.resolve(process.env.BACKUP_DIR || path.join(root, "backups"));
const retentionDays = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS || 14));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

function capture(command, args, output) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
    const file = fs.createWriteStream(output, { flags: "wx", mode: 0o600 });
    const fileDone = finished(file);
    const procDone = new Promise((resolve, reject) => {
      proc.once("error", reject);
      proc.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
    });
    proc.stdout.pipe(file);
    Promise.all([fileDone, procDone]).then(resolve, reject);
  });
}
function hashFile(file) {
  return new Promise((resolve, reject) => { const hash = crypto.createHash("sha256"); const stream = fs.createReadStream(file); stream.on("data", chunk => hash.update(chunk)); stream.once("error", reject); stream.once("end", () => resolve(hash.digest("hex"))); });
}
async function main() {
  await fsp.mkdir(outDir, { recursive: true, mode: 0o700 });
  const dbFile = path.join(outDir, `jobinfo-${stamp}.dump`);
  const uploadsFile = path.join(outDir, `uploads-${stamp}.tar.gz`);
  await capture("docker", ["compose", "exec", "-T", "db", "pg_dump", "-U", "jobinfo", "-d", "jobinfo_india", "-Fc", "--no-owner", "--no-acl"], dbFile);
  await capture("docker", ["compose", "exec", "-T", "api", "tar", "-czf", "-", "-C", "/data", "private-uploads"], uploadsFile);
  const hashes = [];
  for (const file of [dbFile, uploadsFile]) hashes.push(`${await hashFile(file)}  ${path.basename(file)}`);
  await fsp.writeFile(path.join(outDir, `jobinfo-${stamp}.sha256`), `${hashes.join("\n")}\n`, { mode: 0o600, flag: "wx" });
  const cutoff = Date.now() - retentionDays * 86400000;
  for (const name of await fsp.readdir(outDir)) {
    const file = path.join(outDir, name); const info = await fsp.stat(file);
    if (info.isFile() && (name.startsWith("jobinfo-") || name.startsWith("uploads-")) && info.mtimeMs < cutoff) await fsp.rm(file);
  }
  console.log(`Backup complete: ${dbFile} and ${uploadsFile}`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
