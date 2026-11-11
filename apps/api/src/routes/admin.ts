import { Router } from "express";
import { z } from "zod";
import { prisma } from "@jobinfo/database";
import { requireAuth, userOf } from "../auth";
import crypto from "node:crypto";
import { integrationStatus } from "../integrations/registry";
import { callCustomAi, customAiStatus, encryptApiKey } from "../integrations/custom-ai";
import { getPaymentProvider } from "../integrations/registry";

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
  const rule = await prisma.rolePermission.findUnique({ where: { role_permission: { role: "ADMIN", permission: name } } });
  if (rule && !rule.enabled) return res.status(403).json({ error: `Admin access is disabled for ${name}` });
  next();
};
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
  const [users,candidates,recruiters,institutions,jobs,pendingJobs,applications,subscriptions] = await Promise.all([
    prisma.user.count(), prisma.user.count({where:{role:"CANDIDATE"}}), prisma.user.count({where:{role:"RECRUITER"}}),
    prisma.institution.count(), prisma.job.count(), prisma.job.count({where:{status:{in:["PENDING_REVIEW","PENDING_APPROVAL"]}}}),
    prisma.application.count(), prisma.subscription.count({where:{status:"ACTIVE"}})
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
  res.json({ users,candidates,recruiters,institutions,jobs,pendingJobs,applications,activeSubscriptions:subscriptions,
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
  const data=await prisma.job.findMany({where:{status:{in:["PENDING_REVIEW","PENDING_APPROVAL"]}},include:{employer:{select:{name:true,verified:true}},skills:true,requirements:true,benefits:true},orderBy:{createdAt:"asc"}});
  res.json({data});
});
adminRouter.get("/institutions", permission("MANAGE_INSTITUTIONS"), async (_req, res) => {
  const data = await prisma.institution.findMany({ include: { user: { select: { email: true, fullName: true } }, _count: { select: { students: true } } }, orderBy: [{ verified: "asc" }, { name: "asc" }] });
  res.json({ data });
});
adminRouter.patch("/jobs/:id/review", permission("MODERATE_JOBS"), async (req,res) => {
  const p=z.object({decision:z.enum(["PUBLISHED","REJECTED"]),reason:z.string().max(500).optional()}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"Invalid review decision"});
  const existing=await prisma.job.findUnique({where:{id:String(req.params.id)},include:{postingTransactions:{where:{status:{in:["AUTHORIZED","PAID"]}},include:{plan:true},orderBy:{createdAt:"desc"},take:1}}});
  if(!existing)return res.status(404).json({error:"Job not found"});
  if(!["PENDING_APPROVAL","PENDING_REVIEW"].includes(existing.status))return res.status(409).json({error:"Only jobs awaiting review can be moderated"});
  if(p.data.decision==="PUBLISHED"&&existing.postingPlanCode&&!existing.postingTransactions[0])return res.status(402).json({error:"No valid posting entitlement exists for this job"});
  if(p.data.decision==="PUBLISHED"&&!existing.employerId)return res.status(409).json({error:"Job has no company profile"});
  const next=p.data.decision;
  const plan=existing.postingTransactions[0]?.plan;
  const slug=next==="PUBLISHED"?`${existing.title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}-${(existing.jobReference||crypto.randomUUID()).toLowerCase()}`:existing.slug;
  const job=await prisma.$transaction(async(tx)=>{
    const updated=await tx.job.update({where:{id:existing.id},data:{status:next,slug,publishedAt:next==="PUBLISHED"?new Date():existing.publishedAt,expiresAt:next==="PUBLISHED"?new Date(Date.now()+(plan?.durationDays||30)*86400000):existing.expiresAt}});
    await tx.jobStatusHistory.create({data:{jobId:existing.id,previousStatus:existing.status,newStatus:next,changedById:userOf(req).id,reason:p.data.reason||null}});
    await tx.auditLog.create({data:{actorId:userOf(req).id,action:`JOB_${next}`,entityType:"Job",entityId:existing.id,metadata:{reason:p.data.reason||null,jobReference:job.jobReference}}});
    return updated;
  });
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
