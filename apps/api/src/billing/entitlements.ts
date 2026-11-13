import { randomUUID } from "node:crypto";
import { prisma } from "@jobinfo/database";

type FeatureConfig = { key?: string; enabled?: boolean; limit?: number; unlimited?: boolean; period?: string; name?: string; unit?: string; description?: string };
export class PlanAccessError extends Error {
  constructor(message: string, public readonly status = 403, public readonly details?: Record<string, unknown>) { super(message); }
}

const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
function featureConfig(snapshot: Record<string, any>, featureKey: string): FeatureConfig | undefined {
  const features = Array.isArray(snapshot.features) ? snapshot.features : [];
  return features.find((entry: unknown) => entry && typeof entry === "object" && (entry as FeatureConfig).key === featureKey) as FeatureConfig | undefined;
}
function configuredLimit(snapshot: Record<string, any>, subscription: { limits: unknown }, featureKey: string) {
  const feature = featureConfig(snapshot, featureKey);
  const legacyLimits = object(snapshot.limits || subscription.limits);
  const aliases: Record<string, string[]> = { "jobs.active": ["activeJobs"], "jobs.posts_monthly": ["jobPostsPerMonth"], "candidate.profile_views": ["candidateProfileViews", "profileViews"], "candidate.searches": ["candidateSearches", "databaseSearches"], "candidate.resume_downloads": ["resumeDownloads"], "ats.matches": ["atsSubmissions", "atsMatches"] };
  const legacy = [featureKey, ...(aliases[featureKey] || [])].map(key => legacyLimits[key]).find(value => Number.isInteger(value));
  return { feature, limit: feature?.unlimited ? -1 : Number.isInteger(feature?.limit) ? Number(feature?.limit) : Number.isInteger(legacy) ? Number(legacy) : undefined };
}
function periodWindow(period: string, now: Date, startedAt: Date | null, durationDays: number) {
  const start = new Date(now); let end: Date | null = null;
  switch (period.toUpperCase()) {
    case "DAILY": case "DAY": start.setUTCHours(0, 0, 0, 0); end = new Date(start); end.setUTCDate(end.getUTCDate() + 1); break;
    case "WEEKLY": case "WEEK": start.setUTCHours(0, 0, 0, 0); start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); end = new Date(start); end.setUTCDate(end.getUTCDate() + 7); break;
    case "MONTHLY": case "MONTH": start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0); end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1); break;
    case "QUARTERLY": case "QUARTER": start.setUTCMonth(Math.floor(start.getUTCMonth() / 3) * 3, 1); start.setUTCHours(0, 0, 0, 0); end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 3); break;
    case "YEARLY": case "YEAR": start.setUTCMonth(0, 1); start.setUTCHours(0, 0, 0, 0); end = new Date(start); end.setUTCFullYear(end.getUTCFullYear() + 1); break;
    case "BILLING_CYCLE": {
      const anchor = startedAt || now; const span = Math.max(1, durationDays) * 86400000; const cycle = Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / span));
      start.setTime(anchor.getTime() + cycle * span); end = new Date(start.getTime() + span); break;
    }
    case "LIFETIME": case "ONE_TIME": start.setTime(startedAt?.getTime() || 0); break;
    default: start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0); end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
  }
  return { periodStart: start, periodEnd: end };
}

