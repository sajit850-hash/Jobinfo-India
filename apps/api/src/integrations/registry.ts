import { config } from "../config";
import type { EmailProvider, PaymentProvider, ResumeStorage, SmsProvider } from "./contracts";
import { LocalFileStorage } from "./local-file-storage";
import { RazorpayPaymentProvider } from "./razorpay";
import { HttpJsonEmailProvider, HttpJsonSmsProvider } from "./http-messaging";

class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console";
  async sendOtp(input: { to: string; code: string; purpose: string }) {
    if (config.isProd) throw new Error("Console SMS provider is development-only.");
    console.info(`[DEV SMS:${input.purpose}] ${input.to} code=${input.code}`);
  }
}
class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";
  async send(input: { to: string; subject: string; text: string }) {
    if (config.isProd) throw new Error("Console email provider is development-only.");
    console.info(`[DEV EMAIL] to=${input.to} subject=${input.subject}\n${input.text}`);
  }
}
class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";
  async createCheckout(input: { transactionId: string; amountPaise: number; currency: string; description: string; returnUrl: string }) {
    if (config.isProd) throw new Error("Mock payment provider is development-only.");
    return {
      provider: this.name,
      providerReference: `test_${input.transactionId}`,
      checkoutUrl: `${input.returnUrl}${input.returnUrl.includes("?") ? "&" : "?"}testPayment=${encodeURIComponent(input.transactionId)}`,
      mode: "test" as const,
    };
  }
  async verifyWebhook(_input: { rawBody: Buffer; signature: string | undefined }): Promise<never> {
    throw new Error("Mock payments are confirmed only through the development-only test confirmation route.");
  }
}

let sms: SmsProvider | null = null;
let email: EmailProvider | null = null;
let payment: PaymentProvider | null = null;
let storage: ResumeStorage | null = null;

export function registerSmsProvider(provider: SmsProvider) { sms = provider; }
export function registerEmailProvider(provider: EmailProvider) { email = provider; }
export function registerPaymentProvider(provider: PaymentProvider) { payment = provider; }
export function registerResumeStorage(provider: ResumeStorage) { storage = provider; }

export function getSmsProvider(): SmsProvider {
  if (sms) return sms;
  if (process.env.OTP_PROVIDER === "http-json") return new HttpJsonSmsProvider();
  if (process.env.OTP_PROVIDER === "console" && !config.isProd) return new ConsoleSmsProvider();
  throw new Error("SMS provider is not configured. Add a provider adapter and credentials.");
}
export function getEmailProvider(): EmailProvider {
  if (email) return email;
  if (process.env.EMAIL_PROVIDER === "http-json") return new HttpJsonEmailProvider();
  if ((process.env.EMAIL_PROVIDER || "console") === "console" && !config.isProd) return new ConsoleEmailProvider();
  throw new Error("Email provider is not configured. Add a provider adapter and credentials.");
}
export function getPaymentProvider(): PaymentProvider {
  if (payment) return payment;
  if (process.env.PAYMENT_PROVIDER === "razorpay") return new RazorpayPaymentProvider();
  if (process.env.PAYMENT_PROVIDER === "mock" && !config.isProd) return new MockPaymentProvider();
  throw new Error("Payment provider is not configured. Add a provider adapter and credentials.");
}
export function getResumeStorage(): ResumeStorage {
  if (storage) return storage;
  if ((process.env.FILE_STORAGE || "local") === "local") return new LocalFileStorage();
  throw new Error("Resume storage is not configured. Register a private local or object-storage adapter.");
}
export function integrationStatus() {
  return {
    sms: sms?.name || (process.env.OTP_PROVIDER === "http-json" ? "HTTP JSON adapter" : process.env.OTP_PROVIDER === "console" && !config.isProd ? "console (development)" : "not configured"),
    email: email?.name || (process.env.EMAIL_PROVIDER === "http-json" ? "HTTP JSON adapter" : (process.env.EMAIL_PROVIDER || "console") === "console" && !config.isProd ? "console (development)" : "not configured"),
    payment: payment?.name || (process.env.PAYMENT_PROVIDER === "razorpay" ? "razorpay" : process.env.PAYMENT_PROVIDER === "mock" && !config.isProd ? "mock (test only)" : "not configured"),
    resumeStorage: storage?.name || ((process.env.FILE_STORAGE || "local") === "local" ? "private local disk" : "not configured"),
    ai: process.env.AI_PROVIDER || "keyword baseline",
  };
}
