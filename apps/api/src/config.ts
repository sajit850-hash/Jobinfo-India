import "dotenv/config";

const isProd = process.env.NODE_ENV === "production";
const secret = process.env.JWT_SECRET ?? "";
if (isProd && secret.length < 32) throw new Error("JWT_SECRET must be set (32+ chars) in production");

export const config = {
  isProd,
  port: Number(process.env.PORT || process.env.API_PORT || 4000),
  webOrigin: process.env.WEB_ORIGIN || "http://localhost:3000",
  jwtSecret: secret || "dev-only-insecure-secret-change-me",
  integrationEncryptionSecret: process.env.AI_ENCRYPTION_KEY || secret || "dev-only-insecure-secret-change-me",
  otpTtlMinutes: 10,
  otpMaxAttempts: 5,
  otpResendSeconds: 30,
};
