import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma, Prisma } from "@jobinfo/database";
import { requireAuth, setSession, userOf } from "../auth";
import { phoneSchema } from "../validation";
import { consumePlanUsage, PlanAccessError } from "../billing/entitlements";
import { getResumeStorage } from "../integrations/registry";
import { getEmailProvider } from "../integrations/registry";
import { createZip } from "../security/zip-archive";

export const recruitersRouter = Router();

recruitersRouter.post("/register", async (req, res) => {
  const p = z.object({
    fullName: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(12, "Minimum 12 characters").max(128),
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
      passwordHash: await bcrypt.hash(d.password, 12), role: "RECRUITER", isActive: true, termsAcceptedAt: new Date(),
      registrationStatus: "PROFILE_INCOMPLETE",
      registrationDraft: { fullName: d.fullName, email: d.email, phone: d.phone, recruiterType: d.recruiterType, registrationType: "RECRUITER" },
      employer: { create: { name: d.companyName || d.fullName, city: d.city, recruiterType: d.recruiterType, industry: d.recruiterType === "FREELANCE" ? "Freelance Recruitment" : undefined } }
    },
    select: { id: true, email: true, fullName: true, role: true }
  });
  await prisma.auditLog.create({ data: { actorId: user.id, action: "RECRUITER_REGISTERED", entityType: "User", entityId: user.id } });
  setSession(res, user);
  res.status(201).json({ ok: true, role: user.role });
});

