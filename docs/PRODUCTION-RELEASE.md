# Production release setup

The repository now includes a Render Blueprint for the API and web app. It uses the root npm workspaces, deploys after GitHub checks pass, and checks API readiness at `/ready`. It does not run database migrations automatically.

## GitHub

The CI workflow runs on pull requests and pushes to `main`. Before treating `main` as production protected, configure a GitHub ruleset for `main` that:

- Requires pull requests and the `validate` CI job to pass.
- Blocks force pushes and branch deletion.
- Requires review from a maintainer who did not author the change.
- Applies to administrators as well as other contributors.

GitHub currently reports `main` as unprotected and returns no repository rulesets. The connected integration does not expose the detailed branch-protection settings or a write operation, so apply the rules above in GitHub Settings.

## Render

Create services from `render.yaml` and connect the repository's `main` branch. Both services are set to Render's Free plan so the Blueprint does not create a paid resource without a budget decision. Free services can sleep while idle; select an always-on paid plan before relying on this as a production service.

The API requires these values in Render:

- Neon `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct), both copied from the confirmed production branch and database.
- Email provider endpoint, API key, and sender address.
- Razorpay production credentials and webhook secret, after the billing setup is reviewed.
- Private S3-compatible storage endpoint, region, credentials, and bucket.

Render generates `JWT_SECRET` and `AI_ENCRYPTION_KEY`. Keep the encryption key stable across deployments; rotating it can make stored integration credentials unreadable. Set the final API and site URLs in the linked service environment variables if Render cannot resolve the service references during initial Blueprint provisioning.

The Blueprint intentionally has no pre-deploy migration command. Run production migrations only after confirming the target branch/database, validating the migration chain, and reviewing the SQL and recovery evidence. The current environment could not connect to Neon, and the local connection file's database name differs from the requested `jobinfo_india`; confirm the correct database in Neon before configuring Render.

## Remaining production gates

- Verify a backup restore on an isolated Neon branch and retain the evidence.
- Validate all Prisma migrations on PostgreSQL 16, then reconcile production schema drift before deploying them.
- Exercise recruiter and candidate workflows, including private resume preview and download, against staging.
- Configure external monitoring and encrypted backups; add malware scanning and a shared rate-limit store before scaling API instances.
- Run `npm run doctor:production` with the production environment before launch.
