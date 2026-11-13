import { Router } from "express";
import { z } from "zod";
import { prisma, Prisma } from "@jobinfo/database";
import { requireAuth, userOf } from "../auth";
import { callCustomAi } from "../integrations/custom-ai";
import { parseBooleanSearch, searchWhere } from "./recruiters";
import { consumePlanUsage, PlanAccessError } from "../billing/entitlements";
import { extractJobDescription } from "../ats/documents";
import { getResumeStorage } from "../integrations/registry";

export const atsRouter = Router();
atsRouter.use(requireAuth("RECRUITER"));
const criteriaSchema = z.object({ requiredSkills: z.array(z.string()).default([]), preferredSkills: z.array(z.string()).default([]), minExperience: z.number().nullable().optional(), maxExperience: z.number().nullable().optional(), educationKeywords: z.array(z.string()).default([]), summary: z.string().optional() });
const recommendationCriteriaSchema = z.object({ title: z.string().max(180).default(""), requiredSkills: z.array(z.string().trim().min(1).max(100)).max(80).default([]), preferredSkills: z.array(z.string().trim().min(1).max(100)).max(80).default([]), minExperience: z.number().min(0).max(60).nullable().optional(), maxExperience: z.number().min(0).max(60).nullable().optional(), educationKeywords: z.array(z.string().trim().min(1).max(120)).max(30).default([]), location: z.string().max(180).default(""), workMode: z.string().max(50).default(""), minimumSalary: z.number().min(0).max(2_000_000_000).nullable().optional(), maximumSalary: z.number().min(0).max(2_000_000_000).nullable().optional(), summary: z.string().max(1000).default("") }).refine(x => x.minimumSalary == null || x.maximumSalary == null || x.maximumSalary >= x.minimumSalary, { message: "AI extracted an invalid salary range" });
function baselineCriteria(text: string) {
  const dictionary = ["javascript", "typescript", "react", "node.js", "python", "java", "sql", "postgresql", "mongodb", "aws", "azure", "docker", "kubernetes", "product management", "sales", "marketing", "excel", "communication", "leadership", "customer service", "data analysis", "machine learning", "figma", "accounting", "recruitment"];
  return { requiredSkills: dictionary.filter((skill) => text.toLowerCase().includes(skill)), preferredSkills: [] as string[], educationKeywords: ["bachelor", "master", "degree", "diploma", "b.tech", "mba"].filter((term) => text.toLowerCase().includes(term)), summary: "Extracted using local keyword baseline" };
}
async function extractCriteria(text: string) {
  const ai = await callCustomAi<z.infer<typeof criteriaSchema>>("Read the job description. Return JSON with requiredSkills (array), preferredSkills (array), minExperience (number or null), maxExperience (number or null), educationKeywords (array), summary (short string). Use only explicit requirements.", text);
  return ai ? { criteria: criteriaSchema.parse(ai), method: "custom-ai" } : { criteria: criteriaSchema.parse(baselineCriteria(text)), method: "keyword-baseline" };
}

