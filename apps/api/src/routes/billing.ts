import { Router } from "express";
import { z } from "zod";
import { prisma } from "@jobinfo/database";
import { requireAuth, userOf } from "../auth";
import { getPaymentProvider } from "../integrations/registry";
import { config } from "../config";
import { settlePayment, taxFor } from "../billing/settlement";

export const billingRouter = Router();
const defaultPlans = [
  { code: "FREELANCE_BASIC", audience: "FREELANCE", name: "Basic", description: "Basic freelancer tools", amountPaise: 0, durationDays: 30, features: ["Recruiter profile", "Limited job posts"] },
  { code: "FREELANCE_PRO", audience: "FREELANCE", name: "Professional", description: "For independent recruiters", amountPaise: 99900, durationDays: 30, features: ["More job posts", "Candidate search"] },
  { code: "CORPORATE_GROWTH", audience: "CORPORATE", name: "Growth", description: "For hiring teams", amountPaise: 299900, durationDays: 30, features: ["Company profile", "Job management", "Candidate search"] },
  { code: "INSTITUTION_STANDARD", audience: "INSTITUTION", name: "Institution Standard", description: "Placement and student recruitment tools", amountPaise: 199900, durationDays: 365, features: ["Student roster", "Placement tracking", "Recruiter visibility"] },
];

billingRouter.get("/plans", async (_req, res) => {
  const [configured, configuredAudiences] = await Promise.all([prisma.subscriptionPlan.findMany({ where: { active: true }, orderBy: { amountPaise: "asc" } }), prisma.subscriptionPlan.findMany({ distinct: ["audience"], select: { audience: true } })]);
  const data = [...configured, ...defaultPlans.filter((plan) => !configuredAudiences.some((x) => x.audience === plan.audience))];
  res.json({ data, currency: "INR", gstRateBps: taxFor(10000).rateBps, tax: "GST is calculated and added at checkout; invoices are issued after provider-verified payment." });
});

const profileSchema = z.object({ legalName: z.string().trim().min(2).max(180), gstin: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/).optional().or(z.literal("")), address: z.string().trim().min(5).max(300), city: z.string().trim().min(2).max(100), state: z.string().trim().min(2).max(100), postalCode: z.string().trim().min(4).max(12) });
billingRouter.get("/profile", requireAuth("RECRUITER", "INSTITUTION"), async (req, res) => res.json({ profile: await prisma.billingProfile.findUnique({ where: { userId: userOf(req).id } }) }));
billingRouter.put("/profile", requireAuth("RECRUITER", "INSTITUTION"), async (req, res) => {
  const p = profileSchema.safeParse(req.body); if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const profile = await prisma.billingProfile.upsert({ where: { userId: userOf(req).id }, create: { userId: userOf(req).id, ...p.data, gstin: p.data.gstin || null }, update: { ...p.data, gstin: p.data.gstin || null } });
  res.json({ profile });
});

billingRouter.post("/free", requireAuth("RECRUITER", "INSTITUTION"), async (req, res) => {
  const p = z.object({ planCode: z.string().min(3) }).safeParse(req.body); if (!p.success) return res.status(400).json({ error: "Select a valid free plan" });
  const user = userOf(req); const configured = await prisma.subscriptionPlan.findUnique({ where: { code: p.data.planCode } });
  const audience = user.role === "INSTITUTION" ? "INSTITUTION" : (await prisma.employer.findUnique({ where: { userId: user.id }, select: { recruiterType: true } }))?.recruiterType;
  const configuredAudienceCount = await prisma.subscriptionPlan.count({ where: { audience: audience || "" } });
  const fallback = defaultPlans.find(x => x.code === p.data.planCode); const plan: any = configured || (configuredAudienceCount === 0 ? fallback : undefined);
  if (!plan || (configured && !configured.active) || plan.amountPaise !== 0 || plan.audience !== audience) return res.status(404).json({ error: "Free plan is unavailable for this account type" });
  const now = new Date(); await prisma.subscription.updateMany({ where: { userId: user.id, status: "ACTIVE", endsAt: { lte: now } }, data: { status: "EXPIRED" } });
  const existing = await prisma.subscription.findFirst({ where: { userId: user.id, status: "ACTIVE", endsAt: { gt: now } } });
  if (existing) return res.status(409).json({ error: "An active subscription already exists" });
  const subscription = await prisma.subscription.create({ data: { userId: user.id, planCode: plan.code, audience, durationDays: plan.durationDays, limits: plan.limits || {}, amountPaise: 0, status: "ACTIVE", startedAt: now, endsAt: new Date(now.getTime() + plan.durationDays * 86400000) } });
  res.status(201).json({ subscription });
});

billingRouter.get("/mine", requireAuth("RECRUITER", "INSTITUTION"), async (req, res) => {
  const userId = userOf(req).id; const now = new Date();
  await prisma.subscription.updateMany({ where: { userId, status: "ACTIVE", endsAt: { lte: now } }, data: { status: "EXPIRED" } });
  const [data, invoices] = await Promise.all([prisma.subscription.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 }), prisma.taxInvoice.findMany({ where: { userId }, orderBy: { issuedAt: "desc" }, take: 50 })]);
  res.json({ data, invoices });
});

