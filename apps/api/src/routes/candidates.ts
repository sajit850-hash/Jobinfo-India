import { Router } from "express";
import { z } from "zod";
import { prisma, Prisma } from "@jobinfo/database";
import { requireAuth, userOf } from "../auth";
import { getResumeStorage } from "../integrations/registry";

export const candidatesRouter = Router();
candidatesRouter.use(requireAuth("CANDIDATE"));

const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(100).optional(),
  headline: z.string().trim().max(120).optional(),
  summary: z.string().trim().max(2000).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  currentAddress: z.string().trim().max(500).optional(),
  dateOfBirth: z.string().date().optional(),
  gender: z.string().trim().max(40).optional(),
  highestQualification: z.string().trim().max(120).optional(),
  course: z.string().trim().max(150).optional(),
  grade: z.string().trim().max(40).optional(),
  experienceYears: z.number().int().min(0).max(50).optional(),
  expectedSalary: z.number().int().min(0).max(2_000_000_000).optional(),
  preferredJobLocations: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  preferredJobRoles: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  employmentType: z.string().trim().max(60).optional(),
  workMode: z.string().trim().max(60).optional(),
  noticePeriod: z.string().trim().max(60).optional(),
  languages: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  linkedinUrl: z.string().url().max(500).optional().or(z.literal("")),
  portfolioUrl: z.string().url().max(500).optional().or(z.literal("")),
  complete: z.boolean().optional(),
  searchable: z.boolean().optional(),
  skills: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  education: z.array(z.object({
    institution: z.string().trim().min(1).max(150),
    degree: z.string().trim().min(1).max(100),
    field: z.string().trim().max(100).optional(),
    department: z.string().trim().max(100).optional(),
    passingYear: z.number().int().min(1970).max(2100).optional(),
    grade: z.string().trim().max(40).optional(),
  })).max(10).default([]),
  certifications: z.array(z.object({
    name: z.string().trim().min(1).max(150),
    issuer: z.string().trim().max(150).optional(),
    issueYear: z.number().int().min(1970).max(2100).optional(),
    issueDate: z.string().date().optional(),
    expiryDate: z.string().date().optional(),
    credentialUrl: z.string().url().optional().or(z.literal("")),
  })).max(20).default([]),
  workExperience: z.array(z.object({
    company: z.string().trim().min(1).max(150),
    title: z.string().trim().min(1).max(150),
    location: z.string().trim().max(100).optional(),
    description: z.string().trim().max(2000).optional(),
    employmentType: z.string().trim().max(60).optional(),
    startDate: z.string().date(),
    endDate: z.string().date().optional(),
    current: z.boolean().default(false),
  }).refine((x) => x.current || !!x.endDate, { message: "Add an end date or mark this role as current" })).max(20).default([]),
});


candidatesRouter.get("/me", async (req, res) => {
  const candidate = await prisma.candidate.findUnique({ where: { userId: userOf(req).id }, include: { user: { select: { fullName: true, email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true, registrationStatus: true } }, skills: true, education: true, certifications: true, workExperience: { orderBy: { startDate: "desc" } } } });
  if (!candidate) return res.status(404).json({ error: "Candidate profile not found" });
  const { resumeUrl, profilePhotoKey, ...profile } = candidate;
  res.json({ candidate: { ...profile, hasResume: !!resumeUrl, hasProfilePhoto: !!profilePhotoKey } });
});