recruitersRouter.use(requireAuth("RECRUITER"));
recruitersRouter.get("/me", async (req, res) => {
  const userId = userOf(req).id;
  const employer = await prisma.employer.findUnique({ where: { userId }, include: { user: { select: { fullName: true, email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true, registrationStatus: true } }, jobs: { orderBy: { createdAt: "desc" }, take: 20, include: { _count: { select: { applications: true } } } } } });
  if (!employer) return res.status(404).json({ error: "Recruiter profile not found" });
  const [totalJobs, publishedJobs, draftJobs, pendingApprovalJobs, applications, pendingApplications, shortlistedCandidates, upcomingInterviews, applicationGroups] = await Promise.all([
    prisma.job.count({ where: { employerId: employer.id } }),
    prisma.job.count({ where: { employerId: employer.id, status: { in: ["PUBLISHED", "ACTIVE"] } } }),
    prisma.job.count({ where: { employerId: employer.id, status: "DRAFT" } }),
    prisma.job.count({ where: { employerId: employer.id, status: { in: ["PENDING_APPROVAL","PENDING_REVIEW"] } } }),
    prisma.application.count({ where: { job: { employerId: employer.id } } }),
    prisma.application.count({ where: { job: { employerId: employer.id }, status: "APPLIED" } }),
    prisma.application.count({ where: { job: { employerId: employer.id }, status: "SHORTLISTED" } }),
    prisma.interview.count({ where: { recruiterId: userId, scheduledAt: { gte: new Date() }, status: "SCHEDULED" } }),
    prisma.application.groupBy({ by: ["jobId", "status"], where: { job: { employerId: employer.id } }, _count: { _all: true } }),
  ]);
  const jobs = employer.jobs.map((job) => {
    const counts = applicationGroups.filter((group) => group.jobId === job.id);
    const count = (statuses: string[]) => counts.filter((group) => statuses.includes(group.status)).reduce((sum, group) => sum + group._count._all, 0);
    return { ...job, applicationSummary: { total: count(["APPLIED", "VIEWED", "SHORTLISTED", "INTERVIEW", "OFFERED", "HIRED", "REJECTED", "WITHDRAWN"]), shortlisted: count(["SHORTLISTED"]), pending: count(["APPLIED", "VIEWED"]), rejected: count(["REJECTED"]) } };
  });
  res.json({ employer: { ...employer, jobs }, summary: { totalJobs, publishedJobs, draftJobs, pendingApprovalJobs, applications, pendingApplications, shortlistedCandidates, upcomingInterviews } });
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
  const multi = (key: string) => { const raw = req.query[key]; return (Array.isArray(raw) ? raw : [raw]).flatMap(value => String(value || "").split(",")).map(x => x.trim()).filter(Boolean).slice(0, 20); };
  const skills = multi("skills");
  const skillMatch = String(req.query.skillMatch || "AND").toUpperCase();
  const page = Math.max(1, Math.min(1000, Number(req.query.page) || 1));
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
  if (!["AND", "OR"].includes(skillMatch)) return res.status(400).json({ error: "Skills matching must be AND or OR" });
  const clauses: Prisma.CandidateWhereInput[] = [{ searchable: true, user: { is: { isActive: true, deletedAt: null } } }];
  if (q) {
    try { clauses.push(searchWhere(parseBooleanSearch(q))); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid Boolean query" }); }
  }
  if (location) clauses.push({ OR: [{ city: { contains: location, mode: "insensitive" } }, { state: { contains: location, mode: "insensitive" } }] });
  if (department) clauses.push({ education: { some: { department: { contains: department, mode: "insensitive" } } } });
  if (skills.length) clauses.push(skillMatch === "AND" ? { AND: skills.map(name => ({ skills: { some: { name: { contains: name, mode: "insensitive" } } } })) } : { OR: skills.map(name => ({ skills: { some: { name: { contains: name, mode: "insensitive" } } } })) });
  const addMulti = (key: string, build: (value: string) => Prisma.CandidateWhereInput) => { const values = multi(key); if (values.length) clauses.push({ OR: values.map(build) }); };
  const experienceRanges: Record<string, [number, number | null]> = { FRESHER: [0, 0], "0-1": [0, 1], "1-3": [1, 3], "3-5": [3, 5], "5-10": [5, 10], "10+": [10, null] };
  const experience = multi("experience").map(key => experienceRanges[key]).filter(Boolean);
  if (experience.length) clauses.push({ OR: experience.map(([min, max]) => ({ experienceYears: { gte: min, ...(max == null ? {} : { lte: max }) } })) });
  addMulti("gender", value => ({ gender: { equals: value, mode: "insensitive" } }));
  addMulti("qualification", value => ({ highestQualification: { contains: value, mode: "insensitive" } }));
  addMulti("course", value => ({ course: { contains: value, mode: "insensitive" } }));
  addMulti("language", value => ({ languages: { has: value } }));
  addMulti("designation", value => ({ OR: [{ currentDesignation: { contains: value, mode: "insensitive" } }, { workExperience: { some: { current: true, title: { contains: value, mode: "insensitive" } } } }] }));
  addMulti("company", value => ({ OR: [{ currentCompany: { contains: value, mode: "insensitive" } }, { workExperience: { some: { current: true, company: { contains: value, mode: "insensitive" } } } }] }));
  addMulti("industry", value => ({ currentIndustry: { contains: value, mode: "insensitive" } }));
  addMulti("noticePeriod", value => ({ noticePeriod: { contains: value, mode: "insensitive" } }));
  addMulti("preferredRole", value => ({ preferredJobRoles: { has: value } }));
  addMulti("preferredLocation", value => ({ OR: [{ preferredJobLocations: { has: value } }, { city: { contains: value, mode: "insensitive" } }, { state: { contains: value, mode: "insensitive" } }, { postalCode: { contains: value } }] }));
  addMulti("workMode", value => ({ workMode: { contains: value, mode: "insensitive" } }));
  addMulti("employmentType", value => ({ employmentType: { contains: value, mode: "insensitive" } }));
  addMulti("shift", value => ({ preferredShift: { contains: value, mode: "insensitive" } }));
  const salaryRanges: Record<string, [number, number | null]> = { "0-2": [0, 200000], "2-3": [200000, 300000], "3-5": [300000, 500000], "5-8": [500000, 800000], "8-12": [800000, 1200000], "12-20": [1200000, 2000000], "20+": [2000000, null] };
  for (const [key, field] of [["currentCtc", "currentSalary"], ["expectedCtc", "expectedSalary"]] as const) { const ranges = multi(key).map(value => salaryRanges[value]).filter(Boolean); if (ranges.length) clauses.push({ OR: ranges.map(([min, max]) => ({ [field]: { gte: min, ...(max == null ? {} : { lte: max }) } })) as Prisma.CandidateWhereInput[] }); }
  const now = new Date();
  if (String(req.query.activity || "") === "NEW") clauses.push({ createdAt: { gte: new Date(now.getTime() - 30 * 86400000) } });
  if (String(req.query.activity || "") === "RECENTLY_UPDATED") clauses.push({ updatedAt: { gte: new Date(now.getTime() - 30 * 86400000) } });
  if (String(req.query.activity || "") === "ACTIVE") clauses.push({ user: { is: { lastActiveAt: { gte: new Date(now.getTime() - 30 * 86400000) } } } });
  const lastActive = String(req.query.lastActive || "");
  if (lastActive) { const dayCount = lastActive === "TODAY" ? 1 : Number(lastActive.replace("D", "")); if (!Number.isFinite(dayCount) || dayCount < 1 || dayCount > 30) return res.status(400).json({ error: "Invalid last-active range" }); clauses.push({ user: { is: { lastActiveAt: { gte: new Date(now.getTime() - dayCount * 86400000) } } } }); }
  if (req.query.resume === "UPLOADED") clauses.push({ resumeUrl: { not: null } });
  if (req.query.resume === "NOT_UPLOADED") clauses.push({ resumeUrl: null });
  if (req.query.profile === "COMPLETE") clauses.push({ profileComplete: true });
  if (req.query.profile === "INCOMPLETE") clauses.push({ profileComplete: false });
  if ([7, 15, 30, 90].includes(Number(req.query.updatedWithin))) clauses.push({ updatedAt: { gte: new Date(now.getTime() - Number(req.query.updatedWithin) * 86400000) } });
  if (req.query.verified === "true") clauses.push({ user: { is: { emailVerifiedAt: { not: null }, phoneVerifiedAt: { not: null } } } });
  if (req.query.linkedin === "true") clauses.push({ linkedinUrl: { not: null } });
  if (multi("ageGroup").length) {
    if (process.env.ENABLE_AGE_BASED_CANDIDATE_FILTERS !== "true") return res.status(403).json({ error: "Age filters are disabled by the privacy configuration." });
    const ageBounds: Record<string, [number, number | null]> = { "18-24": [18, 24], "25-30": [25, 30], "31-40": [31, 40], "41+": [41, null] };
    const ranges = multi("ageGroup").map(value => ageBounds[value]).filter(Boolean);
    clauses.push({ OR: ranges.map(([min, max]) => ({ dateOfBirth: { lte: new Date(Date.UTC(now.getUTCFullYear() - min, now.getUTCMonth(), now.getUTCDate())), ...(max == null ? {} : { gt: new Date(Date.UTC(now.getUTCFullYear() - max - 1, now.getUTCMonth(), now.getUTCDate())) }) } })) });
  }
  const orderBy: Prisma.CandidateOrderByWithRelationInput[] = String(req.query.sort || "NEWEST") === "RECENTLY_ACTIVE" ? [{ user: { lastActiveAt: "desc" } }, { updatedAt: "desc" }] : String(req.query.sort || "NEWEST") === "LOWEST_EXPECTED_SALARY" ? [{ expectedSalary: "asc" }, { updatedAt: "desc" }] : String(req.query.sort || "NEWEST") === "HIGHEST_EXPERIENCE" || String(req.query.sort || "NEWEST") === "BEST_EXPERIENCE_MATCH" ? [{ experienceYears: "desc" }, { updatedAt: "desc" }] : String(req.query.sort || "NEWEST") === "HIGHEST_SKILLS_MATCH" ? [{ skills: { _count: "desc" } }, { updatedAt: "desc" }] : [{ createdAt: "desc" }];
  try { await consumePlanUsage(userOf(req).id, "candidate.searches", 1, req.get("x-idempotency-key")); }
  catch (error) { if (error instanceof PlanAccessError) return res.status(error.status).json({ error: error.message, ...error.details }); throw error; }
  const where: Prisma.CandidateWhereInput = { AND: clauses };
  const [total, rows] = await Promise.all([
    prisma.candidate.count({ where }),
    prisma.candidate.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit,
      select: { id: true, headline: true, summary: true, city: true, state: true, experienceYears: true, currentDesignation: true, currentCompany: true, currentIndustry: true, currentSalary: true, expectedSalary: true, noticePeriod: true, preferredShift: true, preferredJobRoles: true, preferredJobLocations: true, workMode: true, employmentType: true, updatedAt: true, createdAt: true, profileComplete: true, resumeUrl: true, profilePhotoKey: true, linkedinUrl: true,
        user: { select: { id: true, fullName: true, createdAt: true, lastActiveAt: true, emailVerifiedAt: true, phoneVerifiedAt: true } }, skills: { select: { name: true } },
        education: { select: { institution: true, degree: true, field: true, department: true, passingYear: true } },
        workExperience: { orderBy: { startDate: "desc" }, take: 3, select: { company: true, title: true, startDate: true, endDate: true, current: true } },
        recruiterActions: { where: { recruiterId: userOf(req).id }, select: { status: true } }, recruiterComments: { where: { recruiterId: userOf(req).id }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, body: true, createdAt: true } } },
    }),
  ]);
  const data = rows.map(({ resumeUrl, profilePhotoKey, ...row }) => ({ ...row, hasResume: Boolean(resumeUrl), hasPhoto: Boolean(profilePhotoKey), recruiterStatus: row.recruiterActions[0]?.status || null, lastComment: row.recruiterComments[0] || null, verified: row.profileComplete && Boolean(row.user.emailVerifiedAt && row.user.phoneVerifiedAt) }));
  res.json({ data, total, page, limit, pageCount: Math.ceil(total / limit), filters: req.query, ageFiltersEnabled: process.env.ENABLE_AGE_BASED_CANDIDATE_FILTERS === "true" });
});