atsRouter.get("/jobs", async (req, res) => {
  const employer = await prisma.employer.findUnique({ where: { userId: userOf(req).id }, select: { id: true } });
  if (!employer) return res.status(404).json({ error: "Recruiter profile not found" });
  const data = await prisma.job.findMany({ where: { employerId: employer.id }, select: { id: true, title: true, description: true, location: true, status: true, experienceMin: true, experienceMax: true, skills: { select: { name: true } }, requirements: { select: { name: true } }, _count: { select: { applications: true } } }, orderBy: { updatedAt: "desc" } });
  res.json({ data });
});
atsRouter.post("/parse-jd", async (req, res) => {
  const p = z.object({ text: z.string().trim().min(30).max(50_000) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Provide at least 30 characters of job description text" });
  try { const result = await extractCriteria(p.data.text); res.json(result); }
  catch { res.status(502).json({ error: "The configured AI provider could not process this description" }); }
});

atsRouter.post("/candidate-recommendations", async (req, res) => {
  const p = z.object({ jdText: z.string().max(50_000).optional(), fileName: z.string().max(180).optional(), fileBase64: z.string().max(7_000_000).optional(), booleanQuery: z.string().max(200).optional() }).refine(x => Boolean(x.jdText?.trim()) || Boolean(x.fileName && x.fileBase64), { message: "Enter JD text or upload a PDF, DOC or DOCX file" }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message || "Enter a job description" });
  let jdText = p.data.jdText?.trim() || ""; let uploadedBytes: Buffer | null = null; let uploadedContentType: string | null = null;
  if (p.data.fileName && p.data.fileBase64) {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(p.data.fileBase64)) return res.status(400).json({ error: "Invalid uploaded file encoding" });
    const bytes = Buffer.from(p.data.fileBase64, "base64"); if (!bytes.length || bytes.length > 5 * 1024 * 1024) return res.status(413).json({ error: "Upload a JD document up to 5 MB" });
    try { jdText = await extractJobDescription(bytes, p.data.fileName); uploadedBytes = bytes; uploadedContentType = p.data.fileName.toLowerCase().endsWith(".pdf") ? "application/pdf" : p.data.fileName.toLowerCase().endsWith(".docx") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/msword"; }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Could not read this document" }); }
  }
  if (jdText.length < 30) return res.status(400).json({ error: "Provide at least 30 characters of job description" });
  let criteria: z.infer<typeof recommendationCriteriaSchema>;
  try {
    const extracted = await callCustomAi<unknown>("Analyze this job description for candidate recommendation. Return JSON with title, requiredSkills array, preferredSkills array, minExperience and maxExperience (years or null), educationKeywords array, location, workMode, minimumSalary and maximumSalary (annual INR numbers or null), and summary. Use only requirements explicitly present. Do not infer protected characteristics such as age, gender, religion, caste, disability, or marital status.", jdText);
    if (!extracted) return res.status(503).json({ error: "AI recommendations require an enabled custom AI integration. Configure it in Admin → Integrations." });
    criteria = recommendationCriteriaSchema.parse(extracted);
  } catch (error) { return res.status(502).json({ error: error instanceof Error ? `AI job analysis failed: ${error.message}` : "AI job analysis failed" }); }
  try { await consumePlanUsage(userOf(req).id, "ats.matches", 1, req.get("x-idempotency-key")); }
  catch (error) { if (error instanceof PlanAccessError) return res.status(error.status).json({ error: error.message, ...error.details }); throw error; }
  const clauses: Prisma.CandidateWhereInput[] = [{ searchable: true, user: { is: { isActive: true, deletedAt: null } } }];
  if (p.data.booleanQuery?.trim()) { try { clauses.push(searchWhere(parseBooleanSearch(p.data.booleanQuery))); } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid Boolean query" }); } }
  const candidates = await prisma.candidate.findMany({ where: { AND: clauses }, include: { user: { select: { fullName: true, lastActiveAt: true, emailVerifiedAt: true, phoneVerifiedAt: true } }, skills: true, education: true }, take: 1000 });
  const reqSkills = criteria.requiredSkills.map(x => x.toLowerCase()); const prefSkills = criteria.preferredSkills.map(x => x.toLowerCase());
  const ranked = candidates.map(candidate => {
    const skills = candidate.skills.map(x => x.name); const normalized = skills.map(x => x.toLowerCase());
    const matchedRequiredSkills = reqSkills.filter(x => normalized.some(s => s.includes(x) || x.includes(s))); const matchedPreferredSkills = prefSkills.filter(x => normalized.some(s => s.includes(x) || x.includes(s)));
    const missingSkills = [...reqSkills.filter(x => !matchedRequiredSkills.includes(x)), ...prefSkills.filter(x => !matchedPreferredSkills.includes(x))];
    const skillScore = reqSkills.length + prefSkills.length ? Math.round(100 * (matchedRequiredSkills.length + .5 * matchedPreferredSkills.length) / Math.max(1, reqSkills.length + .5 * prefSkills.length)) : 50;
    const exp = candidate.experienceYears; const expScore = exp == null || criteria.minExperience == null && criteria.maxExperience == null ? (exp == null ? 50 : 100) : criteria.minExperience != null && exp < criteria.minExperience ? Math.max(0, Math.round(100 * exp / Math.max(1, criteria.minExperience))) : criteria.maxExperience != null && exp > criteria.maxExperience + 3 ? 65 : 100;
    const edu = candidate.education.map(x => `${x.degree} ${x.field || ""} ${x.department || ""}`).join(" ").toLowerCase(); const eduScore = criteria.educationKeywords.length ? Math.round(100 * criteria.educationKeywords.filter(x => edu.includes(x.toLowerCase())).length / criteria.educationKeywords.length) : 100;
    const location = `${candidate.city || ""} ${candidate.state || ""} ${candidate.preferredJobLocations.join(" ")}`.toLowerCase(); const locationScore = criteria.location ? (location.includes(criteria.location.toLowerCase()) ? 100 : 35) : 100;
    const modeScore = criteria.workMode ? (candidate.workMode?.toLowerCase().includes(criteria.workMode.toLowerCase()) ? 100 : 50) : 100;
    const salaryScore = criteria.maximumSalary != null && candidate.expectedSalary != null && candidate.expectedSalary > criteria.maximumSalary ? 40 : 100;
    const matchScore = Math.round(skillScore * .5 + expScore * .2 + eduScore * .15 + locationScore * .07 + modeScore * .04 + salaryScore * .04);
    return { id: candidate.id, candidateId: candidate.id, name: candidate.user.fullName, user: { fullName: candidate.user.fullName, lastActiveAt: candidate.user.lastActiveAt?.toISOString() || null }, headline: candidate.headline, summary: candidate.summary, city: candidate.city, state: candidate.state, experienceYears: exp, currentDesignation: candidate.currentDesignation, currentCompany: candidate.currentCompany, currentSalary: candidate.currentSalary, expectedSalary: candidate.expectedSalary, noticePeriod: candidate.noticePeriod, preferredJobLocations: candidate.preferredJobLocations, workMode: candidate.workMode, employmentType: candidate.employmentType, updatedAt: candidate.updatedAt.toISOString(), hasResume: Boolean(candidate.resumeUrl), hasPhoto: Boolean(candidate.profilePhotoKey), verified: candidate.profileComplete && Boolean(candidate.user.emailVerifiedAt && candidate.user.phoneVerifiedAt), matchedRequiredSkills, matchedPreferredSkills, missingSkills, skills: skills.map(name => ({ name })), matchScore, scoreDetails: { skillScore, expScore, eduScore, locationScore, modeScore, salaryScore }, recommendation: matchScore >= 75 ? "Strong match" : matchScore >= 55 ? "Review profile" : "Lower match" };
  }).sort((a, b) => b.matchScore - a.matchScore);
  let jdFileKey: string | null = null;
  if (uploadedBytes && uploadedContentType && p.data.fileName) {
    try { jdFileKey = (await getResumeStorage().save({ ownerId: userOf(req).id, fileName: p.data.fileName, contentType: uploadedContentType, bytes: uploadedBytes })).key; }
    catch { return res.status(503).json({ error: "Private file storage is unavailable. The uploaded JD was not retained." }); }
  }
  const recommendation = await prisma.candidateSearchRecommendation.create({ data: { recruiterId: userOf(req).id, jdText, fileName: p.data.fileName || null, jdFileKey, criteria: criteria as Prisma.InputJsonValue, results: ranked as unknown as Prisma.InputJsonValue, aiProvider: "custom-ai" } });
  await prisma.auditLog.create({ data: { actorId: userOf(req).id, action: "ATS_CANDIDATE_RECOMMENDATIONS_CREATED", entityType: "CandidateSearchRecommendation", entityId: recommendation.id, metadata: { resultCount: ranked.length, jdTitle: criteria.title }, ipAddress: req.ip } });
  res.json({ id: recommendation.id, method: "custom-ai", disclaimer: "AI-assisted ranking is decision support only. Review candidates consistently and verify information directly.", criteria, data: ranked });
});

