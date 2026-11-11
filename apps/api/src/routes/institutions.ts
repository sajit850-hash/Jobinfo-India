import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@jobinfo/database";
import { requireAuth, userOf } from "../auth";

export const institutionsRouter = Router();
institutionsRouter.get("/", async (req, res) => {
  const q = String(req.query.q || "").slice(0, 100);
  const rows = await prisma.institution.findMany({
    where: { verified: true, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }, { state: { contains: q, mode: "insensitive" } }] } : {}) },
    include: { departments: true }, orderBy: { name: "asc" }, take: 100
  });
  res.json({ data: rows });
});
institutionsRouter.post("/register", async (req, res) => {
  const p = z.object({
    contactName: z.string().trim().min(2).max(100), email: z.string().email().toLowerCase(),
    password: z.string().min(10).max(128), name: z.string().trim().min(2).max(180),
    city: z.string().trim().min(2).max(80), state: z.string().trim().min(2).max(80),
    website: z.string().url().optional().or(z.literal(""))
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  if (await prisma.user.findUnique({ where: { email: p.data.email } })) return res.status(409).json({ error: "Email already registered" });
  const user = await prisma.user.create({
    data: { email: p.data.email, fullName: p.data.contactName, passwordHash: await bcrypt.hash(p.data.password, 12), role: "INSTITUTION",
      institution: { create: { name: p.data.name, city: p.data.city, state: p.data.state, website: p.data.website, verified: false } } },
    select: { id: true, email: true, role: true }
  });
  res.status(201).json({ ok: true, user, message: "Institution submitted for verification." });
});
institutionsRouter.get("/me", requireAuth("INSTITUTION"), async (req, res) => {
  const institution = await prisma.institution.findUnique({
    where: { userId: userOf(req).id },
    include: {
      departments: { orderBy: { name: "asc" } },
      students: {
        include: { placements: { orderBy: { createdAt: "desc" } } },
        orderBy: [{ passingYear: "desc" }, { fullName: "asc" }],
      },
    },
  });
  if (!institution) return res.status(404).json({ error: "Institution profile not found" });
  const [studentCount, placedCount, seekingCount] = await Promise.all([
    prisma.institutionStudent.count({ where: { institutionId: institution.id } }),
    prisma.institutionStudent.count({ where: { institutionId: institution.id, placementStatus: "PLACED" } }),
    prisma.institutionStudent.count({ where: { institutionId: institution.id, placementStatus: "SEEKING" } }),
  ]);
  res.json({ institution, summary: { studentCount, placedCount, seekingCount } });
});
institutionsRouter.patch("/me", requireAuth("INSTITUTION"), async (req, res) => {
  const p = z.object({ name: z.string().trim().min(2).max(180), city: z.string().trim().min(2).max(80), state: z.string().trim().min(2).max(80), website: z.string().url().optional().or(z.literal("")) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const institution = await prisma.institution.update({ where: { userId: userOf(req).id }, data: { ...p.data, website: p.data.website || null } });
  res.json({ institution });
});
institutionsRouter.post("/me/departments", requireAuth("INSTITUTION"), async (req, res) => {
  const p = z.object({ name: z.string().trim().min(2).max(100) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Department name is required" });
  const institution = await prisma.institution.findUnique({ where: { userId: userOf(req).id } });
  if (!institution) return res.status(404).json({ error: "Institution profile not found" });
  const existing = await prisma.department.findFirst({ where: { institutionId: institution.id, name: { equals: p.data.name, mode: "insensitive" } } });
  const department = existing || await prisma.department.create({ data: { institutionId: institution.id, name: p.data.name } });
  res.status(existing ? 200 : 201).json({ department });
});
institutionsRouter.delete("/me/departments/:id", requireAuth("INSTITUTION"), async (req, res) => {
  const department = await prisma.department.findFirst({ where: { id: String(req.params.id), institution: { userId: userOf(req).id } } });
  if (!department) return res.status(404).json({ error: "Department not found" });
  await prisma.department.delete({ where: { id: department.id } });
  res.json({ ok: true });
});

const studentInput = z.object({
  fullName: z.string().trim().min(2).max(120), email: z.string().trim().email().toLowerCase(), phone: z.string().trim().max(30).optional().or(z.literal("")),
  department: z.string().trim().min(2).max(100), degree: z.string().trim().max(150).optional().or(z.literal("")),
  passingYear: z.number().int().min(1990).max(2100), skills: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  headline: z.string().trim().max(180).optional().or(z.literal("")), profileSummary: z.string().trim().max(3000).optional().or(z.literal("")),
  recruiterVisible: z.boolean().default(false), placementStatus: z.enum(["SEEKING", "IN_PROCESS", "PLACED", "NOT_SEEKING"]).default("SEEKING"),
});
institutionsRouter.post("/me/students", requireAuth("INSTITUTION"), async (req, res) => {
  const p = studentInput.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const institution = await prisma.institution.findUnique({ where: { userId: userOf(req).id } });
  if (!institution) return res.status(404).json({ error: "Institution profile not found" });
  if (!institution.verified && p.data.recruiterVisible) return res.status(403).json({ error: "Institution approval is required before listing students for recruiters" });
  const existingStudent = await prisma.institutionStudent.findUnique({ where: { institutionId_email: { institutionId: institution.id, email: p.data.email } }, select: { id: true } });
  if (!existingStudent) {
    const subscription = await prisma.subscription.findFirst({ where: { userId: userOf(req).id, audience: "INSTITUTION", status: "ACTIVE", endsAt: { gt: new Date() } }, orderBy: { endsAt: "desc" }, select: { limits: true } });
    const limit = (subscription?.limits as Record<string, unknown> | null)?.studentRecords;
    if (typeof limit === "number" && await prisma.institutionStudent.count({ where: { institutionId: institution.id } }) >= limit) return res.status(403).json({ error: `Your institution plan allows ${limit} student records. Upgrade to add more.` });
  }
  const student = await prisma.institutionStudent.upsert({
    where: { institutionId_email: { institutionId: institution.id, email: p.data.email } },
    create: { ...p.data, phone: p.data.phone || null, degree: p.data.degree || null, headline: p.data.headline || null, profileSummary: p.data.profileSummary || null, institutionId: institution.id },
    update: { ...p.data, phone: p.data.phone || null, degree: p.data.degree || null, headline: p.data.headline || null, profileSummary: p.data.profileSummary || null },
  });
  res.status(201).json({ student });
});
institutionsRouter.patch("/me/students/:id", requireAuth("INSTITUTION"), async (req, res) => {
  const p = studentInput.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const institution = await prisma.institution.findUnique({ where: { userId: userOf(req).id }, select: { id: true, verified: true } });
  if (!institution) return res.status(404).json({ error: "Institution profile not found" });
  if (!institution.verified && p.data.recruiterVisible) return res.status(403).json({ error: "Institution approval is required before listing students for recruiters" });
  const existing = await prisma.institutionStudent.findFirst({ where: { id: String(req.params.id), institutionId: institution.id } });
  if (!existing) return res.status(404).json({ error: "Student not found" });
  try {
    const student = await prisma.institutionStudent.update({ where: { id: existing.id }, data: { ...p.data, phone: p.data.phone || null, degree: p.data.degree || null, headline: p.data.headline || null, profileSummary: p.data.profileSummary || null } });
    res.json({ student });
  } catch { res.status(409).json({ error: "A student with this email is already in the roster" }); }
});
institutionsRouter.delete("/me/students/:id", requireAuth("INSTITUTION"), async (req, res) => {
  const student = await prisma.institutionStudent.findFirst({ where: { id: String(req.params.id), institution: { userId: userOf(req).id } } });
  if (!student) return res.status(404).json({ error: "Student not found" });
  await prisma.institutionStudent.delete({ where: { id: student.id } });
  res.json({ ok: true });
});
institutionsRouter.post("/me/students/:id/placements", requireAuth("INSTITUTION"), async (req, res) => {
  const p = z.object({ companyName: z.string().trim().min(2).max(180), jobTitle: z.string().trim().min(2).max(180), status: z.enum(["IN_PROGRESS", "OFFERED", "JOINED", "DECLINED"]).default("IN_PROGRESS"), notes: z.string().max(2000).optional(), placedAt: z.string().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const student = await prisma.institutionStudent.findFirst({ where: { id: String(req.params.id), institution: { userId: userOf(req).id } } });
  if (!student) return res.status(404).json({ error: "Student not found" });
  const placement = await prisma.institutionPlacement.create({ data: { studentId: student.id, ...p.data, placedAt: p.data.placedAt ? new Date(p.data.placedAt) : null } });
  const placementStatus = p.data.status === "JOINED" ? "PLACED" : p.data.status === "IN_PROGRESS" || p.data.status === "OFFERED" ? "IN_PROCESS" : student.placementStatus;
  await prisma.institutionStudent.update({ where: { id: student.id }, data: { placementStatus } });
  res.status(201).json({ placement });
});
institutionsRouter.patch("/me/placements/:id", requireAuth("INSTITUTION"), async (req, res) => {
  const p = z.object({ companyName: z.string().trim().min(2).max(180), jobTitle: z.string().trim().min(2).max(180), status: z.enum(["IN_PROGRESS", "OFFERED", "JOINED", "DECLINED"]), notes: z.string().max(2000).optional(), placedAt: z.string().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const placement = await prisma.institutionPlacement.findFirst({ where: { id: String(req.params.id), student: { institution: { userId: userOf(req).id } } } });
  if (!placement) return res.status(404).json({ error: "Placement record not found" });
  const updated = await prisma.institutionPlacement.update({ where: { id: placement.id }, data: { ...p.data, placedAt: p.data.placedAt ? new Date(p.data.placedAt) : null } });
  const nextStatus = p.data.status === "JOINED" ? "PLACED" : p.data.status === "IN_PROGRESS" || p.data.status === "OFFERED" ? "IN_PROCESS" : "SEEKING";
  await prisma.institutionStudent.update({ where: { id: placement.studentId }, data: { placementStatus: nextStatus } });
  res.json({ placement: updated });
});

institutionsRouter.get("/candidates", requireAuth("RECRUITER"), async (req, res) => {
  const department = String(req.query.department || "").trim().slice(0, 100);
  const passingYear = Number(req.query.passingYear) || undefined;
  const institutionId = String(req.query.institutionId || "").slice(0, 100) || undefined;
  const location = String(req.query.location || "").trim().slice(0, 100);
  const q = String(req.query.q || "").trim().slice(0, 100);
  const where = { recruiterVisible: true, institution: { verified: true, ...(institutionId ? { id: institutionId } : {}), ...(location ? { OR: [{ city: { contains: location, mode: "insensitive" as const } }, { state: { contains: location, mode: "insensitive" as const } }] } : {}) }, ...(department ? { department: { contains: department, mode: "insensitive" as const } } : {}), ...(passingYear ? { passingYear } : {}), ...(q ? { OR: [{ fullName: { contains: q, mode: "insensitive" as const } }, { headline: { contains: q, mode: "insensitive" as const } }, { profileSummary: { contains: q, mode: "insensitive" as const } }, { skills: { hasSome: [q] } }] } : {}) };
  const data = await prisma.institutionStudent.findMany({ where, orderBy: [{ passingYear: "desc" }, { fullName: "asc" }], take: 100, select: { id: true, fullName: true, email: true, department: true, degree: true, passingYear: true, skills: true, headline: true, profileSummary: true, placementStatus: true, institution: { select: { id: true, name: true, city: true, state: true } } } });
  res.json({ data });
});
