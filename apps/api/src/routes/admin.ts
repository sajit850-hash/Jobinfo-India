import { Router } from "express";
import { z } from "zod";
import { prisma, Prisma } from "@jobinfo/database";
import { requireAuth, signPasswordResetToken, userOf } from "../auth";
import crypto from "node:crypto";
import { integrationStatus } from "../integrations/registry";
import { callCustomAi, customAiStatus, encryptApiKey } from "../integrations/custom-ai";
import { getPaymentProvider } from "../integrations/registry";
import { getJobPostingPolicy, JOB_POSTING_POLICY_KEY, jobPostingPolicySchema } from "../platform/job-posting-policy";
import { notifyUser } from "../notifications/service";
import { jobDescriptionPlainText, sanitizeJobDescriptionHtml } from "../security/job-description";
import { config } from "../config";
import { getEmailProvider, getResumeStorage } from "../integrations/registry";

export const adminRouter = Router();
export const cmsRouter = Router();
cmsRouter.get("/:slug", async (req, res) => {
  const page = await prisma.cmsPage.findFirst({ where: { slug: String(req.params.slug), published: true }, select: { slug: true, title: true, body: true, metaTitle: true, metaDescription: true, updatedAt: true } });
  if (!page) return res.status(404).json({ error: "Page not found" });
  res.json({ page });
});
adminRouter.use(requireAuth("ADMIN"));
const audit = (req: any, action: string, entityType: string, entityId?: string, metadata?: any) => prisma.auditLog.create({ data: { actorId: userOf(req).id, action, entityType, entityId, metadata, ipAddress: req.ip } });
const hasPermission = async (req:any,name:string) => {
  const adminProfile = await prisma.adminProfile.findUnique({ where: { userId: userOf(req).id }, select: { permissions: true } });
  if (adminProfile && !adminProfile.permissions.includes(name)) return false;
  const rule = await prisma.rolePermission.findUnique({ where: { role_permission: { role: "ADMIN", permission: name } } });
  return rule?.enabled??true;
};
const permission = (name: string) => async (req: any, res: any, next: any) => {
  if(!await hasPermission(req,name))return res.status(403).json({error:`Your admin access profile does not allow ${name}`});
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
adminRouter.get("/integrations", permission("MANAGE_INTEGRATIONS"), async (_req,res) => res.json({ integrations: { ...integrationStatus(), ai: (await customAiStatus()).enabled ? "custom API" : "keyword baseline" } }));
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
adminRouter.get("/overview", permission("VIEW_REPORTS"), async (_req, res) => {
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
  const page=Math.max(1,Number(req.query.page)||1), pageSize=Math.min(100,Math.max(1,Number(req.query.pageSize)||50));
  const role = z.enum(["CANDIDATE", "RECRUITER", "INSTITUTION", "ADMIN"]).safeParse(req.query.role);
  const recruiterType = z.enum(["CORPORATE", "FREELANCE"]).safeParse(req.query.recruiterType);
  const accountStatus = z.enum(["ACTIVE", "SUSPENDED", "DELETED"]).safeParse(req.query.status);
  const verification = z.enum(["VERIFIED", "PENDING"]).safeParse(req.query.verification);
  const subscriptionStatus = z.enum(["ACTIVE", "PENDING", "EXPIRED", "CANCELLED"]).safeParse(req.query.subscriptionStatus);
  const jobActivity = z.enum(["HAS_ACTIVE_JOBS", "HAS_PENDING_JOBS", "NO_JOBS"]).safeParse(req.query.jobActivity);
  const q = String(req.query.q || "").trim().slice(0, 100);
  const since = req.query.createdFrom ? new Date(String(req.query.createdFrom)) : undefined;
  const until = req.query.createdTo ? new Date(String(req.query.createdTo)) : undefined;
  const filters: any[] = [];
  if (q) filters.push({ OR: [{ fullName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q, mode: "insensitive" } }, { employer: { name: { contains: q, mode: "insensitive" } } }, { institution: { name: { contains: q, mode: "insensitive" } } }] });
  if (verification.success) filters.push(role.success && role.data === "RECRUITER" ? { employer: { verified: verification.data === "VERIFIED" } } : role.success && role.data === "INSTITUTION" ? { institution: { verified: verification.data === "VERIFIED" } } : role.success ? { emailVerifiedAt: verification.data === "VERIFIED" ? { not: null } : null } : { OR: [{ employer: { verified: verification.data === "VERIFIED" } }, { institution: { verified: verification.data === "VERIFIED" } }, { emailVerifiedAt: verification.data === "VERIFIED" ? { not: null } : null }] });
  if (jobActivity.success) filters.push(jobActivity.data === "NO_JOBS" ? { employer: { is: { jobs: { none: {} } } } } : { employer: { is: { jobs: { some: { status: { in: jobActivity.data === "HAS_ACTIVE_JOBS" ? ["PUBLISHED", "ACTIVE"] : ["PENDING_REVIEW", "PENDING_APPROVAL"] } } } } } });
  const where: any = {
    ...(role.success ? { role: role.data } : {}),
    ...(recruiterType.success ? { employer: { ...(q ? { name: { contains: q, mode: "insensitive" } } : {}), recruiterType: recruiterType.data } } : {}),
    ...(accountStatus.success ? (accountStatus.data === "DELETED" ? {deletedAt:{not:null}} : {deletedAt:null,isActive:accountStatus.data === "ACTIVE"}) : {deletedAt:null}),
    ...(filters.length ? { AND: filters } : {}),
    ...(subscriptionStatus.success ? { subscriptions: { some: { status: subscriptionStatus.data } } } : {}),
    ...(since && Number.isFinite(since.getTime()) || until && Number.isFinite(until.getTime()) ? { createdAt: { ...(since && Number.isFinite(since.getTime()) ? { gte: since } : {}), ...(until && Number.isFinite(until.getTime()) ? { lte: until } : {}) } } : {}),
  };
  const sort = z.enum(["createdAt", "fullName", "email", "role"]).safeParse(req.query.sort);
  const direction = req.query.direction === "asc" ? "asc" : "desc";
  const [total, data] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, select:{id:true,email:true,fullName:true,phone:true,role:true,isActive:true,deletedAt:true,emailVerifiedAt:true,phoneVerifiedAt:true,createdAt:true,candidate:{select:{headline:true,city:true,state:true,passingYear:true,searchable:true,_count:{select:{applications:true,savedJobs:true}}}},employer:{select:{name:true,recruiterType:true,verified:true,_count:{select:{jobs:true}}}},institution:{select:{name:true,verified:true,_count:{select:{students:true}}}},subscriptions:{select:{status:true,planCode:true,endsAt:true},orderBy:{createdAt:"desc"},take:1}},orderBy:{[sort.success?sort.data:"createdAt"]:direction},skip:(page-1)*pageSize,take:pageSize }),
  ]);
  res.json({data,page,total,pageSize});
});
adminRouter.get("/users/export", permission("MANAGE_USERS"), async (req,res) => {
  const q=String(req.query.q||"").trim().slice(0,100),role=z.enum(["CANDIDATE","RECRUITER","INSTITUTION","ADMIN"]).safeParse(req.query.role),status=z.enum(["ACTIVE","SUSPENDED","DELETED"]).safeParse(req.query.status),recruiterType=z.enum(["CORPORATE","FREELANCE"]).safeParse(req.query.recruiterType),verification=z.enum(["VERIFIED","PENDING"]).safeParse(req.query.verification),subscriptionStatus=z.enum(["ACTIVE","PENDING","EXPIRED","CANCELLED"]).safeParse(req.query.subscriptionStatus),jobActivity=z.enum(["HAS_ACTIVE_JOBS","HAS_PENDING_JOBS","NO_JOBS"]).safeParse(req.query.jobActivity);
  const createdFrom=req.query.createdFrom?new Date(String(req.query.createdFrom)):undefined,createdTo=req.query.createdTo?new Date(String(req.query.createdTo)):undefined;
  const filters:any[]=[];if(q)filters.push({OR:[{fullName:{contains:q,mode:"insensitive"}},{email:{contains:q,mode:"insensitive"}},{phone:{contains:q,mode:"insensitive"}},{employer:{name:{contains:q,mode:"insensitive"}}},{institution:{name:{contains:q,mode:"insensitive"}}}]});
  if(verification.success)filters.push(role.success&&role.data==="RECRUITER"?{employer:{verified:verification.data==="VERIFIED"}}:role.success&&role.data==="INSTITUTION"?{institution:{verified:verification.data==="VERIFIED"}}:role.success?{emailVerifiedAt:verification.data==="VERIFIED"?{not:null}:null}:{OR:[{employer:{verified:verification.data==="VERIFIED"}},{institution:{verified:verification.data==="VERIFIED"}},{emailVerifiedAt:verification.data==="VERIFIED"?{not:null}:null}]});
  if(jobActivity.success)filters.push(jobActivity.data==="NO_JOBS"?{employer:{is:{jobs:{none:{}}}}}:{employer:{is:{jobs:{some:{status:{in:jobActivity.data==="HAS_ACTIVE_JOBS"?["PUBLISHED","ACTIVE"]:["PENDING_REVIEW","PENDING_APPROVAL"]}}}}}});
  const where:any={...(role.success?{role:role.data}:{}),...(status.success?(status.data==="DELETED"?{deletedAt:{not:null}}:{deletedAt:null,isActive:status.data==="ACTIVE"}):{deletedAt:null}),...(recruiterType.success?{employer:{recruiterType:recruiterType.data}}:{}),...(filters.length?{AND:filters}:{}),...(subscriptionStatus.success?{subscriptions:{some:{status:subscriptionStatus.data}}}:{}),...(createdFrom&&Number.isFinite(createdFrom.getTime())||createdTo&&Number.isFinite(createdTo.getTime())?{createdAt:{...(createdFrom&&Number.isFinite(createdFrom.getTime())?{gte:createdFrom}:{}),...(createdTo&&Number.isFinite(createdTo.getTime())?{lte:createdTo}:{})}}:{})};
  const rows=await prisma.user.findMany({where,select:{fullName:true,email:true,role:true,isActive:true,deletedAt:true,emailVerifiedAt:true,createdAt:true,employer:{select:{name:true,verified:true}},institution:{select:{name:true,verified:true}}},orderBy:{createdAt:"desc"},take:10000});
  const cell=(value:unknown)=>`"${String(value??"").replace(/"/g,'""')}"`;
  const csv=["Name,Email,Role,Organization,Account Status,Verified,Registered",...rows.map(x=>[x.fullName,x.email,x.role,x.employer?.name||x.institution?.name||"",x.deletedAt?"DELETED":x.isActive?"ACTIVE":"SUSPENDED",x.employer?.verified||x.institution?.verified||!!x.emailVerifiedAt?"VERIFIED":"PENDING",x.createdAt.toISOString()].map(cell).join(","))].join("\r\n");
  await audit(req,"ADMIN_USER_EXPORT","User",undefined,{rowCount:rows.length,filters:{role:role.success?role.data:null,status:status.success?status.data:null,q:q||null}});
  res.setHeader("Content-Type","text/csv; charset=utf-8");res.setHeader("Content-Disposition","attachment; filename=jobinfo-admin-users.csv");res.setHeader("Cache-Control","private, no-store");res.send(`\uFEFF${csv}`);
});
adminRouter.get("/users/:id", permission("MANAGE_USERS"), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: String(req.params.id) }, select: {
    id:true,email:true,fullName:true,phone:true,role:true,isActive:true,deletedAt:true,deletionReason:true,emailVerifiedAt:true,phoneVerifiedAt:true,registrationStatus:true,createdAt:true,updatedAt:true,
    candidate:{select:{id:true,headline:true,summary:true,city:true,state:true,resumeUrl:true,profilePhotoKey:true,passingYear:true,experienceYears:true,profileComplete:true,searchable:true,preferredJobLocations:true,preferredJobRoles:true,highestQualification:true,course:true,createdAt:true,skills:true,education:true,workExperience:true,certifications:true,applications:{select:{id:true,status:true,appliedAt:true,job:{select:{id:true,title:true,status:true,employer:{select:{name:true}}}}},orderBy:{appliedAt:"desc"},take:50},savedJobs:{select:{createdAt:true,job:{select:{id:true,title:true,status:true}}},orderBy:{createdAt:"desc"},take:50},_count:{select:{applications:true,savedJobs:true}}}},
    employer:{include:{_count:{select:{jobs:true}},jobs:{select:{id:true,title:true,status:true,createdAt:true,_count:{select:{applications:true}}},orderBy:{createdAt:"desc"},take:20}}},
    institution:{include:{departments:true,courses:true,_count:{select:{students:true}},students:{select:{id:true,fullName:true,email:true,department:true,passingYear:true,placementStatus:true,recruiterVisible:true,placements:{select:{status:true,companyName:true,jobTitle:true}}},orderBy:{passingYear:"desc"},take:100}}},
    subscriptions:{select:{id:true,planCode:true,status:true,amountPaise:true,currency:true,startedAt:true,endsAt:true,audience:true,limits:true},orderBy:{createdAt:"desc"},take:20},
    _count:{select:{notifications:true,paymentTransactions:true}},
  }});
  if (!user) return res.status(404).json({ error: "Account not found" });
  const [jobStatuses,applicationCount,placementStatuses,passingYears]=await Promise.all([
    user.employer?prisma.job.groupBy({by:["status"],where:{employerId:user.employer.id},_count:{_all:true}}):Promise.resolve([]),
    user.employer?prisma.application.count({where:{job:{employerId:user.employer.id}}}):Promise.resolve(0),
    user.institution?prisma.institutionStudent.groupBy({by:["placementStatus"],where:{institutionId:user.institution.id},_count:{_all:true}}):Promise.resolve([]),
    user.institution?prisma.institutionStudent.groupBy({by:["passingYear"],where:{institutionId:user.institution.id},_count:{_all:true},orderBy:{passingYear:"desc"}}):Promise.resolve([]),
  ]);
  const jobCount=(statuses:string[])=>jobStatuses.filter(row=>statuses.includes(row.status)).reduce((sum,row)=>sum+row._count._all,0);
  const userWithStats={...user,
    employer:user.employer?{...user.employer,summary:{totalJobs:user.employer._count.jobs,activeJobs:jobCount(["PUBLISHED","ACTIVE"]),pendingJobs:jobCount(["PENDING_REVIEW","PENDING_APPROVAL"]),totalApplications:applicationCount}}:null,
    institution:user.institution?{...user.institution,placementStats:{byStatus:Object.fromEntries(placementStatuses.map(row=>[row.placementStatus,row._count._all])),passingYears:Object.fromEntries(passingYears.map(row=>[String(row.passingYear),row._count._all])),placed:placementStatuses.filter(row=>["PLACED","HIRED"].includes(row.placementStatus)).reduce((sum,row)=>sum+row._count._all,0),unplaced:placementStatuses.filter(row=>["SEEKING","NOT_SEEKING"].includes(row.placementStatus)).reduce((sum,row)=>sum+row._count._all,0),inProcess:placementStatuses.filter(row=>row.placementStatus==="IN_PROCESS").reduce((sum,row)=>sum+row._count._all,0)}}:null,
  };
  const activity = await prisma.auditLog.findMany({ where: { entityType:"User", entityId:user.id }, orderBy:{createdAt:"desc"}, take:50, select:{id:true,actorId:true,action:true,metadata:true,ipAddress:true,createdAt:true} });
  res.json({ user:userWithStats, activity });
});
adminRouter.patch("/users/:id", permission("MANAGE_USERS"), async (req, res) => {
  const p = z.object({ fullName:z.string().trim().min(2).max(150).optional(), phone:z.string().trim().min(7).max(30).nullable().optional(), candidate:z.object({headline:z.string().max(180).nullable().optional(),summary:z.string().max(5000).nullable().optional(),city:z.string().max(100).nullable().optional(),state:z.string().max(100).nullable().optional(),passingYear:z.number().int().min(1950).max(2200).nullable().optional(),experienceYears:z.number().int().min(0).max(80).nullable().optional(),searchable:z.boolean().optional()}).optional(), employer:z.object({name:z.string().trim().min(2).max(150).optional(),website:z.string().url().max(300).nullable().optional(),industry:z.string().max(120).nullable().optional(),city:z.string().max(100).nullable().optional(),state:z.string().max(100).nullable().optional(),registeredAddress:z.string().max(500).nullable().optional()}).optional(), institution:z.object({name:z.string().trim().min(2).max(180).optional(),website:z.string().url().max(300).nullable().optional(),city:z.string().max(100).optional(),state:z.string().max(100).optional(),address:z.string().max(500).nullable().optional(),institutionType:z.string().max(100).nullable().optional(),affiliation:z.string().max(180).nullable().optional()}).optional() }).strict().safeParse(req.body);
  if (!p.success) return res.status(400).json({error:p.error.issues[0].message});
  const current = await prisma.user.findUnique({where:{id:String(req.params.id)},include:{candidate:true,employer:true,institution:true}});
  if (!current) return res.status(404).json({error:"Account not found"});
  if(current.deletedAt)return res.status(409).json({error:"Soft-deleted accounts cannot be edited"});
  if(current.institution&&!await hasPermission(req,"MANAGE_INSTITUTIONS"))return res.status(403).json({error:"Managing institution profile details requires MANAGE_INSTITUTIONS"});
  const profileKey=current.candidate?"candidate":current.employer?"employer":current.institution?"institution":null;
  if ((p.data.candidate && profileKey!=="candidate") || (p.data.employer && profileKey!=="employer") || (p.data.institution && profileKey!=="institution")) return res.status(400).json({error:"Profile fields do not match this account type"});
  const updated = await prisma.$transaction(async tx=>{
    const u=await tx.user.update({where:{id:current.id},data:{...(p.data.fullName?{fullName:p.data.fullName}:{}),...(p.data.phone!==undefined?{phone:p.data.phone}:{}),...(p.data.phone!==undefined&&p.data.phone!==current.phone?{phoneVerifiedAt:null}:{})},select:{id:true,fullName:true,email:true,phone:true,role:true,isActive:true}});
    if(p.data.candidate&&current.candidate)await tx.candidate.update({where:{id:current.candidate.id},data:p.data.candidate});
    if(p.data.employer&&current.employer)await tx.employer.update({where:{id:current.employer.id},data:p.data.employer});
    if(p.data.institution&&current.institution)await tx.institution.update({where:{id:current.institution.id},data:p.data.institution});
    return u;
  });
  await audit(req,"ADMIN_ACCOUNT_EDITED","User",current.id,{previous:{fullName:current.fullName,phone:current.phone,profile:current.candidate||current.employer||current.institution},newValues:p.data});
  res.json({user:updated});
});
adminRouter.post("/users/:id/password-reset", permission("MANAGE_USERS"), async (req, res) => {
  const user=await prisma.user.findUnique({where:{id:String(req.params.id)},select:{id:true,email:true,isActive:true,sessionVersion:true}});
  if(!user)return res.status(404).json({error:"Account not found"});
  if(!user.isActive)return res.status(409).json({error:"Activate the account before requesting a password reset"});
  try {
    const token=signPasswordResetToken(user);const url=new URL("/account/security/reset",config.webOrigin);url.searchParams.set("token",token);
    await getEmailProvider().send({to:user.email,subject:"Reset your Jobinfo India password",text:`An administrator requested a password reset for your account. Use this secure link once within 30 minutes:\n\n${url.toString()}`});
    await audit(req,"ADMIN_PASSWORD_RESET_SENT","User",user.id);
    res.json({ok:true,message:"A secure, single-use password reset link was sent to the account email."});
  } catch { res.status(503).json({error:"Password reset email could not be delivered. Configure the email provider and try again."}); }
});
adminRouter.get("/users/:id/resume", permission("MANAGE_USERS"), async (req,res) => {
  const candidate=await prisma.candidate.findUnique({where:{userId:String(req.params.id)},select:{resumeUrl:true}});
  if(!candidate?.resumeUrl)return res.status(404).json({error:"No resume is available for this candidate"});
  try { const file=await getResumeStorage().read(candidate.resumeUrl);res.setHeader("Content-Type",file.contentType);res.setHeader("Content-Length",file.bytes.length);res.setHeader("Content-Disposition",`inline; filename="${file.fileName.replace(/[\\r\\n"\\\\]/g,"_")}"`);res.setHeader("Cache-Control","private, no-store");res.setHeader("X-Content-Type-Options","nosniff");res.send(file.bytes);await audit(req,"CANDIDATE_RESUME_VIEWED","User",String(req.params.id)); }
  catch { res.status(404).json({error:"Resume file is unavailable"}); }
});
adminRouter.get("/users/:id/photo", permission("MANAGE_USERS"), async (req,res) => {
  const candidate=await prisma.candidate.findUnique({where:{userId:String(req.params.id)},select:{profilePhotoKey:true}});
  if(!candidate?.profilePhotoKey)return res.status(404).json({error:"No profile photo is available"});
  try { const file=await getResumeStorage().read(candidate.profilePhotoKey);if(!file.contentType.startsWith("image/"))return res.status(415).json({error:"Stored profile photo has an unsupported format"});res.setHeader("Content-Type",file.contentType);res.setHeader("Content-Length",file.bytes.length);res.setHeader("Content-Disposition","inline");res.setHeader("Cache-Control","private, no-store");res.setHeader("X-Content-Type-Options","nosniff");res.send(file.bytes);await audit(req,"CANDIDATE_PHOTO_VIEWED","User",String(req.params.id)); }
  catch { res.status(404).json({error:"Profile photo is unavailable"}); }
});
adminRouter.get("/billing/assignable-plans", permission("MANAGE_BILLING"), async (_req,res) => {
  res.json({data:await prisma.subscriptionPlan.findMany({where:{active:true,amountPaise:0},orderBy:[{audience:"asc"},{name:"asc"}],select:{code:true,audience:true,name:true,durationDays:true,limits:true}})});
});
adminRouter.post("/users/:id/subscription", permission("MANAGE_BILLING"), async (req,res) => {
  const p=z.object({planCode:z.string().trim().min(1).max(50),reason:z.string().trim().min(5).max(500)}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:p.error.issues[0].message});
  const [user,plan]=await Promise.all([prisma.user.findUnique({where:{id:String(req.params.id)},include:{employer:{select:{recruiterType:true}},institution:{select:{id:true}}}}),prisma.subscriptionPlan.findUnique({where:{code:p.data.planCode}})]);
  if(!user)return res.status(404).json({error:"Account not found"});if(!plan||!plan.active)return res.status(404).json({error:"Active subscription plan not found"});
  const audience=user.role==="INSTITUTION"?"INSTITUTION":user.role==="RECRUITER"?(user.employer?.recruiterType||"CORPORATE"):null;
  if(!audience||plan.audience!==audience)return res.status(400).json({error:"This plan is not available for the account type"});
  if(plan.amountPaise>0)return res.status(402).json({error:"Paid plans can only be activated by a confirmed payment. Assigning unpaid plans is not allowed."});
  const startsAt=new Date(),endsAt=new Date(startsAt.getTime()+plan.durationDays*86400000);
  const subscription=await prisma.$transaction(async tx=>{
    await tx.subscription.updateMany({where:{userId:user.id,status:"ACTIVE"},data:{status:"CANCELLED"}});
    return tx.subscription.create({data:{userId:user.id,planCode:plan.code,audience:plan.audience,status:"ACTIVE",amountPaise:0,currency:"INR",durationDays:plan.durationDays,limits:plan.limits as Prisma.InputJsonValue,startedAt:startsAt,endsAt}});
  });
  await audit(req,"ADMIN_FREE_PLAN_ASSIGNED","Subscription",subscription.id,{userId:user.id,planCode:plan.code,reason:p.data.reason});res.status(201).json({subscription});
});
adminRouter.patch("/subscriptions/:id", permission("MANAGE_BILLING"), async (req,res) => {
  const p=z.object({action:z.enum(["EXTEND","CANCEL"]),days:z.number().int().min(1).max(3650).optional(),reason:z.string().trim().min(5).max(500)}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:p.error.issues[0].message});if(p.data.action==="EXTEND"&&!p.data.days)return res.status(400).json({error:"Choose an extension duration"});
  const current=await prisma.subscription.findUnique({where:{id:String(req.params.id)}});if(!current)return res.status(404).json({error:"Subscription not found"});
  if(p.data.action==="CANCEL"&&current.status!=="ACTIVE")return res.status(409).json({error:"Only active subscriptions can be cancelled"});
  if(p.data.action==="EXTEND"&&["CANCELLED","PENDING"].includes(current.status))return res.status(409).json({error:"Cancelled or pending subscriptions cannot be extended"});
  const data=p.data.action==="CANCEL"?{status:"CANCELLED"}:{status:"ACTIVE",startedAt:current.startedAt||new Date(),endsAt:new Date(Math.max(current.endsAt?.getTime()||0,Date.now())+(p.data.days||0)*86400000)};
  const subscription=await prisma.subscription.update({where:{id:current.id},data});
  await audit(req,`ADMIN_SUBSCRIPTION_${p.data.action}`,"Subscription",current.id,{previousStatus:current.status,newStatus:subscription.status,previousEndsAt:current.endsAt,newEndsAt:subscription.endsAt,reason:p.data.reason});
  res.json({subscription});
});
adminRouter.get("/registrations", permission("MANAGE_REGISTRATIONS"), async (_req, res) => {
  const [recruiters, institutions] = await Promise.all([
    prisma.employer.findMany({ where: { verificationStatus:{in:["PENDING","REJECTED"]} }, include: { user: { select: { id: true, fullName: true, email: true, emailVerifiedAt: true, isActive: true } } }, orderBy: { user: { createdAt: "asc" } } }),
    prisma.institution.findMany({ where: { verificationStatus:{in:["PENDING","REJECTED"]},deletedAt:null }, include: { user: { select: { id: true, fullName: true, email: true, emailVerifiedAt: true, isActive: true } } }, orderBy: { name: "asc" } }),
  ]);
  res.json({ recruiters, institutions });
});
adminRouter.patch("/employers/:id/verify", permission("MANAGE_REGISTRATIONS"), async (req, res) => {
  const p = z.object({verified:z.boolean().optional(),decision:z.enum(["APPROVE","REJECT","REVOKE"]).optional(),reason:z.string().trim().max(500).optional()}).refine(x=>x.verified!==undefined||x.decision!==undefined).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message||"Choose an approval decision" });
  const decision=p.data.decision||(p.data.verified?"APPROVE":"REVOKE");
  if(decision!=="APPROVE"&&!p.data.reason)return res.status(400).json({error:"Provide a reason when rejecting or revoking company verification"});
  const previous=await prisma.employer.findUnique({where:{id:String(req.params.id)},select:{id:true,verified:true,verificationStatus:true,userId:true,name:true}});
  if(!previous)return res.status(404).json({error:"Recruiter company not found"});
  const verified=decision==="APPROVE",status=verified?"APPROVED":decision==="REJECT"?"REJECTED":"REVOKED";
  const employer = await prisma.employer.update({ where: { id: previous.id }, data: { verified,verificationStatus:status,verificationReason:verified?null:p.data.reason,verificationUpdatedAt:new Date() } });
  await audit(req,`RECRUITER_COMPANY_${status}`,"Employer",employer.id,{previousStatus:previous.verificationStatus,newStatus:status,reason:p.data.reason||null});
  await notifyUser({userId:previous.userId,title:verified?"Company verified":"Company verification updated",body:verified?`${previous.name} has been verified.`:`${previous.name} verification ${status.toLowerCase()}: ${p.data.reason}`,emailSubject:"Recruiter verification update"});
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
  const [transactions, postingTransactions, subscriptions, cases, payments, posts, invoices] = await Promise.all([
    prisma.paymentTransaction.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.jobPostingTransaction.findMany({ include: { plan: { select: { name: true } }, user: { select: { email: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.subscription.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, userId: true, planCode: true, status: true, amountPaise: true, currency: true, createdAt: true, endsAt: true } }),
    prisma.billingCase.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.paymentTransaction.findMany({ where: { status: { in: ["PAID", "PARTIALLY_REFUNDED"] } }, select: { amountPaise: true, taxPaise: true, refundedPaise: true } }),
    prisma.jobPostingTransaction.findMany({ where: { status: { in: ["PAID", "PARTIALLY_REFUNDED"] } }, select: { amountPaise: true, taxPaise: true, refundedPaise: true } }),
    prisma.taxInvoice.findMany({include:{user:{select:{email:true,fullName:true}}},orderBy:{issuedAt:"desc"},take:100}),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set([...transactions.map((x) => x.userId), ...subscriptions.map((x) => x.userId)])] } }, select: { id: true, email: true } });
  const emails = new Map(users.map((x) => [x.id, x.email]));
  const netRevenue = [...payments, ...posts].reduce((total, item) => total + Math.max(0, item.amountPaise - item.taxPaise - item.refundedPaise), 0);
  const gstCollectedPaise = [...payments, ...posts].reduce((total, item) => total + Math.max(0, item.taxPaise - (item.refundedPaise >= item.amountPaise ? item.taxPaise : 0)), 0);
  res.json({ revenuePaise: netRevenue, gstCollectedPaise, paidCount: payments.length + posts.length, transactions: transactions.map((x) => ({ ...x, userEmail: emails.get(x.userId) || "" })), postingTransactions, subscriptions: subscriptions.map((x) => ({ ...x, userEmail: emails.get(x.userId) || "" })), invoices, cases });
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
  if(["RESOLVED","REJECTED"].includes(p.data.status)&&!p.data.resolution?.trim())return res.status(400).json({error:"A resolution or rejection reason is required"});
  const previous=await prisma.billingCase.findUnique({where:{id:String(req.params.id)}});if(!previous)return res.status(404).json({error:"Billing case not found"});
  const record = await prisma.billingCase.update({ where: { id: previous.id }, data: p.data }); await audit(req, "BILLING_CASE_UPDATED", "BillingCase", record.id, { previousStatus:previous.status,status: record.status,reason:record.resolution });
  if(record.userId)await notifyUser({userId:record.userId,title:`Billing case ${record.status.toLowerCase()}`,body:`${record.reason}${record.resolution?`\n\nResolution: ${record.resolution}`:""}`,emailSubject:"Billing case update"});
  res.json({ case: record });
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
adminRouter.get("/capabilities",async(req,res)=>{
  const allowed=await Promise.all(adminPermissions.map(async name=>[name,await hasPermission(req,name)] as const));res.json({permissions:allowed.filter(([,enabled])=>enabled).map(([name])=>name)});
});
adminRouter.get("/access-matrix", permission("MANAGE_USERS"), async (_req, res) => {
  const stored = await prisma.rolePermission.findMany();
  res.json({ data: adminPermissions.map((name) => ({ name, enabled: stored.find((x) => x.role === "ADMIN" && x.permission === name)?.enabled ?? true })) });
});
adminRouter.put("/access-matrix", permission("MANAGE_USERS"), async (req, res) => {
  const p = z.object({ entries: z.array(z.object({ permission: z.enum(["MANAGE_USERS", "MANAGE_REGISTRATIONS", "MODERATE_JOBS", "MANAGE_INSTITUTIONS", "MANAGE_PRICING", "MANAGE_BILLING", "MANAGE_CMS", "MANAGE_TEMPLATES", "MANAGE_INTEGRATIONS", "VIEW_REPORTS", "VIEW_AUDIT"]), enabled: z.boolean() })).max(100) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  await prisma.$transaction(p.data.entries.map((entry) => prisma.rolePermission.upsert({ where: { role_permission: { role: "ADMIN", permission: entry.permission } }, create: { ...entry, role: "ADMIN", updatedById: userOf(req).id }, update: { enabled: entry.enabled, updatedById: userOf(req).id } })));
  await audit(req, "ACCESS_MATRIX_UPDATED", "RolePermission", undefined, { count: p.data.entries.length });
  res.json({ ok: true });
});
adminRouter.patch("/users/:id/status", permission("MANAGE_USERS"), async (req,res) => {
  const p=z.object({isActive:z.boolean(),reason:z.string().trim().max(500).optional()}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:p.error.issues[0].message});
  if(!p.data.isActive&&!p.data.reason)return res.status(400).json({error:"A reason is required when suspending an account"});
  if (!p.data.isActive && String(req.params.id) === userOf(req).id) return res.status(409).json({ error: "You cannot suspend your own admin account" });
  const target = await prisma.user.findUnique({ where: { id: String(req.params.id) }, select: { id:true,role: true, isActive: true,deletedAt:true } });
  if (!target) return res.status(404).json({error:"Account not found"});
  if(target.deletedAt)return res.status(409).json({error:"Soft-deleted accounts cannot be reactivated. Contact platform support if this was a mistake."});
  if (!p.data.isActive && target.role === "ADMIN" && target.isActive && await prisma.user.count({ where: { role: "ADMIN", isActive: true } }) <= 1) return res.status(409).json({ error: "The last active admin account cannot be suspended" });
  const user=await prisma.user.update({where:{id:target.id},data:{isActive:p.data.isActive,sessionVersion:{increment:1}},select:{id:true,isActive:true}});
  await audit(req, p.data.isActive ? "USER_RESTORED" : "USER_SUSPENDED", "User", user.id,{previousStatus:target.isActive?"ACTIVE":"SUSPENDED",newStatus:p.data.isActive?"ACTIVE":"SUSPENDED",reason:p.data.reason||null});
  await notifyUser({userId:user.id,title:p.data.isActive?"Account access restored":"Account suspended",body:p.data.isActive?"An administrator restored access to your Jobinfo India account.":`Your account has been suspended by an administrator. Reason: ${p.data.reason}`,emailSubject:p.data.isActive?"Account access restored":"Account suspended"});
  res.json({user});
});
adminRouter.post("/users/:id/delete", permission("MANAGE_USERS"), async (req,res) => {
  const id=String(req.params.id),p=z.object({confirmUserId:z.string().min(1),reason:z.string().trim().min(5).max(500)}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:p.error.issues[0].message});if(p.data.confirmUserId!==id)return res.status(400).json({error:"Confirmation account ID does not match"});if(id===userOf(req).id)return res.status(409).json({error:"You cannot delete your signed-in administrator account"});
  const target=await prisma.user.findUnique({where:{id},include:{candidate:{select:{id:true}},employer:{select:{id:true,verified:true,jobs:{where:{status:{in:["PUBLISHED","ACTIVE"]}},select:{id:true,status:true}}}},institution:{select:{id:true,verified:true}}}});
  if(!target)return res.status(404).json({error:"Account not found"});if(target.deletedAt)return res.status(409).json({error:"Account is already soft-deleted"});
  if(target.institution&&!await hasPermission(req,"MANAGE_INSTITUTIONS"))return res.status(403).json({error:"Deleting an institution account requires MANAGE_INSTITUTIONS"});
  if(target.role==="ADMIN"&&target.isActive&&await prisma.user.count({where:{role:"ADMIN",isActive:true,deletedAt:null}})<=1)return res.status(409).json({error:"The last active administrator cannot be deleted"});
  const deletedAt=new Date();
  await prisma.$transaction(async tx=>{
    await tx.user.update({where:{id},data:{deletedAt,deletionReason:p.data.reason,isActive:false,sessionVersion:{increment:1}}});
    if(target.candidate)await tx.candidate.update({where:{id:target.candidate.id},data:{searchable:false}});
    if(target.employer){await tx.employer.update({where:{id:target.employer.id},data:{verified:false,verificationStatus:"REVOKED",verificationReason:p.data.reason,verificationUpdatedAt:deletedAt}});if(target.employer.jobs.length){await tx.job.updateMany({where:{id:{in:target.employer.jobs.map(j=>j.id)}},data:{status:"PAUSED"}});await tx.jobStatusHistory.createMany({data:target.employer.jobs.map(j=>({jobId:j.id,previousStatus:j.status,newStatus:"PAUSED",changedById:userOf(req).id,reason:"Recruiter account soft-deleted"}))});}}
    if(target.institution){await tx.institution.update({where:{id:target.institution.id},data:{deletedAt,deletionReason:p.data.reason,verified:false,verificationStatus:"REVOKED",verificationReason:p.data.reason,verificationUpdatedAt:deletedAt}});await tx.institutionStudent.updateMany({where:{institutionId:target.institution.id},data:{recruiterVisible:false}});}
    await tx.auditLog.create({data:{actorId:userOf(req).id,action:"USER_SOFT_DELETED",entityType:"User",entityId:id,metadata:{role:target.role,reason:p.data.reason,previousActive:target.isActive,pausedJobIds:target.employer?.jobs.map(j=>j.id)||[]},ipAddress:req.ip}});
  });
  await notifyUser({userId:id,title:"Account deleted",body:`Your Jobinfo India account was soft-deleted by an administrator. Reason: ${p.data.reason}`,emailSubject:"Jobinfo India account update"});
  res.json({ok:true,status:"DELETED",deletedAt});
});
adminRouter.get("/jobs", permission("MODERATE_JOBS"), async (req,res) => {
  const status=z.enum(["DRAFT","PENDING_APPROVAL","PENDING_REVIEW","PUBLISHED","ACTIVE","PAUSED","CLOSED","EXPIRED","REJECTED","CHANGES_REQUESTED","ARCHIVED","ALL"]).safeParse(req.query.status),q=String(req.query.q||"").trim().slice(0,100),page=Math.max(1,Number(req.query.page)||1),pageSize=Math.min(100,Math.max(1,Number(req.query.pageSize)||50));
  const where:any={...(status.success?status.data==="ALL"?{}:{status:status.data}:{status:{in:["PENDING_REVIEW","PENDING_APPROVAL"]}}),...(q?{OR:[{title:{contains:q,mode:"insensitive"}},{jobReference:{contains:q,mode:"insensitive"}},{employer:{name:{contains:q,mode:"insensitive"}}}]}:{})};
  const [total,data]=await Promise.all([prisma.job.count({where}),prisma.job.findMany({where,include:{employer:{select:{id:true,name:true,verified:true,userId:true,user:{select:{fullName:true,email:true}}}},skills:true,requirements:true,benefits:true,statusHistory:{orderBy:{createdAt:"desc"},take:5}},orderBy:{createdAt:"desc"},skip:(page-1)*pageSize,take:pageSize})]);
  res.json({data:data.map(job=>({...job,jobOverview:sanitizeJobDescriptionHtml(job.jobOverview||job.description)})),page,pageSize,total});
});
adminRouter.get("/institutions", permission("MANAGE_INSTITUTIONS"), async (req, res) => {
  const q=String(req.query.q||"").trim().slice(0,100),verified=z.enum(["VERIFIED","PENDING"]).safeParse(req.query.verification);
  const data = await prisma.institution.findMany({where:{deletedAt:null,...(verified.success?{verified:verified.data==="VERIFIED"}:{}),...(q?{OR:[{name:{contains:q,mode:"insensitive"}},{city:{contains:q,mode:"insensitive"}},{state:{contains:q,mode:"insensitive"}},{user:{email:{contains:q,mode:"insensitive"}}}]}:{})},include:{ user: { select: { id:true,email: true, fullName: true,isActive:true,createdAt:true } },departments:true,courses:true, _count: { select: { students: true } } }, orderBy: [{ verified: "asc" }, { name: "asc" }] });
  res.json({ data });
});
adminRouter.get("/institutions/:id/documents/:category/:index", permission("MANAGE_INSTITUTIONS"), async (req,res)=>{
  const category=z.enum(["logo","registration","accreditation","affiliation"]).safeParse(req.params.category),index=Number(req.params.index);if(!category.success||!Number.isInteger(index)||index<0)return res.status(400).json({error:"Invalid document reference"});
  const institution=await prisma.institution.findFirst({where:{id:String(req.params.id),deletedAt:null},select:{id:true,logoKey:true,registrationDocumentKeys:true,accreditationDocumentKeys:true,affiliationDocumentKeys:true}});if(!institution)return res.status(404).json({error:"Institution not found"});
  const keys=category.data==="logo"?(institution.logoKey?[institution.logoKey]:[]):category.data==="registration"?institution.registrationDocumentKeys:category.data==="accreditation"?institution.accreditationDocumentKeys:institution.affiliationDocumentKeys;const key=keys[index];if(!key)return res.status(404).json({error:"Verification document not found"});
  try{const file=await getResumeStorage().read(key);res.setHeader("Content-Type",file.contentType);res.setHeader("Content-Length",file.bytes.length);res.setHeader("Content-Disposition",`inline; filename="${file.fileName.replace(/[\\r\\n"\\\\]/g,"_")}"`);res.setHeader("Cache-Control","private, no-store");res.setHeader("X-Content-Type-Options","nosniff");res.send(file.bytes);await audit(req,"INSTITUTION_VERIFICATION_DOCUMENT_VIEWED","Institution",institution.id,{category:category.data,index});}catch{res.status(404).json({error:"Verification document is unavailable"});}
});
adminRouter.post("/institutions/:id/departments", permission("MANAGE_INSTITUTIONS"), async (req,res)=>{
  const p=z.object({name:z.string().trim().min(2).max(120)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:p.error.issues[0].message});
  const institution=await prisma.institution.findFirst({where:{id:String(req.params.id),deletedAt:null},select:{id:true}});if(!institution)return res.status(404).json({error:"Active institution not found"});
  const exists=await prisma.department.findFirst({where:{institutionId:institution.id,name:{equals:p.data.name,mode:"insensitive"}}});if(exists)return res.status(409).json({error:"Department already exists"});
  const department=await prisma.department.create({data:{institutionId:institution.id,name:p.data.name}});await audit(req,"INSTITUTION_DEPARTMENT_CREATED","Department",department.id,{institutionId:institution.id,name:department.name});res.status(201).json({department});
});
adminRouter.patch("/institutions/:id/departments/:departmentId", permission("MANAGE_INSTITUTIONS"), async (req,res)=>{
  const p=z.object({name:z.string().trim().min(2).max(120)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:p.error.issues[0].message});
  const old=await prisma.department.findFirst({where:{id:String(req.params.departmentId),institutionId:String(req.params.id)}});if(!old)return res.status(404).json({error:"Department not found"});
  const department=await prisma.department.update({where:{id:old.id},data:{name:p.data.name}});await audit(req,"INSTITUTION_DEPARTMENT_UPDATED","Department",department.id,{previousName:old.name,newName:department.name});res.json({department});
});
adminRouter.delete("/institutions/:id/departments/:departmentId", permission("MANAGE_INSTITUTIONS"), async (req,res)=>{
  const p=z.object({reason:z.string().trim().min(5).max(500)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:p.error.issues[0].message});
  const old=await prisma.department.findFirst({where:{id:String(req.params.departmentId),institutionId:String(req.params.id)}});if(!old)return res.status(404).json({error:"Department not found"});
  await prisma.department.delete({where:{id:old.id}});await audit(req,"INSTITUTION_DEPARTMENT_DELETED","Department",old.id,{name:old.name,institutionId:old.institutionId,reason:p.data.reason});res.json({ok:true});
});
adminRouter.post("/institutions/:id/courses", permission("MANAGE_INSTITUTIONS"), async (req,res)=>{
  const p=z.object({name:z.string().trim().min(2).max(150)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:p.error.issues[0].message});
  const institution=await prisma.institution.findFirst({where:{id:String(req.params.id),deletedAt:null},select:{id:true}});if(!institution)return res.status(404).json({error:"Active institution not found"});
  const exists=await prisma.institutionCourse.findFirst({where:{institutionId:institution.id,name:{equals:p.data.name,mode:"insensitive"}}});if(exists)return res.status(409).json({error:"Course already exists"});
  const course=await prisma.institutionCourse.create({data:{institutionId:institution.id,name:p.data.name}});await audit(req,"INSTITUTION_COURSE_CREATED","InstitutionCourse",course.id,{institutionId:institution.id,name:course.name});res.status(201).json({course});
});
adminRouter.patch("/institutions/:id/courses/:courseId", permission("MANAGE_INSTITUTIONS"), async (req,res)=>{
  const p=z.object({name:z.string().trim().min(2).max(150)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:p.error.issues[0].message});
  const old=await prisma.institutionCourse.findFirst({where:{id:String(req.params.courseId),institutionId:String(req.params.id)}});if(!old)return res.status(404).json({error:"Course not found"});
  const course=await prisma.institutionCourse.update({where:{id:old.id},data:{name:p.data.name}});await audit(req,"INSTITUTION_COURSE_UPDATED","InstitutionCourse",course.id,{previousName:old.name,newName:course.name});res.json({course});
});
adminRouter.delete("/institutions/:id/courses/:courseId", permission("MANAGE_INSTITUTIONS"), async (req,res)=>{
  const p=z.object({reason:z.string().trim().min(5).max(500)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:p.error.issues[0].message});
  const old=await prisma.institutionCourse.findFirst({where:{id:String(req.params.courseId),institutionId:String(req.params.id)}});if(!old)return res.status(404).json({error:"Course not found"});
  await prisma.institutionCourse.delete({where:{id:old.id}});await audit(req,"INSTITUTION_COURSE_DELETED","InstitutionCourse",old.id,{name:old.name,institutionId:old.institutionId,reason:p.data.reason});res.json({ok:true});
});
adminRouter.get("/institutions/:id/placement-report.csv", permission("MANAGE_INSTITUTIONS"), async (req,res)=>{
  const institution=await prisma.institution.findFirst({where:{id:String(req.params.id),deletedAt:null},select:{id:true,name:true}});if(!institution)return res.status(404).json({error:"Institution not found"});
  const rows=await prisma.institutionStudent.groupBy({by:["passingYear","department","placementStatus"],where:{institutionId:institution.id},_count:{_all:true},orderBy:[{passingYear:"desc"},{department:"asc"},{placementStatus:"asc"}]});
  const cell=(x:unknown)=>`"${String(x??"").replace(/"/g,'""')}"`;const csv=["Institution,Passing Year,Department,Placement Status,Students",...rows.map(x=>[institution.name,x.passingYear,x.department,x.placementStatus,x._count._all].map(cell).join(","))].join("\r\n");
  await audit(req,"INSTITUTION_PLACEMENT_REPORT_EXPORTED","Institution",institution.id,{groupCount:rows.length});res.setHeader("Content-Type","text/csv; charset=utf-8");res.setHeader("Content-Disposition",`attachment; filename="${institution.name.replace(/[^a-z0-9]+/gi,"-")}-placement-report.csv"`);res.setHeader("Cache-Control","private, no-store");res.send(`\uFEFF${csv}`);
});
adminRouter.post("/institutions/:id/delete", permission("MANAGE_INSTITUTIONS"), async (req,res)=>{
  const id=String(req.params.id),p=z.object({confirmInstitutionId:z.string().min(1),reason:z.string().trim().min(5).max(500)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:p.error.issues[0].message});if(p.data.confirmInstitutionId!==id)return res.status(400).json({error:"Confirmation institution ID does not match"});
  const institution=await prisma.institution.findUnique({where:{id},select:{id:true,name:true,userId:true,deletedAt:true}});if(!institution)return res.status(404).json({error:"Institution not found"});if(institution.deletedAt)return res.status(409).json({error:"Institution is already deleted"});const deletedAt=new Date();
  await prisma.$transaction(async tx=>{await tx.institution.update({where:{id},data:{deletedAt,deletionReason:p.data.reason,verified:false,verificationStatus:"REVOKED",verificationReason:p.data.reason,verificationUpdatedAt:deletedAt}});await tx.institutionStudent.updateMany({where:{institutionId:id},data:{recruiterVisible:false}});if(institution.userId)await tx.user.update({where:{id:institution.userId},data:{deletedAt,deletionReason:p.data.reason,isActive:false,sessionVersion:{increment:1}}});await tx.auditLog.create({data:{actorId:userOf(req).id,action:"INSTITUTION_SOFT_DELETED",entityType:"Institution",entityId:id,metadata:{name:institution.name,userId:institution.userId,reason:p.data.reason},ipAddress:req.ip}})});
  if(institution.userId)await notifyUser({userId:institution.userId,title:"Institution account deleted",body:`${institution.name} was soft-deleted by an administrator. Reason: ${p.data.reason}`,emailSubject:"Institution account update"});
  res.json({ok:true,status:"DELETED",deletedAt});
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
adminRouter.patch("/jobs/:id", permission("MODERATE_JOBS"), async (req,res)=>{
  const p=z.object({title:z.string().trim().min(3).max(150).optional(),location:z.string().trim().min(2).max(250).optional(),category:z.string().trim().max(100).nullable().optional(),employmentType:z.string().max(80).nullable().optional(),experienceMin:z.number().int().min(0).max(60).nullable().optional(),experienceMax:z.number().int().min(0).max(60).nullable().optional(),openings:z.number().int().min(1).max(100000).optional(),jobOverview:z.string().max(50000).optional(),reason:z.string().trim().min(5).max(500)}).strict().safeParse(req.body);
  if(!p.success)return res.status(400).json({error:p.error.issues[0].message});
  if(p.data.experienceMin!=null&&p.data.experienceMax!=null&&p.data.experienceMax<p.data.experienceMin)return res.status(400).json({error:"Maximum experience cannot be lower than minimum experience"});
  const current=await prisma.job.findUnique({where:{id:String(req.params.id)},select:{id:true,title:true,location:true,category:true,employmentType:true,experienceMin:true,experienceMax:true,openings:true,jobOverview:true,description:true,status:true,employerId:true,jobReference:true,employer:{select:{userId:true}}}});
  if(!current)return res.status(404).json({error:"Job not found"});
  const safeOverview=p.data.jobOverview===undefined?undefined:sanitizeJobDescriptionHtml(p.data.jobOverview);
  if(safeOverview!==undefined&&jobDescriptionPlainText(safeOverview).length<20)return res.status(400).json({error:"Job overview must contain at least 20 readable characters"});
  const {reason,...fields}=p.data;const title=fields.title||current.title;
  const updated=await prisma.$transaction(async tx=>{
    const job=await tx.job.update({where:{id:current.id},data:{...fields,jobOverview:safeOverview,description:safeOverview?jobDescriptionPlainText(safeOverview):undefined,...(current.status==="PUBLISHED"||current.status==="ACTIVE"?{slug:`${title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}-${(current.jobReference||current.id).toLowerCase()}`}:{})}});
    await tx.auditLog.create({data:{actorId:userOf(req).id,action:"ADMIN_JOB_EDITED",entityType:"Job",entityId:job.id,metadata:{previous:{title:current.title,location:current.location,category:current.category,employmentType:current.employmentType,experienceMin:current.experienceMin,experienceMax:current.experienceMax,openings:current.openings,jobOverview:current.jobOverview},newValues:fields,reason},ipAddress:req.ip}});
    return job;
  });
  await notifyUser({userId:current.employer.userId,title:"Job listing edited by platform administrator",body:`${current.title}: ${reason}`,emailSubject:"Update to your job listing"});res.json({job:updated});
});
adminRouter.post("/jobs/:id/action", permission("MODERATE_JOBS"), async (req,res) => {
  const p=z.object({action:z.enum(["UNPUBLISH","CLOSE","REOPEN","ARCHIVE"]),reason:z.string().trim().min(5).max(500)}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:p.error.issues[0].message});
  const job=await prisma.job.findUnique({where:{id:String(req.params.id)},include:{employer:{select:{userId:true}}}});
  if(!job)return res.status(404).json({error:"Job not found"});
  const allowed:Record<string,string[]>={UNPUBLISH:["PUBLISHED","ACTIVE"],CLOSE:["PUBLISHED","ACTIVE","PAUSED","EXPIRED"],REOPEN:["CLOSED","ARCHIVED","EXPIRED","REJECTED","CHANGES_REQUESTED"],ARCHIVE:["DRAFT","PENDING_APPROVAL","PENDING_REVIEW","PUBLISHED","ACTIVE","PAUSED","CLOSED","REJECTED","EXPIRED","CHANGES_REQUESTED"]};
  if(!allowed[p.data.action].includes(job.status))return res.status(409).json({error:`${p.data.action.toLowerCase()} is not allowed for a ${job.status.toLowerCase()} job`});
  const next:Record<string,string>={UNPUBLISH:"PAUSED",CLOSE:"CLOSED",REOPEN:"PENDING_REVIEW",ARCHIVE:"ARCHIVED"};
  const updated=await prisma.$transaction(async tx=>{
    const result=await tx.job.update({where:{id:job.id},data:{status:next[p.data.action] as any}});
    await tx.jobStatusHistory.create({data:{jobId:job.id,previousStatus:job.status,newStatus:next[p.data.action] as any,changedById:userOf(req).id,reason:p.data.reason}});
    await tx.auditLog.create({data:{actorId:userOf(req).id,action:`JOB_${p.data.action}`,entityType:"Job",entityId:job.id,metadata:{previousStatus:job.status,newStatus:next[p.data.action],reason:p.data.reason},ipAddress:req.ip}});
    return result;
  });
  if(job.employer?.userId)await notifyUser({userId:job.employer.userId,title:`Job ${p.data.action.toLowerCase()}`,body:`${job.title}: ${p.data.reason}`,emailSubject:`Job listing update: ${job.title}`});
  res.json({job:updated});
});
adminRouter.patch("/institutions/:id/verify", permission("MANAGE_INSTITUTIONS"), async (req,res) => {
  const p=z.object({verified:z.boolean().optional(),decision:z.enum(["APPROVE","REJECT","REVOKE"]).optional(),reason:z.string().trim().max(500).optional()}).refine(x=>x.verified!==undefined||x.decision!==undefined).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:p.error.issues[0]?.message||"Choose an approval decision"});
  const decision=p.data.decision||(p.data.verified?"APPROVE":"REVOKE");
  if(decision!=="APPROVE"&&!p.data.reason)return res.status(400).json({error:"Provide a reason when rejecting or revoking institution verification"});
  const previous=await prisma.institution.findUnique({where:{id:String(req.params.id)},select:{id:true,verified:true,verificationStatus:true,userId:true,name:true,deletedAt:true}});
  if(!previous)return res.status(404).json({error:"Institution not found"});
  if(previous.deletedAt)return res.status(409).json({error:"Deleted institutions cannot be verified"});
  const verified=decision==="APPROVE",status=verified?"APPROVED":decision==="REJECT"?"REJECTED":"REVOKED";
  const institution=await prisma.institution.update({where:{id:previous.id},data:{verified,verificationStatus:status,verificationReason:verified?null:p.data.reason,verificationUpdatedAt:new Date()}});
  await audit(req,`INSTITUTION_${status}`,"Institution",institution.id,{previousStatus:previous.verificationStatus,newStatus:status,reason:p.data.reason||null});
  if(previous.userId)await notifyUser({userId:previous.userId,title:verified?"Institution verified":"Institution verification updated",body:verified?"Your institution account has been verified.":`Verification ${status.toLowerCase()}: ${p.data.reason}`,emailSubject:"Institution verification update"});
  res.json({institution});
});
adminRouter.get("/audit", permission("VIEW_AUDIT"), async (_req,res) => {
  const data=await prisma.auditLog.findMany({orderBy:{createdAt:"desc"},take:100});
  res.json({data});
});
