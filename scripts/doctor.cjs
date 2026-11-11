const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const production = process.argv.includes("--production");
const envFile = path.join(root, ".env");
const fileValues = {};
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !match[2].startsWith("#")) fileValues[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}
const value = (key) => process.env[key] || fileValues[key] || "";
const checks = [];
const check = (label, ok, detail = "") => checks.push({ label, ok: Boolean(ok), detail });
const placeholder = (text) => !text || /change-this|replace-with|your[-_ ]|example\.com/i.test(text);

for (const file of ["apps/api/src/server.ts", "apps/web/src/app/layout.tsx", "packages/database/prisma/schema.prisma", "docker-compose.yml"]) {
  check(`required file ${file}`, fs.existsSync(path.join(root, file)));
}
check("DATABASE_URL configured", !placeholder(value("DATABASE_URL")));
check("POSTGRES_PASSWORD configured", !placeholder(value("POSTGRES_PASSWORD")));
check("JWT_SECRET has at least 32 characters", value("JWT_SECRET").length >= 32 && !placeholder(value("JWT_SECRET")));
check("AI_ENCRYPTION_KEY has at least 32 characters", value("AI_ENCRYPTION_KEY").length >= 32 && !placeholder(value("AI_ENCRYPTION_KEY")));

if (production) {
  check("NODE_ENV is production", value("NODE_ENV") === "production");
  for (const key of ["WEB_ORIGIN", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_API_URL"]) {
    try { check(`${key} uses HTTPS`, new URL(value(key)).protocol === "https:"); }
    catch { check(`${key} uses HTTPS`, false); }
  }
  check("EMAIL_PROVIDER is not console", Boolean(value("EMAIL_PROVIDER")) && value("EMAIL_PROVIDER") !== "console");
  check("OTP_PROVIDER is not console", Boolean(value("OTP_PROVIDER")) && value("OTP_PROVIDER") !== "console");
  check("payment provider is not mock", Boolean(value("PAYMENT_PROVIDER")) && value("PAYMENT_PROVIDER") !== "mock");
  check("private non-local resume storage selected", Boolean(value("FILE_STORAGE")) && value("FILE_STORAGE") !== "local");
  if (value("EMAIL_PROVIDER") === "http-json") check("email endpoint and key configured", Boolean(value("EMAIL_API_URL") && value("EMAIL_API_KEY")));
  if (value("OTP_PROVIDER") === "http-json") check("SMS endpoint and key configured", Boolean(value("SMS_API_URL") && value("SMS_API_KEY")));
  if (value("PAYMENT_PROVIDER") === "razorpay") check("Razorpay credentials and webhook secret configured", Boolean(value("RAZORPAY_KEY_ID") && value("RAZORPAY_KEY_SECRET") && value("RAZORPAY_WEBHOOK_SECRET")));
}

console.log(`Jobinfo India ${production ? "production" : "local"} readiness check`);
for (const item of checks) console.log(`${item.ok ? "OK" : "FAIL"} ${item.label}${item.detail ? ` — ${item.detail}` : ""}`);
console.log(`${checks.filter((item) => item.ok).length}/${checks.length} checks passed`);
if (checks.some((item) => !item.ok)) process.exitCode = 1;
