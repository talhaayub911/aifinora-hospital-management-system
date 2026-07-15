# AI Finora Multi-Hospital SaaS Demo

AI Finora is a locally runnable, Pakistan-focused multi-hospital SaaS demonstration. It preserves the original light-blue/white hospital interface and operational patient workflows while adding tenant isolation, authenticated roles, configurable plans/modules, separate SaaS billing, manual payment verification, optional Safepay boundaries, and a dedicated Super Admin portal.

This repository is suitable for demonstration and further engineering. It is **not cleared for real patient or payment data** until the production integration and compliance gate in [Cloud deployment and integration guide](./docs/CLOUD-DEPLOYMENT.md) is completed.

## What is included

- Public login, password reset demonstration, and masked payment-status lookup
- AI Finora Super Admin portal for hospitals, onboarding, plan versions, subscriptions, SaaS invoices, proofs, users, support, audit, and settings
- Hospital portal whose effective access is the intersection of tenant, role, plan/modules, and subscription state
- Separate patient invoices and AI Finora subscription invoices
- One-time implementation fee plus monthly/annual recurring invoices
- Manual bank-proof submission, review, rejection/resubmission, approval, receipt, and duplicate protection
- Trial, pending-payment, active, past-due, grace-period, read-only, paused, suspended, canceled, and reactivation behavior
- Explicit, reason-required, visible, time-limited, audited, read-only support access
- Safepay hosted-payment/webhook structure with demo labeling when merchant integration is not certified
- Deterministic fictional seed data, integration tests, linting, CI, and a production build

## Architecture

