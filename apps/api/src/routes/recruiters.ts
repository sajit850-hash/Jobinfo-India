import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma, Prisma } from "@jobinfo/database";
import { requireAuth, signOtpToken, userOf } from "../auth";
import { issueOtp } from "../otp";
import { phoneSchema } from "../validation";

export const recruitersRouter = Router();

recruitersRouter.post("/register", async (req, res) => {
  const p = z.object({
    fullName: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(10).max(128),
    recruiterType: z.enum(["FREELANCE", "CORPORATE"]),
    companyName: z.string().trim().min(2).max(150).optional(),
    phone: phoneSchema,
    city: z.string().trim().max(80).optional(),
    acceptTerms: z.literal(true, { error: "You must accept the Terms and Privacy Policy" }),
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const d = p.data;
  if (d.recruiterType === "CORPORATE" && !d.companyName) return res.status(400).json({ error: "Company name is required for corporate recruiters" });
  const existing = await prisma.user.findFirst({ where: { OR: [{ email: d.email }, { phone: d.phone }] } });
  if (existing) return res.status(409).json({ error: "An account with this email or mobile already exists. Try logging in." });
  const user = await prisma.user.create({
    data: {
      email: d.email, fullName: d.fullName, phone: d.phone,
      passwordHash: await bcrypt.hash(d.password, 12), role: "RECRUITER", isActive: false, termsAcceptedAt: new Date(),
      registrationDraft: { fullName: d.fullName, email: d.email, phone: d.phone, recruiterType: d.recruiterType, registrationType: "RECRUITER" },
      employer: { create: { name: d.companyName || d.fullName, city: d.city, recruiterType: d.recruiterType, industry: d.recruiterType === "FREELANCE" ? "Freelance Recruitment" : undefined } }
    },
    select: { id: true, email: true, fullName: true, role: true }
  });
  try {
    const otp = await issueOtp(user.id, d.phone);
    if (!otp.ok) {
      await prisma.user.delete({ where: { id: user.id } });
      return res.status(429).json({ error: `Please wait ${otp.retryAfter}s before requesting another code` });
    }
    await prisma.auditLog.create({ data: { actorId: user.id, action: "RECRUITER_REGISTERED", entityType: "User", entityId: user.id } });
    res.status(201).json({
      ok: true, verificationToken: signOtpToken(user.id), maskedPhone: d.phone.slice(0, 3) + "XXXXX" + d.phone.slice(-3),
      demoMode: otp.demoMode, devCode: otp.devCode, message: "Verify your mobile number to finish registration.",
    });
  } catch (error) {
    await prisma.user.delete({ where: { id: user.id } });
    res.status(503).json({ error: error instanceof Error ? error.message : "SMS provider is unavailable." });
  }
});

recruitersRouter.use(requireAuth("RECRUITER"));
recruitersRouter.get("/me", async (req, res) => {
  const userId = userOf(req).id;
  const employer = await prisma.employer.findUnique({ where: { userId }, include: { user: { select: { fullName: true, email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true, registrationStatus: true } }, jobs: { orderBy: { createdAt: "desc" }, take: 20, include: { _count: { select: { applications: true } } } } } });
  if (!employer) return res.status(404).json({ error: "Recruiter profile not found" });
  res.json({ employer, summary: {
    totalJobs: await prisma.job.count({ where: { employerId: employer.id } }),
    publishedJobs: await prisma.job.count({ where: { employerId: employer.id, status: "PUBLISHED" } }),
    applications: await prisma.application.count({ where: { job: { employerId: employer.id } } })
  } });
});
recruitersRouter.patch("/me", async (req, res) => {
  const p = z.object({
    fullName: z.string().trim().min(2).max(100).optional(),
    name: z.string().trim().min(2).max(150).optional(),
    website: z.string().url().max(500).optional().or(z.literal("")),
    industry: z.string().trim().max(120).optional(),
    city: z.string().trim().max(80).optional(),
    recruiterDesignation: z.string().trim().max(120).optional(),
    recruiterDepartment: z.string().trim().max(120).optional(),
    recruiterLinkedinUrl: z.string().url().max(500).optional().or(z.literal("")),
    companySize: z.string().trim().max(60).optional(),
    description: z.string().trim().max(5000).optional(),
    registeredAddress: z.string().trim().max(500).optional(),
    state: z.string().trim().max(80).optional(),
    postalCode: z.string().trim().max(20).optional(),
    country: z.string().trim().max(80).optional(),
    gstin: z.string().trim().max(20).optional(),
    companyLinkedinUrl: z.string().url().max(500).optional().or(z.literal("")),
    hiringDepartments: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
    hiringLocations: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
    hiringVolume: z.number().int().min(0).max(1_000_000).optional(),
    positionTypes: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    recruitmentRequirements: z.string().trim().max(5000).optional(),
    professionalExperienceYears: z.number().int().min(0).max(60).optional(),
    specialization: z.string().trim().max(200).optional(),
    preferredHiringCategories: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
    corporateContactDetails: z.record(z.string(), z.unknown()).optional(),
    teamInformation: z.record(z.string(), z.unknown()).optional(),
    complete: z.boolean().optional(),
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const { complete, fullName, recruiterLinkedinUrl, companyLinkedinUrl, website, corporateContactDetails, teamInformation, ...fields } = p.data;
  const userId = userOf(req).id;
  const account = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phoneVerifiedAt: true, emailVerifiedAt: true } });
  if (!account.phoneVerifiedAt || !account.emailVerifiedAt) return res.status(403).json({ error: "Verify both mobile and email before saving your profile" });
  if (complete && (!fields.name?.trim() || !fields.city?.trim() || !fields.industry?.trim())) {
    return res.status(400).json({ error: "Company or recruiter name, industry, and city are required to complete the profile" });
  }
  const [employer] = await prisma.$transaction([
    prisma.employer.update({
      where: { userId },
      data: {
        ...fields,
        website: website === undefined ? undefined : website || null,
        recruiterLinkedinUrl: recruiterLinkedinUrl === undefined ? undefined : recruiterLinkedinUrl || null,
        companyLinkedinUrl: companyLinkedinUrl === undefined ? undefined : companyLinkedinUrl || null,
        corporateContactDetails: corporateContactDetails as Prisma.InputJsonValue | undefined,
        teamInformation: teamInformation as Prisma.InputJsonValue | undefined,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: {
        fullName,
        registrationStatus: complete === undefined ? undefined : complete ? "REGISTRATION_COMPLETED" : "PROFILE_INCOMPLETE",
        registrationDraft: complete ? Prisma.DbNull : undefined,
      },
    }),
  ]);
  res.json({ employer });
});

type SearchExpression = { kind: "term"; value: string } | { kind: "not"; child: SearchExpression } | { kind: "and" | "or"; left: SearchExpression; right: SearchExpression };
export function parseBooleanSearch(input: string): SearchExpression {
  const tokens = input.match(/\(|\)|\bAND\b|\bOR\b|\bNOT\b|"(?:[^"\\]|\\.)*"|[^\s()]+/gi) || [];
  if (!tokens.length || tokens.join("").length === 0) throw new Error("Enter a candidate search term");
  let i = 0;
  const primary = (): SearchExpression => {
    const token = tokens[i++];
    if (!token) throw new Error("Unexpected end of Boolean search");
    if (/^NOT$/i.test(token)) return { kind: "not", child: primary() };
    if (token === "(") {
      const value = expression();
      if (tokens[i++] !== ")") throw new Error("Missing closing parenthesis");
      return value;
    }
    if (token === ")" || /^(AND|OR)$/i.test(token)) throw new Error("Expected a search term");
    const value = token.startsWith('"') ? token.slice(1, -1).replace(/\\"/g, '"') : token;
    return { kind: "term", value };
  };
  const conjunction = (): SearchExpression => {
    let left = primary();
    while (i < tokens.length && !/^OR$/i.test(tokens[i]) && tokens[i] !== ")") {
      if (/^AND$/i.test(tokens[i])) i++;
      left = { kind: "and", left, right: primary() };
    }
    return left;
  };
  const expression = (): SearchExpression => {
    let left = conjunction();
    while (/^OR$/i.test(tokens[i] || "")) {
      i++;
      left = { kind: "or", left, right: conjunction() };
    }
    return left;
  };
  const result = expression();
  if (i !== tokens.length) throw new Error("Unexpected token in Boolean search");
  return result;
}

export function searchWhere(expression: SearchExpression): Prisma.CandidateWhereInput {
  if (expression.kind === "not") return { NOT: searchWhere(expression.child) };
  if (expression.kind === "and") return { AND: [searchWhere(expression.left), searchWhere(expression.right)] };
  if (expression.kind === "or") return { OR: [searchWhere(expression.left), searchWhere(expression.right)] };
  if (expression.kind !== "term") throw new Error("Invalid Boolean search expression");
  const contains = { contains: expression.value, mode: "insensitive" as const };
  return { OR: [
    { user: { is: { fullName: contains } } }, { headline: contains }, { summary: contains },
    { skills: { some: { name: contains } } },
    { education: { some: { OR: [{ institution: contains }, { degree: contains }, { field: contains }, { department: contains }] } } },
    { workExperience: { some: { OR: [{ company: contains }, { title: contains }, { description: contains }] } } },
  ] };
}

recruitersRouter.get("/candidates", async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 200);
  const location = String(req.query.location || "").trim().slice(0, 100);
  const department = String(req.query.department || "").trim().slice(0, 100);
  const skills = String(req.query.skills || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 10);
  const page = Math.max(1, Math.min(1000, Number(req.query.page) || 1));
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
  if (!q && !location && !department && !skills.length) return res.status(400).json({ error: "Add a keyword, skill, location or department filter" });
  const clauses: Prisma.CandidateWhereInput[] = [{ searchable: true }];
  if (q) {
    try { clauses.push(searchWhere(parseBooleanSearch(q))); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid Boolean query" }); }
  }
  if (location) clauses.push({ OR: [{ city: { contains: location, mode: "insensitive" } }, { state: { contains: location, mode: "insensitive" } }] });
  if (department) clauses.push({ education: { some: { department: { contains: department, mode: "insensitive" } } } });
  for (const name of skills) clauses.push({ skills: { some: { name: { contains: name, mode: "insensitive" } } } });
  const where: Prisma.CandidateWhereInput = { AND: clauses };
  const [total, rows] = await Promise.all([
    prisma.candidate.count({ where }),
    prisma.candidate.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * limit, take: limit,
      select: { id: true, headline: true, summary: true, city: true, state: true, experienceYears: true,
        user: { select: { fullName: true } }, skills: { select: { name: true } },
        education: { select: { institution: true, degree: true, field: true, department: true, passingYear: true } },
        workExperience: { orderBy: { startDate: "desc" }, take: 3, select: { company: true, title: true, startDate: true, endDate: true, current: true } } },
    }),
  ]);
  res.json({ data: rows, total, page, limit });
});

recruitersRouter.get("/candidates/:candidateId", async (req, res) => {
  const employer = await prisma.employer.findUnique({ where: { userId: userOf(req).id }, select: { id: true } });
  if (!employer) return res.status(404).json({ error: "Recruiter profile not found" });
  const candidate = await prisma.candidate.findFirst({ where: { id: String(req.params.candidateId), OR: [
    { searchable: true }, { applications: { some: { job: { employerId: employer.id } } } },
  ] }, select: {
    id: true, headline: true, summary: true, city: true, state: true, experienceYears: true,
    user: { select: { fullName: true } }, skills: { select: { name: true } }, education: true, certifications: true,
    workExperience: { orderBy: { startDate: "desc" } },
  } });
  if (!candidate) return res.status(404).json({ error: "Candidate profile not found or is private" });
  await prisma.candidateProfileView.create({ data: { candidateId: candidate.id, recruiterId: userOf(req).id, source: "RECRUITER_PROFILE" } });
  res.json({ candidate });
});
