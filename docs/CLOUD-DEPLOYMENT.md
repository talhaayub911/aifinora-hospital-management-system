# Cloud deployment and integration guide

This guide separates a cloud-hosted demonstration from a production healthcare SaaS deployment. The repository has production-oriented boundaries and verification, but it is not automatically safe for real patient data. Security, privacy, operations, payments, and applicable Pakistan legal/compliance requirements must be reviewed and signed off for the intended hospitals and hosting locations.

## Critical database fact

The checked-in Prisma datasource is explicitly:

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

`provider` is selected when Prisma Client and migrations are generated. **Changing only `DATABASE_URL` to a PostgreSQL URL does not convert this application to PostgreSQL.** The existing migration SQL is SQLite SQL and must not be applied to PostgreSQL.

Choose one of these deployment profiles deliberately:

| Profile | Database/files | Scale | Intended use |
|---|---|---|---|
| Local npm | SQLite/local private directory | One process | Development and review |
| Docker Compose demo | SQLite and proofs on named volumes | One API replica | Temporary demonstration only |
| Production SaaS | Reviewed PostgreSQL migrations and private object storage | Multiple stateless API replicas | Real deployment after security/compliance sign-off |

## Local and Docker demonstration

For local npm setup, follow the main README. `npm run db:bootstrap:demo` creates a valid SQLite file, applies checked-in migrations, and installs fictional seed data only when the database is empty. For an earlier local demo database created by `prisma db push`, it can baseline only the exact checked-in schema milestones whose marker tables/columns are already present. That compatibility convenience must not be generalized to production databases.

The Compose example serves the complete application:

```text
Browser :8080
    |
    +-- Nginx `web`: Vite static files and SPA fallback
    |       |
    |       +-- /api/* reverse proxy
    |                    |
    |                 Express `api`: :3001, private network only
    |                    |
    +---------------- SQLite named volume
                         proof-upload named volume
```

Run it with a private secret, even for a shared demo:

```bash
export JWT_SECRET="$(openssl rand -base64 48)"
docker compose up --build
```

On PowerShell:

```powershell
$secretBytes = [byte[]]::new(48)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($secretBytes)
$env:JWT_SECRET = [Convert]::ToBase64String($secretBytes)
docker compose up --build
```

The server intentionally rejects placeholder/default-like JWT secrets in `NODE_ENV=production`; generate a fresh value for every environment and store it in the deployment secret manager.

Then open `http://localhost:8080`. The `migrate` service must exit successfully before the API starts, and the API health check must pass before Nginx starts. The `sqlite-data` and `payment-proofs` named volumes survive container replacement.

The Compose file intentionally has no fallback JWT secret and exits during configuration unless `JWT_SECRET` is supplied. Seeded credentials are local demonstration credentials and must never be deployed with real data or on an internet-facing production environment.

Useful operations:

```bash
docker compose ps
docker compose logs -f api
docker compose down
docker compose down --volumes  # deletes the local demo database and proofs
```

SQLite limitations for this topology:

- Run exactly one API replica.
- Keep the database on a persistent block volume with filesystem locking; do not use an eventually consistent network share.
- Back up both the database and proof volume together and test a restore.
- A container filesystem without a mounted volume is disposable and will lose data.
- SQLite is not the recommended multi-tenant production database for this service.

## PostgreSQL migration plan

Perform this work in a migration branch and staging environment with an experienced database owner. Do not edit production schema state interactively.

1. Freeze and back up the source database. Record counts and financial control totals for hospitals, users, patient invoices/payments, SaaS invoices/payments, proofs, webhooks, and audit logs.
2. Change `provider = "sqlite"` to `provider = "postgresql"` in the reviewed production Prisma schema.
3. Archive the SQLite migration history for reference. Create a new PostgreSQL baseline migration against an empty disposable PostgreSQL database. The SQLite `migration.sql` cannot be reused.
4. Review generated SQL, column precision, timestamps/time zones, foreign keys, delete behavior, indexes, case sensitivity/collation, unique email/reference rules, and query plans.
5. Generate Prisma Client from the PostgreSQL schema in CI and run the complete test suite against PostgreSQL, not only SQLite.
6. If preserving demo/legacy data, build an explicit ETL: preserve primary keys and tenant foreign keys, convert dates/decimals, copy in dependency order, and keep payment-proof object keys stable. Never use the demo reset seed against migrated data.
7. Reconcile row counts, per-hospital totals, invoice balances, payment references, proof hashes, and audit chronology. Test orphan detection and cross-tenant queries.
8. Rehearse cutover and rollback. For a live source, define a write freeze or change-capture plan so no transaction is lost.
9. Run `npm run migrate:deploy` as a single release job before new application replicas receive traffic. Do not run `prisma migrate dev` or `db push` in production.
10. Take a pre-cutover backup, deploy, run smoke tests, and retain the old system read-only until reconciliation is signed off.

