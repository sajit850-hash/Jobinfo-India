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
import { prisma } from "@jobinfo/database";

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
app.use(express.json({ limit: "8mb", verify: (req, _res, buffer) => { (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer); } }));
app.use(cookieParser());
app.use("/api/v1", rateLimit({ windowMs: 15 * 60_000, limit: 300, standardHeaders: true, legacyHeaders: false, handler: (_req, res) => res.status(429).json({ error: "Too many requests. Try again later." }) }));
app.use("/api/v1/privacy", privacyRouter);

app.get("/", (_req, res) => res.redirect(config.webOrigin));
app.get("/health", (_req, res) => res.json({ status: "ok", service: "jobinfo-api", timestamp: new Date().toISOString() }));
app.get("/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ready", service: "jobinfo-api" });
  } catch {
    res.status(503).json({ status: "not_ready", service: "jobinfo-api" });
  }
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

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

app.listen(config.port, () => console.log(`Jobinfo API listening on ${config.port}`));
const subscriptionExpiryTimer = setInterval(() => { void expireSubscriptions().catch((error) => console.error("Subscription expiry sweep failed", error)); }, 60 * 60 * 1000);
subscriptionExpiryTimer.unref();
void expireSubscriptions().catch((error) => console.error("Initial subscription expiry sweep failed", error));
