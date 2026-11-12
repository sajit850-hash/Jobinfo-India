# Demo data

The repeatable staging dataset is in `packages/database/src/demo-seed.ts`. It creates a tracked batch (`jobinfo-demo-v1`) in PostgreSQL and writes generated login credentials to the ignored file `packages/database/.local/demo-credentials.txt`.

Seed only a development database or a separately authorized Neon staging branch. Set `DEMO_DATA_ENABLED=true`; for staging also set `DEMO_DATA_ENVIRONMENT=staging` and `NEON_BRANCH` to the non-production branch name. Never point the seed at production. The seed refuses email collisions and skips an already-populated batch.

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
