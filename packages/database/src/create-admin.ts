import bcrypt from "bcryptjs";
import { prisma } from "./index";

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || "Jobinfo India Admin";
  if (!email || !password || password.length < 14) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (minimum 14 characters).");
  const existingAdmin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (existingAdmin) throw new Error("An admin account already exists. Refusing to create another bootstrap admin.");
  await prisma.user.create({ data: { email, fullName: name, passwordHash: await bcrypt.hash(password, 12), role: "ADMIN", emailVerifiedAt: new Date() } });
  console.log(`Created initial admin: ${email}`);
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