async function getActiveSubscription(userId: string) {
  const now = new Date();
  return prisma.subscription.findFirst({ where: { userId, status: "ACTIVE", OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, orderBy: [{ endsAt: "desc" }, { createdAt: "desc" }] });
}

export async function consumePlanUsage(userId: string, featureKey: string, quantity = 1, idempotencyKey: string = randomUUID()) {
  if (!Number.isInteger(quantity) || quantity < 1) throw new PlanAccessError("Usage quantity must be a positive integer", 400);
  const subscription = await getActiveSubscription(userId);
  if (!subscription) return { allowed: true, noSubscription: true, unlimited: true };
  const snapshot = object(subscription.planSnapshot);
  const { feature, limit: configured } = configuredLimit(snapshot, subscription, featureKey);
  if (feature?.enabled === false) throw new PlanAccessError(`The ${feature.name || featureKey} feature is not included in your plan. Upgrade to continue.`, 403, { featureKey, featureEnabled: false });
  if (configured === undefined) return { allowed: true, unmetered: true };
  const limit = configured < 0 ? -1 : configured;
  const now = new Date(); const { periodStart, periodEnd } = periodWindow(feature?.period || "BILLING_CYCLE", now, subscription.startedAt, subscription.durationDays);
  try {
    return await prisma.$transaction(async (tx) => {
      const usage = await tx.subscriptionUsage.upsert({ where: { subscriptionId_featureKey_periodStart: { subscriptionId: subscription.id, featureKey, periodStart } }, create: { subscriptionId: subscription.id, featureKey, periodStart, periodEnd, quantityUsed: 0 }, update: { periodEnd } });
      const updated = await tx.subscriptionUsage.updateMany({ where: { id: usage.id, ...(limit >= 0 ? { quantityUsed: { lte: limit - quantity } } : {}) }, data: { quantityUsed: { increment: quantity } } });
      if (!updated.count) throw new PlanAccessError(`You have used all ${limit.toLocaleString("en-IN")} ${feature?.name || featureKey} included in your current plan. Upgrade to continue.`, 403, { featureKey, used: usage.quantityUsed, limit, remaining: Math.max(0, limit - usage.quantityUsed), resetAt: periodEnd?.toISOString() || null });
      await tx.usageTransaction.create({ data: { subscriptionId: subscription.id, featureKey, idempotencyKey: idempotencyKey.slice(0, 160), quantity, periodStart } });
      const current = await tx.subscriptionUsage.findUniqueOrThrow({ where: { id: usage.id } });
      return { allowed: true, subscriptionId: subscription.id, featureKey, used: current.quantityUsed, limit, remaining: limit < 0 ? null : Math.max(0, limit - current.quantityUsed), resetAt: periodEnd?.toISOString() || null };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof PlanAccessError) throw error;
    if ((error as { code?: string })?.code === "P2002") {
      const duplicate = await prisma.usageTransaction.findUnique({ where: { subscriptionId_featureKey_idempotencyKey: { subscriptionId: subscription.id, featureKey, idempotencyKey: idempotencyKey.slice(0, 160) } } });
      if (duplicate) return { allowed: true, duplicate: true, subscriptionId: subscription.id, featureKey };
    }
    throw error;
  }
}

export async function assertPlanLimit(userId: string, featureKey: string, currentUsage: number, additional = 1) {
  const subscription = await getActiveSubscription(userId);
  if (!subscription) return { allowed: true, noSubscription: true, unlimited: true };
  const snapshot = object(subscription.planSnapshot);
  const { feature, limit } = configuredLimit(snapshot, subscription, featureKey);
  if (feature?.enabled === false) throw new PlanAccessError(`The ${feature.name || featureKey} feature is not included in your plan. Upgrade to continue.`, 403, { featureKey, featureEnabled: false });
  if (limit === undefined || limit < 0) return { allowed: true, unlimited: true };
  if (currentUsage + additional > limit) throw new PlanAccessError(`You have used all ${limit.toLocaleString("en-IN")} ${feature?.name || featureKey} included in your current plan. Upgrade to continue.`, 403, { featureKey, used: currentUsage, limit, remaining: Math.max(0, limit - currentUsage), resetAt: subscription.endsAt?.toISOString() || null });
  return { allowed: true, used: currentUsage, limit, remaining: limit - currentUsage };
}

export async function getPlanUsage(userId: string) {
  const subscription = await getActiveSubscription(userId);
  if (!subscription) return { subscription: null, features: [] };
  const snapshot = object(subscription.planSnapshot); const limits = object(snapshot.limits || subscription.limits);
  const keys = new Set<string>(Object.keys(limits));
  for (const feature of Array.isArray(snapshot.features) ? snapshot.features : []) if (feature && typeof feature === "object" && (feature as FeatureConfig).key) keys.add((feature as FeatureConfig).key!);
  const features = await Promise.all([...keys].map(async (key) => {
    const feature = featureConfig(snapshot, key); const configured = feature?.unlimited ? -1 : Number.isInteger(feature?.limit) ? Number(feature?.limit) : Number.isInteger(limits[key]) ? Number(limits[key]) : -1;
    const window = periodWindow(feature?.period || "BILLING_CYCLE", new Date(), subscription.startedAt, subscription.durationDays);
    const row = await prisma.subscriptionUsage.findUnique({ where: { subscriptionId_featureKey_periodStart: { subscriptionId: subscription.id, featureKey: key, periodStart: window.periodStart } } });
    return { key, name: feature?.name || key, unit: feature?.unit || "uses", enabled: feature?.enabled !== false, used: row?.quantityUsed || 0, limit: configured, unlimited: configured < 0, remaining: configured < 0 ? null : Math.max(0, configured - (row?.quantityUsed || 0)), period: feature?.period || "BILLING_CYCLE", resetAt: window.periodEnd?.toISOString() || null };
  }));
  return { subscription: { id: subscription.id, planCode: subscription.planCode, status: subscription.status, endsAt: subscription.endsAt }, features };
}