candidatesRouter.put("/me", async (req, res) => {
  const p = profileSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const { fullName, skills, education, certifications, workExperience, complete: requestedComplete, dateOfBirth, ...rest } = p.data;
  const complete = requestedComplete ?? true;
  const cand = await prisma.candidate.findUniqueOrThrow({ where: { userId: userOf(req).id } });
  const account = await prisma.user.findUniqueOrThrow({ where: { id: userOf(req).id }, select: { phoneVerifiedAt: true, emailVerifiedAt: true } });
  if (!account.phoneVerifiedAt || !account.emailVerifiedAt) return res.status(403).json({ error: "Verify both mobile and email before saving your profile" });
  if (complete && (!rest.headline?.trim() || !rest.city?.trim() || (!skills.length && !education.length && !workExperience.length))) {
    return res.status(400).json({ error: "Add a headline, current city, and at least one skill, education record, or experience record to complete your profile" });
  }
  const unique = [...new Set(skills.map((s) => s.toLowerCase()))].map(
    (n) => skills.find((s) => s.toLowerCase() === n)!,
  );
  await prisma.$transaction([
    ...(fullName ? [prisma.user.update({ where: { id: userOf(req).id }, data: { fullName } })] : []),
    prisma.candidate.update({
      where: { id: cand.id },
      data: {
        ...rest,
        dateOfBirth: dateOfBirth ? new Date(`${dateOfBirth}T00:00:00.000Z`) : undefined,
        linkedinUrl: rest.linkedinUrl || null,
        portfolioUrl: rest.portfolioUrl || null,
        passingYear: education[0]?.passingYear,
        profileComplete: complete,
      },
    }),
    prisma.candidateSkill.deleteMany({ where: { candidateId: cand.id } }),
    prisma.candidateSkill.createMany({ data: unique.map((name) => ({ candidateId: cand.id, name })) }),
    prisma.education.deleteMany({ where: { candidateId: cand.id } }),
    ...(education.length ? [prisma.education.createMany({ data: education.map((e) => ({ ...e, candidateId: cand.id })) })] : []),
    prisma.certification.deleteMany({ where: { candidateId: cand.id } }),
    ...(certifications.length ? [prisma.certification.createMany({ data: certifications.map((c) => ({
      ...c,
      issueDate: c.issueDate ? new Date(`${c.issueDate}T00:00:00.000Z`) : null,
      expiryDate: c.expiryDate ? new Date(`${c.expiryDate}T00:00:00.000Z`) : null,
      credentialUrl: c.credentialUrl || null,
      candidateId: cand.id,
    })) })] : []),
    prisma.workExperience.deleteMany({ where: { candidateId: cand.id } }),
    ...(workExperience.length ? [prisma.workExperience.createMany({ data: workExperience.map((x) => ({ ...x, startDate: new Date(`${x.startDate}T00:00:00.000Z`), endDate: x.endDate ? new Date(`${x.endDate}T00:00:00.000Z`) : null, candidateId: cand.id })) })] : []),
    prisma.user.update({
      where: { id: userOf(req).id },
      data: { registrationStatus: complete ? "REGISTRATION_COMPLETED" : "PROFILE_INCOMPLETE", registrationDraft: complete ? Prisma.DbNull : undefined },
    }),
  ]);
  res.json({ ok: true });
});

const uploadSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  contentType: z.string().max(100),
  data: z.string().min(1).max(7_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
function decodeUpload(input: z.infer<typeof uploadSchema>, allowed: Record<string, string[]>, maxBytes: number) {
  if (!allowed[input.contentType]?.some((ext) => input.fileName.toLowerCase().endsWith(ext))) throw new Error("Unsupported file type");
  const bytes = Buffer.from(input.data, "base64");
  if (!bytes.length || bytes.length > maxBytes || bytes.toString("base64").replace(/=+$/, "") !== input.data.replace(/=+$/, "")) throw new Error("Invalid file data or file is too large");
  const type = input.contentType;
  const valid = type === "application/pdf" ? bytes.subarray(0, 5).toString() === "%PDF-"
    : type === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
    : type === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : type === "image/webp" ? bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP"
    : type === "application/msword" ? bytes.subarray(0, 4).equals(Buffer.from([0xd0,0xcf,0x11,0xe0]))
    : type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? bytes.subarray(0, 2).toString() === "PK"
    : false;
  if (!valid) throw new Error("File contents do not match the selected file type");
  return bytes;
}
const resumeTypes = { "application/pdf": [".pdf"], "application/msword": [".doc"], "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"] };
const imageTypes = { "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"], "image/webp": [".webp"] };

