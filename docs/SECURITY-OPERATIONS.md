# Security, privacy, and operations

## Access and sessions

- API routes use role-specific guards. Each authenticated request checks the account is active and the token's `sessionVersion` still matches the database.
- Passwords are hashed with bcrypt. Authenticated password changes and email OTP resets revoke all existing sessions.
- Authentication endpoints are limited to 30 requests per IP per 15 minutes; the API has a 300 request per IP per 15 minute limit. These defaults use in-process memory and need a shared store before running multiple API replicas.
- OTPs are random six-digit values, stored as HMAC hashes, expire after 10 minutes, and allow five attempts. Resends are throttled.

## Messaging adapters

The built-in `http-json` adapters provide a vendor-neutral HTTP contract:

- SMS: set `OTP_PROVIDER=http-json`, `SMS_API_URL`, and `SMS_API_KEY`. The endpoint receives `{ "to": "...", "message": "...", "purpose": "..." }` as JSON with a bearer token.
- Email: set `EMAIL_PROVIDER=http-json`, `EMAIL_API_URL`, `EMAIL_API_KEY`, and optionally `EMAIL_FROM`. The endpoint receives `{ "from", "to", "subject", "text", "html" }` as JSON with a bearer token.
- Messaging endpoints must use HTTPS outside development. Provider errors are not returned with credentials or response bodies.
- Application confirmations and status changes create in-app notifications and attempt email delivery. An email delivery failure does not undo the in-app notification.

## Private files

The local resume adapter writes files with owner-only permissions outside the web root. Set `UPLOAD_DIR` to a private persistent volume. Use a registered private object-storage adapter for multi-node production; do not make the upload directory public. File type and size are checked, but malware scanning is not included.

## Privacy controls

Users can change/reset passwords, download a JSON account export, and request account removal at `/account/security`. Removal disables the account, deletes role profile data and private uploads, and scrubs customer fields from stored invoices. Financial transaction rows are kept with a non-identifying account tombstone so billing history can remain internally reconcilable.

## Backup and restore

For the included Docker Compose database and upload volume:

```powershell
node scripts/backup.cjs
node scripts/restore.cjs <timestamp>
```

Backups include a PostgreSQL custom-format dump, private uploads archive, and SHA-256 checksums. Restore verifies the checksums and requires typing the exact timestamp confirmation before replacing data. `BACKUP_DIR` can point to a protected backup mount; `BACKUP_RETENTION_DAYS` controls local cleanup. Copy encrypted backups off-host and rehearse restore before relying on them. These scripts target the repository's Docker Compose service names, not an arbitrary hosted database.

## Remaining deployment controls

- Configure TLS, stable `JWT_SECRET` and `AI_ENCRYPTION_KEY`, gateway and messaging credentials, private file storage, and external encrypted backups.
- The built-in rate limiter is process-local; multiple API instances need a shared limiter store.
- A complete Prisma baseline and additive migrations are committed. Validate the full chain on an empty PostgreSQL database; existing databases require a schema comparison and migration reconciliation before `migrate deploy`.
- Malware scanning, distributed audit delivery, incident alerts, privacy-retention review, and an external security assessment are not included.
