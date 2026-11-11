import { Router } from "express";
import { z } from "zod";
import { prisma } from "@jobinfo/database";
import { requireAuth, userOf } from "../auth";
import { notifyUser } from "../notifications/service";

export const applicationsRouter = Router();
applicationsRouter.post("/", requireAuth("CANDIDATE"), async (req, res) => {
  const p = z.object({ jobId: z.string().min(1), coverLetter: z.string().max(5000).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "A valid job ID is required" });
  const candidate = await prisma.candidate.findUnique({ where: { userId: userOf(req).id } });
  if (!candidate) return res.status(404).json({ error: "Candidate profile not found" });
  const job = await prisma.job.findFirst({ where: { id: p.data.jobId, status: "PUBLISHED" }, include: { employer: { select: { userId: true } } } });
  if (!job) return res.status(404).json({ error: "Job is not available" });
  let application;
  try { application = await prisma.application.create({ data: { candidateId: candidate.id, jobId: job.id, coverLetter: p.data.coverLetter } }); }
  catch { return res.status(409).json({ error: "You have already applied for this job" }); }
  await notifyUser({ userId: userOf(req).id, title: "Application submitted", body: `Your application for ${job.title} was submitted.`, emailSubject: `Application submitted: ${job.title}` });
  await notifyUser({ userId: job.employer.userId, title: "New job application", body: `A candidate applied for ${job.title}.`, emailSubject: `New application: ${job.title}` });
  res.status(201).json({ application });
});
applicationsRouter.get("/mine", requireAuth("CANDIDATE"), async (req, res) => {
  const candidate = await prisma.candidate.findUnique({ where: { userId: userOf(req).id } });
  if (!candidate) return res.status(404).json({ error: "Candidate profile not found" });
  const data = await prisma.application.findMany({ where: { candidateId: candidate.id }, include: { job: { include: { employer: { select: { name: true } } } } }, orderBy: { appliedAt: "desc" } });
  res.json({ data });
});
applicationsRouter.get("/recruiter", requireAuth("RECRUITER"), async (req, res) => {
  const employer = await prisma.employer.findUnique({ where: { userId: userOf(req).id } });
  if (!employer) return res.status(404).json({ error: "Recruiter profile not found" });
  const data = await prisma.application.findMany({ where: { job: { employerId: employer.id } }, include: { job: true, candidate: { include: { user: { select: { fullName: true, email: true } }, skills: true, education: true, workExperience: true } } }, orderBy: { appliedAt: "desc" } });
  res.json({ data });
});
applicationsRouter.patch("/:id/status", requireAuth("RECRUITER"), async (req, res) => {
  const p = z.object({ status: z.enum(["VIEWED","SHORTLISTED","INTERVIEW","OFFERED","HIRED","REJECTED"]) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Invalid application status" });
  const employer = await prisma.employer.findUnique({ where: { userId: userOf(req).id } });
  const app = await prisma.application.findFirst({ where: { id: String(req.params.id), job: { employerId: employer?.id } }, include: { job: { select: { title: true } } } });
  if (!app) return res.status(404).json({ error: "Application not found" });
  if (app.status === p.data.status) return res.json({ application: app });
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.application.update({ where: { id: app.id }, data: { status: p.data.status } });
    await tx.auditLog.create({ data: { actorId: userOf(req).id, action: "APPLICATION_STATUS_CHANGED", entityType: "Application", entityId: app.id, metadata: { from: app.status, to: p.data.status, jobId: app.jobId }, ipAddress: req.ip } });
    return result;
  });
  const cand = await prisma.candidate.findUnique({ where: { id: app.candidateId } });
  if (cand) await notifyUser({ userId: cand.userId, title: "Application update", body: `Your application for ${app.job.title} changed to ${p.data.status}.`, emailSubject: `Application update: ${p.data.status}` });
  res.json({ application: updated });
});
