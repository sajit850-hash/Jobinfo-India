const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(root, "backups"));
const stamp = process.argv[2] || "";
if (!/^\d{4}-\d{2}-\d{2}T[\d-]+Z$/.test(stamp)) { console.error("Usage: node scripts/restore.cjs <backup timestamp>"); process.exit(2); }
const dbFile = path.join(backupDir, `jobinfo-${stamp}.dump`);
const uploadsFile = path.join(backupDir, `uploads-${stamp}.tar.gz`);
const hashFile = path.join(backupDir, `jobinfo-${stamp}.sha256`);

function runWithFile(command, args, inputFile) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd: root, stdio: ["pipe", "inherit", "inherit"] });
    const input = fs.createReadStream(inputFile); input.pipe(proc.stdin);
    input.once("error", reject); proc.once("error", reject);
    proc.once("close", code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}
function hashFile(file) {
  return new Promise((resolve, reject) => { const hash = crypto.createHash("sha256"); const stream = fs.createReadStream(file); stream.on("data", chunk => hash.update(chunk)); stream.once("error", reject); stream.once("end", () => resolve(hash.digest("hex"))); });
}
async function main() {
  const [checksums] = await Promise.all([fsp.readFile(hashFile, "utf8"), fsp.stat(dbFile), fsp.stat(uploadsFile)]);
  for (const file of [dbFile, uploadsFile]) {
    const expected = checksums.split(/\r?\n/).find(line => line.endsWith(`  ${path.basename(file)}`))?.split("  ")[0];
    const actual = await hashFile(file);
    if (!expected || expected !== actual) throw new Error(`Checksum verification failed for ${path.basename(file)}`);
  }
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(`This will overwrite the database and private upload volume from ${stamp}. Type RESTORE ${stamp} to continue: `); rl.close();
  if (answer !== `RESTORE ${stamp}`) throw new Error("Restore cancelled");
  await runWithFile("docker", ["compose", "exec", "-T", "db", "pg_restore", "--exit-on-error", "--clean", "--if-exists", "--no-owner", "--no-acl", "-U", "jobinfo", "-d", "jobinfo_india"], dbFile);
  await runWithFile("docker", ["compose", "exec", "-T", "api", "tar", "-xzf", "-", "-C", "/data"], uploadsFile);
  console.log("Database and private uploads restored. Verify the application and backups before reopening traffic.");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
