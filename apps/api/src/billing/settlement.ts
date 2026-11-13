import crypto from "node:crypto";
import { prisma } from "@jobinfo/database";

export async function settlePayment(input: { transactionId: string; providerReference: string; providerPaymentReference?: string; status: "PAID" | "FAILED" }) {
  const tx = await prisma.paymentTransaction.findUnique({ where: { id: input.transactionId } });
  if (tx) {
    if (tx.providerRef && tx.providerRef !== input.providerReference) throw new Error("Payment reference does not match transaction");
    if (tx.status === "PAID" || tx.status === "REFUNDED") return { ok: true, duplicate: true };
    if (tx.status !== "CREATED") throw new Error("Transaction is not awaiting payment");
    if (input.status === "FAILED") {
      await prisma.$transaction(async db => {
        await db.paymentTransaction.update({ where: { id: tx.id }, data: { status: "FAILED", providerRef: input.providerReference } });
        if (tx.subscriptionId) { await db.subscription.updateMany({ where: { id: tx.subscriptionId, status: "PENDING" }, data: { status: "FAILED" } }); await db.couponRedemption.updateMany({ where: { subscriptionId: tx.subscriptionId, status: "RESERVED" }, data: { status: "RELEASED" } }); }
      });
      return { ok: true, status: "FAILED" };
    }
    const now = new Date();
    await prisma.$transaction(async (db) => {
      await db.paymentTransaction.update({ where: { id: tx.id }, data: { status: "PAID", providerRef: input.providerReference, providerPaymentRef: input.providerPaymentReference } });
      if (tx.subscriptionId) {
        const subscription = await db.subscription.findUnique({ where: { id: tx.subscriptionId } });
        if (subscription) {
          const current = await db.subscription.findFirst({ where: { userId: tx.userId, status: "ACTIVE", endsAt: { gt: now } }, orderBy: { endsAt: "desc" } });
          const isRenewal = current?.planCode === subscription.planCode;
          if (current && !isRenewal) await db.subscription.updateMany({ where: { userId: tx.userId, status: "ACTIVE" }, data: { status: "CANCELLED" } });
          const start = isRenewal && current?.endsAt && current.endsAt > now ? current.endsAt : now;
          await db.subscription.update({ where: { id: subscription.id }, data: { status: "ACTIVE", startedAt: start, endsAt: new Date(start.getTime() + subscription.durationDays * 86400000), providerRef: input.providerReference } });
          await db.couponRedemption.updateMany({ where: { subscriptionId: subscription.id, status: "RESERVED" }, data: { status: "REDEEMED" } });
          await db.subscriptionEvent.create({ data: { subscriptionId: subscription.id, actorId: tx.userId, event: "PAYMENT_VERIFIED", next: { providerReference: input.providerReference, amountPaise: tx.amountPaise, couponCode: subscription.couponCode } } });
        }
      }
      await issueInvoice(db, { userId: tx.userId, paymentId: tx.id, amountPaise: tx.amountPaise, taxPaise: tx.taxPaise });
    });
    return { ok: true, status: "PAID" };
  }
  const post = await prisma.jobPostingTransaction.findUnique({ where: { id: input.transactionId } });
  if (!post) throw new Error("Payment transaction not found");
  if (post.providerRef && post.providerRef !== input.providerReference) throw new Error("Payment reference does not match transaction");
  if (post.status === "PAID" || post.status === "REFUNDED") return { ok: true, duplicate: true };
  if (post.status !== "PENDING") throw new Error("Transaction is not awaiting payment");
  if (input.status === "FAILED") {
    await prisma.jobPostingTransaction.update({ where: { id: post.id }, data: { status: "FAILED", providerRef: input.providerReference } });
    return { ok: true, status: "FAILED" };
  }
  await prisma.$transaction(async (db) => {
    const now = new Date();
    const plan = await db.jobPostingPlan.findUnique({ where: { id: post.planId }, select: { postingCredits: true, durationDays: true } });
    await db.jobPostingTransaction.update({ where: { id: post.id }, data: { status: "PAID", providerRef: input.providerReference, providerPaymentRef: input.providerPaymentReference, creditsGranted: plan?.postingCredits || 1, validUntil: new Date(now.getTime() + (plan?.durationDays || 30) * 86400000) } });
    await issueInvoice(db, { userId: post.userId, jobPostingPaymentId: post.id, amountPaise: post.amountPaise, taxPaise: post.taxPaise });
  });
  return { ok: true, status: "PAID" };
}

async function issueInvoice(db: any, input: { userId: string; paymentId?: string; jobPostingPaymentId?: string; amountPaise: number; taxPaise: number }) {
  const existing = await db.taxInvoice.findFirst({ where: { OR: [{ paymentId: input.paymentId || "" }, { jobPostingPaymentId: input.jobPostingPaymentId || "" }] } });
  if (existing) return existing;
  const [profile, user] = await Promise.all([
    db.billingProfile.findUnique({ where: { userId: input.userId } }),
    db.user.findUnique({ where: { id: input.userId }, select: { fullName: true } }),
  ]);
  const totalPaise = input.amountPaise;
  const subtotalPaise = totalPaise - input.taxPaise;
  const state = profile?.state || "Not provided";
  const now = new Date(); const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return db.taxInvoice.create({ data: { invoiceNumber: `JIN-${date}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`, userId: input.userId, paymentId: input.paymentId, jobPostingPaymentId: input.jobPostingPaymentId, subtotalPaise, gstRateBps: subtotalPaise ? Math.round(input.taxPaise * 10000 / subtotalPaise) : 0, gstPaise: input.taxPaise, totalPaise, legalName: profile?.legalName || user?.fullName || "Customer", gstin: profile?.gstin || null, billingAddress: profile ? `${profile.address}, ${profile.city}, ${profile.state} ${profile.postalCode}` : "Billing address not provided", placeOfSupply: state, sellerLegalName: process.env.GST_BUSINESS_NAME || "Jobinfo India", sellerGstin: process.env.GSTIN || null, sellerAddress: process.env.GST_ADDRESS || "Seller address not configured" } });
}

export function taxFor(amountPaise: number) {
  const configured = Number(process.env.GST_RATE_BPS ?? 1800);
  const rateBps = Number.isFinite(configured) ? Math.max(0, Math.min(3000, Math.round(configured))) : 1800;
  return { rateBps, taxPaise: Math.round(amountPaise * rateBps / 10000), totalPaise: amountPaise + Math.round(amountPaise * rateBps / 10000) };
}

export async function expireSubscriptions() {
  return prisma.subscription.updateMany({ where: { status: "ACTIVE", endsAt: { lte: new Date() } }, data: { status: "EXPIRED" } });
}
