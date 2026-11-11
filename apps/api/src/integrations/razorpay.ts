import crypto from "node:crypto";
import type { PaymentProvider } from "./contracts";

export class RazorpayPaymentProvider implements PaymentProvider {
  readonly name = "razorpay";
  private keyId = process.env.RAZORPAY_KEY_ID || "";
  private keySecret = process.env.RAZORPAY_KEY_SECRET || "";
  private webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
  private auth() { if (!this.keyId || !this.keySecret) throw new Error("Razorpay API credentials are not configured"); return `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`; }
  async createCheckout(input: { transactionId: string; amountPaise: number; currency: string; description: string; returnUrl: string }) {
    const response = await fetch("https://api.razorpay.com/v1/payment_links", { method: "POST", headers: { Authorization: this.auth(), "Content-Type": "application/json" }, body: JSON.stringify({ amount: input.amountPaise, currency: input.currency, description: input.description, reference_id: input.transactionId, notes: { transactionId: input.transactionId }, callback_url: input.returnUrl, callback_method: "get" }), signal: AbortSignal.timeout(20_000) });
    const result: any = await response.json();
    if (!response.ok || !result.id || !result.short_url) throw new Error(result.error?.description || `Razorpay checkout failed (${response.status})`);
    return { provider: this.name, providerReference: result.id, checkoutUrl: result.short_url, mode: "live" as const };
  }
  async verifyWebhook(input: { rawBody: Buffer; signature: string | undefined }) {
    if (!this.webhookSecret) throw new Error("Razorpay webhook secret is not configured");
    if (!input.signature) throw new Error("Payment signature is missing");
    const expected = crypto.createHmac("sha256", this.webhookSecret).update(input.rawBody).digest();
    let received: Buffer; try { received = Buffer.from(input.signature, "hex"); } catch { throw new Error("Payment signature is invalid"); }
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) throw new Error("Payment signature is invalid");
    const payload: any = JSON.parse(input.rawBody.toString("utf8"));
    const event = payload.event;
    if (!(["payment_link.paid", "payment_link.cancelled", "payment_link.expired", "payment.captured"] as string[]).includes(event)) throw new Error("Unsupported Razorpay webhook event");
    const link = payload.payload?.payment_link?.entity;
    const payment = payload.payload?.payment?.entity;
    const transactionId = link?.notes?.transactionId || payment?.notes?.transactionId || link?.reference_id;
    const providerReference = link?.id || payment?.notes?.paymentLinkId;
    const providerPaymentReference = payment?.id || link?.payments?.[0]?.payment_id;
    if (!transactionId || !providerReference) throw new Error("Webhook is missing the internal transaction reference");
    return { transactionId, providerReference, providerPaymentReference, status: ["payment_link.cancelled", "payment_link.expired"].includes(event) ? "FAILED" as const : "PAID" as const };
  }
  async createRefund(input: { providerReference: string; paymentReference?: string; amountPaise: number; reason: string; idempotencyKey?: string }) {
    if (!input.paymentReference) throw new Error("Verified payment ID is not available for refund");
    const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(input.paymentReference)}/refund`, { method: "POST", headers: { Authorization: this.auth(), "Content-Type": "application/json", ...(input.idempotencyKey ? { "X-Refund-Idempotency": input.idempotencyKey } : {}) }, body: JSON.stringify({ amount: input.amountPaise, notes: { paymentLinkId: input.providerReference, reason: input.reason.slice(0, 200) } }), signal: AbortSignal.timeout(20_000) });
    const result: any = await response.json();
    if (!response.ok || !result.id) throw new Error(result.error?.description || `Razorpay refund failed (${response.status})`);
    return { providerRefundReference: result.id };
  }
}