atsRouter.get("/candidate-recommendations", async (req, res) => {
  const data = await prisma.candidateSearchRecommendation.findMany({ where: { recruiterId: userOf(req).id }, select: { id: true, fileName: true, criteria: true, aiProvider: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 30 });
  res.json({ data });
});
atsRouter.get("/candidate-recommendations/:id", async (req, res) => {
  const recommendation = await prisma.candidateSearchRecommendation.findFirst({ where: { id: String(req.params.id), recruiterId: userOf(req).id } });
  if (!recommendation) return res.status(404).json({ error: "Recommendation was not found" });
  res.json({ id: recommendation.id, fileName: recommendation.fileName, criteria: recommendation.criteria, results: recommendation.results, aiProvider: recommendation.aiProvider, createdAt: recommendation.createdAt });
});
atsRouter.get("/candidate-recommendations/:id/jd", async (req, res) => {
  const item = await prisma.candidateSearchRecommendation.findFirst({ where: { id: String(req.params.id), recruiterId: userOf(req).id }, select: { jdFileKey: true, fileName: true } });
  if (!item?.jdFileKey) return res.status(404).json({ error: "Uploaded JD document is unavailable" });
  try { const file = await getResumeStorage().read(item.jdFileKey); res.setHeader("Content-Type", file.contentType); res.setHeader("Content-Length", file.bytes.length); res.setHeader("Content-Disposition", `attachment; filename="${(item.fileName || file.fileName).replace(/[\\\r\n\"]/g, "_")}"`); res.setHeader("Cache-Control", "private, no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); res.send(file.bytes); }
  catch { res.status(404).json({ error: "Uploaded JD document is unavailable" }); }
});
atsRouter.post("/parse-resume", async (req, res) => {
  const p = z.object({ text: z.string().trim().min(40).max(30_000) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Paste resume text (40 to 30,000 characters)" });
  try {
    const parsed = await callCustomAi<{ name?: string; headline?: string; skills: string[]; experienceYears?: number | null; education: string[]; summary?: string }>("Parse resume text. Return JSON: name, headline, skills array, experienceYears number or null, education array of concise qualifications, summary. Do not infer missing facts.", p.data.text);
    if (parsed) return res.json({ method: "custom-ai", data: parsed });
    const skills = [...new Set((p.data.text.match(/\b(?:JavaScript|TypeScript|React|Node\.js|Python|Java|SQL|AWS|Azure|Docker|Kubernetes|Excel|Figma|Salesforce|Communication|Recruitment|Accounting)\b/gi) || []).map((x) => x.trim()))];
    const years = p.data.text.match(/(\d{1,2})\+?\s+years?/i);
    res.json({ method: "keyword-baseline", data: { skills, experienceYears: years ? Number(years[1]) : null, education: [], summary: "Text scanned with local keyword baseline. Configure a custom AI provider for full resume parsing." } });
  } catch { res.status(502).json({ error: "The configured AI provider could not parse this resume" }); }
});
atsRouter.post("/match/:jobId", async (req, res) => {
  const employer = await prisma.employer.findUnique({ where: { userId: userOf(req).id }, select: { id: true } });
  const job = await prisma.job.findFirst({ where: { id: String(req.params.jobId), employerId: employer?.id }, include: { skills: true, requirements: true } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  const p = z.object({ jdText: z.string().max(50_000).optional(), booleanQuery: z.string().max(200).optional() }).safeParse(req.body || {});
  if (!p.success) return res.status(400).json({ error: "Invalid ATS search options" });
  let criteria: z.infer<typeof criteriaSchema>; let method = "keyword-baseline";
  try { const extracted = await extractCriteria(p.data.jdText || `${job.title}\n${job.description}\n${job.requirements.map((x) => x.name).join("\n")}`); criteria = extracted.criteria; method = extracted.method; }
  catch { return res.status(502).json({ error: "The configured AI provider could not process this job" }); }
  try { await consumePlanUsage(userOf(req).id, "ats.matches", 1, req.get("x-idempotency-key")); }
  catch (error) { if (error instanceof PlanAccessError) return res.status(error.status).json({ error: error.message, ...error.details }); throw error; }
  const skillNeeds = [...new Set([...job.skills.map((s) => s.name), ...criteria.requiredSkills, ...criteria.preferredSkills])];
  const whereClauses: Prisma.CandidateWhereInput[] = [{ OR: [{ searchable: true }, { applications: { some: { jobId: job.id } } }] }];
  if (p.data.booleanQuery?.trim()) { try { whereClauses.push(searchWhere(parseBooleanSearch(p.data.booleanQuery))); } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid Boolean query" }); } }
  const candidates = await prisma.candidate.findMany({ where: { AND: whereClauses }, include: { user: { select: { fullName: true } }, skills: true, education: true, applications: { where: { jobId: job.id }, select: { id: true, status: true } } }, take: 500 });
  const data = candidates.map((c) => {
    const skills = c.skills.map((x) => x.name); const matchedSkills = skillNeeds.filter((need) => skills.some((s) => s.toLowerCase().includes(need.toLowerCase()) || need.toLowerCase().includes(s.toLowerCase())));
    const skillScore = skillNeeds.length ? Math.round(100 * matchedSkills.length / skillNeeds.length) : 0;
    const minExp = criteria.minExperience ?? job.experienceMin; const maxExp = criteria.maxExperience ?? job.experienceMax; const exp = c.experienceYears;
    const experienceScore = exp == null || (minExp == null && maxExp == null) ? (exp === null ? 50 : 100) : (minExp != null && exp < minExp ? Math.max(0, Math.round(100 * exp / Math.max(minExp, 1))) : maxExp != null && exp > maxExp + 3 ? 70 : 100);
    const eduTerms = criteria.educationKeywords; const eduText = c.education.map((x) => `${x.degree} ${x.field || ""} ${x.department || ""}`).join(" ").toLowerCase(); const educationScore = !eduTerms.length ? 100 : Math.min(100, Math.round(100 * eduTerms.filter((term) => eduText.includes(term.toLowerCase())).length / eduTerms.length));
    const matchScore = Math.round(skillScore * .55 + experienceScore * .25 + educationScore * .20);
    const reasons = [`Skills ${skillScore}%`, `Experience ${experienceScore}%${exp == null ? " (not provided)" : ` (${exp} years)`}`, `Education ${educationScore}%`];
    return { candidateId: c.id, name: c.user.fullName, skills, matchedSkills, skillScore, experienceYears: exp, experienceScore, education: c.education.map((x) => `${x.degree}${x.field ? `, ${x.field}` : ""}`), educationScore, matchScore, reasons, applicationId: c.applications[0]?.id || null, applicationStatus: c.applications[0]?.status || null, alreadyApplied: c.applications.length > 0, recommendation: matchScore >= 75 ? "Strong profile match" : matchScore >= 50 ? "Review profile" : "Lower profile match" };
  }).sort((a, b) => b.matchScore - a.matchScore);
  res.json({ method, disclaimer: "Scores summarize profile data against job criteria and are decision support only. Review candidates consistently; scores do not predict job performance.", criteria, data });
});