Recommended managed PostgreSQL controls:

- Private networking and TLS connections
- Separate application and migration roles; application role has no schema-DDL privileges
- Encrypted storage, point-in-time recovery, automated backups, deletion protection, and cross-region/cross-account copies where required
- Connection pooler sized for all replicas and background workers
- Slow-query insight, storage/connection alarms, and regular index review
- Tested restore runbooks with defined recovery point and recovery time objectives

Prisma's schema and migration history remain the source-controlled contract. Consult the current [Prisma deployment documentation](https://www.prisma.io/docs/orm/prisma-client/deployment/deploy-database-changes-with-prisma-migrate) during the reviewed migration.

The repository currently pins Prisma 6 and still uses its supported `package.json#prisma.seed` hook. Prisma warns that this hook moves to a Prisma config file in version 7; migrate and verify that configuration in an upgrade branch before adopting Prisma 7.

## Build and release pipeline

The included GitHub Actions workflow performs:

```text
npm ci -> Prisma Client generation -> lint -> integration tests -> Vite build -> demo-credential bundle scan
```

A production pipeline should add dependency/license scanning, secret scanning, SAST, container image scanning, a PostgreSQL integration job, browser E2E/accessibility tests, and signed build artifacts/SBOMs.

Recommended release sequence:

1. Build one immutable image from a reviewed commit.
2. Run tests and scans on that image/commit.
3. Back up the database if the migration changes data or schema.
4. Run the migration target/job once.
5. Deploy API replicas with readiness disabled until the database is compatible.
6. Deploy the static frontend built with the correct same-origin `/api` URL.
7. Run authenticated smoke tests for Super Admin, each hospital role, billing-only suspended access, and payment webhook ingress.
8. Monitor errors, latency, database connections, and billing events during the rollout; roll back the application only when the migration is backward compatible.

Pin image digests in deployment manifests. Do not rebuild the same release tag with different dependencies.

## Required environment and secrets

Use a cloud secrets manager or workload identity. Do not place secrets in Git, container images, frontend `VITE_*` variables, support tickets, or general application logs.

| Variable | Production requirement |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | Internal API port, normally `3001` |
| `DATABASE_URL` | TLS PostgreSQL URL only after the provider/migrations/client are converted |
| `JWT_SECRET` | At least 32 random bytes; unique per environment and rotated with a session-revocation plan |
| `JWT_EXPIRES_IN` | Short session lifetime reviewed with refresh/session strategy |
| `REMEMBER_ME_EXPIRES_IN` | Review risk; 30 days is a demo convenience |
| `APP_BASE_URL` | Canonical HTTPS browser origin |
| `API_BASE_URL` | Canonical HTTPS API origin used in server-generated links |
| `CLIENT_ORIGIN` | Exact trusted frontend origin; never wildcard with credentials |
| `VITE_API_BASE_URL` | Public API path/origin embedded at frontend build time; contains no secret |
| `VITE_SHOW_DEMO_ACCOUNTS` | `false`; production bundles must not render or embed fictional seeded credentials |
| `VITE_DEMO_*` | Omit in every production/cloud build; all `VITE_*` values are public browser data |
| `DEMO_MODE` | `false` |
| `EMAIL_PROVIDER` | `disabled` until a real adapter and durable outbox/worker are implemented; `local_simulation` never delivers email |
| `UPLOAD_DIR` | Only for the local/Compose filesystem adapter; production should use private object storage |
| `MAX_UPLOAD_BYTES` | Size policy aligned with proxy and object-storage limits |
| `SAFEPAY_*` | Secret manager values from the correct sandbox/live merchant environment |

Bank-account display data should be managed as reviewed configuration, not source constants. Treat it as sensitive operational configuration even when it is not an authentication secret.

## Reverse proxy, DNS, and TLS

Use one canonical HTTPS origin where practical, for example:

```text
https://app.example.com/       -> versioned static frontend/CDN
https://app.example.com/api/*  -> load balancer -> API service
```

Required controls:

- TLS 1.2+ at the edge, managed certificate renewal, HTTP-to-HTTPS redirect, and HSTS after validation
- Private API/container network; expose only the load balancer
- Preserve `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`; allow forwarded headers only from trusted proxies
- Request body limit slightly above `MAX_UPLOAD_BYTES`, plus header/time-out limits
- WAF/rate limits for login, password reset, public payment status, uploads, and webhooks
- Static asset immutable caching; never cache API responses, `index.html`, auth pages, proof files, or patient data
- Reviewed CSP, framing, MIME-sniffing, referrer, and permissions policies
- Exact CORS allowlist and credentials behavior

