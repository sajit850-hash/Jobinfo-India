import { Router } from "express";
import { z } from "zod";
import { prisma, Prisma } from "@jobinfo/database";
import { requireAuth, userOf } from "../auth";
import { callCustomAi } from "../integrations/custom-ai";
import { parseBooleanSearch, searchWhere } from "./recruiters";
import { consumePlanUsage, PlanAccessError } from "../billing/entitlements";

export const atsRouter = Router();
atsRouter.use(requireAuth("RECRUITER"));
const criteriaSchema = z.object({ requiredSkills: z.array(z.string()).default([]), preferredSkills: z.array(z.string()).default([]), minExperience: z.number().nullable().optional(), maxExperience: z.number().nullable().optional(), educationKeywords: z.array(z.string()).default([]), summary: z.string().optional() });
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
