import dotenv from "dotenv";
import path from "node:path";

// Workspace scripts execute from apps/api, while the shared environment file lives at the repo root.
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const isProd = process.env.NODE_ENV === "production";
const secret = process.env.JWT_SECRET ?? "";
if (isProd && secret.length < 32) throw new Error("JWT_SECRET must be set (32+ chars) in production");
const otpProvider = process.env.OTP_PROVIDER || "console";
if (!["console", "http-json", "msg91", "twilio"].includes(otpProvider)) {
  throw new Error("OTP_PROVIDER must be console, http-json, msg91, or twilio");
}

export const config = {
  isProd,
  otpProvider,
  port: Number(process.env.PORT || process.env.API_PORT || 4000),
  webOrigin: process.env.WEB_ORIGIN || "http://localhost:3000",
  jwtSecret: secret || "dev-only-insecure-secret-change-me",
  integrationEncryptionSecret: process.env.AI_ENCRYPTION_KEY || secret || "dev-only-insecure-secret-change-me",
  otpTtlMinutes: 10,
  otpMaxAttempts: 5,
  otpResendSeconds: 30,
};