recruitersRouter.get("/candidate-views", async (req, res) => {
  const recruiterId = userOf(req).id; const page = Math.max(1, Math.min(1000, Number(req.query.page) || 1)); const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
  const [totalUnique, data] = await Promise.all([prisma.candidateProfileView.count({ where: { recruiterId } }), prisma.candidateProfileView.findMany({ where: { recruiterId }, orderBy: { viewedAt: "desc" }, skip: (page - 1) * limit, take: limit, include: { candidate: { select: { id: true, headline: true, city: true, state: true, user: { select: { fullName: true } } } } } })]);
  res.json({ totalUnique, data, page, limit });
});

recruitersRouter.get("/candidates/:candidateId", async (req, res) => {
  const employer = await prisma.employer.findUnique({ where: { userId: userOf(req).id }, select: { id: true } });
  if (!employer) return res.status(404).json({ error: "Recruiter profile not found" });
  const candidate = await prisma.candidate.findFirst({ where: { id: String(req.params.candidateId), user: { is: { isActive: true, deletedAt: null } }, OR: [
    { searchable: true }, { applications: { some: { job: { employerId: employer.id } } } },
  ] }, select: {
    id: true, headline: true, summary: true, city: true, state: true, experienceYears: true, currentDesignation: true, currentCompany: true, currentIndustry: true, currentSalary: true, expectedSalary: true, noticePeriod: true, workMode: true, employmentType: true, preferredShift: true, preferredJobRoles: true, preferredJobLocations: true, linkedinUrl: true, updatedAt: true, resumeUrl: true, profilePhotoKey: true,
    user: { select: { id: true, fullName: true, emailVerifiedAt: true, phoneVerifiedAt: true } }, skills: { select: { name: true } }, education: true, certifications: true,
    workExperience: { orderBy: { startDate: "desc" } },
    recruiterActions: { where: { recruiterId: userOf(req).id }, select: { status: true } }, recruiterComments: { where: { recruiterId: userOf(req).id }, orderBy: { createdAt: "desc" }, take: 50 },
  } });
  if (!candidate) return res.status(404).json({ error: "Candidate profile not found or is private" });
  try { await consumePlanUsage(userOf(req).id, "candidate.profile_views", 1, req.get("x-idempotency-key")); }
  catch (error) { if (error instanceof PlanAccessError) return res.status(error.status).json({ error: error.message, ...error.details }); throw error; }
  await prisma.$transaction(async tx => {
    await tx.candidateProfileView.upsert({ where: { candidateId_recruiterId: { candidateId: candidate.id, recruiterId: userOf(req).id } }, create: { candidateId: candidate.id, recruiterId: userOf(req).id, source: "RECRUITER_PROFILE" }, update: { viewedAt: new Date(), source: "RECRUITER_PROFILE" } });
    await tx.candidateRecruiterAction.upsert({ where: { candidateId_recruiterId: { candidateId: candidate.id, recruiterId: userOf(req).id } }, create: { candidateId: candidate.id, recruiterId: userOf(req).id, status: "VIEWED" }, update: {} });
    await tx.auditLog.create({ data: { actorId: userOf(req).id, action: "RECRUITER_CANDIDATE_PROFILE_VIEWED", entityType: "Candidate", entityId: candidate.id, ipAddress: req.ip } });
  });
  const { resumeUrl, profilePhotoKey, ...safeCandidate } = candidate;
  res.json({ candidate: { ...safeCandidate, hasResume: Boolean(resumeUrl), hasPhoto: Boolean(profilePhotoKey) } });
});

