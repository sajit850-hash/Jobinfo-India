# Production release runbook

This repository has Dockerfiles, a Docker Compose foundation, CI build/type checks, live smoke checks, and a checked-in Prisma baseline plus additive migrations. Production is still gated on validating those migrations against PostgreSQL and reconciling any existing database before applying them.

## 1. Validate a release candidate

On a clean checkout with Node 22 and dependencies installed:

```powershell
npm ci
npm run db:generate
npm run typecheck
npm run build
npm test
```

`npm test` currently has no application workflow suites wired in. Add and pass candidate, recruiter, institution, admin, payment, database, and security suites before launch; the current CI does not establish those workflows work end to end.

## 2. Prepare production configuration

Create `.env` on the VPS and keep it out of source control. Configure stable random secrets, PostgreSQL credentials, HTTPS origins, transactional email, OTP SMS, payment gateway keys/webhook secret, private object storage, and monitoring/backup credentials. Never use `console` email/SMS, mock payments, or local resume storage for public traffic.

Run the production configuration gate without displaying secret values:

```powershell
npm run doctor:production
```

The doctor checks required settings and common unsafe defaults. It does not verify that credentials work or that external providers have approved the account.

## 2.1 Render API service

For a Render Web Service connected to this repository, use the repository root as the root directory, Node 22, and:

- Build command: `npm ci --include=dev && npm run db:generate && npm run build --workspace @jobinfo/database && npm run build --workspace @jobinfo/api`
- Start command: `npm start`
- Health check path: `/ready`

The `--include=dev` flag is required because the build uses Prisma, TypeScript, and their type definitions, even when `NODE_ENV=production` is set. The root `start` script launches the API workspace. The API listens on Render's assigned `PORT` when available, falling back to `API_PORT` and then `4000` for local development. Set `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `JWT_SECRET`, `AI_ENCRYPTION_KEY`, and `WEB_ORIGIN` as Render environment variables; never commit their values.

## 2.2 Render web service

Deploy the Next.js frontend as a separate Render Web Service using the repository root and Node 22:

- Build command: `npm ci --include=dev && npm run build --workspace @jobinfo/web`
- Start command: `npm run start --workspace @jobinfo/web`
- Set `NEXT_PUBLIC_API_URL` to the public API service URL and `NEXT_PUBLIC_SITE_URL` to the frontend service URL.
- Keep the service on the Free plan unless a paid plan is explicitly selected.

The web start command uses Render's assigned `PORT`. Set the API service's `WEB_ORIGIN` to the frontend service URL so browser API requests pass CORS checks.

## 3. Database migration gate

Do not run `prisma db push` on production. The initial migration `20261111_000000_baseline` creates the current schema on a clean PostgreSQL database; later migrations add query indexes, session controls, and billing referential integrity. Validate the full chain against an empty PostgreSQL 16 database and keep backup/restore rehearsal evidence with the release.

Once the committed migration history is validated, deploy it using:

```powershell
docker compose run --rm api npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
```

For an existing database, do not run the baseline as a create-all migration. Take a verified backup, compare the live schema to the baseline and additive migrations, and reconcile drift first. If the existing database already contains the baseline schema, mark that baseline as applied once, then deploy the remaining additive migrations:

```powershell
docker compose run --rm api npx prisma migrate resolve --applied 20261111_000000_baseline --schema packages/database/prisma/schema.prisma
docker compose run --rm api npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
```

Only use `migrate resolve` after verifying the database really matches the baseline except for changes supplied by pending additive migrations. Older databases need a reviewed reconciliation migration before production deployment.

## 4. VPS, domain, and TLS

Install Docker Engine and the Compose plugin on a supported VPS. Configure the firewall to expose only SSH and ports 80/443. Compose binds the web and API ports to loopback; put a maintained reverse proxy such as Caddy or Nginx in front, route the public domain to the web service, and route the configured API domain to the API service. Issue and automatically renew TLS certificates. Set `WEB_ORIGIN`, `NEXT_PUBLIC_SITE_URL`, and `NEXT_PUBLIC_API_URL` to the final HTTPS origins before building the web image.

```powershell
docker compose build
docker compose up -d db
# Apply the reviewed production migration here.
docker compose up -d
docker compose ps
```

The Compose health checks verify API database readiness and web availability. The `/health` endpoint is liveness only; `/ready` checks PostgreSQL connectivity.

## 5. Post-deploy smoke checks

From an operator machine, set the public endpoints and run:

```powershell
$env:API_BASE_URL = "https://api.example.org"
$env:SITE_BASE_URL = "https://example.org"
npm run smoke
```

This checks API liveness, database readiness, and the public homepage. It does not replace browser workflow testing, payment sandbox/live verification, role access checks, or security review.

## 6. Monitoring, backup, and launch

- Configure uptime checks for `/health` and `/ready`, application error alerts, disk/database capacity alerts, and provider webhook failure alerts.
- Configure encrypted off-host PostgreSQL and private-upload backups. Run the documented backup and restore scripts against the deployment and rehearse recovery before launch.
- Verify DNS, certificate renewal, firewall rules, cookie security, provider webhooks, email/SMS delivery, and payment reconciliation.
- Run and record the full release matrix: candidate registration/verification/profile/search/apply; recruiter registration/company/job posting/application management/ATS; institution approval/student placement; admin moderation/access/billing/refunds; payment success/failure/webhook replay; API validation, access control, OTP limits, upload privacy, and load checks.
- Launch only after the baseline migration, automated workflow tests, security review, monitoring, backup restore rehearsal, and live smoke checks pass.

No VPS, domain, DNS, certificate, production database, or provider credentials are configured in this workspace, so those external launch actions remain operator tasks.