The Express app is configured for one trusted proxy hop and secure cookies in production. Revisit that value for the actual load-balancer chain; trusting too many unverified proxy headers permits client spoofing. If frontend and API use different sites, redesign cookie `SameSite`, CSRF, CORS, and logout behavior together rather than changing one flag in isolation.

Add an internal readiness endpoint that performs a bounded database query. Keep liveness independent so a database incident does not create a restart storm.

## Private payment-proof storage

The current adapter writes proofs to a non-public local directory and streams them through authenticated tenant/platform endpoints. Multiple API replicas require a shared private object-store implementation (for example, S3-compatible object storage, Azure Blob, or Google Cloud Storage).

The production adapter should:

- Generate opaque server-side object keys; never trust a client path or filename
- Keep the bucket/container private with public access blocked
- Use workload identity and least-privilege read/write roles
- Encrypt at rest with managed or customer-managed keys according to policy
- Retain the database metadata and SHA-256 digest; verify content after upload/download
- Validate MIME magic bytes and run asynchronous malware scanning/quarantine before reviewers can open a proof
- Use short-lived, audience-limited signed downloads or proxy authenticated streams
- Set `Content-Disposition`, `X-Content-Type-Options`, and safe rendering behavior; PDFs/images are still untrusted content
- Define lifecycle, legal hold, deletion, and backup policies aligned with financial/audit requirements
- Log object access without logging the signed URL or sensitive filename

Uploads should be idempotent and finalized only after both object storage and database metadata succeed. Define cleanup for abandoned/quarantined objects. Migrating existing proof files requires preserving `storageKey`, size, MIME type, and hash, followed by sampled/full hash verification.

## Subscription scheduler and background work

The demo exposes a protected manual Super Admin processing action. Production requires a scheduled worker/queue that runs independently of web replicas.

Recommended design:

- Invoke subscription processing at least daily in a defined business time zone, while storing timestamps in UTC.
- Use a distributed lock or unique job key so only one logical run is active.
- Keep renewal invoice, reminder, state-transition, and webhook operations idempotent at the database level.
- Retry transient failures with exponential backoff and a dead-letter queue; never endlessly retry validation/business conflicts.
- Record job ID, as-of time, tenant/result counts, duration, and sanitized error data.
- Alert on missed schedules, repeated failures, unexpected transition volumes, and invoice count anomalies.
- Separate an `eligible_for_suspension` recommendation from automatic destructive action. No overdue job deletes hospital or patient data.

Use a service identity or an internal worker entry point, not a stored human Super Admin bearer token. Add a dry-run/reconciliation report before enabling automated suspension.

## Email and in-app notifications

The demo stores in-app notifications and exposes a reset token only in demo mode. It includes a fail-closed email-provider interface with disabled and local-simulation adapters; simulation validates a message but returns `delivered: false` and sends nothing. No application workflow currently dispatches email. Before production, add a network-backed provider behind the same interface and invoke it only after commit through a durable outbox/worker for password reset, onboarding, invoice issue/due reminders, proof review, payment receipt, state changes, and support updates.

Requirements include:

- Verified sending domain with SPF, DKIM, and DMARC
- Environment-specific templates and links based on the canonical HTTPS origin
- Queue/outbox delivery so a provider outage does not roll back a committed payment
- Idempotency/deduplication, retry policy, bounce/complaint handling, and delivery event retention
- No passwords, patient data, proof images, or long-lived bearer tokens in email
- Single-use hashed reset tokens with short expiry; production responses never reveal the raw token
- Locale/time-zone and recipient-preference strategy where applicable

Reconcile delivery failures separately from billing transaction success.

## Safepay integration checklist

The repository's provider class, hosted-link boundary, signature verification, event ledger, and idempotent payment application are a structural adapter only. They do not prove compatibility with an actual Safepay merchant account or SDK.

Before enabling real payments:

1. Complete merchant onboarding and obtain distinct sandbox/live credentials through approved channels.
2. Validate the current flow against [Safepay API documentation](https://apidocs.getsafepay.com/) and the [Safepay web Express Checkout guide](https://safepay-docs.netlify.app/build-your-integration/express-checkout/?platform=web).
3. Create the tracker/token server-side, redirect the user to hosted checkout, and treat the browser return as informational only.
4. Configure an HTTPS webhook URL and allow the required provider network path without bypassing signature verification.
5. Confirm the exact raw-body signature algorithm/header/encoding, event ID, event types, currency, and amount units supplied for the merchant account.
6. Keep sandbox and live accounts, secrets, endpoints, and webhook ledgers isolated.
7. Poll only the application's own server for status until a verified `payment.succeeded` webhook has committed the payment. Never activate from query parameters or a client callback alone.
8. Exercise duplicate, delayed, out-of-order, invalid-signature, partial/over-payment, timeout, and replay cases.
9. Build daily provider-to-ledger-to-bank reconciliation, exception ownership, refund/dispute policy, and accounting exports.
10. Rotate credentials, alert on signature failures/failed events, and document provider outage behavior.

The application should continue to label Safepay as demo/unconfigured until merchant-specific sandbox certification is complete.

## Monitoring, audit, and incident response

Collect structured logs with request/job correlation IDs and fields such as route template, status, latency, principal type, tenant ID, and audit action. Do not log passwords, JWTs, cookies, reset tokens, webhook secrets/signatures, raw bank proofs, full CNICs, or unrestricted request bodies.

Monitor at minimum:

- API error rate/latency, event-loop health, restarts, CPU/memory
- Authentication failures, lockouts, password resets, role/user changes, support access
- Database connections, storage, replication/backup state, slow/deadlocked queries
- Queue lag, scheduler last success, notification failures
- Proof upload/scan failures and storage access anomalies
- Invoice/payment/credit totals and reconciliation differences
- Safepay signature failures, failed/retried/duplicate events
- Cross-tenant authorization denials and unusual export volumes

Ship immutable audit/security logs to a restricted central destination with clock synchronization and tamper-evident retention. Define severity, on-call ownership, escalation, incident containment, notification, evidence preservation, and post-incident review. Regularly test session revocation and support-access termination.

## Backup and disaster recovery

Define written RPO/RTO targets before launch. A backup is not valid until a restore has been demonstrated.

- PostgreSQL: automated snapshots plus point-in-time recovery/WAL, encrypted and copied outside the primary failure domain
- Object storage: versioning/retention or replicated backup consistent with proof retention policy
- Configuration: infrastructure as code, migration history, template versions, and secret-recovery procedure
- Restore drill: isolated environment, integrity checks, row/control-total reconciliation, object hash sampling, application smoke tests
- Key loss/rotation: document how encrypted backups remain recoverable without broad permanent access

Do not include demo credentials in production backups. Restrict backup access more tightly than application read access and log every restore/export.

## Privacy, security, and compliance gate

Before processing real patient information, commission legal/privacy/security reviews for the exact service, data categories, hospitals, processors/subprocessors, cross-border flows, and current Pakistan requirements. This guide is operational guidance, not legal advice.

The launch gate should cover:

- Data inventory/classification, purpose limitation, consent/legal basis, notices, and tenant/controller/processor responsibilities
- Per-tenant authorization tests, least privilege, MFA for privileged accounts, password/session policy, and periodic access review
- Encryption in transit/at rest, key management, secrets rotation, vulnerability/patch management, penetration testing, and dependency response
- Support-access approval, reason, visible banner, time limit, audit, emergency access, and review
- Patient/financial/audit retention schedules, legal hold, export, correction, deletion/anonymization, and tenant offboarding
- No automatic clinical-data deletion because a subscription is overdue
- Business continuity, incident/breach response, notification assessment, vendor agreements, staff training, and audit evidence
- Aggregation/minimization of Super Admin metrics so platform dashboards do not expose patient medical or patient-billing detail

Run threat modeling and independent penetration/tenant-isolation tests before launch and after material authentication, payment, storage, or tenancy changes.

## Production readiness sign-off

Do not describe the system as production-ready for real hospitals until all applicable items below have owners and evidence:

- [ ] PostgreSQL provider, reviewed migrations, data migration, reconciliation, and restore drill
- [ ] Private object storage, malware scanning, retention, and access logging
- [ ] TLS/proxy/WAF/rate limits/CORS/CSP/CSRF design verified
- [ ] Secrets manager, MFA, account lockout, session rotation/revocation, and production password-reset delivery
- [ ] Reliable scheduler/queue, email integration, retries, dead-letter handling, and alarms
- [ ] Safepay merchant sandbox certification, live change control, and reconciliation
- [ ] Audit/SIEM, monitoring, on-call, incident response, and disaster recovery exercised
- [ ] Browser E2E, accessibility, PostgreSQL, load, backup/restore, security, and tenant-isolation testing passed
- [ ] Privacy/legal/compliance, retention, processor agreements, and hospital acceptance completed

Until then, operate it as a fictional-data demonstration on isolated infrastructure.