```text
React/Vite browser application
  |-- public/auth routes
  |-- /hospital/*       authenticated hospital tenant
  `-- /super-admin/*    platform SaaS administration
             |
             v
Express /api
  |-- JWT/HttpOnly-cookie authentication
  |-- tenant + role + feature + subscription enforcement
  |-- subscription/invoice/payment/audit transactions
  `-- private proof-file and Safepay provider boundaries
             |
             v
Prisma + SQLite (local demo)
```

Every hospital-owned operational query derives `hospitalId` from the verified principal. Client-supplied tenant IDs are not trusted. Super Admin responses use safe user projections and do not normally expose patient medical or patient billing data.

Technology: React 19, Vite, React Router, Node.js 22, Express, Prisma, SQLite, JWT, bcrypt, Zod, Multer, Vitest, Supertest, and ESLint.

## Project structure

```text
src/
  components/          shared and Super Admin UI
  context/             authenticated session state
  guards/              route and account-kind protection
  pages/auth/          login, reset, and first-password flows
  pages/hospital/      preserved tenant hospital workspace
  pages/super-admin/   platform SaaS administration
  services/            browser API client
server/
  prisma/              schema, checked-in migrations, and fictional seed
  scripts/             safe database bootstrap and bundle checks
  src/middleware/      authentication, tenancy, access, upload, and errors
  src/routes/          public, hospital, platform, file, and webhook APIs
  src/services/        onboarding, billing, lifecycle, audit, and providers
  tests/                integration contract
docs/                   API, cloud launch guide, and change record
deploy/                 Nginx demonstration configuration
```

## Requirements

- Node.js 22.12 or newer
- npm 10 or newer

## Quick start

Clone/copy the project into a writable directory, then on Windows PowerShell:

```powershell
npm ci
Copy-Item .env.example .env
npm run db:bootstrap:demo
npm run dev
```

On macOS/Linux:

```bash
npm ci
cp .env.example .env
npm run db:bootstrap:demo
npm run dev
```

Open:

- Frontend: `http://localhost:5173`
- API: `http://localhost:3001`
- Health: `http://localhost:3001/api/health`

`npm run db:bootstrap:demo` generates Prisma Client, creates a valid SQLite database, applies checked-in migrations, and seeds fictional data only when the database is empty. It is safe to run again without resetting an existing database.

Convenience launchers perform install-if-needed, migration/bootstrap, seed-if-empty, and development startup:

```text
start-demo.bat    Windows
./start-demo.sh   macOS/Linux
```

Do not use `npm run seed` against data you need: the direct seed command resets the deterministic demo dataset. Production must never install these credentials.

## Demonstration accounts

All names and records are fictional. Passwords are stored as bcrypt hashes.

| Account | Hospital code | Email | Password |
|---|---|---|---|
| AI Finora Super Admin | Leave blank | `admin@aifinora.com` | `Admin@123` |
| Hospital Admin | `akram-medical` | `hospitaladmin@example.com` | `Hospital@123` |
| Receptionist | `akram-medical` | `receptionist@example.com` | `Reception@123` |
| Billing Officer | `akram-medical` | `billing@example.com` | `Billing@123` |
| Accountant | `akram-medical` | `accountant@example.com` | `Accounts@123` |

Seeded tenant scenarios include an active Growth hospital, a past-due Starter hospital, and a trialing Enterprise hospital.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start frontend and API together; stop both if either fails |
| `npm run dev:client` | Vite frontend only |
| `npm run dev:server` | Express API with Node watch mode |
| `npm start` | Express API without watch mode |
| `npm run db:bootstrap:demo` | Generate, migrate, and seed only an empty local demo DB |
| `npm run db:bootstrap` | Generate and apply migrations without demo seeding |
| `npm run migrate` | Create/apply migrations during local development only |
| `npm run migrate:deploy` | Apply checked-in migrations in a release job |
| `npm run prisma:generate` | Generate Prisma Client |
| `npm run seed` | Destructively reset the fictional demo dataset |
| `npm run lint` | Run strict JavaScript/React lint checks |
| `npm run test` | Generate Prisma Client and run integration tests |
| `npm run build` | Create the Vite production bundle in `dist/` with the demo-account picker forced off |
| `npm run verify:bundle` | Fail if the production bundle embeds configured demo emails/passwords |
| `npm run verify` | Lint, test, build, and scan the bundle for demo credentials |

`db:push` remains available for disposable schema prototyping but is not a production deployment command. Commit reviewed migrations instead.

## Core workflows

### Onboard a hospital

1. Sign in as the AI Finora Super Admin and open **Add Hospital**.
2. Complete hospital details, subscription terms, limits/modules, and first administrator.
3. Review and create. The backend transaction creates the tenant, roles/admin, plan assignment, subscription, separate implementation and recurring invoices when applicable, notifications, and audit record.
4. Print the onboarding confirmation. The temporary-password user must change it before hospital-data APIs are available.

Plan edits create a new version; existing assignments and historical invoices are retained.

### Verify a manual bank transfer

1. A Hospital Administrator opens **Subscription & Billing**, selects an outstanding SaaS invoice, and submits amount, bank, unique reference, date, and PNG/JPEG/PDF proof.
2. A Super Admin opens **Payment Verification**, marks it under review, and approves, rejects with reason, requests information, or flags a duplicate.
3. Approval atomically creates the SaaS payment/receipt, recalculates the invoice, updates subscription access/period where applicable, notifies the hospital, and writes audit history.
4. Rejection does not extend access and may be resubmitted as a linked new proof.

Proofs are not public static files. Production still requires private object storage and malware scanning.

### Process renewal and access states

The Super Admin processing action demonstrates the job intended for a daily production worker. It creates renewal invoices/reminders idempotently and progresses unpaid subscriptions without deleting tenant data.

- `TRIALING`, `ACTIVE`, `PAST_DUE`, `GRACE_PERIOD`: permitted-plan operational access, with warnings where applicable
- `PENDING_PAYMENT`: onboarding/billing/export/support only
- `READ_ONLY`, `PAUSED`: existing data, reports, printing, billing/export/support; operational writes blocked by the API
- `SUSPENDED`, `CANCELED`: other users cannot sign in; designated Hospital Administrators receive billing/export/support-only access

### Support access

Super Admin support access requires a reason and warning acknowledgement. It creates a time-limited session and audit events, shows a visible banner in the hospital portal, and remains read-only. Ending or expiry revokes the support token.

## Configuration

Copy `.env.example` to `.env`. Important groups are:

- Origins: `APP_BASE_URL`, `API_BASE_URL`, `VITE_API_BASE_URL`, `CLIENT_ORIGIN`
- Database: `DATABASE_URL` (SQLite in the checked-in schema)
- Authentication: `JWT_SECRET`, session lifetimes
- Demo controls: `DEMO_MODE`
- Notifications: `EMAIL_PROVIDER=local_simulation|disabled`; simulation never sends a message or reports delivery
- Local credential helper: `VITE_SHOW_DEMO_ACCOUNTS` and `VITE_DEMO_*` (public build-time values; never set them in production)
- Proofs: `UPLOAD_DIR`, `MAX_UPLOAD_BYTES`
- Bank display instructions
- Safepay sandbox/live credentials, webhook secret, endpoints, and demo mode

Never commit `.env`, real credentials, JWT secrets, banking secrets, payment proofs, or local databases.

The login-page account picker is opt-in. The supplied local `.env.example` enables it for the fictional seed, while Docker/cloud builds explicitly set `VITE_SHOW_DEMO_ACCOUNTS=false` and do not embed demo emails or passwords.

Important: Prisma's datasource provider is currently `sqlite`. A PostgreSQL URL alone does not switch providers. Follow the reviewed migration process in the cloud guide.

## Safepay configuration

The default is a safe simulated flow: keep `SAFEPAY_DEMO_MODE=true` and leave merchant credentials empty. The hospital UI then labels the action **Safepay Demo** and cannot activate a subscription as a real payment.

For a merchant sandbox, configure the Safepay public/secret keys, webhook secret, environment, API base URL, and create-link URL in the deployment secret manager, then set `SAFEPAY_DEMO_MODE=false`. Register `POST /api/webhooks/safepay` as the provider callback. A payment changes financial/subscription state only after the backend verifies an invoice-bound intent, signature, amount, currency, and idempotent event; a browser return URL is never sufficient.

The included adapter is a structural integration boundary, not proof of merchant acceptance. Reconcile its request/signature contract against the current Safepay merchant documentation and complete sandbox webhook/retry certification before enabling live checkout. See the cloud guide for the release gate.

## Docker demonstration

The included Compose topology runs a one-shot migration/seed container, an internal Express API, and Nginx serving the Vite UI while proxying `/api`:

```powershell
$secretBytes = [byte[]]::new(48)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($secretBytes)
$env:JWT_SECRET = [Convert]::ToBase64String($secretBytes)
docker compose up --build
```

Open `http://localhost:8080`. Named volumes persist the SQLite database and proof uploads. This configuration is a single-replica demonstration, not the recommended production database/storage topology.

## Verification

Run before handing off a change:

```bash
npm ci
npm run verify
```

The integration suite initializes its own disposable database and checks deterministic seeding, authentication/roles/lockout, safe projections, temporary-password enforcement and rotation, tenant isolation and direct ID substitution, restricted subscription states, overdue lifecycle reruns, invoice/payment transitions, proof approval/duplicates/content/resubmission binding/review state, plan limits, renewal idempotency, and Safepay intent/signature/amount/currency/retry behavior. The CI workflow runs generation, lint, tests, build, and the production-bundle credential scan on pushes and pull requests.

## Documentation

- [API reference](./docs/API.md) — authentication, errors, route matrix, examples, state/idempotency rules
- [Cloud deployment and integration guide](./docs/CLOUD-DEPLOYMENT.md) — database migration, TLS/proxy, secrets, storage, scheduler, email, Safepay, backups, monitoring, and compliance gate
- [SaaS change record](./docs/SAAS-CHANGELOG.md) — preserved baseline and major-file history

## Production gate

The local demo deliberately uses fictional records, SQLite, local private proof files, a manual scheduler trigger, in-app notifications plus a non-delivering email simulation boundary, browser print-to-PDF, and a structural Safepay adapter. Real deployment requires, at minimum, reviewed PostgreSQL migrations, private object storage and scanning, hardened auth/MFA/rate limits/CSRF strategy, a real transactional email adapter and durable outbox/worker queues, tested backups/restore, monitoring/incident response, Safepay merchant certification/reconciliation, browser/load/security testing, and healthcare/privacy/legal sign-off.

See the cloud guide for the evidence-based launch checklist. Do not claim real Safepay payment capability without valid merchant credentials and verified sandbox/live webhook behavior.
