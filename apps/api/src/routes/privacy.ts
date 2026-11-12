import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "@jobinfo/database";
import { requireAuth, userOf } from "../auth";
import { getResumeStorage } from "../integrations/registry";

export const privacyRouter = Router();
privacyRouter.use(requireAuth());

privacyRouter.get("/export", async (req, res) => {
  const userId = userOf(req).id;
  const [user, candidate, employer, institution, billingProfile, notifications, subscriptions, invoices] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, fullName: true, email: true, phone: true, role: true, emailVerifiedAt: true, phoneVerifiedAt: true, registrationStatus: true, registrationDraft: true, termsAcceptedAt: true, createdAt: true, updatedAt: true } }),
    prisma.candidate.findUnique({ where: { userId }, include: { skills: true, education: true, certifications: true, workExperience: true, applications: { include: { job: { select: { id: true, title: true, status: true, employer: { select: { name: true } } } } } } } }),
    prisma.employer.findUnique({ where: { userId }, include: { jobs: { select: { id: true, title: true, status: true, createdAt: true, updatedAt: true } } } }),
    prisma.institution.findUnique({ where: { userId }, include: { departments: true, courses: true, students: { include: { placements: true } } } }),
    prisma.billingProfile.findUnique({ where: { userId } }),
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.subscription.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.taxInvoice.findMany({ where: { userId }, orderBy: { issuedAt: "desc" } }),
  ]);
  res.setHeader("Content-Disposition", "attachment; filename=jobinfo-account-export.json");
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ exportedAt: new Date().toISOString(), account: user, candidate, employer, institution, billingProfile, notifications, subscriptions, invoices });
});

privacyRouter.post("/delete-account", async (req, res) => {
  const body = req.body as { password?: unknown; confirmation?: unknown };
  if (typeof body.password !== "string" || body.confirmation !== "DELETE") return res.status(400).json({ error: "Enter your password and type DELETE to confirm account removal" });
  const user = await prisma.user.findUnique({
    where: { id: userOf(req).id },
    include: {
      candidate: { select: { resumeUrl: true, profilePhotoKey: true } },
      employer: { select: { recruiterProfilePhotoKey: true, companyLogoKey: true, verificationDocumentKeys: true } },
      institution: { select: { logoKey: true, registrationDocumentKeys: true, accreditationDocumentKeys: true, affiliationDocumentKeys: true } },
    },
  });
  if (!user || !await bcrypt.compare(body.password, user.passwordHash)) return res.status(401).json({ error: "Password is incorrect" });
  try {
    if (user.candidate?.resumeUrl) await getResumeStorage().remove(user.candidate.resumeUrl);
    if (user.candidate?.profilePhotoKey) await getResumeStorage().remove(user.candidate.profilePhotoKey);
    if (user.employer?.recruiterProfilePhotoKey) await getResumeStorage().remove(user.employer.recruiterProfilePhotoKey);
    if (user.employer?.companyLogoKey) await getResumeStorage().remove(user.employer.companyLogoKey);
    for (const key of user.employer?.verificationDocumentKeys ?? []) await getResumeStorage().remove(key);
    if (user.institution?.logoKey) await getResumeStorage().remove(user.institution.logoKey);
    for (const key of user.institution?.registrationDocumentKeys ?? []) await getResumeStorage().remove(key);
    for (const key of user.institution?.accreditationDocumentKeys ?? []) await getResumeStorage().remove(key);
    for (const key of user.institution?.affiliationDocumentKeys ?? []) await getResumeStorage().remove(key);
  } catch { return res.status(503).json({ error: "Could not remove private uploaded files. Account data was not changed." }); }

  const tombstoneEmail = `deleted-${user.id}@deleted.invalid`;
  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({ data: { action: "ACCOUNT_DATA_ERASED", entityType: "User", metadata: { role: user.role }, ipAddress: req.ip } });
    await tx.candidate.deleteMany({ where: { userId: user.id } });
    await tx.employer.deleteMany({ where: { userId: user.id } });
    await tx.institution.deleteMany({ where: { userId: user.id } });
    await tx.billingProfile.deleteMany({ where: { userId: user.id } });
    await tx.notification.deleteMany({ where: { userId: user.id } });
    await tx.otpCode.deleteMany({ where: { userId: user.id } });
    await tx.taxInvoice.updateMany({ where: { userId: user.id }, data: { legalName: "Deleted account", gstin: null, billingAddress: "Removed at account holder request", placeOfSupply: "Removed" } });
    await tx.user.update({ where: { id: user.id }, data: { email: tombstoneEmail, fullName: "Deleted account", phone: null, passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12), isActive: false, emailVerifiedAt: null, phoneVerifiedAt: null, termsAcceptedAt: null, sessionVersion: { increment: 1 } } });
  });
  res.json({ ok: true, message: "Account profile and private uploads were removed. You have been signed out." });
});
