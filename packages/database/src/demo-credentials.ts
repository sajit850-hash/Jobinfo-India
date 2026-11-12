import { randomBytes } from "node:crypto";
import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { prisma } from "./index";

async function main() {
  const staging = process.env.DEMO_DATA_ENVIRONMENT === "staging" && !!process.env.NEON_BRANCH && !/production|main/i.test(process.env.NEON_BRANCH);
  if (process.env.DEMO_DATA_ENABLED !== "true" || (process.env.NODE_ENV === "production" && !staging)) throw new Error("Credential generation is restricted to development or authorized staging.");
  const batchKey = process.env.DEMO_DATA_BATCH_KEY || "jobinfo-demo-v1";
  const batch = await prisma.demoSeedBatch.findUnique({ where: { batchKey } });
  if (!batch || batch.status !== "ACTIVE") throw new Error(`Active demo batch ${batchKey} was not found.`);
  const ownership = await prisma.demoDataRecord.findMany({ where: { batchId: batch.id, recordType: "User", deletedAt: null }, select: { recordId: true } });
  const users = await prisma.user.findMany({ where: { id: { in: ownership.map(row => row.recordId) } }, select: { id: true, email: true, role: true } });
  if (users.length !== ownership.length) throw new Error("Tracked demo user records are incomplete; no credentials were changed.");
  const lines = ["Jobinfo India demo account credentials", `Batch: ${batchKey}`, `Generated: ${new Date().toISOString()}`, "Passwords are random, hashed in PostgreSQL and stored only in this ignored local report.", "Role\tUser ID\tEmail\tPassword"];
  const updates = await Promise.all(users.map(async user => {
    const password = randomBytes(24).toString("base64url");
    lines.push(`${user.role}\t${user.id}\t${user.email}\t${password}`);
    return { id: user.id, passwordHash: await bcrypt.hash(password, 12) };
  }));
  const reportPath = path.resolve(process.cwd(), ".local", "demo-credentials.txt");
  const temporaryPath = `${reportPath}.tmp`;
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(temporaryPath, lines.join("\n") + "\n", { mode: 0o600 });
  try {
    await prisma.$transaction(updates.map(update => prisma.user.update({ where: { id: update.id }, data: { passwordHash: update.passwordHash, sessionVersion: { increment: 1 } } })));
    await rename(temporaryPath, reportPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  console.log(`Generated credentials for ${users.length} tracked demo accounts at packages/database/.local/demo-credentials.txt`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Credential generation failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