async function streamPrivateFile(key: string, res: import("express").Response, disposition: "inline" | "attachment") {
  try {
    const file = await getResumeStorage().read(key);
    const fileName = file.fileName.replace(/[\r\n"\\]/g, "_");
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Length", file.bytes.length);
    res.setHeader("Content-Disposition", `${disposition}; filename="${fileName}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(file.bytes);
  } catch { res.status(404).json({ error: "File not found" }); }
}

candidatesRouter.put("/me/resume", async (req, res) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Select a PDF, DOC or DOCX resume up to 5 MB" });
  const candidate = await prisma.candidate.findUniqueOrThrow({ where: { userId: userOf(req).id } });
  try {
    const bytes = decodeUpload(parsed.data, resumeTypes, 5 * 1024 * 1024);
    const saved = await getResumeStorage().save({ ownerId: userOf(req).id, fileName: parsed.data.fileName.replace(/[\\/\r\n]/g, "_"), contentType: parsed.data.contentType, bytes });
    await prisma.candidate.update({ where: { id: candidate.id }, data: { resumeUrl: saved.key } });
    if (candidate.resumeUrl) await getResumeStorage().remove(candidate.resumeUrl).catch(() => undefined);
    res.json({ ok: true, fileName: parsed.data.fileName, size: saved.size });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not save resume" }); }
});
candidatesRouter.get("/me/resume", async (req, res) => {
  const candidate = await prisma.candidate.findUnique({ where: { userId: userOf(req).id }, select: { id: true, resumeUrl: true } });
  if (!candidate?.resumeUrl) return res.status(404).json({ error: "No resume uploaded" });
  if (candidate.resumeUrl.startsWith("demo://resume/")) return res.status(200).type("text/plain").attachment("demo-resume.txt").send(`JOBINFO INDIA — DEMO RESUME\n\nCandidate ID: ${candidate.id}\nThis fictional text resume is provided for staging dashboard testing.\nNo real candidate information is included.\n`);
  return streamPrivateFile(candidate.resumeUrl, res, "attachment");
});
candidatesRouter.delete("/me/resume", async (req, res) => {
  const candidate = await prisma.candidate.findUniqueOrThrow({ where: { userId: userOf(req).id } });
  if (candidate.resumeUrl) await getResumeStorage().remove(candidate.resumeUrl).catch(() => undefined);
  await prisma.candidate.update({ where: { id: candidate.id }, data: { resumeUrl: null } });
  res.json({ ok: true });
});

candidatesRouter.put("/me/photo", async (req, res) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Select a JPG, PNG or WEBP photo up to 2 MB" });
  const candidate = await prisma.candidate.findUniqueOrThrow({ where: { userId: userOf(req).id } });
  try {
    const bytes = decodeUpload(parsed.data, imageTypes, 2 * 1024 * 1024);
    const saved = await getResumeStorage().save({ ownerId: userOf(req).id, fileName: parsed.data.fileName.replace(/[\\/\r\n]/g, "_"), contentType: parsed.data.contentType, bytes });
    await prisma.candidate.update({ where: { id: candidate.id }, data: { profilePhotoKey: saved.key } });
    if (candidate.profilePhotoKey) await getResumeStorage().remove(candidate.profilePhotoKey).catch(() => undefined);
    res.json({ ok: true });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not save photo" }); }
});
candidatesRouter.get("/me/photo", async (req, res) => {
  const candidate = await prisma.candidate.findUnique({ where: { userId: userOf(req).id }, select: { profilePhotoKey: true, user: { select: { fullName: true } } } });
  if (!candidate?.profilePhotoKey) return res.status(404).json({ error: "No profile photo uploaded" });
  if (candidate.profilePhotoKey.startsWith("demo-avatar-")) {
    const initials = candidate.user.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part.replace(/[^a-z]/gi, "").slice(0, 1).toUpperCase()).join("") || "JD";
    return res.status(200).type("image/svg+xml").send(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="128" fill="#e7eefc"/><text x="128" y="150" text-anchor="middle" font-family="Arial,sans-serif" font-size="82" font-weight="700" fill="#3157a4">${initials}</text></svg>`);
  }
  return streamPrivateFile(candidate.profilePhotoKey, res, "inline");
});
candidatesRouter.delete("/me/photo", async (req, res) => {
  const candidate = await prisma.candidate.findUniqueOrThrow({ where: { userId: userOf(req).id } });
  if (candidate.profilePhotoKey) await getResumeStorage().remove(candidate.profilePhotoKey).catch(() => undefined);
  await prisma.candidate.update({ where: { id: candidate.id }, data: { profilePhotoKey: null } });
  res.json({ ok: true });
});


candidatesRouter.get("/saved-jobs", async (req, res) => {
  const candidate = await prisma.candidate.findUniqueOrThrow({ where: { userId: userOf(req).id } });
  const data = await prisma.savedJob.findMany({ where: { candidateId: candidate.id }, include: { job: { include: { employer: { select: { name: true, verified: true } } } } }, orderBy: { createdAt: "desc" } });
  res.json({ data });
});
candidatesRouter.get("/saved-jobs/:jobId", async (req, res) => {
  const candidate = await prisma.candidate.findUniqueOrThrow({ where: { userId: userOf(req).id } });
  const saved = await prisma.savedJob.findUnique({ where: { candidateId_jobId: { candidateId: candidate.id, jobId: String(req.params.jobId) } }, select: { jobId: true } });
  res.json({ saved: !!saved });
});
candidatesRouter.post("/saved-jobs/:jobId", async (req, res) => {
  const candidate = await prisma.candidate.findUniqueOrThrow({ where: { userId: userOf(req).id } });
  const job = await prisma.job.findFirst({ where: { id: String(req.params.jobId), status: "PUBLISHED" }, select: { id: true } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  await prisma.savedJob.upsert({ where: { candidateId_jobId: { candidateId: candidate.id, jobId: job.id } }, create: { candidateId: candidate.id, jobId: job.id }, update: {} });
  res.status(201).json({ ok: true });
});
candidatesRouter.delete("/saved-jobs/:jobId", async (req, res) => {
  const candidate = await prisma.candidate.findUniqueOrThrow({ where: { userId: userOf(req).id } });
  await prisma.savedJob.deleteMany({ where: { candidateId: candidate.id, jobId: String(req.params.jobId) } });
  res.json({ ok: true });
});
