# Jobinfo India — Full-stack MVP

Next.js 15 + React 19 frontend, Express API, PostgreSQL and Prisma. The repository contains candidate registration/profile/saved-job flows, recruiter registration/job posting/application tracking, job search/moderation, institution registration/directory, admin APIs, notifications, subscription checkout scaffolding, explainable ATS keyword matching and Docker deployment scaffolding. Vendor integrations are isolated behind replaceable provider contracts.

## Local setup

1. Install Node.js 22 and PostgreSQL 16.
2. Copy `.env.example` to `.env` and configure `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `JWT_SECRET` (32+ random characters), `WEB_ORIGIN`, `NEXT_PUBLIC_API_URL` and `API_INTERNAL_URL`. For Neon, link the intended project/branch with the Neon CLI, then run `neon env pull --file .env`; this application uses pooled `DATABASE_URL` for runtime and `DATABASE_URL_UNPOOLED` for Prisma direct connections/migrations. Verify the selected branch before running migrations.
3. `npm ci`
4. `npm run db:generate`
5. `npm run db:migrate --workspace @jobinfo/database`
6. `npm run db:seed`
7. `npm run dev` (generates Prisma client and builds the shared database package first)

Web: http://localhost:3000 — API health: http://localhost:4000/health

## Build

`npm run build`

## Registration tests

Run API unit tests with `npm test --workspace @jobinfo/api`. The Neon registration integration test is opt-in and is skipped unless `ALLOW_REGISTRATION_TESTS=true` and all three staging settings below are supplied:

- `REGISTRATION_TEST_DATABASE_URL` — database URL for the isolated test branch.
- `REGISTRATION_TEST_DATABASE_URL_UNPOOLED` — direct URL for that same branch.
- `REGISTRATION_TEST_BRANCH_HOST` — exact hostname used by `REGISTRATION_TEST_DATABASE_URL`.

Run the same API test command after setting these variables. The integration test refuses a host mismatch, creates uniquely named test accounts, exercises all three registration journeys and deletes the accounts it created. Never point it at production.

## Create the first admin

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (minimum 14 characters) in the environment, then run:

`npm run admin:create --workspace @jobinfo/database`

The bootstrap command refuses to create another admin if one already exists.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) and [docs/PHASE-STATUS.md](docs/PHASE-STATUS.md). Docker Compose is included as a starting deployment setup.

The current schema and verified relationship boundaries are documented in [docs/database-architecture.md](docs/database-architecture.md). The development seed is repeatable, refuses production, and never deletes existing jobs. To create local workflow accounts, set `SEED_DEMO_ACCOUNTS=true` before `npm run db:seed` (PowerShell: `$env:SEED_DEMO_ACCOUNTS='true'; npm run db:seed`). Demo accounts use `JobinfoDemo!2026` unless `SEED_DEMO_PASSWORD` overrides it:

| Role | Login email |
|---|---|
| Candidate | `demo.candidate@example.com` |
| Corporate recruiter | `demo.corporate@example.com` |
| Freelance recruiter | `demo.freelance@example.com` |
| Institution admin | `demo.institution@example.com` |
| Administrator | `demo.admin@example.com` |

These credentials are for a local development database only. Do not use the demo seed against production. Set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` if you want the seed to create a separate initial admin; otherwise bootstrap one with the command above.

## Provider-independent development mode

Use local adapters while API credentials are unavailable: `OTP_PROVIDER=console`, `EMAIL_PROVIDER=console`, and `PAYMENT_PROVIDER=mock`. Console OTP is displayed only in development. Mock checkout creates a test transaction and exposes a development-only confirmation endpoint; it never charges money. Production supports Razorpay payment links and generic HTTPS JSON SMS/email adapters when configured. Review [docs/INTEGRATION-ADAPTERS.md](docs/INTEGRATION-ADAPTERS.md) and [docs/SECURITY-OPERATIONS.md](docs/SECURITY-OPERATIONS.md). The admin integrations endpoint is `/api/v1/admin/integrations`.

Run `npm run doctor` after creating `.env` to check the local environment configuration.

## Production readiness

This is an expanded MVP, not a certified production system. Configure real SMS/email endpoints, Razorpay credentials and webhooks, private persistent file storage, malware scanning, TLS, monitoring, external encrypted backups, and operational alerts before launch. Rate limiting is process-local and needs a shared store when scaling API replicas. A full Prisma baseline and additive migrations are included; validate them against an empty PostgreSQL database and reconcile existing databases before deployment. See [DEPLOYMENT.md](DEPLOYMENT.md) and [docs/SECURITY-OPERATIONS.md](docs/SECURITY-OPERATIONS.md) for migration, backup, recovery and privacy notes.

### Billing setup

Apply the Prisma migrations and regenerate the client before deploying the monetization changes. Configure `PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` for live Razorpay payment links. Point the gateway webhook to `/api/v1/billing/webhooks/payment` and subscribe to `payment_link.paid`, `payment_link.cancelled`, and `payment_link.expired`. Configure `GST_RATE_BPS`, `GST_BUSINESS_NAME`, `GSTIN`, and `GST_ADDRESS` from approved finance settings. Recruiters and institutions must save customer billing details before paid checkout. Refund execution is available in Admin → Billing when the gateway has supplied a verified payment ID.
