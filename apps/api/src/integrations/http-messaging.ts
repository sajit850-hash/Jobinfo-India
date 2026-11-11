import type { EmailProvider, SmsProvider } from "./contracts";

function endpoint(value: string | undefined, label: string) {
  if (!value) throw new Error(`${label} endpoint is not configured`);
  const url = new URL(value);
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error(`${label} endpoint must use HTTPS`);
  return url;
}
async function postJson(url: URL, apiKey: string | undefined, payload: unknown) {
  if (!apiKey) throw new Error("Messaging API key is not configured");
  const response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(12_000), headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`Messaging provider returned HTTP ${response.status}`);
}

export class HttpJsonSmsProvider implements SmsProvider {
  readonly name = "http-json";
  async sendOtp(input: { to: string; code: string; purpose: string; message?: string }) {
    await postJson(endpoint(process.env.SMS_API_URL, "SMS"), process.env.SMS_API_KEY, { to: input.to, message: input.message || `Your verification code is ${input.code}`, purpose: input.purpose });
  }
}
export class HttpJsonEmailProvider implements EmailProvider {
  readonly name = "http-json";
  async send(input: { to: string; subject: string; text: string; html?: string }) {
    await postJson(endpoint(process.env.EMAIL_API_URL, "Email"), process.env.EMAIL_API_KEY, { from: process.env.EMAIL_FROM || undefined, to: input.to, subject: input.subject, text: input.text, html: input.html });
  }
}