billingRouter.post("/checkout", requireAuth("RECRUITER", "INSTITUTION"), async (req, res) => {
  const p = z.object({ planCode: z.string().min(3), returnUrl: z.string().url().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Select a valid subscription plan." });
  const user = userOf(req); const profile = await prisma.billingProfile.findUnique({ where: { userId: user.id } });
  if (!profile) return res.status(409).json({ error: "Add your billing name and address before checkout." });
  const configuredPlan = await prisma.subscriptionPlan.findUnique({ where: { code: p.data.planCode } });
  if (configuredPlan && !configuredPlan.active) return res.status(404).json({ error: "Plan is not currently available." });
  const fallback = defaultPlans.find(x => x.code === p.data.planCode);
  const configuredAudienceCount = fallback ? await prisma.subscriptionPlan.count({ where: { audience: fallback.audience } }) : 0;
  const plan: any = configuredPlan || (configuredAudienceCount === 0 ? fallback : undefined);
  if (!plan) return res.status(404).json({ error: "Plan not found." });
  const audience = user.role === "INSTITUTION" ? "INSTITUTION" : (await prisma.employer.findUnique({ where: { userId: user.id }, select: { recruiterType: true } }))?.recruiterType;
  if (!audience || plan.audience !== audience) return res.status(403).json({ error: "This plan is not available for your account type." });
  if (plan.amountPaise === 0) return res.status(400).json({ error: "The free plan does not require checkout." });
  const amount = taxFor(plan.amountPaise); const now = new Date();
  await prisma.subscription.updateMany({ where: { userId: user.id, status: "ACTIVE", endsAt: { lte: now } }, data: { status: "EXPIRED" } });
  const subscription = await prisma.subscription.create({ data: { userId: user.id, planCode: plan.code, audience, durationDays: plan.durationDays, limits: plan.limits || {}, amountPaise: amount.totalPaise, currency: "INR", status: "PENDING" } });
  const transaction = await prisma.paymentTransaction.create({ data: { userId: user.id, subscriptionId: subscription.id, provider: process.env.PAYMENT_PROVIDER || "unconfigured", amountPaise: amount.totalPaise, taxPaise: amount.taxPaise, currency: "INR", status: "CREATED" } });
  try {
    const provider = getPaymentProvider();
    const session = await provider.createCheckout({ transactionId: transaction.id, amountPaise: amount.totalPaise, currency: "INR", description: `Jobinfo India ${plan.name} subscription`, returnUrl: p.data.returnUrl || `${config.webOrigin}/recruiter/billing` });
    await prisma.paymentTransaction.update({ where: { id: transaction.id }, data: { provider: session.provider, providerRef: session.providerReference } });
    res.status(201).json({ subscriptionId: subscription.id, transactionId: transaction.id, checkoutUrl: session.checkoutUrl, mode: session.mode, subtotalPaise: plan.amountPaise, gstPaise: amount.taxPaise, totalPaise: amount.totalPaise });
  } catch (e) { await prisma.paymentTransaction.update({ where: { id: transaction.id }, data: { status: "PROVIDER_NOT_CONFIGURED" } }); res.status(503).json({ error: e instanceof Error ? e.message : "Payment provider is unavailable." }); }
});

billingRouter.get("/invoices/:id", requireAuth("RECRUITER", "INSTITUTION"), async (req, res) => {
  const invoice = await prisma.taxInvoice.findFirst({ where: { id: String(req.params.id), userId: userOf(req).id } });
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  res.json({ invoice });
});

billingRouter.post("/webhooks/payment", async (req, res) => {
  const rawBody = (req as any).rawBody as Buffer | undefined;
  if (!rawBody?.length) return res.status(400).json({ error: "Raw payment event is required" });
  try {
    const provider = getPaymentProvider();
    const verified = await provider.verifyWebhook({ rawBody, signature: req.get("x-payment-signature") || req.get("x-razorpay-signature") });
    const result = await settlePayment(verified);
    res.json(result);
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Payment event verification failed" }); }
});

if (!config.isProd) {
  billingRouter.post("/dev/confirm/:transactionId", requireAuth("RECRUITER", "INSTITUTION"), async (req, res) => {
    const tx = await prisma.paymentTransaction.findFirst({ where: { id: String(req.params.transactionId), userId: userOf(req).id, status: "CREATED", provider: "mock" } });
    if (!tx) return res.status(404).json({ error: "Test transaction not found." });
    try { await settlePayment({ transactionId: tx.id, providerReference: tx.providerRef || `test_${tx.id}`, status: "PAID" }); res.json({ ok: true, mode: "test", message: "Test payment confirmed. No real money was charged." }); }
    catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Could not confirm payment" }); }
  });
}
