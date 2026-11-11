import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "@jobinfo/database";
import { clearSession, readOtpToken, readSession, requireAuth, setSession, signOtpToken, userOf } from "../auth";
import { checkOtp, issueEmailOtp, issueOtp } from "../otp";
import { getSmsProvider } from "../integrations/registry";

export const authRouter = Router();
const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
authRouter.use(limiter);

const phone = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, ""))
  .refine((s) => /^(\+91)?[6-9]\d{9}$/.test(s), "Enter a valid Indian mobile number")
  .transform((s) => (s.startsWith("+91") ? s : "+91" + s));

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  phone,
  password: z.string().min(8, "Minimum 8 characters").max(128),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "You must accept the Terms and Privacy Policy" }) }),
});

authRouter.post("/register/candidate", async (req, res) => {
  const p = registerSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const d = p.data;
  try { getSmsProvider(); } catch (e) {
    return res.status(503).json({ error: e instanceof Error ? e.message : "SMS provider is unavailable." });
  }

  const existing = await prisma.user.findFirst({ where: { OR: [{ email: d.email }, { phone: d.phone }] } });
  if (existing) {
    // Allow an unverified account to restart; never reveal that a verified one exists beyond a generic message.
    if (existing.phoneVerifiedAt) return res.status(409).json({ error: "An account with this email or mobile already exists. Try logging in." });
    await prisma.user.delete({ where: { id: existing.id } });
  }
  const user = await prisma.user.create({
    data: {
      email: d.email,
      phone: d.phone,
      fullName: d.fullName,
      passwordHash: await bcrypt.hash(d.password, 12),
      role: "CANDIDATE",
      termsAcceptedAt: new Date(),
      candidate: { create: {} },
    },
  });
  const otp = await issueOtp(user.id, d.phone);
  res.status(201).json({
    verificationToken: signOtpToken(user.id),
    maskedPhone: d.phone.slice(0, 3) + "XXXXX" + d.phone.slice(-3),
    devCode: otp.ok ? otp.devCode : undefined,
  });
});

const verifySchema = z.object({ token: z.string(), code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") });
authRouter.post("/otp/verify", async (req, res) => {
  const p = verifySchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const uid = readOtpToken(p.data.token);
  if (!uid) return res.status(401).json({ error: "Session expired. Please register again." });
  const r = await checkOtp(uid, p.data.code);
  if (r === "expired") return res.status(400).json({ error: "Code expired. Request a new one." });
  if (r === "locked") return res.status(429).json({ error: "Too many attempts. Request a new code." });
  if (r === "invalid") return res.status(400).json({ error: "Incorrect code" });
  const user = await prisma.user.update({ where: { id: uid }, data: { phoneVerifiedAt: new Date() } });
  setSession(res, { id: user.id, role: user.role, sessionVersion: user.sessionVersion });
  res.json({ ok: true });
});

authRouter.post("/otp/resend", async (req, res) => {
  const uid = readOtpToken(String(req.body?.token ?? ""));
  if (!uid) return res.status(401).json({ error: "Session expired. Please register again." });
  const u = await prisma.user.findUnique({ where: { id: uid } });
  if (!u?.phone) return res.status(404).json({ error: "Not found" });
  const o = await issueOtp(uid, u.phone);
  if (!o.ok) return res.status(429).json({ error: `Please wait ${o.retryAfter}s before requesting another code` });
  res.json({ ok: true, devCode: o.devCode });
});

authRouter.post("/email/verification/send", requireAuth("CANDIDATE"), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: userOf(req).id } });
  if (!user || user.emailVerifiedAt) return res.status(400).json({ error: "Email is already verified or account was not found" });
  try {
    const result = await issueEmailOtp(user.id, user.email);
    if (!result.ok) return res.status(429).json({ error: `Please wait ${result.retryAfter}s before requesting another code` });
    res.json({ ok: true, devCode: result.devCode });
  } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Email provider is unavailable" }); }
});