recruitersRouter.get("/candidates/:candidateId/resume", async (req, res) => {
  const employer = await prisma.employer.findUnique({ where: { userId: userOf(req).id }, select: { id: true } });
  if (!employer) return res.status(404).json({ error: "Recruiter profile not found" });
  const candidate = await prisma.candidate.findFirst({ where: { id: String(req.params.candidateId), user: { is: { isActive: true, deletedAt: null } }, OR: [{ searchable: true }, { applications: { some: { job: { employerId: employer.id } } } }] }, select: { id: true, resumeUrl: true } });
  if (!candidate?.resumeUrl) return res.status(404).json({ error: "Candidate resume is unavailable" });
  try { await consumePlanUsage(userOf(req).id, "candidate.resume_downloads", 1, req.get("x-idempotency-key")); }
  catch (error) { if (error instanceof PlanAccessError) return res.status(error.status).json({ error: error.message, ...error.details }); throw error; }
  try {
    const file = await getResumeStorage().read(candidate.resumeUrl);
    res.setHeader("Content-Type", file.contentType); res.setHeader("Content-Length", file.bytes.length); res.setHeader("Content-Disposition", `attachment; filename="${file.fileName.replace(/[\\\r\n\"]/g, "_")}"`); res.setHeader("Cache-Control", "private, no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); res.send(file.bytes);
  } catch { res.status(404).json({ error: "Candidate resume is unavailable" }); }
});

recruitersRouter.get("/candidates/:candidateId/photo", async (req, res) => {
  const employer = await prisma.employer.findUnique({ where: { userId: userOf(req).id }, select: { id: true } });
  const candidate = employer && await prisma.candidate.findFirst({ where: { id: String(req.params.candidateId), searchable: true, user: { is: { isActive: true, deletedAt: null } } }, select: { profilePhotoKey: true } });
  if (!candidate?.profilePhotoKey) return res.status(404).json({ error: "Candidate photo is unavailable" });
  try { const file = await getResumeStorage().read(candidate.profilePhotoKey); if (!file.contentType.startsWith("image/")) return res.status(415).json({ error: "Stored photo has an unsupported format" }); res.setHeader("Content-Type", file.contentType); res.setHeader("Content-Length", file.bytes.length); res.setHeader("Content-Disposition", "inline"); res.setHeader("Cache-Control", "private, no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); res.send(file.bytes); await prisma.auditLog.create({ data: { actorId: userOf(req).id, action: "RECRUITER_CANDIDATE_PHOTO_VIEWED", entityType: "Candidate", entityId: String(req.params.candidateId), ipAddress: req.ip } }); }
  catch { res.status(404).json({ error: "Candidate photo is unavailable" }); }
});

recruitersRouter.get("/candidates/:candidateId/contact", async (req, res) => {
  const employer = await prisma.employer.findUnique({ where: { userId: userOf(req).id }, select: { id: true } });
  const candidate = employer && await prisma.candidate.findFirst({ where: { id: String(req.params.candidateId), searchable: true, user: { is: { isActive: true, deletedAt: null } } }, select: { id: true, user: { select: { email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true } } } });
  if (!candidate) return res.status(404).json({ error: "Candidate has not shared contact details with recruiters" });
  await prisma.auditLog.create({ data: { actorId: userOf(req).id, action: "RECRUITER_CANDIDATE_CONTACT_VIEWED", entityType: "Candidate", entityId: candidate.id, ipAddress: req.ip } });
  res.json({ email: candidate.user.emailVerifiedAt ? candidate.user.email : null, phone: candidate.user.phoneVerifiedAt ? candidate.user.phone : null });
});

recruitersRouter.patch("/candidates/:candidateId/status", async (req, res) => {
  const p = z.object({ status: z.enum(["SHORTLISTED", "REJECTED"]) }).safeParse(req.body); if (!p.success) return res.status(400).json({ error: "Choose shortlist or reject" });
  const employer = await prisma.employer.findUnique({ where: { userId: userOf(req).id }, select: { id: true } });
  const candidate = employer && await prisma.candidate.findFirst({ where: { id: String(req.params.candidateId), user: { is: { isActive: true, deletedAt: null } }, OR: [{ searchable: true }, { applications: { some: { job: { employerId: employer.id } } } }] }, select: { id: true } });
  if (!candidate) return res.status(404).json({ error: "Candidate profile not found or private" });
  const action = await prisma.candidateRecruiterAction.upsert({ where: { candidateId_recruiterId: { candidateId: candidate.id, recruiterId: userOf(req).id } }, create: { candidateId: candidate.id, recruiterId: userOf(req).id, status: p.data.status }, update: { status: p.data.status } });
  await prisma.auditLog.create({ data: { actorId: userOf(req).id, action: `CANDIDATE_${p.data.status}`, entityType: "Candidate", entityId: candidate.id, ipAddress: req.ip } });
  res.json({ action });
});

recruitersRouter.post("/candidates/:candidateId/comments", async (req, res) => {
  const p = z.object({ body: z.string().trim().min(1).max(3000) }).safeParse(req.body); if (!p.success) return res.status(400).json({ error: "Enter a comment (up to 3,000 characters)" });
  const employer = await prisma.employer.findUnique({ where: { userId: userOf(req).id }, select: { id: true } });
  const candidate = employer && await prisma.candidate.findFirst({ where: { id: String(req.params.candidateId), user: { is: { isActive: true, deletedAt: null } }, OR: [{ searchable: true }, { applications: { some: { job: { employerId: employer.id } } } }] }, select: { id: true } });
  if (!candidate) return res.status(404).json({ error: "Candidate profile not found or private" });
  const comment = await prisma.candidateRecruiterComment.create({ data: { candidateId: candidate.id, recruiterId: userOf(req).id, body: p.data.body } });
  await prisma.auditLog.create({ data: { actorId: userOf(req).id, action: "RECRUITER_CANDIDATE_COMMENT_ADDED", entityType: "Candidate", entityId: candidate.id, ipAddress: req.ip } });
  res.status(201).json({ comment });
});

recruitersRouter.post("/candidates/bulk-email", async (req, res) => {
  const p = z.object({ candidateIds: z.array(z.string().min(1)).min(1).max(50), subject: z.string().trim().min(2).max(150), body: z.string().trim().min(1).max(10000) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message || "Select candidates and enter an email" });
  const recruiterId = userOf(req).id; const recruiter = await prisma.user.findUnique({ where: { id: recruiterId }, select: { email: true } });
  const candidates = await prisma.candidate.findMany({ where: { id: { in: [...new Set(p.data.candidateIds)] }, searchable: true, user: { is: { isActive: true, deletedAt: null, emailVerifiedAt: { not: null } } } }, select: { id: true, user: { select: { email: true } } } });
  if (candidates.length !== new Set(p.data.candidateIds).size) return res.status(403).json({ error: "Some selected candidates have not consented to recruiter contact or do not have verified email" });
  try { await getEmailProvider().send({ to: recruiter!.email, bcc: candidates.map(x => x.user.email), subject: p.data.subject, text: p.data.body }); }
  catch { return res.status(503).json({ error: "Email integration is unavailable. Configure the actual email provider before sending." }); }
  await prisma.auditLog.create({ data: { actorId: recruiterId, action: "RECRUITER_CANDIDATE_BULK_EMAIL_SENT", entityType: "Candidate", metadata: { candidateIds: candidates.map(x => x.id), recipientCount: candidates.length }, ipAddress: req.ip } });
  res.json({ sent: candidates.length });
});

recruitersRouter.post("/candidates/bulk-resumes", async (req, res) => {
  const p = z.object({ candidateIds: z.array(z.string().min(1)).min(1).max(50) }).safeParse(req.body); if (!p.success) return res.status(400).json({ error: "Select up to 50 candidates" });
  const employer = await prisma.employer.findUnique({ where: { userId: userOf(req).id }, select: { id: true } }); if (!employer) return res.status(404).json({ error: "Recruiter profile not found" });
  const ids = [...new Set(p.data.candidateIds)];
  const candidates = await prisma.candidate.findMany({ where: { id: { in: ids }, user: { is: { isActive: true, deletedAt: null } }, OR: [{ searchable: true }, { applications: { some: { job: { employerId: employer.id } } } }] }, select: { id: true, resumeUrl: true, user: { select: { fullName: true } } } });
  if (candidates.length !== ids.length) return res.status(403).json({ error: "One or more candidates are private or unavailable to this company" });
  const downloadable = candidates.filter(c => c.resumeUrl); if (!downloadable.length) return res.status(404).json({ error: "No selected candidates have an uploaded resume" });
  try { for (const candidate of downloadable) await consumePlanUsage(userOf(req).id, "candidate.resume_downloads", 1, `${req.get("x-idempotency-key") || "bulk"}:${candidate.id}`); }
  catch (error) { if (error instanceof PlanAccessError) return res.status(error.status).json({ error: error.message, ...error.details }); throw error; }
  try {
    const files = await Promise.all(downloadable.map(async candidate => ({ candidate, file: await getResumeStorage().read(candidate.resumeUrl!) })));
    const totalBytes = files.reduce((sum, item) => sum + item.file.bytes.length, 0); if (totalBytes > 100 * 1024 * 1024) return res.status(413).json({ error: "Selected resume bundle exceeds the 100 MB limit" });
    const zip = createZip(files.map(({ candidate, file }) => ({ name: `${candidate.user.fullName}_${candidate.id}_${file.fileName}`, bytes: file.bytes })));
    res.setHeader("Content-Type", "application/zip"); res.setHeader("Content-Length", zip.length); res.setHeader("Content-Disposition", "attachment; filename=jobinfo-candidate-resumes.zip"); res.setHeader("Cache-Control", "private, no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); res.send(zip);
    await prisma.auditLog.create({ data: { actorId: userOf(req).id, action: "RECRUITER_CANDIDATE_RESUME_BULK_DOWNLOADED", entityType: "Candidate", metadata: { candidateIds: downloadable.map(x => x.id), count: downloadable.length }, ipAddress: req.ip } });
  } catch { if (!res.headersSent) res.status(404).json({ error: "A selected resume file could not be read" }); }
});
