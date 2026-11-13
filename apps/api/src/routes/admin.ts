import { Router } from "express";
import { z } from "zod";
import { prisma, Prisma } from "@jobinfo/database";
import { requireAuth, userOf } from "../auth";
import crypto from "node:crypto";
import { integrationStatus } from "../integrations/registry";
import { callCustomAi, customAiStatus, encryptApiKey } from "../integrations/custom-ai";
import { getPaymentProvider } from "../integrations/registry";
import { getJobPostingPolicy, JOB_POSTING_POLICY_KEY, jobPostingPolicySchema } from "../platform/job-posting-policy";
import { notifyUser } from "../notifications/service";
import { sanitizeJobDescriptionHtml } from "../security/job-description";

export const adminRouter = Router();
export const cmsRouter = Router();
cmsRouter.get("/:slug", async (req, res) => {
  const page = await prisma.cmsPage.findFirst({ where: { slug: String(req.params.slug), published: true }, select: { slug: true, title: true, body: true, metaTitle: true, metaDescription: true, updatedAt: true } });
  if (!page) return res.status(404).json({ error: "Page not found" });
  res.json({ page });
});
adminRouter.use(requireAuth("ADMIN"));
const audit = (req: any, action: string, entityType: string, entityId?: string, metadata?: any) => prisma.auditLog.create({ data: { actorId: userOf(req).id, action, entityType, entityId, metadata } });
const permission = (name: string) => async (req: any, res: any, next: any) => {
  const adminProfile = await prisma.adminProfile.findUnique({ where: { userId: userOf(req).id }, select: { permissions: true } });
  if (adminProfile && !adminProfile.permissions.includes(name)) return res.status(403).json({ error: `Your admin access profile does not allow ${name}` });
  const rule = await prisma.rolePermission.findUnique({ where: { role_permission: { role: "ADMIN", permission: name } } });
  if (rule && !rule.enabled) return res.status(403).json({ error: `Admin access is disabled for ${name}` });
  next();
};
adminRouter.use("/demo-data", (_req, res) => res.status(404).json({ error: "Not found" }));
adminRouter.get("/demo-data/batches", permission("MANAGE_DEMO_DATA"), async (_req, res) => {
  const batches = await prisma.demoSeedBatch.findMany({ orderBy: { createdAt: "desc" } });
  const counts = await prisma.demoDataRecord.groupBy({ by: ["batchId"], where: { deletedAt: null }, _count: { _all: true } });
  const countByBatch = new Map(counts.map(row => [row.batchId, row._count._all]));
  res.json({ batches: batches.map(batch => ({ ...batch, _count: { records: countByBatch.get(batch.id) || 0 } })) });
});
adminRouter.get("/demo-data/batches/:id/records", permission("MANAGE_DEMO_DATA"), async (req, res) => {
  const batchId = String(req.params.id);
  const records = await prisma.demoDataRecord.findMany({ where: { batchId, deletedAt: null }, orderBy: [{ recordType: "asc" }, { createdAt: "asc" }], select: { id: true, recordType: true, recordId: true, userId: true, createdAt: true } });
  res.json({ records });
});
adminRouter.get("/demo-data/batches/:id/users", permission("MANAGE_DEMO_DATA"), async (req, res) => {
  const batchId = String(req.params.id);
  const role = z.enum(["CANDIDATE", "RECRUITER", "INSTITUTION", "ADMIN"]).safeParse(req.query.role);
  const q = String(req.query.q || "").trim().slice(0, 100);
  const records = await prisma.demoDataRecord.findMany({ where: { batchId, recordType: "User", deletedAt: null }, select: { recordId: true } });
  const users = await prisma.user.findMany({ where: { id: { in: records.map(row => row.recordId) }, ...(role.success ? { role: role.data as any } : {}), ...(q ? { OR: [{ id: { contains: q, mode: "insensitive" } }, { fullName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}) }, select: { id: true, fullName: true, email: true, role: true, isActive: true, createdAt: true, employer: { select: { name: true, company: { select: { name: true } } } }, institution: { select: { name: true } } }, orderBy: [{ role: "asc" }, { fullName: "asc" }] });
  res.json({ users, total: users.length });
});
adminRouter.delete("/demo-data/users/:userId", permission("MANAGE_DEMO_DATA"), async (req, res) => {
  const userId = String(req.params.userId);
  const confirm = z.object({ confirmUserId: z.string().min(1) }).safeParse(req.body);
  if (!confirm.success || confirm.data.confirmUserId !== userId) return res.status(400).json({ error: "Type the demo user ID to confirm deletion" });
  if (userId === userOf(req).id) return res.status(409).json({ error: "You cannot delete your currently signed-in administrator account." });
  const ownership = await prisma.demoDataRecord.findFirst({ where: { recordType: "User", recordId: userId, deletedAt: null }, include: { batch: true } });
  if (!ownership || ownership.batch.status !== "ACTIVE") return res.status(404).json({ error: "Active demo user not found" });
  const batchId = ownership.batchId;
  const target = await prisma.user.findUnique({ where: { id: userId }, include: { candidate: true, employer: true, institution: true } });
  if (!target) return res.status(404).json({ error: "Demo user not found" });
  const [batchUsers, batchCandidates, batchJobs, billingRecords, institutionStudents, institutionDepartments, institutionCourses, institutionPlacements, ownedCandidateTracked, ownedEmployerTracked, ownedInstitutionTracked] = await Promise.all([
    prisma.demoDataRecord.findMany({ where: { batchId, recordType: "User", deletedAt: null }, select: { recordId: true } }),
    prisma.demoDataRecord.findMany({ where: { batchId, recordType: "Candidate", deletedAt: null }, select: { recordId: true } }),
    prisma.demoDataRecord.findMany({ where: { batchId, recordType: "Job", deletedAt: null }, select: { recordId: true } }),
    prisma.demoDataRecord.findMany({ where: { batchId, userId, deletedAt: null, recordType: { in: ["Subscription", "PaymentTransaction", "TaxInvoice"] } }, select: { recordType: true, recordId: true } }),
    prisma.demoDataRecord.findMany({ where: { batchId, recordType: "InstitutionStudent", deletedAt: null }, select: { recordId: true } }),
    prisma.demoDataRecord.findMany({ where: { batchId, recordType: "Department", deletedAt: null }, select: { recordId: true } }),
    prisma.demoDataRecord.findMany({ where: { batchId, recordType: "InstitutionCourse", deletedAt: null }, select: { recordId: true } }),
    prisma.demoDataRecord.findMany({ where: { batchId, recordType: "InstitutionPlacement", deletedAt: null }, select: { recordId: true } }),
    target.candidate ? prisma.demoDataRecord.findFirst({ where: { batchId, recordType: "Candidate", recordId: target.candidate.id, deletedAt: null }, select: { id: true } }) : null,
    target.employer ? prisma.demoDataRecord.findFirst({ where: { batchId, recordType: "Employer", recordId: target.employer.id, deletedAt: null }, select: { id: true } }) : null,
    target.institution ? prisma.demoDataRecord.findFirst({ where: { batchId, recordType: "Institution", recordId: target.institution.id, deletedAt: null }, select: { id: true } }) : null,
  ]);
  const allUserIds = batchUsers.map(row => row.recordId), candidateIds = batchCandidates.map(row => row.recordId), jobIds = batchJobs.map(row => row.recordId);
  const ownedCandidateIds = target.candidate ? [target.candidate.id] : [];
  const ownedJobIds = target.employer ? (await prisma.job.findMany({ where: { employerId: target.employer.id }, select: { id: true } })).map(row => row.id) : [];
  const untrackedOwnedJob = ownedJobIds.some(id => !jobIds.includes(id));
  const institutionId = target.institution?.id;
  const [externalApplication, externalSavedJob, externalTeamMember, externalDraft, externalProfileView, untrackedInstitutionRows, untrackedBilling] = await Promise.all([
    prisma.application.findFirst({ where: { OR: [ { candidateId: { in: ownedCandidateIds }, jobId: { notIn: jobIds } }, { jobId: { in: ownedJobIds }, candidateId: { notIn: candidateIds } } ] }, select: { id: true } }),
    prisma.savedJob.findFirst({ where: { OR: [ { candidateId: { in: ownedCandidateIds }, jobId: { notIn: jobIds } }, { jobId: { in: ownedJobIds }, candidateId: { notIn: candidateIds } } ] }, select: { jobId: true } }),
    prisma.jobTeamMember.findFirst({ where: { OR: [ { jobId: { in: ownedJobIds }, userId: { notIn: allUserIds } }, { userId, jobId: { notIn: jobIds } } ] }, select: { id: true } }),
    prisma.recruiterJobDraft.findFirst({ where: { OR: [ { jobId: { in: ownedJobIds }, ownerId: { notIn: allUserIds } }, { ownerId: userId, jobId: { notIn: jobIds } } ] }, select: { id: true } }),
    prisma.candidateProfileView.findFirst({ where: { OR: [ { candidateId: { in: ownedCandidateIds }, recruiterId: { notIn: allUserIds } }, { recruiterId: userId, candidateId: { notIn: candidateIds } } ] }, select: { id: true } }),
    institutionId ? Promise.all([
      prisma.institutionStudent.findFirst({ where: { institutionId, id: { notIn: institutionStudents.map(row => row.recordId) } }, select: { id: true } }),
      prisma.department.findFirst({ where: { institutionId, id: { notIn: institutionDepartments.map(row => row.recordId) } }, select: { id: true } }),
      prisma.institutionCourse.findFirst({ where: { institutionId, id: { notIn: institutionCourses.map(row => row.recordId) } }, select: { id: true } }),
      prisma.institutionPlacement.findFirst({ where: { student: { institutionId }, id: { notIn: institutionPlacements.map(row => row.recordId) } }, select: { id: true } }),
    ]).then(rows => rows.some(Boolean)) : false,
    Promise.all([
      prisma.subscription.findFirst({ where: { userId, id: { notIn: billingRecords.filter(row => row.recordType === "Subscription").map(row => row.recordId) } }, select: { id: true } }),
      prisma.paymentTransaction.findFirst({ where: { userId, id: { notIn: billingRecords.filter(row => row.recordType === "PaymentTransaction").map(row => row.recordId) } }, select: { id: true } }),
      prisma.taxInvoice.findFirst({ where: { userId, id: { notIn: billingRecords.filter(row => row.recordType === "TaxInvoice").map(row => row.recordId) } }, select: { id: true } }),
      prisma.jobPostingTransaction.findFirst({ where: { userId }, select: { id: true } }),
    ]).then(rows => rows.some(Boolean)),
  ]);
  if ((target.candidate && !ownedCandidateTracked) || (target.employer && !ownedEmployerTracked) || (target.institution && !ownedInstitutionTracked) || untrackedOwnedJob || externalApplication || externalSavedJob || externalTeamMember || externalDraft || externalProfileView || untrackedInstitutionRows || untrackedBilling) return res.status(409).json({ error: "This account has links to non-demo activity or untracked records. Remove those links before deletion." });
  const appIds = (await prisma.application.findMany({ where: { OR: [ { candidateId: { in: ownedCandidateIds } }, { jobId: { in: ownedJobIds } } ] }, select: { id: true } })).map(row => row.id);
  const statusIds = (await prisma.applicationStatusHistory.findMany({ where: { applicationId: { in: appIds } }, select: { id: true } })).map(row => row.id);
  const interviewIds = (await prisma.interview.findMany({ where: { OR: [ { applicationId: { in: appIds } }, { recruiterId: userId } ] }, select: { id: true } })).map(row => row.id);
  const savedRows = await prisma.savedJob.findMany({ where: { OR: [ { candidateId: { in: ownedCandidateIds } }, { jobId: { in: ownedJobIds } } ] }, select: { candidateId: true, jobId: true } });
  const viewIds = (await prisma.candidateProfileView.findMany({ where: { OR: [ { candidateId: { in: ownedCandidateIds } }, { recruiterId: userId } ] }, select: { id: true } })).map(row => row.id);
  const subscriptionIds = billingRecords.filter(row => row.recordType === "Subscription").map(row => row.recordId), paymentIds = billingRecords.filter(row => row.recordType === "PaymentTransaction").map(row => row.recordId), invoiceIds = billingRecords.filter(row => row.recordType === "TaxInvoice").map(row => row.recordId);
  const dependentRecords = [
    ...appIds.map(recordId => ({ batchId, recordType: "Application", recordId })), ...statusIds.map(recordId => ({ batchId, recordType: "ApplicationStatusHistory", recordId })),
    ...interviewIds.map(recordId => ({ batchId, recordType: "Interview", recordId })), ...savedRows.map(row => ({ batchId, recordType: "SavedJob", recordId: `${row.candidateId}:${row.jobId}` })),
    ...viewIds.map(recordId => ({ batchId, recordType: "CandidateProfileView", recordId })),
  ];
  await prisma.$transaction(async tx => {
    if (institutionId) await tx.institution.delete({ where: { id: institutionId } });
    await tx.taxInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await tx.paymentTransaction.deleteMany({ where: { id: { in: paymentIds } } });
    await tx.subscription.deleteMany({ where: { id: { in: subscriptionIds } } });
    if (dependentRecords.length) await tx.demoDataRecord.updateMany({ where: { OR: dependentRecords, deletedAt: null }, data: { deletedAt: new Date() } });
    await tx.demoDataRecord.updateMany({ where: { batchId, deletedAt: null, OR: [{ userId }, { recordId: userId }] }, data: { deletedAt: new Date() } });
    await tx.user.delete({ where: { id: userId } });
    const companyId = target.employer?.companyId;
    if (companyId && (await tx.employer.count({ where: { companyId } })) === 0) {
      await tx.company.deleteMany({ where: { AND: [{ id: companyId }, { id: { in: (await tx.demoDataRecord.findMany({ where: { batchId, recordType: "Company", deletedAt: null }, select: { recordId: true } })).map(row => row.recordId) } }] } });
      await tx.demoDataRecord.updateMany({ where: { batchId, recordType: "Company", recordId: companyId, deletedAt: null }, data: { deletedAt: new Date() } });
    }
  });
  await audit(req, "DEMO_USER_DELETED", "User", userId, { batchId, role: target.role });
  res.json({ ok: true, userId, status: "DELETED" });
});
adminRouter.delete("/demo-data/batches/:id", permission("MANAGE_DEMO_DATA"), async (req, res) => {
  const batchId = String(req.params.id);
  const confirmation = z.object({ confirmBatchKey: z.string().min(1) }).safeParse(req.body);
  if (!confirmation.success) return res.status(400).json({ error: "Type the batch key to confirm deletion" });
  const batch = await prisma.demoSeedBatch.findUnique({ where: { id: batchId } });
  if (!batch || batch.batchKey !== confirmation.data.confirmBatchKey) return res.status(404).json({ error: "Batch not found or confirmation did not match" });
  const [userRecords, jobRecords, candidateRecords, institutionRecords, companyRecords, studentRecords, departmentRecords, courseRecords, placementRecords, subscriptionRecords, paymentRecords, invoiceRecords, subscriptionPlanRecords] = await Promise.all([
    prisma.demoDataRecord.findMany({ where: { batchId, recordType: "User", deletedAt: null }, select: { recordId: true } }),
    prisma.demoDataRecord.findMany({ where: { batchId, recordType: "Job", deletedAt: null }, select: { recordId: true } }),
    prisma.demoDataRecord.findMany({ where: { batchId, recordType: "Candidate", deletedAt: null }, select: { recordId: true } }),
    prisma.demoDataRecord.findMany({ where: { batchId, recordType: "Institution", deletedAt: null }, select: { recordId: true } }),
    prisma.demoDataRecord.findMany({ where: { batchId, recordType: "Company", deletedAt: null }, select: { recordId: true } }),
    prisma.demoDataRecord.findMany({ where: { batchId, recordType: "InstitutionStudent", deletedAt: null }, select: { recordId: true } }),
    prisma.demoDataRecord.findMany({ where: { batchId, recordType: "Department", deletedAt: null }, select: { recordId: true } }),
    prisma.demoDataRecord.findMany({ where: { batchId, recordType: "InstitutionCourse", deletedAt: null }, select: { recordId: true } }),
    prisma.demoDataRecord.findMany({ where: { batchId, recordType: "InstitutionPlacement", deletedAt: null }, select: { recordId: true } }),
    prisma.demoDataRecord.findMany({ where: { batchId, recordType: "Subscription", deletedAt: null }, select: { recordId: true } }),
    prisma.demoDataRecord.findMany({ where: { batchId, recordType: "PaymentTransaction", deletedAt: null }, select: { recordId: true } }),
    prisma.demoDataRecord.findMany({ where: { batchId, recordType: "TaxInvoice", deletedAt: null }, select: { recordId: true } }),
    prisma.demoDataRecord.findMany({ where: { batchId, recordType: "SubscriptionPlan", deletedAt: null }, select: { recordId: true } }),
  ]);
  const jobIds = jobRecords.map(x => x.recordId), candidateIds = candidateRecords.map(x => x.recordId), userIds = userRecords.map(x => x.recordId);
  if (userIds.includes(userOf(req).id)) return res.status(409).json({ error: "Sign in as a different administrator before deleting a batch that contains your current account." });
  const institutionIds = institutionRecords.map(x => x.recordId), companyIds = companyRecords.map(x => x.recordId);
  const [externalApplication, externalSavedJob, externalTeamMember, externalDraft, externalCompanyMember, externalProfileView, externalPlanSubscription, untrackedInstitutionData, protectedBillingRecord] = await Promise.all([
    prisma.application.findFirst({ where: { OR: [ { jobId: { in: jobIds }, candidateId: { notIn: candidateIds } }, { candidateId: { in: candidateIds }, jobId: { notIn: jobIds } } ] }, select: { id: true } }),
    prisma.savedJob.findFirst({ where: { OR: [ { jobId: { in: jobIds }, candidateId: { notIn: candidateIds } }, { candidateId: { in: candidateIds }, jobId: { notIn: jobIds } } ] }, select: { jobId: true } }),
    prisma.jobTeamMember.findFirst({ where: { jobId: { in: jobIds }, userId: { notIn: userIds } }, select: { id: true } }),
    prisma.recruiterJobDraft.findFirst({ where: { jobId: { in: jobIds }, ownerId: { notIn: userIds } }, select: { id: true } }),
    prisma.employer.findFirst({ where: { companyId: { in: companyIds }, userId: { notIn: userIds } }, select: { id: true } }),
    prisma.candidateProfileView.findFirst({ where: { OR: [ { candidateId: { in: candidateIds }, recruiterId: { notIn: userIds } }, { recruiterId: { in: userIds }, candidateId: { notIn: candidateIds } } ] }, select: { id: true } }),
    prisma.subscription.findFirst({ where: { planCode: { in: (await prisma.subscriptionPlan.findMany({ where: { id: { in: subscriptionPlanRecords.map(x => x.recordId) } }, select: { code: true } })).map(row => row.code) }, id: { notIn: subscriptionRecords.map(x => x.recordId) } }, select: { id: true } }),
    Promise.all([
      prisma.institutionStudent.findFirst({ where: { institutionId: { in: institutionIds }, id: { notIn: studentRecords.map(x => x.recordId) } }, select: { id: true } }),
      prisma.department.findFirst({ where: { institutionId: { in: institutionIds }, id: { notIn: departmentRecords.map(x => x.recordId) } }, select: { id: true } }),
      prisma.institutionCourse.findFirst({ where: { institutionId: { in: institutionIds }, id: { notIn: courseRecords.map(x => x.recordId) } }, select: { id: true } }),
      prisma.institutionPlacement.findFirst({ where: { student: { institutionId: { in: institutionIds } }, id: { notIn: placementRecords.map(x => x.recordId) } }, select: { id: true } }),
    ]).then(rows => rows.some(Boolean)),
    Promise.all([
      prisma.subscription.findFirst({ where: { userId: { in: userIds }, id: { notIn: subscriptionRecords.map(x => x.recordId) } }, select: { id: true } }),
      prisma.paymentTransaction.findFirst({ where: { userId: { in: userIds }, id: { notIn: paymentRecords.map(x => x.recordId) } }, select: { id: true } }),
      prisma.taxInvoice.findFirst({ where: { userId: { in: userIds }, id: { notIn: invoiceRecords.map(x => x.recordId) } }, select: { id: true } }),
      prisma.jobPostingTransaction.findFirst({ where: { userId: { in: userIds } }, select: { id: true } }),
    ]).then(rows => rows.some(Boolean)),
  ]);
  if (externalApplication || externalSavedJob || externalTeamMember || externalDraft || externalCompanyMember || externalProfileView || externalPlanSubscription || untrackedInstitutionData || protectedBillingRecord) return res.status(409).json({ error: "This batch is linked to non-demo activity, untracked institution data, or protected billing records. Remove those links before deletion." });
  await prisma.$transaction(async tx => {
    await tx.taxInvoice.deleteMany({ where: { id: { in: invoiceRecords.map(x => x.recordId) } } });
    await tx.paymentTransaction.deleteMany({ where: { id: { in: paymentRecords.map(x => x.recordId) } } });
    await tx.subscription.deleteMany({ where: { id: { in: subscriptionRecords.map(x => x.recordId) } } });
    await tx.subscriptionPlan.deleteMany({ where: { id: { in: subscriptionPlanRecords.map(x => x.recordId) } } });
    await tx.institution.deleteMany({ where: { id: { in: institutionIds } } });
    await tx.company.deleteMany({ where: { id: { in: companyRecords.map(x => x.recordId) } } });
    await tx.user.deleteMany({ where: { id: { in: userRecords.map(x => x.recordId) } } });
    await tx.demoDataRecord.updateMany({ where: { batchId, deletedAt: null }, data: { deletedAt: new Date() } });
    await tx.demoSeedBatch.update({ where: { id: batchId }, data: { status: "DELETED" } });
  });
  await audit(req, "DEMO_BATCH_DELETED", "DemoSeedBatch", batchId, { recordCount: (await prisma.demoDataRecord.count({ where: { batchId } })) });
  res.json({ ok: true, batchId, status: "DELETED" });
});
adminRouter.get("/integrations", async (_req,res) => res.json({ integrations: { ...integrationStatus(), ai: (await customAiStatus()).enabled ? "custom API" : "keyword baseline" } }));
adminRouter.get("/integrations/custom-ai", permission("MANAGE_INTEGRATIONS"), async (_req, res) => {
  const status = await customAiStatus(); res.json({ integration: status });
});
adminRouter.put("/integrations/custom-ai", permission("MANAGE_INTEGRATIONS"), async (req, res) => {
  const p = z.object({ endpointUrl: z.string().url().max(500), model: z.string().trim().min(1).max(150), apiKey: z.string().max(500).optional(), enabled: z.boolean() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const endpoint = new URL(p.data.endpointUrl);
  if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost" && endpoint.hostname !== "127.0.0.1") return res.status(400).json({ error: "Use an HTTPS endpoint" });
  const previous = await prisma.customAiIntegration.findUnique({ where: { id: "default" } });
  if (p.data.enabled && !p.data.apiKey?.trim() && !previous?.apiKeyCiphertext) return res.status(400).json({ error: "API key is required to enable the integration" });
  const integration = await prisma.customAiIntegration.upsert({ where: { id: "default" }, create: { id: "default", endpointUrl: p.data.endpointUrl, model: p.data.model, apiKeyCiphertext: encryptApiKey(p.data.apiKey || ""), enabled: p.data.enabled, updatedById: userOf(req).id }, update: { endpointUrl: p.data.endpointUrl, model: p.data.model, ...(p.data.apiKey?.trim() ? { apiKeyCiphertext: encryptApiKey(p.data.apiKey) } : {}), enabled: p.data.enabled, updatedById: userOf(req).id } });
  await audit(req, "CUSTOM_AI_INTEGRATION_UPDATED", "CustomAiIntegration", integration.id, { enabled: integration.enabled, model: integration.model });
  res.json({ integration: { configured: integration.enabled, endpointUrl: integration.endpointUrl, model: integration.model, hasApiKey: !!integration.apiKeyCiphertext } });
});
adminRouter.post("/integrations/custom-ai/test", permission("MANAGE_INTEGRATIONS"), async (_req, res) => {
  try { const answer = await callCustomAi<{ ok: boolean }>("Return JSON with {\"ok\":true} only.", "Connection test"); if (!answer?.ok) return res.status(502).json({ error: "Provider responded, but did not return the expected JSON" }); res.json({ ok: true }); }
  catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "AI provider connection failed" }); }
});
adminRouter.get("/reports", permission("VIEW_REPORTS"), async (_req, res) => {
  const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const [users, jobs, applications, paidPayments, paidPosts, subscriptions, cases] = await Promise.all([
    prisma.user.findMany({ where: { createdAt: { gte: start } }, select: { createdAt: true, role: true } }),
    prisma.job.findMany({ where: { createdAt: { gte: start } }, select: { createdAt: true, status: true } }),
    prisma.application.findMany({ where: { appliedAt: { gte: start } }, select: { appliedAt: true, status: true } }),
    prisma.paymentTransaction.findMany({ where: { status: { in: ["PAID", "PARTIALLY_REFUNDED"] }, createdAt: { gte: start } }, select: { amountPaise: true, taxPaise: true, refundedPaise: true, createdAt: true } }),
    prisma.jobPostingTransaction.findMany({ where: { status: { in: ["PAID", "PARTIALLY_REFUNDED"] }, createdAt: { gte: start } }, select: { amountPaise: true, taxPaise: true, refundedPaise: true, createdAt: true } }),
    prisma.subscription.findMany({ where: { createdAt: { gte: start } }, select: { status: true, amountPaise: true, createdAt: true } }),
    prisma.billingCase.groupBy({ by: ["kind", "status"], _count: { _all: true } }),
  ]);
  const months = Array.from({ length: 12 }, (_, i) => { const date = new Date(start.getFullYear(), start.getMonth() + i, 1); return { key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`, label: date.toLocaleString("en", { month: "short", year: "numeric" }), users: 0, jobs: 0, applications: 0, revenuePaise: 0, gstPaise: 0 }; });
  const indexFor = (date: Date) => months.find((m) => m.key === `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  for (const row of users) { const month = indexFor(row.createdAt); if (month) month.users++; }
  for (const row of jobs) { const month = indexFor(row.createdAt); if (month) month.jobs++; }
  for (const row of applications) { const month = indexFor(row.appliedAt); if (month) month.applications++; }
  for (const row of [...paidPayments, ...paidPosts]) { const month = indexFor(row.createdAt); if (month) { month.revenuePaise += Math.max(0, row.amountPaise - row.taxPaise - row.refundedPaise); month.gstPaise += Math.max(0, row.taxPaise - (row.refundedPaise >= row.amountPaise ? row.taxPaise : 0)); } }
  res.json({ months, totals: { users: users.length, jobs: jobs.length, applications: applications.length, revenuePaise: months.reduce((sum, x) => sum + x.revenuePaise, 0), gstCollectedPaise: months.reduce((sum, x) => sum + x.gstPaise, 0), activeSubscriptions: subscriptions.filter((x) => x.status === "ACTIVE").length }, cases });
});
adminRouter.get("/overview", async (_req, res) => {
  const [users,candidates,recruiters,institutions,companies,jobs,pendingJobs,applications,subscriptions] = await Promise.all([
    prisma.user.count(), prisma.user.count({where:{role:"CANDIDATE"}}), prisma.user.count({where:{role:"RECRUITER"}}),
    prisma.institution.count(), prisma.company.count(), prisma.job.count(), prisma.job.count({where:{status:{in:["PENDING_REVIEW","PENDING_APPROVAL"]}}}),
    prisma.application.count(), prisma.subscription.count({where:{status:"ACTIVE"}}),
  ]);
  const [roleCounts, jobStatuses, applicationStatuses, paymentRevenue, postingRevenue, subscriptionRevenue, openCases, recentUsers] = await Promise.all([
    prisma.user.groupBy({ by: ["role"], _count: true }),
    prisma.job.groupBy({ by: ["status"], _count: true }),
    prisma.application.groupBy({ by: ["status"], _count: true }),
    prisma.paymentTransaction.findMany({ where: { status: { in: ["PAID", "PARTIALLY_REFUNDED"] } }, select: { amountPaise: true, taxPaise: true, refundedPaise: true } }),
    prisma.jobPostingTransaction.findMany({ where: { status: { in: ["PAID", "PARTIALLY_REFUNDED"] } }, select: { amountPaise: true, taxPaise: true, refundedPaise: true } }),
    prisma.subscription.aggregate({ where: { status: "ACTIVE" }, _sum: { amountPaise: true }, _count: { _all: true } }),
    prisma.billingCase.count({ where: { status: { in: ["OPEN", "REVIEWING"] } } }),
    prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 8, select: { id: true, fullName: true, email: true, role: true, createdAt: true } }),
  ]);
  res.json({ users,candidates,recruiters,institutions,companies,jobs,pendingJobs,applications,activeSubscriptions:subscriptions,
    analytics: { roleCounts, jobStatuses, applicationStatuses, revenuePaise: [...paymentRevenue, ...postingRevenue].reduce((total, item) => total + Math.max(0, item.amountPaise - item.taxPaise - item.refundedPaise), 0), gstCollectedPaise: [...paymentRevenue, ...postingRevenue].reduce((total, item) => total + Math.max(0, item.taxPaise - (item.refundedPaise >= item.amountPaise ? item.taxPaise : 0)), 0), payments: paymentRevenue.length + postingRevenue.length, activeSubscriptionValuePaise: subscriptionRevenue._sum.amountPaise || 0, openCases, recentUsers } });
});
adminRouter.get("/users", permission("MANAGE_USERS"), async (req,res) => {
  const page=Math.max(1,Number(req.query.page)||1);
  const role = z.enum(["CANDIDATE", "RECRUITER", "INSTITUTION", "ADMIN"]).safeParse(req.query.role);
  const recruiterType = z.enum(["CORPORATE", "FREELANCE"]).safeParse(req.query.recruiterType);
  const q = String(req.query.q || "").trim().slice(0, 100);
  const where: any = { ...(role.success ? { role: role.data } : {}), ...(q ? { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}), ...(recruiterType.success ? { employer: { recruiterType: recruiterType.data } } : {}) };
  const [total, data] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, select:{id:true,email:true,fullName:true,phone:true,role:true,isActive:true,emailVerifiedAt:true,createdAt:true,candidate:{select:{headline:true,city:true,state:true,passingYear:true,searchable:true}},employer:{select:{name:true,recruiterType:true,verified:true}},institution:{select:{name:true,verified:true}}},orderBy:{createdAt:"desc"},skip:(page-1)*50,take:50 }),
  ]);
  res.json({data,page,total,pageSize:50});
});
adminRouter.get("/registrations", permission("MANAGE_REGISTRATIONS"), async (_req, res) => {
  const [recruiters, institutions] = await Promise.all([
    prisma.employer.findMany({ where: { verified: false }, include: { user: { select: { id: true, fullName: true, email: true, emailVerifiedAt: true, isActive: true } } }, orderBy: { user: { createdAt: "asc" } } }),
    prisma.institution.findMany({ where: { verified: false }, include: { user: { select: { id: true, fullName: true, email: true, emailVerifiedAt: true, isActive: true } } }, orderBy: { name: "asc" } }),
  ]);
  res.json({ recruiters, institutions });
});
adminRouter.patch("/employers/:id/verify", permission("MANAGE_REGISTRATIONS"), async (req, res) => {
  const p = z.object({ verified: z.boolean() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "verified must be boolean" });
  const employer = await prisma.employer.update({ where: { id: String(req.params.id) }, data: { verified: p.data.verified } });
  await audit(req, p.data.verified ? "RECRUITER_COMPANY_APPROVED" : "RECRUITER_COMPANY_VERIFICATION_REVOKED", "Employer", employer.id);
  res.json({ employer });
});
adminRouter.get("/job-posting-settings", permission("MANAGE_PRICING"), async (_req, res) => {
  res.json({ settings: await getJobPostingPolicy() });
});
adminRouter.put("/job-posting-settings", permission("MANAGE_PRICING"), async (req, res) => {
  const parsed = jobPostingPolicySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const setting = await prisma.platformSetting.upsert({
    where: { key: JOB_POSTING_POLICY_KEY },
    create: { key: JOB_POSTING_POLICY_KEY, value: parsed.data as Prisma.InputJsonValue, updatedById: userOf(req).id },
    update: { value: parsed.data as Prisma.InputJsonValue, updatedById: userOf(req).id },
  });
  await audit(req, "JOB_POSTING_POLICY_UPDATED", "PlatformSetting", setting.key, parsed.data);
  res.json({ settings: parsed.data });
});

