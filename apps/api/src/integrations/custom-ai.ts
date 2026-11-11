import crypto from "node:crypto";
import { prisma } from "@jobinfo/database";
import { config } from "../config";

const key = () => crypto.createHash("sha256").update(config.integrationEncryptionSecret).digest();
export function encryptApiKey(value: string) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}
function decryptApiKey(value: string) {
  const [iv, tag, data] = value.split("."); const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url")); return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
export async function customAiStatus() {
  const item = await prisma.customAiIntegration.findUnique({ where: { id: "default" } });
  return item ? { configured: true, enabled: item.enabled, endpointUrl: item.endpointUrl, model: item.model, hasApiKey: !!item.apiKeyCiphertext } : { configured: false, enabled: false, hasApiKey: false };
}
export async function callCustomAi<T>(system: string, input: string): Promise<T | null> {
  const item = await prisma.customAiIntegration.findUnique({ where: { id: "default" } });
  if (!item?.enabled) return null;
  const url = new URL(item.endpointUrl);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") throw new Error("AI endpoint must use HTTPS");
  const target = /\/chat\/completions\/?$/.test(url.pathname) ? url : new URL(`${url.pathname.replace(/\/$/, "")}/chat/completions`, url);
  const response = await fetch(target, { method: "POST", redirect: "error", signal: AbortSignal.timeout(25_000), headers: { Authorization: `Bearer ${decryptApiKey(item.apiKeyCiphertext)}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: item.model, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: input }] }) });
  if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}`);
  const payload: any = await response.json(); const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("AI provider returned no JSON content");
  return JSON.parse(content) as T;
}
