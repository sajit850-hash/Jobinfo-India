import crypto from "node:crypto";
import { prisma } from "@jobinfo/database";
import { config } from "./config";
import { getEmailProvider, getSmsProvider } from "./integrations/registry";

const hash = (code: string) =>
  crypto.createHmac("sha256", config.jwtSecret).update(code).digest("hex");

export async function issueOtp(userId: string, phone: string) {
  const last = await prisma.otpCode.findFirst({ where: { userId, purpose: "PHONE_VERIFY" }, orderBy: { createdAt: "desc" } });
  if (last && Date.now() - last.createdAt.getTime() < config.otpResendSeconds * 1000) {
    return { ok: false as const, retryAfter: config.otpResendSeconds };
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.otpCode.create({
    data: { userId, codeHash: hash(code), expiresAt: new Date(Date.now() + config.otpTtlMinutes * 60_000) },
  });
  const template = await prisma.messageTemplate.findUnique({ where: { key: "PHONE_VERIFY" } });
  const smsText = template?.enabled ? template.body.replaceAll("{{code}}", code).replaceAll("{{minutes}}", String(config.otpTtlMinutes)) : undefined;
  await getSmsProvider().sendOtp({ to: phone, code, purpose: "PHONE_VERIFY", message: smsText });
  return { ok: true as const, devCode: !config.isProd && process.env.OTP_PROVIDER === "console" ? code : undefined };
}

export async function issueEmailOtp(userId: string, email: string, purpose = "EMAIL_VERIFY") {
  const last = await prisma.otpCode.findFirst({ where: { userId, purpose }, orderBy: { createdAt: "desc" } });
  if (last && Date.now() - last.createdAt.getTime() < config.otpResendSeconds * 1000) {
    return { ok: false as const, retryAfter: config.otpResendSeconds };
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.otpCode.create({
    data: { userId, purpose, codeHash: hash(code), expiresAt: new Date(Date.now() + config.otpTtlMinutes * 60_000) },
  });
  const template = await prisma.messageTemplate.findUnique({ where: { key: purpose } });
  const action = purpose === "EMAIL_VERIFY" ? "email verification" : "password reset";
  const text = template?.enabled ? template.body.replaceAll("{{code}}", code).replaceAll("{{minutes}}", String(config.otpTtlMinutes)) : `Your ${action} code is ${code}. It expires in ${config.otpTtlMinutes} minutes.`;
  const subject = template?.enabled && template.subject ? template.subject.replaceAll("{{code}}", code).replaceAll("{{minutes}}", String(config.otpTtlMinutes)) : purpose === "EMAIL_VERIFY" ? "Verify your Jobinfo India email" : "Reset your Jobinfo India password";
  await getEmailProvider().send({ to: email, subject, text });
  return { ok: true as const, devCode: !config.isProd && (process.env.EMAIL_PROVIDER || "console") === "console" ? code : undefined };
}

export async function checkOtp(userId: string, code: string, purpose = "PHONE_VERIFY") {
  const rec = await prisma.otpCode.findFirst({
    where: { userId, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!rec || rec.expiresAt < new Date()) return "expired" as const;
  if (rec.attempts >= config.otpMaxAttempts) return "locked" as const;
  const a = Buffer.from(hash(code));
  const b = Buffer.from(rec.codeHash);
  if (!crypto.timingSafeEqual(a, b)) {
    await prisma.otpCode.update({ where: { id: rec.id }, data: { attempts: { increment: 1 } } });
    return "invalid" as const;
  }
  await prisma.otpCode.update({ where: { id: rec.id }, data: { consumedAt: new Date() } });
  return "ok" as const;
}
