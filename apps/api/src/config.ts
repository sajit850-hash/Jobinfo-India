import "dotenv/config";
import { assertOtpProviderAllowed } from "./otp-policy";

const isProd = process.env.NODE_ENV === "production";
const secret = process.env.JWT_SECRET ?? "";
if (isProd && secret.length < 32) throw new Error("JWT_SECRET must be set (32+ chars) in production");
const otpProvider = process.env.OTP_PROVIDER || "console";
if (!["demo", "console", "http-json", "msg91", "twilio"].includes(otpProvider)) {
  throw new Error("OTP_PROVIDER must be demo, console, http-json, msg91, or twilio");
}
assertOtpProviderAllowed(
  otpProvider,
  process.env.NODE_ENV,
  process.env.OTP_DEMO_STAGING_ENABLED,
  process.env.OTP_DEMO_PRODUCTION_ENABLED,
);

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
