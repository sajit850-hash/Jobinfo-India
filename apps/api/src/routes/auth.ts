import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma, Prisma } from "@jobinfo/database";
import { clearSession, readPasswordResetToken, readSession, requireAuth, setSession, signPasswordResetToken, userOf } from "../auth";
import { getEmailProvider } from "../integrations/registry";
import { phoneSchema } from "../validation";
import { config } from "../config";

export const authRouter = Router();
const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
authRouter.use(limiter);

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  phone: phoneSchema,
  password: z.string().min(12, "Minimum 12 characters").max(128),
  acceptTerms: z.literal(true, { error: "You must accept the Terms and Privacy Policy" }),
});

authRouter.post("/register/candidate", async (req, res) => {
  const p = registerSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const d = p.data;

  const existing = await prisma.user.findFirst({ where: { OR: [{ email: d.email }, { phone: d.phone }] } });
  if (existing) return res.status(409).json({ error: "An account with this email or mobile already exists. Sign in to resume registration." });
  const user = await prisma.user.create({
    data: {
      email: d.email,
      phone: d.phone,
      fullName: d.fullName,
      passwordHash: await bcrypt.hash(d.password, 12),
      role: "CANDIDATE",
      isActive: true,
      termsAcceptedAt: new Date(),
      registrationStatus: "PROFILE_INCOMPLETE",
      registrationDraft: { fullName: d.fullName, email: d.email, phone: d.phone, registrationType: "CANDIDATE" },
      candidate: { create: {} },
    },
    select: { id: true, role: true, sessionVersion: true },
  });
  setSession(res, user);
  res.status(201).json({ ok: true, role: user.role });
});

authRouter.get("/registration/status", requireAuth(), async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: userOf(req).id },
    select: { id: true, role: true, registrationStatus: true, registrationDraft: true },
  });
  if (!user) return res.status(404).json({ error: "Registration not found" });
  res.json({
    role: user.role,
    status: user.registrationStatus,
    draft: user.registrationDraft,
  });
});

authRouter.put("/registration/draft", requireAuth(), async (req, res) => {
  const p = z.object({ draft: z.record(z.string(), z.unknown()) }).safeParse(req.body);
  if (!p.success || JSON.stringify(p.data?.draft ?? {}).length > 100_000) {
    return res.status(400).json({ error: "Registration draft is invalid or too large" });
  }
  const user = await prisma.user.findUnique({ where: { id: userOf(req).id }, select: { registrationDraft: true } });
  if (!user) return res.status(404).json({ error: "Registration not found" });
  const existingDraft = user.registrationDraft && typeof user.registrationDraft === "object" && !Array.isArray(user.registrationDraft)
    ? user.registrationDraft as Prisma.InputJsonObject
    : {};
  await prisma.user.update({
    where: { id: userOf(req).id },
    data: {
      registrationDraft: { ...existingDraft, ...p.data.draft } as Prisma.InputJsonObject,
      registrationStatus: "PROFILE_INCOMPLETE",
    },
  });
  res.json({ ok: true, status: "PROFILE_INCOMPLETE" });
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
  const user = await prisma.user.findUnique({ where: { email: p.data.email }, select: { id: true, email: true, isActive: true, sessionVersion: true } });
  if (user?.isActive) {
    try {
      const token = signPasswordResetToken(user);
      const resetUrl = new URL("/account/security/reset", config.webOrigin);
      resetUrl.searchParams.set("token", token);
      await getEmailProvider().send({
        to: user.email,
        subject: "Reset your Jobinfo India password",
        text: `Use this link to reset your password. It expires in 30 minutes and can be used once:\n\n${resetUrl.toString()}`,
      });
    } catch (error) {
      console.error("Password reset email delivery failed; check email provider configuration.");
    }
  }
  res.json({ ok: true, message: "If an active account uses that email, a password reset link has been sent." });
});

authRouter.post("/password/reset", async (req, res) => {
  const p = z.object({ token: z.string().min(1), newPassword: strongPassword }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const claims = readPasswordResetToken(p.data.token);
  if (!claims) return res.status(400).json({ error: "Reset link is invalid or expired. Request a new link." });
  const user = await prisma.user.findUnique({ where: { id: claims.id }, select: { id: true, isActive: true, sessionVersion: true } });
  if (!user?.isActive || user.sessionVersion !== claims.sessionVersion) return res.status(400).json({ error: "Reset link is invalid or expired. Request a new link." });
  const updated = await prisma.user.updateMany({
    where: { id: user.id, isActive: true, sessionVersion: claims.sessionVersion },
    data: { passwordHash: await bcrypt.hash(p.data.newPassword, 12), sessionVersion: { increment: 1 } },
  });
  if (updated.count !== 1) return res.status(400).json({ error: "Reset link is invalid or expired. Request a new link." });
  await prisma.auditLog.create({ data: { actorId: user.id, action: "PASSWORD_RESET", entityType: "User", entityId: user.id, ipAddress: req.ip } });
  res.json({ ok: true, message: "Password reset. Sign in with your new password." });
});

authRouter.post("/login", async (req, res) => {
  const p = z.object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(1),
    expectedRole: z.enum(["CANDIDATE", "RECRUITER", "INSTITUTION", "ADMIN"]).optional(),
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Enter a valid email and password" });
  const user = await prisma.user.findUnique({ where: { email: p.data.email } });
  const ok = user && user.isActive && (await bcrypt.compare(p.data.password, user.passwordHash));
  if (!user || !ok) return res.status(401).json({ error: "Incorrect email or password" });
  if (p.data.expectedRole && user.role !== p.data.expectedRole) return res.status(401).json({ error: "These credentials do not match this account type." });
  setSession(res, { id: user.id, role: user.role, sessionVersion: user.sessionVersion });
  res.json({ ok: true, role: user.role });
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
