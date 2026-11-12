import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma, Prisma } from "@jobinfo/database";
import { requireAuth, setSession, userOf } from "../auth";
import { phoneSchema } from "../validation";

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
    contactName: z.string().trim().min(2).max(100), email: z.string().trim().email().toLowerCase(),
    password: z.string().min(12, "Minimum 12 characters").max(128), name: z.string().trim().min(2).max(180),
    phone: phoneSchema,
    acceptTerms: z.literal(true, { error: "You must accept the Terms and Privacy Policy" }),
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  if (await prisma.user.findFirst({ where: { OR: [{ email: p.data.email }, { phone: p.data.phone }] } })) {
    return res.status(409).json({ error: "An account with this email or mobile already exists. Try logging in." });
  }
  const user = await prisma.user.create({
    data: {
      email: p.data.email,
      phone: p.data.phone,
      fullName: p.data.contactName,
      passwordHash: await bcrypt.hash(p.data.password, 12),
      role: "INSTITUTION",
      isActive: true,
      termsAcceptedAt: new Date(),
      registrationStatus: "PROFILE_INCOMPLETE",
      registrationDraft: { contactName: p.data.contactName, email: p.data.email, phone: p.data.phone, name: p.data.name, registrationType: "INSTITUTION" },
      institution: { create: { name: p.data.name, city: "", state: "", verified: false } },
    },
    select: { id: true, email: true, role: true }
  });
  setSession(res, user);
  res.status(201).json({ ok: true, role: user.role });
});
institutionsRouter.get("/me", requireAuth("INSTITUTION"), async (req, res) => {
  const institution = await prisma.institution.findUnique({
    where: { userId: userOf(req).id },
    include: {
      user: { select: { fullName: true, email: true, phone: true, registrationStatus: true } },
      departments: { orderBy: { name: "asc" } },
      courses: { orderBy: { name: "asc" } },
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
  const p = z.object({
    name: z.string().trim().min(2).max(180).optional(),
    city: z.string().trim().max(80).optional(),
    state: z.string().trim().max(80).optional(),
    website: z.string().url().max(500).optional().or(z.literal("")),
    institutionType: z.string().trim().max(100).optional(),
    category: z.string().trim().max(100).optional(),
    establishedYear: z.number().int().min(1500).max(new Date().getFullYear()).optional(),
    affiliation: z.string().trim().max(200).optional(),
    accreditation: z.string().trim().max(200).optional(),
    registrationNumber: z.string().trim().max(150).optional(),
    description: z.string().trim().max(5000).optional(),
    contactDesignation: z.string().trim().max(120).optional(),
    address: z.string().trim().max(500).optional(),
    postalCode: z.string().trim().max(20).optional(),
    country: z.string().trim().max(80).optional(),
    studentStrength: z.number().int().min(0).max(10_000_000).optional(),
    passingYears: z.array(z.number().int().min(1990).max(2100)).max(30).optional(),
    placementOfficer: z.object({
      name: z.string().trim().max(120).optional(),
      email: z.string().trim().email().optional().or(z.literal("")),
      phone: z.string().trim().max(30).optional(),
      designation: z.string().trim().max(120).optional(),
    }).optional(),
    departments: z.array(z.string().trim().min(2).max(100)).max(100).optional(),
    courses: z.array(z.string().trim().min(2).max(150)).max(200).optional(),
    complete: z.boolean().optional(),
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const { complete, departments, courses, website, ...fields } = p.data;
  const userId = userOf(req).id;
  if (complete && (!fields.name?.trim() || !fields.city?.trim() || !fields.state?.trim() || !(departments?.length || courses?.length))) {
    return res.status(400).json({ error: "Institution name, city, state, and at least one department or course are required to complete the profile" });
  }
  const institution = await prisma.institution.findUniqueOrThrow({ where: { userId }, select: { id: true } });
  const existingDepartments = departments?.length
    ? await prisma.department.findMany({ where: { institutionId: institution.id }, select: { name: true } })
    : [];
  const existingCourses = courses?.length
    ? await prisma.institutionCourse.findMany({ where: { institutionId: institution.id }, select: { name: true } })
    : [];
  const departmentNames = new Set(existingDepartments.map(({ name }) => name.toLowerCase()));
  const newDepartments = (departments ?? []).filter((name) => {
    const key = name.toLowerCase();
    if (departmentNames.has(key)) return false;
    departmentNames.add(key);
    return true;
  });
  const courseNames = new Set(existingCourses.map(({ name }) => name.toLowerCase()));
  const newCourses = (courses ?? []).filter((name) => {
    const key = name.toLowerCase();
    if (courseNames.has(key)) return false;
    courseNames.add(key);
    return true;
  });
  await prisma.$transaction([
    prisma.institution.update({
      where: { userId },
      data: { ...fields, website: website === undefined ? undefined : website || null },
    }),
    ...(newDepartments.length ? [prisma.department.createMany({ data: newDepartments.map((name) => ({ institutionId: institution.id, name })) })] : []),
    ...(newCourses.length ? [prisma.institutionCourse.createMany({ data: newCourses.map((name) => ({ institutionId: institution.id, name })) })] : []),
    prisma.user.update({
      where: { id: userId },
      data: {
        registrationStatus: complete === undefined ? undefined : complete ? "REGISTRATION_COMPLETED" : "PROFILE_INCOMPLETE",
        registrationDraft: complete ? Prisma.DbNull : undefined,
      },
    }),
  ]);
  const savedInstitution = await prisma.institution.findUniqueOrThrow({ where: { userId }, include: { departments: true, courses: true } });
  res.json({ institution: savedInstitution });
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