adminRouter.get("/plans", permission("MANAGE_PRICING"), async (_req, res) => {
  const [jobPostingPlans, subscriptionPlans] = await Promise.all([
    prisma.jobPostingPlan.findMany({ orderBy: { pricePaise: "asc" } }),
    prisma.subscriptionPlan.findMany({ orderBy: [{ audience: "asc" }, { amountPaise: "asc" }] }),
  ]);
  res.json({ jobPostingPlans, subscriptionPlans });
});
adminRouter.post("/plans/posting", permission("MANAGE_PRICING"), async (req, res) => {
  const p = z.object({ code: z.string().trim().min(2).max(50), name: z.string().trim().min(2).max(100), description: z.string().max(500).optional(), pricePaise: z.number().int().min(0), durationDays: z.number().int().min(1).max(3650), postingCredits: z.number().int().min(1).max(10000), featured: z.boolean(), features: z.array(z.string().max(150)), active: z.boolean() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const plan = await prisma.jobPostingPlan.create({ data: { ...p.data, features: p.data.features } }); await audit(req, "POSTING_PLAN_CREATED", "JobPostingPlan", plan.id); res.status(201).json({ plan });
});
adminRouter.patch("/plans/posting/:id", permission("MANAGE_PRICING"), async (req, res) => {
  const p = z.object({ name: z.string().trim().min(2).max(100).optional(), description: z.string().max(500).nullable().optional(), pricePaise: z.number().int().min(0).optional(), durationDays: z.number().int().min(1).max(3650).optional(), postingCredits: z.number().int().min(1).max(10000).optional(), featured: z.boolean().optional(), features: z.array(z.string().max(150)).optional(), active: z.boolean().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const plan = await prisma.jobPostingPlan.update({ where: { id: String(req.params.id) }, data: p.data }); await audit(req, "POSTING_PLAN_UPDATED", "JobPostingPlan", plan.id); res.json({ plan });
});
adminRouter.post("/plans/subscription", permission("MANAGE_PRICING"), async (req, res) => {
  const p = z.object({ code: z.string().trim().min(2).max(50), audience: z.enum(["FREELANCE", "CORPORATE", "INSTITUTION"]), name: z.string().trim().min(2).max(100), description: z.string().max(500).optional(), amountPaise: z.number().int().min(0), durationDays: z.number().int().min(1).max(3650), features: z.array(z.string().max(150)), limits: z.record(z.string(), z.number().int().min(0).max(1000000)).default({}), active: z.boolean() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const plan = await prisma.subscriptionPlan.create({ data: { ...p.data, features: p.data.features } }); await audit(req, "SUBSCRIPTION_PLAN_CREATED", "SubscriptionPlan", plan.id); res.status(201).json({ plan });
});
adminRouter.patch("/plans/subscription/:id", permission("MANAGE_PRICING"), async (req, res) => {
  const p = z.object({ audience: z.enum(["FREELANCE", "CORPORATE", "INSTITUTION"]).optional(), name: z.string().trim().min(2).max(100).optional(), description: z.string().max(500).nullable().optional(), amountPaise: z.number().int().min(0).optional(), durationDays: z.number().int().min(1).max(3650).optional(), features: z.array(z.string().max(150)).optional(), limits: z.record(z.string(), z.number().int().min(0).max(1000000)).optional(), active: z.boolean().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const plan = await prisma.subscriptionPlan.update({ where: { id: String(req.params.id) }, data: p.data }); await audit(req, "SUBSCRIPTION_PLAN_UPDATED", "SubscriptionPlan", plan.id); res.json({ plan });
});
adminRouter.get("/billing", permission("MANAGE_BILLING"), async (_req, res) => {
  const [transactions, postingTransactions, subscriptions, cases, payments, posts] = await Promise.all([
    prisma.paymentTransaction.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.jobPostingTransaction.findMany({ include: { plan: { select: { name: true } }, user: { select: { email: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.subscription.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, userId: true, planCode: true, status: true, amountPaise: true, currency: true, createdAt: true, endsAt: true } }),
    prisma.billingCase.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.paymentTransaction.findMany({ where: { status: { in: ["PAID", "PARTIALLY_REFUNDED"] } }, select: { amountPaise: true, taxPaise: true, refundedPaise: true } }),
    prisma.jobPostingTransaction.findMany({ where: { status: { in: ["PAID", "PARTIALLY_REFUNDED"] } }, select: { amountPaise: true, taxPaise: true, refundedPaise: true } }),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set([...transactions.map((x) => x.userId), ...subscriptions.map((x) => x.userId)])] } }, select: { id: true, email: true } });
  const emails = new Map(users.map((x) => [x.id, x.email]));
  const netRevenue = [...payments, ...posts].reduce((total, item) => total + Math.max(0, item.amountPaise - item.taxPaise - item.refundedPaise), 0);
  const gstCollectedPaise = [...payments, ...posts].reduce((total, item) => total + Math.max(0, item.taxPaise - (item.refundedPaise >= item.amountPaise ? item.taxPaise : 0)), 0);
  res.json({ revenuePaise: netRevenue, gstCollectedPaise, paidCount: payments.length + posts.length, transactions: transactions.map((x) => ({ ...x, userEmail: emails.get(x.userId) || "" })), postingTransactions, subscriptions: subscriptions.map((x) => ({ ...x, userEmail: emails.get(x.userId) || "" })), cases });
});
adminRouter.post("/billing/cases", permission("MANAGE_BILLING"), async (req, res) => {
  const p = z.object({ userId: z.string().optional(), transactionId: z.string().optional(), kind: z.enum(["REFUND", "DISPUTE"]), reason: z.string().trim().min(5).max(2000), amountPaise: z.number().int().min(0).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const record = await prisma.billingCase.create({ data: p.data }); await audit(req, `${p.data.kind}_CASE_CREATED`, "BillingCase", record.id); res.status(201).json({ case: record });
});
adminRouter.post("/billing/refunds/:transactionId", permission("MANAGE_BILLING"), async (req, res) => {
  const p = z.object({ amountPaise: z.number().int().positive().optional(), reason: z.string().trim().min(5).max(500) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const payment = await prisma.paymentTransaction.findUnique({ where: { id: String(req.params.transactionId) } });
  const posting = payment ? null : await prisma.jobPostingTransaction.findUnique({ where: { id: String(req.params.transactionId) } });
  const tx: any = payment || posting;
  if (!tx || !["PAID", "PARTIALLY_REFUNDED"].includes(tx.status)) return res.status(409).json({ error: "Only paid transactions can be refunded" });
  const amountPaise = p.data.amountPaise ?? (tx.amountPaise - tx.refundedPaise);
  if (amountPaise <= 0 || amountPaise > tx.amountPaise - tx.refundedPaise) return res.status(400).json({ error: "Refund amount exceeds the remaining refundable amount" });
  const provider = getPaymentProvider();
  if (!provider.createRefund) return res.status(501).json({ error: `Refund execution is not supported by ${provider.name}` });
  try {
    const idempotencyKey = crypto.createHash("sha256").update(`${tx.id}:${tx.refundedPaise}:${amountPaise}:${p.data.reason}`).digest("hex").slice(0, 32);
    const refund = await provider.createRefund({ providerReference: tx.providerRef || "", paymentReference: tx.providerPaymentRef || undefined, amountPaise, reason: p.data.reason, idempotencyKey });
    const refundedPaise = tx.refundedPaise + amountPaise; const status = refundedPaise >= tx.amountPaise ? "REFUNDED" : "PARTIALLY_REFUNDED";
    if (payment) {
      await prisma.paymentTransaction.update({ where: { id: payment.id }, data: { refundedPaise, status } });
      if (status === "REFUNDED" && payment.subscriptionId) await prisma.subscription.updateMany({ where: { id: payment.subscriptionId }, data: { status: "CANCELLED" } });
    } else if (posting) await prisma.jobPostingTransaction.update({ where: { id: posting.id }, data: { refundedPaise, status } });
    await prisma.billingCase.create({ data: { userId: tx.userId, transactionId: tx.id, kind: "REFUND", status: "RESOLVED", reason: p.data.reason, amountPaise, resolution: `Provider refund ${refund.providerRefundReference}` } });
    await audit(req, "PAYMENT_REFUNDED", "PaymentTransaction", tx.id, { amountPaise, providerRefundReference: refund.providerRefundReference, status });
    res.json({ ok: true, status, refundedPaise, providerRefundReference: refund.providerRefundReference });
  } catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "Payment provider refund failed" }); }
});
adminRouter.patch("/billing/cases/:id", permission("MANAGE_BILLING"), async (req, res) => {
  const p = z.object({ status: z.enum(["OPEN", "REVIEWING", "RESOLVED", "REJECTED"]), resolution: z.string().max(2000).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const record = await prisma.billingCase.update({ where: { id: String(req.params.id) }, data: p.data }); await audit(req, "BILLING_CASE_UPDATED", "BillingCase", record.id, { status: record.status }); res.json({ case: record });
});
adminRouter.get("/cms", permission("MANAGE_CMS"), async (_req, res) => res.json({ data: await prisma.cmsPage.findMany({ orderBy: { slug: "asc" } }) }));
adminRouter.post("/cms", permission("MANAGE_CMS"), async (req, res) => {
  const p = z.object({ slug: z.string().trim().regex(/^[a-z0-9-]+$/).max(100), title: z.string().trim().min(2).max(180), body: z.string().max(100000), metaTitle: z.string().max(180).optional(), metaDescription: z.string().max(320).optional(), published: z.boolean() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const page = await prisma.cmsPage.create({ data: { ...p.data, updatedById: userOf(req).id } }); await audit(req, "CMS_PAGE_CREATED", "CmsPage", page.id); res.status(201).json({ page });
});
adminRouter.patch("/cms/:id", permission("MANAGE_CMS"), async (req, res) => {
  const p = z.object({ slug: z.string().trim().regex(/^[a-z0-9-]+$/).max(100).optional(), title: z.string().trim().min(2).max(180).optional(), body: z.string().max(100000).optional(), metaTitle: z.string().max(180).nullable().optional(), metaDescription: z.string().max(320).nullable().optional(), published: z.boolean().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const page = await prisma.cmsPage.update({ where: { id: String(req.params.id) }, data: { ...p.data, updatedById: userOf(req).id } }); await audit(req, "CMS_PAGE_UPDATED", "CmsPage", page.id); res.json({ page });
});
adminRouter.delete("/cms/:id", permission("MANAGE_CMS"), async (req, res) => { await prisma.cmsPage.delete({ where: { id: String(req.params.id) } }); await audit(req, "CMS_PAGE_DELETED", "CmsPage", String(req.params.id)); res.json({ ok: true }); });
adminRouter.get("/templates", permission("MANAGE_TEMPLATES"), async (_req, res) => res.json({ data: await prisma.messageTemplate.findMany({ orderBy: [{ channel: "asc" }, { key: "asc" }] }) }));
adminRouter.post("/templates", permission("MANAGE_TEMPLATES"), async (req, res) => {
  const p = z.object({ key: z.string().trim().regex(/^[A-Z0-9_.-]+$/).max(100), channel: z.enum(["EMAIL", "SMS"]), name: z.string().trim().min(2).max(120), subject: z.string().max(200).optional(), body: z.string().min(1).max(20000), enabled: z.boolean() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const template = await prisma.messageTemplate.create({ data: { ...p.data, updatedById: userOf(req).id } }); await audit(req, "MESSAGE_TEMPLATE_CREATED", "MessageTemplate", template.id); res.status(201).json({ template });
});
adminRouter.patch("/templates/:id", permission("MANAGE_TEMPLATES"), async (req, res) => {
  const p = z.object({ key: z.string().trim().regex(/^[A-Z0-9_.-]+$/).max(100).optional(), channel: z.enum(["EMAIL", "SMS"]).optional(), name: z.string().trim().min(2).max(120).optional(), subject: z.string().max(200).nullable().optional(), body: z.string().min(1).max(20000).optional(), enabled: z.boolean().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const template = await prisma.messageTemplate.update({ where: { id: String(req.params.id) }, data: { ...p.data, updatedById: userOf(req).id } }); await audit(req, "MESSAGE_TEMPLATE_UPDATED", "MessageTemplate", template.id); res.json({ template });
});
const adminPermissions = ["MANAGE_USERS", "MANAGE_REGISTRATIONS", "MODERATE_JOBS", "MANAGE_INSTITUTIONS", "MANAGE_PRICING", "MANAGE_BILLING", "MANAGE_CMS", "MANAGE_TEMPLATES", "MANAGE_INTEGRATIONS", "VIEW_REPORTS", "VIEW_AUDIT"];
adminRouter.get("/access-matrix", async (_req, res) => {
  const stored = await prisma.rolePermission.findMany();
  res.json({ data: adminPermissions.map((name) => ({ name, enabled: stored.find((x) => x.role === "ADMIN" && x.permission === name)?.enabled ?? true })) });
});
adminRouter.put("/access-matrix", async (req, res) => {
  const p = z.object({ entries: z.array(z.object({ permission: z.enum(["MANAGE_USERS", "MANAGE_REGISTRATIONS", "MODERATE_JOBS", "MANAGE_INSTITUTIONS", "MANAGE_PRICING", "MANAGE_BILLING", "MANAGE_CMS", "MANAGE_TEMPLATES", "MANAGE_INTEGRATIONS", "VIEW_REPORTS", "VIEW_AUDIT"]), enabled: z.boolean() })).max(100) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  await prisma.$transaction(p.data.entries.map((entry) => prisma.rolePermission.upsert({ where: { role_permission: { role: "ADMIN", permission: entry.permission } }, create: { ...entry, role: "ADMIN", updatedById: userOf(req).id }, update: { enabled: entry.enabled, updatedById: userOf(req).id } })));
  await audit(req, "ACCESS_MATRIX_UPDATED", "RolePermission", undefined, { count: p.data.entries.length });
  res.json({ ok: true });
});
adminRouter.patch("/users/:id/status", permission("MANAGE_USERS"), async (req,res) => {
  const p=z.object({isActive:z.boolean()}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"isActive must be boolean"});
  if (!p.data.isActive && String(req.params.id) === userOf(req).id) return res.status(409).json({ error: "You cannot suspend your own admin account" });
  if (!p.data.isActive) {
    const target = await prisma.user.findUnique({ where: { id: String(req.params.id) }, select: { role: true, isActive: true } });
    if (target?.role === "ADMIN" && target.isActive && await prisma.user.count({ where: { role: "ADMIN", isActive: true } }) <= 1) return res.status(409).json({ error: "The last active admin account cannot be suspended" });
  }
  const user=await prisma.user.update({where:{id:String(req.params.id)},data:{isActive:p.data.isActive},select:{id:true,isActive:true}});
  await audit(req, p.data.isActive ? "USER_ACTIVATED" : "USER_SUSPENDED", "User", user.id);
  res.json({user});
});
adminRouter.get("/jobs", permission("MODERATE_JOBS"), async (_req,res) => {
  const data=await prisma.job.findMany({where:{status:{in:["PENDING_REVIEW","PENDING_APPROVAL"]}},include:{employer:{select:{name:true,verified:true,userId:true,user:{select:{fullName:true,email:true}}}},skills:true,requirements:true,benefits:true,statusHistory:{orderBy:{createdAt:"desc"},take:5}},orderBy:{createdAt:"asc"}});
  res.json({data:data.map(job=>({...job,jobOverview:sanitizeJobDescriptionHtml(job.jobOverview||job.description)}))});
});
adminRouter.get("/institutions", permission("MANAGE_INSTITUTIONS"), async (_req, res) => {
  const data = await prisma.institution.findMany({ include: { user: { select: { email: true, fullName: true } }, _count: { select: { students: true } } }, orderBy: [{ verified: "asc" }, { name: "asc" }] });
  res.json({ data });
});
adminRouter.patch("/jobs/:id/review", permission("MODERATE_JOBS"), async (req,res) => {
  const p=z.object({decision:z.enum(["PUBLISHED","REJECTED","CHANGES_REQUESTED"]),reason:z.string().trim().max(500).optional()}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"Invalid review decision"});
  if(p.data.decision!=="PUBLISHED"&&!p.data.reason)return res.status(400).json({error:"Provide a reason for rejection or requested changes"});
  const existing=await prisma.job.findUnique({where:{id:String(req.params.id)},include:{employer:{select:{userId:true}},postingTransactions:{where:{status:{in:["AUTHORIZED","PAID"]}},include:{plan:true},orderBy:{createdAt:"desc"},take:1}}});
  if(!existing)return res.status(404).json({error:"Job not found"});
  if(!["PENDING_APPROVAL","PENDING_REVIEW"].includes(existing.status))return res.status(409).json({error:"Only jobs awaiting review can be moderated"});
  if(p.data.decision==="PUBLISHED"&&existing.postingPlanCode&&existing.postingPlanCode!=="FREE_JOB"&&!existing.postingTransactions[0])return res.status(402).json({error:"No valid posting entitlement exists for this job"});
  if(p.data.decision==="PUBLISHED"&&!existing.employerId)return res.status(409).json({error:"Job has no company profile"});
  const next=p.data.decision;
  const plan=existing.postingTransactions[0]?.plan;
  const slug=next==="PUBLISHED"?`${existing.title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}-${(existing.jobReference||crypto.randomUUID()).toLowerCase()}`:existing.slug;
  const policy=await getJobPostingPolicy();
  const job=await prisma.$transaction(async(tx)=>{
    const updated=await tx.job.update({where:{id:existing.id},data:{status:next,slug,publishedAt:next==="PUBLISHED"?new Date():existing.publishedAt,expiresAt:next==="PUBLISHED"?new Date(Date.now()+(plan?.durationDays||(existing.postingPlanCode==="FREE_JOB"?policy.expiryDays:30))*86400000):existing.expiresAt}});
    await tx.jobStatusHistory.create({data:{jobId:existing.id,previousStatus:existing.status,newStatus:next,changedById:userOf(req).id,reason:p.data.reason||null}});
    await tx.auditLog.create({data:{actorId:userOf(req).id,action:`JOB_${next}`,entityType:"Job",entityId:existing.id,metadata:{previousStatus:existing.status,newStatus:next,reason:p.data.reason||null,jobReference:updated.jobReference}}});
    return updated;
  });
  if(existing.employer?.userId)await notifyUser({userId:existing.employer.userId,title:next==="PUBLISHED"?"Job approved and published":next==="REJECTED"?"Job posting rejected":"Changes requested for your job",body:next==="PUBLISHED"?`${existing.title} is now visible to candidates.`:`${existing.title}: ${p.data.reason}`,emailSubject:`Job posting update: ${existing.title}`});
  res.json({job});
});
adminRouter.patch("/institutions/:id/verify", permission("MANAGE_INSTITUTIONS"), async (req,res) => {
  const p=z.object({verified:z.boolean()}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"verified must be boolean"});
  const institution=await prisma.institution.update({where:{id:String(req.params.id)},data:{verified:p.data.verified}});
  await prisma.auditLog.create({data:{actorId:userOf(req).id,action:p.data.verified?"INSTITUTION_APPROVED":"INSTITUTION_VERIFICATION_REVOKED",entityType:"Institution",entityId:institution.id}});
  res.json({institution});
});
adminRouter.get("/audit", permission("VIEW_AUDIT"), async (_req,res) => {
  const data=await prisma.auditLog.findMany({orderBy:{createdAt:"desc"},take:100});
  res.json({data});
});
