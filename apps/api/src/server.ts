import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { config } from "./config";
import { authRouter } from "./routes/auth";
import { candidatesRouter } from "./routes/candidates";
import { jobsRouter } from "./routes/jobs";
import { recruitersRouter } from "./routes/recruiters";
import { institutionsRouter } from "./routes/institutions";
import { applicationsRouter } from "./routes/applications";
import { atsRouter } from "./routes/ats";
import { adminRouter, cmsRouter } from "./routes/admin";
import { notificationsRouter } from "./routes/notifications";
import { billingRouter } from "./routes/billing";
import { companiesRouter } from "./routes/companies";
import { expireSubscriptions } from "./billing/settlement";
import { privacyRouter } from "./routes/privacy";
import { profileFilesRouter } from "./routes/profile-files";
import { prisma } from "@jobinfo/database";
import { checkResumeStorage } from "./integrations/registry";

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: config.webOrigin, credentials: true }));
app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const origin = req.get("origin");
    if (origin && origin !== config.webOrigin) return res.status(403).json({ error: "Request origin is not allowed" });
  }
  next();
});
// Private profile and institution documents are sent as base64 JSON. A 10 MB
// file expands to roughly 13.4 MB, so the previous 8 MB parser limit rejected
// uploads that the file endpoint itself explicitly accepts.
app.use(express.json({ limit: "16mb", verify: (req, _res, buffer) => { (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer); } }));
app.use(cookieParser());
app.use("/api/v1", rateLimit({ windowMs: 15 * 60_000, limit: 300, standardHeaders: true, legacyHeaders: false, handler: (_req, res) => res.status(429).json({ error: "Too many requests. Try again later." }) }));
app.use("/api/v1/privacy", privacyRouter);

app.get("/", (_req, res) => res.redirect(config.webOrigin));
app.get("/health", (_req, res) => res.json({ status: "ok", service: "jobinfo-api", timestamp: new Date().toISOString() }));
app.get("/ready", async (_req, res) => {
  type Check = { status: "ready" | "unavailable" | "misconfigured"; missing?: string[] };
  const checks: Record<string, Check> = {};
  const databaseUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
  if (!databaseUrl) checks.database = { status: "misconfigured", missing: ["DATABASE_URL or DATABASE_URL_UNPOOLED"] };
  else if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl) || /\/rest\/v1(?:\/|$)/i.test(databaseUrl)) {
    checks.database = { status: "misconfigured", missing: ["PostgreSQL connection URL (not the Neon REST API URL)"] };
  }

  const storageMode = process.env.FILE_STORAGE || "local";
  if (storageMode === "s3") {
    const required = ["AWS_ENDPOINT_URL_S3", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "OBJECT_STORAGE_BUCKET"];
    const missing = required.filter((name) => !process.env[name]?.trim());
    if (missing.length) checks.storage = { status: "misconfigured", missing };
  } else if (storageMode !== "local") {
    checks.storage = { status: "misconfigured", missing: ["FILE_STORAGE must be local or s3"] };
  }

  const tasks: Array<["database" | "storage", Promise<unknown>]> = [];
  if (!checks.database) tasks.push(["database", prisma.$queryRaw`SELECT 1`]);
  if (!checks.storage) tasks.push(["storage", checkResumeStorage()]);
  const results = await Promise.allSettled(tasks.map(([, task]) => task));
  results.forEach((result, index) => {
    const name = tasks[index][0];
    if (result.status === "fulfilled") checks[name] = { status: "ready" };
    else {
      checks[name] = { status: "unavailable" };
      const error = result.reason;
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
      console.error(`${name} readiness probe failed (code: ${code})`);
    }
  });
  const ready = Object.values(checks).every(({ status }) => status === "ready");
  res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready", service: "jobinfo-api", checks });
});
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/candidates", candidatesRouter);
app.use("/api/v1/jobs", jobsRouter);
app.use("/api/v1/companies", companiesRouter);
app.use("/api/v1/recruiters", recruitersRouter);
app.use("/api/v1/institutions", institutionsRouter);
app.use("/api/v1/applications", applicationsRouter);
app.use("/api/v1/ats", atsRouter);
app.use("/api/v1/cms", cmsRouter);
app.use("/api/v1/admin", adminRouter);
app.use("/api/v1/notifications", notificationsRouter);
app.use("/api/v1/billing", billingRouter);
app.use("/api/v1/profile-files", profileFilesRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

app.listen(config.port, () => console.log(`Jobinfo API listening on ${config.port}`));
const subscriptionExpiryTimer = setInterval(() => { void expireSubscriptions().catch((error) => console.error("Subscription expiry sweep failed", error)); }, 60 * 60 * 1000);
subscriptionExpiryTimer.unref();
void expireSubscriptions().catch((error) => console.error("Initial subscription expiry sweep failed", error));
