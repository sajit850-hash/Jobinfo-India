# Demo data

The repeatable demo dataset is in `packages/database/src/demo-seed.ts`. It creates a tracked batch in PostgreSQL and writes generated login credentials to an ignored local report. Production credentials use `packages/database/.local/demo-credentials-production.txt`; other environments use `packages/database/.local/demo-credentials.txt`.

Development and staging seeding require `DEMO_DATA_ENABLED=true`; staging also requires `DEMO_DATA_ENVIRONMENT=staging` and a non-production `NEON_BRANCH`. Production is blocked by default. A deliberate production seed requires all of `NODE_ENV=production`, `DEMO_DATA_ENABLED=true`, `DEMO_DATA_ENVIRONMENT=production`, `DEMO_DATA_PRODUCTION_ENABLED=true`, and the exact `NEON_BRANCH=production`. Keep the production opt-in off in Render runtime settings; enable it only for the one-time, reviewed seed command. The seed refuses email collisions and skips an already-populated batch.

Run the Prisma migration before seeding:

```powershell
npm run db:generate
npm run db:migrate:deploy
npm run db:seed:demo --workspace @jobinfo/database
npm run db:seed:demo --workspace @jobinfo/database -- --dry-run
npm run demo:complete --workspace @jobinfo/database
npm run demo:credentials
npm run demo:verify --workspace @jobinfo/database
```

Admins with `MANAGE_DEMO_DATA` can inspect batches at `/admin/demo-data`. Deletion requires typing the exact batch key and is blocked when the signed-in admin is part of the batch, when demo data links to non-demo activity, or when a user has untracked billing records. A deleted batch stays in the audit list; a fresh seed uses a new versioned batch key.

All generated email addresses use the reserved `.test` domain. Mobile numbers are deliberately non-dialable placeholders beginning with zero after the country code. Student recruiter visibility applies only to these fictional staging records. Demo payment rows use `DEMO` status and zero amount; they cannot be counted as revenue.

Production demo users are fictional test accounts. Do not enter real candidate, recruiter, institution, or payment data through them. The credential report is local and ignored by Git; deliver it only to the project owner.
