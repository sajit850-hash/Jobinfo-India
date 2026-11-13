/**
 * Provider contracts. Business workflows depend on these interfaces, never on
 * a vendor SDK. Add a provider implementation and register it in registry.ts
 * when the business selects a vendor and supplies credentials.
 */
export interface SmsProvider {
  readonly name: string;
  sendOtp(input: { to: string; code: string; purpose: string; message?: string }): Promise<void>;
}
export interface EmailProvider {
  readonly name: string;
  send(input: { to: string; bcc?: string[]; subject: string; text: string; html?: string }): Promise<void>;
}
export interface PaymentSession {
  provider: string;
  providerReference: string;
  checkoutUrl: string;
  mode: "test" | "live";
}
export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: {
    transactionId: string;
    amountPaise: number;
    currency: string;
    description: string;
    returnUrl: string;
  }): Promise<PaymentSession>;
  verifyWebhook(input: { rawBody: Buffer; signature: string | undefined }): Promise<{
    providerReference: string;
    providerPaymentReference?: string;
    transactionId: string;
    status: "PAID" | "FAILED";
  }>;
  createRefund?(input: { providerReference: string; paymentReference?: string; amountPaise: number; reason: string; idempotencyKey?: string }): Promise<{ providerRefundReference: string }>;
}
export interface ResumeStorage {
  readonly name: string;
  check(): Promise<void>;
  save(input: { ownerId: string; fileName: string; contentType: string; bytes: Buffer }): Promise<{ key: string; size: number }>;
  read(key: string): Promise<{ bytes: Buffer; contentType: string; fileName: string }>;
  remove(key: string): Promise<void>;
}
