import crypto from "node:crypto";
import { prisma } from "@jobinfo/database";
import { config } from "./config";
import { getEmailProvider, getSmsProvider } from "./integrations/registry";
import { acceptsDemoOtp, isValidOtpCode } from "./otp-policy";

const hash = (code: string) =>
  crypto.createHmac("sha256", config.jwtSecret).update(code).digest("hex");

export async function issueOtp(userId: string, phone: string) {
  const demoMode = config.otpProvider === "demo";
  const last = await prisma.otpCode.findFirst({ where: { userId, purpose: "PHONE_VERIFY" }, orderBy: { createdAt: "desc" } });
  if (last && Date.now() - last.createdAt.getTime() < config.otpResendSeconds * 1000) {
    return { ok: false as const, retryAfter: config.otpResendSeconds };
  }
  const code = demoMode ? undefined : String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.otpCode.create({
    data: {
      userId,
      provider: config.otpProvider,
      codeHash: hash(code ?? crypto.randomBytes(32).toString("hex")),
      expiresAt: new Date(Date.now() + config.otpTtlMinutes * 60_000),
    },
  });
  if (!demoMode && code) {
    const template = await prisma.messageTemplate.findUnique({ where: { key: "PHONE_VERIFY" } });
    const smsText = template?.enabled ? template.body.replaceAll("{{code}}", code).replaceAll("{{minutes}}", String(config.otpTtlMinutes)) : undefined;
    await getSmsProvider().sendOtp({ to: phone, code, purpose: "PHONE_VERIFY", message: smsText });
  }
  return {
    ok: true as const,
    demoMode,
    devCode: !demoMode && !config.isProd && config.otpProvider === "console" ? code : undefined,
  };
}

export async function issueEmailOtp(userId: string, email: string, purpose = "EMAIL_VERIFY") {
  const last = await prisma.otpCode.findFirst({ where: { userId, purpose }, orderBy: { createdAt: "desc" } });
  if (last && Date.now() - last.createdAt.getTime() < config.otpResendSeconds * 1000) {
    return { ok: false as const, retryAfter: config.otpResendSeconds };
  }
  const demoMode = purpose === "EMAIL_VERIFY" && config.otpProvider === "demo";
  const code = demoMode ? undefined : String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.otpCode.create({
    data: {
      userId,
      purpose,
      provider: demoMode ? "demo" : process.env.EMAIL_PROVIDER || "console",
      codeHash: hash(code ?? crypto.randomBytes(32).toString("hex")),
      expiresAt: new Date(Date.now() + config.otpTtlMinutes * 60_000),
    },
  });
  if (!demoMode && code) {
    const template = await prisma.messageTemplate.findUnique({ where: { key: purpose } });
    const action = purpose === "EMAIL_VERIFY" ? "email verification" : "password reset";
    const text = template?.enabled ? template.body.replaceAll("{{code}}", code).replaceAll("{{minutes}}", String(config.otpTtlMinutes)) : `Your ${action} code is ${code}. It expires in ${config.otpTtlMinutes} minutes.`;
    const subject = template?.enabled && template.subject ? template.subject.replaceAll("{{code}}", code).replaceAll("{{minutes}}", String(config.otpTtlMinutes)) : purpose === "EMAIL_VERIFY" ? "Verify your Jobinfo India email" : "Reset your Jobinfo India password";
    await getEmailProvider().send({ to: email, subject, text });
  }
  return {
    ok: true as const,
    demoMode,
    devCode: !demoMode && !config.isProd && (process.env.EMAIL_PROVIDER || "console") === "console" ? code : undefined,
  };
}

export async function checkOtp(userId: string, code: string, purpose = "PHONE_VERIFY") {
  if (!isValidOtpCode(code)) return "invalid" as const;
  const rec = await prisma.otpCode.findFirst({
    where: { userId, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!rec || rec.expiresAt < new Date()) return "expired" as const;
  if (rec.attempts >= config.otpMaxAttempts) return "locked" as const;
  if ((purpose === "PHONE_VERIFY" || purpose === "EMAIL_VERIFY") && acceptsDemoOtp(code, config.otpProvider, rec.provider)) {
    const consumed = await prisma.otpCode.updateMany({
      where: { id: rec.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return consumed.count === 1 ? "ok" as const : "expired" as const;
  }
  const a = Buffer.from(hash(code));
  const b = Buffer.from(rec.codeHash);
  if (!crypto.timingSafeEqual(a, b)) {
    const updated = await prisma.otpCode.updateMany({
      where: { id: rec.id, consumedAt: null, attempts: { lt: config.otpMaxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    return updated.count === 1 ? "invalid" as const : "locked" as const;
  }
  const consumed = await prisma.otpCode.updateMany({
    where: { id: rec.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  return consumed.count === 1 ? "ok" as const : "expired" as const;
}