authRouter.post("/email/verification/verify", requireAuth("CANDIDATE"), async (req, res) => {
  const p = z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const userId = userOf(req).id;
  const result = await checkOtp(userId, p.data.code, "EMAIL_VERIFY");
  if (result === "expired") return res.status(400).json({ error: "Code expired. Request a new one." });
  if (result === "locked") return res.status(429).json({ error: "Too many attempts. Request a new code." });
  if (result === "invalid") return res.status(400).json({ error: "Incorrect code" });
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  res.json({ ok: true });
});

const strongPassword = z.string().min(12, "Use at least 12 characters").max(128);
authRouter.post("/password/change", requireAuth(), async (req, res) => {
  const p = z.object({ currentPassword: z.string().min(1), newPassword: strongPassword }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const user = await prisma.user.findUnique({ where: { id: userOf(req).id } });
  if (!user || !await bcrypt.compare(p.data.currentPassword, user.passwordHash)) return res.status(401).json({ error: "Current password is incorrect" });
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(p.data.newPassword, 12), sessionVersion: { increment: 1 } } });
  await prisma.auditLog.create({ data: { actorId: user.id, action: "PASSWORD_CHANGED", entityType: "User", entityId: user.id, ipAddress: req.ip } });
  clearSession(res);
  res.json({ ok: true, message: "Password changed. Sign in again on your devices." });
});

authRouter.post("/password/reset/request", async (req, res) => {
  const p = z.object({ email: z.string().trim().toLowerCase().email() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Enter a valid email address" });
  const user = await prisma.user.findUnique({ where: { email: p.data.email }, select: { id: true, email: true, isActive: true } });
  let devCode: string | undefined;
  if (user?.isActive) {
    try { const result = await issueEmailOtp(user.id, user.email, "PASSWORD_RESET"); if (result.ok) devCode = result.devCode; } catch (error) { console.error("Password reset email delivery failed", error); }
  }
  res.json({ ok: true, message: "If an active account uses that email, a reset code has been sent.", devCode });
});

authRouter.post("/password/reset", async (req, res) => {
  const p = z.object({ email: z.string().trim().toLowerCase().email(), code: z.string().regex(/^\d{6}$/), newPassword: strongPassword }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const user = await prisma.user.findUnique({ where: { email: p.data.email }, select: { id: true, isActive: true } });
  if (!user?.isActive) return res.status(400).json({ error: "Code is invalid or expired" });
  const result = await checkOtp(user.id, p.data.code, "PASSWORD_RESET");
  if (result !== "ok") return res.status(result === "locked" ? 429 : 400).json({ error: result === "locked" ? "Too many attempts. Request another code." : "Code is invalid or expired" });
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(p.data.newPassword, 12), sessionVersion: { increment: 1 } } });
  await prisma.auditLog.create({ data: { actorId: user.id, action: "PASSWORD_RESET", entityType: "User", entityId: user.id, ipAddress: req.ip } });
  res.json({ ok: true, message: "Password reset. Sign in with your new password." });
});

authRouter.post("/login", async (req, res) => {
  const p = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Enter a valid email and password" });
  const user = await prisma.user.findUnique({ where: { email: p.data.email } });
  const ok = user && user.isActive && (await bcrypt.compare(p.data.password, user.passwordHash));
  if (!user || !ok) return res.status(401).json({ error: "Incorrect email or password" });
  if (user.role === "CANDIDATE" && !user.phoneVerifiedAt) return res.status(403).json({ error: "Please verify your mobile number first (register again to get a new code)." });
  setSession(res, { id: user.id, role: user.role, sessionVersion: user.sessionVersion });
  res.json({ ok: true, role: user.role, emailVerified: !!user.emailVerifiedAt });
});

authRouter.post("/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get("/me", async (req, res) => {
  const s = readSession(req);
  if (!s) return res.json({ user: null });
  const u = await prisma.user.findUnique({
    where: { id: s.id },
    select: { id: true, fullName: true, email: true, role: true, sessionVersion: true, isActive: true },
  });
  if (!u?.isActive || u.sessionVersion !== s.sessionVersion) return res.json({ user: null });
  const { sessionVersion: _sessionVersion, isActive: _isActive, ...safeUser } = u;
  res.json({ user: safeUser });
});
